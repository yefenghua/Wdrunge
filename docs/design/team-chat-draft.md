# 团队群聊与工作日志草稿

当前页面用同一组工位展示六位 Agent 的状态；右侧顶部标签切换群聊与工作日志。左侧保存可切换的聊天历史。子 Agent 的具体任务内容和工具入参属于内部执行信息。

## 消息投递

用户消息以完整对话历史和固定的 `conversation_id` 发送给 `/api/chat/stream`。Leader 可直接回复、用 `delegate_task` 交给单个成员，或用 `delegate_tasks` 将互不依赖的任务同时交给多位成员。每项任务包含内部 `task`、私有 `handoff`、上下文模式 `context_mode`，以及对用户公开的简短 `summary`。同一次批量派活在群聊中合为一条 Leader 消息，每个 `@成员 summary` 占一行。每行已读圆点紧跟在对应的 `@成员` 后面。成员开始处理时，以群聊消息 ID 和成员 ID 发送 `read_receipt`，并发送简短确认消息。成员完成时，以 `message_reaction` 在原派活消息下面显示 `Done` 反应，不再发送完成聊天。批量成员并行处理，结果返回 Leader 后再由 Leader 汇总。

目前的“已读”表示成员开始接收任务，不代表模型理解或完成任务。后续如需可靠投递，可增加持久化消息、队列、明确的接收确认和重试机制。

## 上下文续接与交接

Leader 为每次派活选择 `fresh`、`continue` 或 `auto`。`fresh` 为该聊天中的成员创建干净的 LangGraph 线程，只提供角色提示词、当前任务和 `handoff`；`continue` 续接该成员在同一聊天中的线程，若线程不存在则安全退化为 `fresh`；`auto` 在存在可靠用量数据时续接，并由运行时在达到阈值时分级压缩旧上下文。若模型未提供用量，`auto` 从干净线程开始。`handoff` 应写明目标、用户约束、已完成决定及有关文件路径，不能依赖成员记得旧对话。

Leader 可在阶段节点单独调用 `checkpoint_context`，保存目标、约束、产物路径、已完成和待办。之后同一聊天的 Leader 上下文由这份结构化摘要和后续消息构成。不同 `conversation_id` 的成员线程与 Leader 检查点相互隔离。它们目前只保存在后端进程内，重启后下一次派活会从干净线程开始；关键决定仍须写入项目文档。

自动压缩与人工 checkpoint 并存：人工 checkpoint 是受保护的高优先级记忆；自动压缩只处理其后的过期前缀，并始终保留最近原始消息。压缩输入按有限 token 分块，再逐层归并摘要，不会把完整历史一次发送给摘要模型。详细策略见 [`context-compression-strategy.md`](context-compression-strategy.md)。

## SSE 可见事件

| 事件 | 用途 | 关键字段 |
| --- | --- | --- |
| `status` | 更新工位状态 | `id`, `status` |
| `chat_message` | 显示群聊文本；批量派活为一条多行消息 | `id`, `sender`, `content`, 可选 `mentions[]` |
| `read_receipt` | 更新被 @ 消息的已读状态 | `message_id`, `reader` |
| `message_reaction` | 在原派活消息下标记成员完成 | `message_id`, `worker`, `reaction: done` |
| `activity` | 更新一次工具调用的时间线条目 | `id`, `agent`, `tool`, `description`, `phase` |
| `usage` | 更新累计 Token 与成员上下文占比 | `total_tokens`, `agents` |
| `delta` | Leader 的最终回复 | `role`, `content` |
| `done` / `error` | 结束或报错 | 可选 `message` |

同一工具调用的 `activity` 使用同一个 ID，先发 `running`，再发 `completed` 或 `failed`。日志描述由服务端固定映射生成；工具入参、文件内容、原始输出和完整派活任务不会发到前端。聊天历史与时间线保存在本机浏览器存储中；Token 用量由后端当前运行实例统计。上下文占比采用模型最近一次输入 Token 与配置的 `QWEN_CONTEXT_WINDOW` 相除，默认分母仅是草稿配置，部署时须按实际模型调整。
