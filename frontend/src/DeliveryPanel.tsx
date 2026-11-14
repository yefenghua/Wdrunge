import { DeliveryTree, type DeliveryState } from './DeliveryFiles';
import './CollaborationPanel.css';

export default function DeliveryPanel({ files, selected, onOpen }: {
  files: DeliveryState;
  selected: string | null;
  onOpen: (path: string) => void;
}) {
  return <section className="collaboration-panel delivery-panel" role="tabpanel" aria-label="Delivery files">
    <header><strong>Delivery files</strong><span>Select a file to preview it</span></header>
    <DeliveryTree files={files} selected={selected} onOpen={onOpen} />
  </section>;
}
