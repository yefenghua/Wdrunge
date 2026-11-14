import { selectionLabel, type VisualAnnotation, type VisualContext } from './visualFeedback';
import './AnnotationDrafts.css';

export default function AnnotationDrafts({ items, current, disabled, onChange, onClearSelection }: {
  items: VisualAnnotation[]; current: VisualContext | null; disabled: boolean;
  onChange: (items: VisualAnnotation[]) => void; onClearSelection: () => void;
}) {
  if (!items.length && !current) return null;
  return <div className="annotation-drafts" aria-label="Visual feedback drafts">
    {current && <div className="annotation-current"><span>Current selection · {selectionLabel(current)}</span>
      <button type="button" disabled={disabled} onClick={onClearSelection} aria-label="Remove current selection">×</button>
      <small>Type below to send this selection with your message, or add an annotation beside the page.</small></div>}
    {!!items.length && <details open className="annotation-list">
      <summary>{items.length} {items.length === 1 ? 'annotation' : 'annotations'} <small>Sent with this message</small></summary>
      <div>{items.map((item, index) => <article key={item.id}>
        <header><strong><i>{index + 1}</i>{selectionLabel(item.context)}</strong>
          <button type="button" disabled={disabled} aria-label={`Delete annotation ${index + 1}`} onClick={() => onChange(items.filter(value => value.id !== item.id))}>×</button></header>
        <textarea aria-label={`Edit annotation ${index + 1}`} maxLength={2000} disabled={disabled} value={item.comment}
          onChange={event => onChange(items.map(value => value.id === item.id ? { ...value, comment: event.target.value } : value))} rows={2} />
        <small title={item.context.url}>{item.context.url}</small>
      </article>)}</div>
    </details>}
  </div>;
}
