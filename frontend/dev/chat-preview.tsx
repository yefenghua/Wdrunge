import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import AgentAvatar from '../src/AgentAvatar';
import MessageContent from '../src/MessageContent';
import { memberName } from '../src/TeamIdentity';
import '../src/App.css';

const delivery = `## API delivery notes

The **team members endpoint** is ready for frontend integration.

### Deliverables
- [x] Return member names and roles
- [x] Keep existing agent IDs
- [ ] Frontend acceptance

| Field | Type | Description |
| :--- | :--- | :--- |
| id | string | Unique member ID |
| name | string | Name (role) |

\`\`\`ts
const response = await fetch("http://localhost:17420/api/team");
const { agents } = await response.json();
\`\`\`

> Keep using English IDs in request parameters.

See the [Markdown guide](https://commonmark.org/help/). The field is \`name\`.`;

function Preview() {
  const [read, setRead] = useState(true);
  return <main style={{ minHeight: '100vh', padding: 20, background: '#f3f3f0' }}>
    <div style={{ margin: '0 auto', width: 'min(410px, 100%)' }}>
      <button type="button" onClick={() => setRead(!read)} style={{ marginBottom: 12 }}>Toggle frontend read status</button>
      <section className="chat-panel" style={{ border: '1px solid #e3e3df', borderRadius: 12, overflow: 'hidden' }}>
        <header className="panel-heading"><div><strong>Team chat</strong><span>Markdown deliverables · mentions and read status</span></div></header>
        <div className="chat-feed" style={{ flex: 'none', overflow: 'visible' }}>
          <article className="chat-message"><AgentAvatar agent="leader" /><div className="message-body"><div className="message-meta"><strong>{memberName('leader')}</strong><time>20:10</time></div><div className="bubble"><MessageContent message={{ id: 'assign', sender: 'leader', content: '', mentions: [
            { worker: 'frontend', name: 'Frontend', summary: 'Use the **delivery notes** to integrate the page.' },
            { worker: 'backend', name: 'Backend', summary: 'Document the `GET /api/team` endpoint.' },
          ], readBy: read ? ['frontend', 'backend'] : ['backend'] }} /></div><div className="message-reactions"><span className="done-reaction"><span>✓</span> Done · {memberName('backend')}</span></div></div></article>
          <article className="chat-message"><AgentAvatar agent="backend" /><div className="message-body"><div className="message-meta"><strong>{memberName('backend')}</strong><time>20:12</time></div><div className="bubble"><MessageContent message={{ id: 'delivery', sender: 'backend', content: delivery }} /></div></div></article>
        </div>
      </section>
    </div>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Preview />);
