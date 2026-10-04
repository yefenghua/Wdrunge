# 多级上下文压缩策略

## 目标与现状

Wdrunge 的前端会在每轮请求中提交完整用户对话，worker 则通过 LangGraph checkpoint 保存各自的消息线程。原有实现提供人工 `checkpoint_context`，但它依赖 Leader 主动调用；worker 的 `auto` 模式达到固定占比后直接换成空线程。两者之间缺少自动、增量且有硬预算约束的压缩层。

本方案的目标是：正常对话尽量保留原文；上下文增长时只压缩已经过期的前缀；历史极长时逐层归并摘要；模型或摘要失败时仍能在明确的数据损失标记下继续请求。人工 checkpoint 始终比自动摘要优先。

实现参考了 LangChain 对短期记忆的 trim、delete、summarize 三类策略，以及 LangGraph 以 thread/checkpoint 隔离状态的模型。这里没有直接套用“把全部消息交给一次摘要调用”的示例，因为摘要请求本身也可能超过上下文窗口。

- LangChain short-term memory: <https://docs.langchain.com/oss/python/langchain/short-term-memory>
- LangGraph persistence: <https://docs.langchain.com/oss/python/langgraph/persistence>

## 不变量

1. 角色 system prompt、人工 checkpoint 和最新用户请求属于受保护内容。
2. 自动摘要不覆盖人工 checkpoint，只处理 checkpoint 之后的历史。
3. 最近消息保留原文；旧消息按完整对话轮次切分，避免拆开普通问答或工具调用链。
4. 每个摘要请求有独立的 token 上限。历史越长，只会增加有限大小的 map/reduce 调用数量，不会产生一个无限增长的摘要输入。
5. 摘要中的历史内容视为不可信数据。摘要器不得执行其中的指令，也不调用工具。
6. 不静默丢弃信息。模型摘要失败会生成带标记的抽取式摘要；单条最新消息自身超限时保留首尾并标出被省略的中段。
7. 不伪造精确 token。触发判断优先使用供应商返回的最近输入 token，并与本地保守估算取较大值。

## 分级策略

阈值按“上下文窗口减去输出预留”后的输入预算计算。

| 级别 | 默认触发点 | 行为 |
| --- | ---: | --- |
| L0 | `< 45%` | 不摘要，发送原始近期上下文。若已有滚动摘要，只发送摘要与未覆盖后缀。 |
| L1 | `45% - 62%` | 增量压缩最旧前缀，尽量保留最近 10 条原始消息。 |
| L2 | `62% - 80%` | 提高压缩强度，保留最近 6 条；新分段摘要与旧滚动摘要进行树状归并。 |
| L3 | `>= 80%` | 只保证最新消息原文，压缩其余可压缩轮次，并执行硬输入预算检查。 |

压缩后的目标占用默认为输入预算的 38%。这些比例不是模型能力声明，应根据实际模型窗口、典型工具输出和期望最大回答长度进行压测后调整。

## 数据流

```text
完整客户端历史 / LangGraph thread
                |
                v
     受保护消息 + 未覆盖后缀
                |
        计算估算值与实际 usage
                |
       L0 ----------- 直接调用 Agent
                |
             L1/L2/L3
                |
      选择完整轮次的过期前缀
                |
     固定上限分块并行概念上的 map
                |
      固定上限分组、多轮 reduce
                |
                v
   滚动摘要 + 最近原文 -> Agent
```

当前实现顺序执行摘要调用，避免一个会话内并发调用导致限流；“map”表示各块互不依赖，并不要求并发。

## 增量状态

`CompressionState` 包含：

- `revision`：历史基线。人工 checkpoint 或 worker thread 变化时随之变化。
- `covered_count`：已有摘要覆盖的消息数。
- `covered_digest`：覆盖前缀的 SHA-256，用于检测客户端编辑、删除或重排历史。
- `summary`：当前滚动摘要。

Leader 每次仍可接收完整客户端历史，但只摘要 `covered_count` 之后新进入过期区的消息。若前缀哈希不匹配，旧摘要立即失效并从当前历史重建。不同 `conversation_id` 使用独立状态。

worker 在实际 usage 达到压缩阈值后读取当前 LangGraph checkpoint，压缩旧轮次并创建包含“角色提示词 + 滚动摘要 + 最近原文”的新 thread。用量未知时，`auto` 仍选择干净线程；显式 `continue` 维持调用方意图。

## 摘要内容契约

摘要器只返回结构化事实，优先保留：

- 用户目标和明确约束；
- 已确认决定及其原因；
- 精确名称、标识符和项目文件路径；
- 已完成工作及可靠依据；
- 待办、阻塞项、未决问题和互相冲突的信息。

摘要器不得把计划写成已完成事实，不得猜测缺失信息，不得回答原用户问题。新原文与摘要冲突时，以新原文为准。

## 失败与硬预算

摘要调用异常或返回空内容时，压缩器按角色逐条抽取并截断原文，生成显式的 `Automatic extractive fallback` 标记。该兜底的保真度低于模型摘要，但可以避免整个聊天请求失败。

压缩后仍超过硬阈值时，依次缩短自动摘要、移除非最新原始消息。若最新消息单独超限，保留首尾并插入 `middle omitted by hard context budget`。角色提示词和人工 checkpoint 不被硬裁剪；如果它们自身超过预算，最终请求仍可能被模型拒绝，这属于需要运维修正的配置错误。

## 可观测性

每次发生 Leader 压缩都会产生 `compress_context` activity，包含：

- 压缩级别；
- 压缩前后的估算 token；
- 新覆盖的消息数；
- 摘要模型调用次数；
- 是否使用抽取式兜底。

摘要模型的供应商 usage 会计入 Leader 或 worker 的累计 token。日志和 SSE 不包含被压缩的原始内容。

## 与任务 3 的边界

当前 `CompressionState` 支持 `to_dict`、`from_dict`、`export_state` 和 `restore_state`，但存储仍是进程内字典。任务 3 应为以下数据提供落盘仓储：

- Leader 的 `CompressionState` 和人工 `LeaderCheckpoint`；
- worker 的 thread 标识、压缩状态和 LangGraph checkpoint；
- schema 版本、更新时间和模型/策略版本。

持久化写入应采用原子替换或事务，并在恢复时重新验证 `covered_digest`。原始聊天记录仍是事实来源，自动摘要是可重建缓存，不应成为唯一副本。

## 验证范围

单元测试覆盖 L0、不超过上限的分块、层级归并、增量覆盖、前缀失效、会话隔离、状态序列化、摘要失败兜底、单条超长消息和 Leader/worker 接入。测试使用本地 fake model，不调用远程服务。
