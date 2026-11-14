import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import type { TeamChatMessage } from "./api";
import { memberName, mentionPrefix } from "./TeamIdentity";
import { readAnnotationMessage, selectionLabel } from './visualFeedback';
import "./MessageContent.css";

type Message = TeamChatMessage & { read?: boolean; readBy?: string[] };
const plugins = [remarkGfm, remarkBreaks];
const components: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
  table: ({ node: _node, ...props }) => <div className="markdown-table" role="region" aria-label="Table, scroll horizontally" tabIndex={0}><table {...props} /></div>,
  pre: ({ node: _node, ...props }) => <pre {...props} tabIndex={0} aria-label="Code block, scroll horizontally" />,
  img: ({ node: _node, ...props }) => <img {...props} loading="lazy" />,
};

function Markdown({ children }: { children: string }) {
  return <div className="markdown-body"><ReactMarkdown remarkPlugins={plugins} components={components} skipHtml>{children}</ReactMarkdown></div>;
}

function Mention({ worker, read }: { worker: string; read: boolean }) {
  const label = `${memberName(worker)} · ${read ? "Read" : "Unread"}`;
  return <span className="mention-token">@{memberName(worker)}<span className={`read-indicator ${read ? "read" : "unread"}`} title={label} aria-label={label} /></span>;
}

export default function MessageContent({ message }: { message: Message }) {
  const annotations = message.sender === 'user' ? readAnnotationMessage(message.content) : null;
  if (annotations) return <>
    <Markdown>{annotations.requirement}</Markdown>
    <details className="message-annotations"><summary>{annotations.items.length} site {annotations.items.length === 1 ? 'annotation' : 'annotations'}</summary>
      {annotations.items.map((item, index) => <div key={index}><strong>{index + 1}. {selectionLabel(item.context)}</strong>
        <p>{item.comment}</p><small>{item.context.url}</small></div>)}
    </details>
  </>;
  // Mentions remain structured UI, so Markdown cannot consume receipt markers.
  if (message.mentions?.length) return <>{message.mentions.map(mention => <div className="mention-line" key={mention.worker}>
    <Mention worker={mention.worker} read={(message.readBy || []).includes(mention.worker)} />{" "}
    <Markdown>{mention.summary}</Markdown>
  </div>)}</>;

  const prefix = message.mention && mentionPrefix(message.mention, message.content);
  if (message.mention && prefix) return <div className="mention-line">
    <Mention worker={message.mention} read={!!message.read} />{" "}
    <Markdown>{message.content.slice(prefix.length).trimStart()}</Markdown>
  </div>;

  return <Markdown>{message.content}</Markdown>;
}
