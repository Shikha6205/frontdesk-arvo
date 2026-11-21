import { useEffect, useState } from 'react';

const API = import.meta.env.DEV ? 'http://localhost:5000/api' : '/api';

export default function App() {
  const [viewMode, setViewMode] = useState('AGENT'); // 'AGENT' or 'CUSTOMER'
  const [agents, setAgents] = useState([]);
  const [currentAgent, setCurrentAgent] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [filter, setFilter] = useState('ALL');
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  // Agent reply form
  const [replyText, setReplyText] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [waitForCustomer, setWaitForCustomer] = useState(false);

  // Customer portal state
  const [custSubject, setCustSubject] = useState('');
  const [custName, setCustName] = useState('Anita Verma');
  const [custEmail, setCustEmail] = useState('anita@client.com');
  const [custPriority, setCustPriority] = useState('MEDIUM');
  const [custMessage, setCustMessage] = useState('');
  const [custTicketId, setCustTicketId] = useState('');
  const [custTicketData, setCustTicketData] = useState(null);
  const [custReply, setCustReply] = useState('');

  const loadTickets = async () => {
    const res = await fetch(`${API}/tickets`);
    const data = await res.json();
    setTickets(data);
  };

  const loadTicketDetail = async (id) => {
    setSelectedId(id);
    setErrorMsg('');
    const res = await fetch(`${API}/tickets/${id}`);
    setDetail(await res.json());
  };

  useEffect(() => {
    fetch(`${API}/agents`).then(r => r.json()).then(data => {
      setAgents(data);
      if (data.length) setCurrentAgent(data[0]);
    });
    loadTickets();
  }, []);

  const handleClaim = async (id) => {
    setErrorMsg('');
    const res = await fetch(`${API}/tickets/${id}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: currentAgent.id, agent_name: currentAgent.name })
    });
    const data = await res.json();
    if (!res.ok) {
      setErrorMsg(data.error);
    }
    loadTickets();
    loadTicketDetail(id);
  };

  const handleAgentSend = async (e) => {
    e.preventDefault();
    if (!replyText.trim()) return;
    await fetch(`${API}/tickets/${selectedId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender_type: 'AGENT',
        sender_name: currentAgent.name,
        body: replyText,
        is_internal: isInternal,
        wait_for_customer: !isInternal && waitForCustomer
      })
    });
    setReplyText('');
    setWaitForCustomer(false);
    loadTickets();
    loadTicketDetail(selectedId);
  };

  const handleUpdateTicket = async (updates) => {
    await fetch(`${API}/tickets/${selectedId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...updates, actor_name: currentAgent.name })
    });
    loadTickets();
    loadTicketDetail(selectedId);
  };

  const handleAutoClose = async () => {
    const res = await fetch(`${API}/system/auto-close`, { method: 'POST' });
    const data = await res.json();
    alert(`Auto-closed ${data.closedCount} inactive ticket(s).`);
    loadTickets();
    if (selectedId) loadTicketDetail(selectedId);
  };

  // Customer Portal handlers
  const handleCreateTicket = async (e) => {
    e.preventDefault();
    const res = await fetch(`${API}/tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject: custSubject,
        customer_name: custName,
        customer_email: custEmail,
        priority: custPriority,
        message: custMessage
      })
    });
    const data = await res.json();
    setCustSubject('');
    setCustMessage('');
    setCustTicketId(String(data.id));
    fetchCustomerTicket(data.id);
    loadTickets();
  };

  const fetchCustomerTicket = async (id) => {
    const res = await fetch(`${API}/customer/tickets/${id}`);
    if (res.ok) setCustTicketData(await res.json());
    else alert('Ticket not found');
  };

  const handleCustomerReply = async (e) => {
    e.preventDefault();
    if (!custReply.trim()) return;
    const res = await fetch(`${API}/tickets/${custTicketData.ticket.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender_type: 'CUSTOMER',
        sender_name: custTicketData.ticket.customer_name,
        body: custReply
      })
    });
    const data = await res.json();
    setCustReply('');
    const targetId = data.redirectedToNewTicketId || custTicketData.ticket.id;
    if (data.redirectedToNewTicketId) {
      alert(`1-week reopen window passed! Created new ticket #${targetId}.`);
      setCustTicketId(String(targetId));
    }
    fetchCustomerTicket(targetId);
    loadTickets();
  };

  const filteredTickets = tickets.filter(t => {
    if (filter === 'OVERDUE') return t.is_overdue;
    if (filter === 'WAITING') return t.status === 'WAITING_ON_CUSTOMER';
    if (filter === 'UNASSIGNED') return !t.assigned_agent_id;
    if (filter === 'RESOLVED') return ['RESOLVED', 'CLOSED'].includes(t.status);
    return true;
  });

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 1200, margin: '0 auto', padding: 20, color: '#1e293b' }}>
      {/* Top Navbar */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #e2e8f0', paddingBottom: 14, marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Arvo Frontdesk</h1>
          <small style={{ color: '#64748b' }}>Working Hours: Mon–Fri, 09:30 – 18:30 (Weekends & Holidays Paused)</small>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {viewMode === 'AGENT' && currentAgent && (
            <label style={{ fontSize: 14 }}>
              Logged in as:{' '}
              <select
                value={currentAgent.id}
                onChange={e => setCurrentAgent(agents.find(a => a.id === Number(e.target.value)))}
                style={{ padding: '6px 10px', borderRadius: 6 }}
              >
                {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
          )}
          <button
            onClick={() => setViewMode(viewMode === 'AGENT' ? 'CUSTOMER' : 'AGENT')}
            style={{ padding: '8px 14px', borderRadius: 6, border: 'none', background: '#0f172a', color: '#fff', cursor: 'pointer' }}
          >
            Switch to {viewMode === 'AGENT' ? 'Customer Portal' : 'Agent Dashboard'}
          </button>
        </div>
      </header>

      {viewMode === 'AGENT' ? (
        <div>
          {/* Filter Bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                ['ALL', `All (${tickets.length})`],
                ['OVERDUE', `Late / Overdue (${tickets.filter(t => t.is_overdue).length})`],
                ['WAITING', `Waiting on Customer (${tickets.filter(t => t.status === 'WAITING_ON_CUSTOMER').length})`],
                ['UNASSIGNED', `Unassigned (${tickets.filter(t => !t.assigned_agent_id).length})`],
                ['RESOLVED', 'Resolved / Closed']
              ].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 6,
                    border: '1px solid #cbd5e1',
                    background: filter === key ? '#2563eb' : '#fff',
                    color: filter === key ? '#fff' : '#1e293b',
                    cursor: 'pointer'
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <button onClick={handleAutoClose} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#f8fafc', cursor: 'pointer' }}>
              Run 1-Week Auto-Close Check
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: selectedId ? '1fr 1.2fr' : '1fr', gap: 20 }}>
            {/* Ticket List */}
            <div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ background: '#f1f5f9', textAlign: 'left' }}>
                    <th style={{ padding: 10 }}>ID</th>
                    <th style={{ padding: 10 }}>Subject & Customer</th>
                    <th style={{ padding: 10 }}>Priority</th>
                    <th style={{ padding: 10 }}>Status / SLA</th>
                    <th style={{ padding: 10 }}>Agent</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTickets.map(t => (
                    <tr
                      key={t.id}
                      onClick={() => loadTicketDetail(t.id)}
                      style={{
                        borderBottom: '1px solid #e2e8f0',
                        cursor: 'pointer',
                        background: selectedId === t.id ? '#eff6ff' : '#fff'
                      }}
                    >
                      <td style={{ padding: 10 }}>#{t.id}</td>
                      <td style={{ padding: 10 }}>
                        <strong>{t.subject}</strong>
                        <div style={{ fontSize: 12, color: '#64748b' }}>{t.customer_name}</div>
                      </td>
                      <td style={{ padding: 10 }}>
                        <span style={{
                          padding: '2px 8px',
                          borderRadius: 4,
                          fontSize: 12,
                          fontWeight: 600,
                          background: t.priority === 'HIGH' ? '#fee2e2' : t.priority === 'MEDIUM' ? '#fef3c7' : '#e0f2fe',
                          color: t.priority === 'HIGH' ? '#b91c1c' : t.priority === 'MEDIUM' ? '#b45309' : '#0369a1'
                        }}>
                          {t.priority}
                        </span>
                      </td>
                      <td style={{ padding: 10 }}>
                        <div>{t.status.replaceAll('_', ' ')}</div>
                        {t.is_overdue && (
                          <span style={{ display: 'inline-block', marginTop: 4, padding: '2px 6px', background: '#dc2626', color: '#fff', borderRadius: 4, fontSize: 11, fontWeight: 700 }}>
                            LATE / SLA BREACHED
                          </span>
                        )}
                        {t.status === 'WAITING_ON_CUSTOMER' && (
                          <span style={{ display: 'inline-block', marginTop: 4, padding: '2px 6px', background: '#f59e0b', color: '#fff', borderRadius: 4, fontSize: 11 }}>
                            TIMER PAUSED
                          </span>
                        )}
                      </td>
                      <td style={{ padding: 10 }}>{t.assigned_agent_name || <em>Unassigned</em>}</td>
                    </tr>
                  ))}
                  {filteredTickets.length === 0 && (
                    <tr><td colSpan={5} style={{ padding: 20, textAlign: 'center', color: '#64748b' }}>No tickets in this view. Switch to Customer Portal to create one!</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Ticket Detail Split Panel */}
            {detail && (
              <div style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: 16, background: '#fff' }}>
                {errorMsg && <div style={{ padding: 10, background: '#fee2e2', color: '#b91c1c', borderRadius: 6, marginBottom: 10 }}>{errorMsg}</div>}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', borderBottom: '1px solid #e2e8f0', paddingBottom: 12 }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: 18 }}>#{detail.ticket.id} — {detail.ticket.subject}</h2>
                    <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>
                      From: {detail.ticket.customer_name} ({detail.ticket.customer_email})
                    </p>
                  </div>
                  {!detail.ticket.assigned_agent_id && (
                    <button
                      onClick={() => handleClaim(detail.ticket.id)}
                      style={{ padding: '8px 14px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
                    >
                      Take This Ticket
                    </button>
                  )}
                </div>

                {/* Controls */}
                <div style={{ display: 'flex', gap: 12, margin: '12px 0', fontSize: 13 }}>
                  <label>
                    Priority:{' '}
                    <select value={detail.ticket.priority} onChange={e => handleUpdateTicket({ priority: e.target.value })}>
                      <option value="LOW">LOW</option>
                      <option value="MEDIUM">MEDIUM</option>
                      <option value="HIGH">HIGH (Urgent)</option>
                    </select>
                  </label>
                  <label>
                    Status:{' '}
                    <select value={detail.ticket.status} onChange={e => handleUpdateTicket({ status: e.target.value })}>
                      <option value="OPEN">OPEN</option>
                      <option value="IN_PROGRESS">IN PROGRESS</option>
                      <option value="WAITING_ON_CUSTOMER">WAITING ON CUSTOMER</option>
                      <option value="RESOLVED">RESOLVED (Done)</option>
                      <option value="CLOSED">CLOSED</option>
                    </select>
                  </label>
                </div>

                {/* Conversation Thread */}
                <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 6, padding: 10, marginBottom: 12, background: '#f8fafc' }}>
                  {detail.messages.map(m => (
                    <div
                      key={m.id}
                      style={{
                        padding: 10,
                        borderRadius: 6,
                        marginBottom: 8,
                        background: m.is_internal ? '#fef3c7' : m.sender_type === 'AGENT' ? '#dbeafe' : '#fff',
                        border: m.is_internal ? '1px solid #f59e0b' : '1px solid #e2e8f0'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                        <strong>
                          {m.sender_name} {m.is_internal ? '🔒 [PRIVATE TEAM NOTE — HIDDEN FROM CUSTOMER]' : `(${m.sender_type})`}
                        </strong>
                        <span style={{ color: '#64748b' }}>{new Date(m.created_at).toLocaleString()}</span>
                      </div>
                      <div style={{ fontSize: 14 }}>{m.body}</div>
                    </div>
                  ))}
                </div>

                {/* Reply / Private Note Box */}
                <form onSubmit={handleAgentSend}>
                  <div style={{ display: 'flex', gap: 12, marginBottom: 8, fontSize: 13 }}>
                    <label style={{ cursor: 'pointer', fontWeight: !isInternal ? 700 : 400 }}>
                      <input type="radio" checked={!isInternal} onChange={() => setIsInternal(false)} /> Public Reply to Customer
                    </label>
                    <label style={{ cursor: 'pointer', fontWeight: isInternal ? 700 : 400, color: '#b45309' }}>
                      <input type="radio" checked={isInternal} onChange={() => setIsInternal(true)} /> Private Team Note Only
                    </label>
                  </div>

                  <textarea
                    rows={3}
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    placeholder={isInternal ? 'Write internal note for team only...' : 'Write reply to customer...'}
                    style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                  />

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                    {!isInternal ? (
                      <label style={{ fontSize: 13 }}>
                        <input type="checkbox" checked={waitForCustomer} onChange={e => setWaitForCustomer(e.target.checked)} /> Ask customer & pause SLA timer
                      </label>
                    ) : <span />}

                    <button
                      type="submit"
                      style={{
                        padding: '8px 16px',
                        borderRadius: 6,
                        border: 'none',
                        background: isInternal ? '#d97706' : '#2563eb',
                        color: '#fff',
                        cursor: 'pointer'
                      }}
                    >
                      {isInternal ? 'Save Private Note' : 'Send Reply'}
                    </button>
                  </div>
                </form>

                {/* Immutable Audit Log */}
                <div style={{ marginTop: 18, borderTop: '1px solid #e2e8f0', paddingTop: 10 }}>
                  <h4 style={{ margin: '0 0 8px', fontSize: 13, color: '#475569' }}>Immutable Audit History (INC-0318)</h4>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#475569' }}>
                    {detail.auditLogs.map(log => (
                      <li key={log.id} style={{ marginBottom: 4 }}>
                        <strong>{log.action}</strong> by {log.actor_name} — {log.details} ({new Date(log.created_at).toLocaleString()})
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Customer Portal View (Demonstrates INC-0304 isolation & Reopen rules) */
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          <form onSubmit={handleCreateTicket} style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: 16 }}>
            <h2 style={{ marginTop: 0, fontSize: 18 }}>Submit a New Support Request</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input required placeholder="Your Name" value={custName} onChange={e => setCustName(e.target.value)} style={{ padding: 8 }} />
              <input required type="email" placeholder="Your Email" value={custEmail} onChange={e => setCustEmail(e.target.value)} style={{ padding: 8 }} />
              <input required placeholder="Subject" value={custSubject} onChange={e => setCustSubject(e.target.value)} style={{ padding: 8 }} />
              <select value={custPriority} onChange={e => setCustPriority(e.target.value)} style={{ padding: 8 }}>
                <option value="HIGH">Urgent — Cannot work at all (2h reply / 1d fix)</option>
                <option value="MEDIUM">Medium — Partial issue (Half-day reply / 3d fix)</option>
                <option value="LOW">Low — Question or small request (1d reply / 1w fix)</option>
              </select>
              <textarea required rows={4} placeholder="Describe your problem..." value={custMessage} onChange={e => setCustMessage(e.target.value)} style={{ padding: 8 }} />
              <button type="submit" style={{ padding: 10, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
                Submit Ticket
              </button>
            </div>
          </form>

          <div style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: 16 }}>
            <h2 style={{ marginTop: 0, fontSize: 18 }}>Check Your Ticket (Private Notes Strictly Hidden)</h2>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <input placeholder="Enter Ticket ID (e.g., 1)" value={custTicketId} onChange={e => setCustTicketId(e.target.value)} style={{ padding: 8, flex: 1 }} />
              <button onClick={() => fetchCustomerTicket(custTicketId)} style={{ padding: '8px 14px' }}>Load Ticket</button>
            </div>

            {custTicketData && (
              <div>
                <p><strong>#{custTicketData.ticket.id}: {custTicketData.ticket.subject}</strong> — Status: <strong>{custTicketData.ticket.status}</strong></p>
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: 10, marginBottom: 10, maxHeight: 240, overflowY: 'auto' }}>
                  {custTicketData.messages.map(m => (
                    <div key={m.id} style={{ marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid #f1f5f9' }}>
                      <div style={{ fontSize: 12, color: '#64748b' }}>{m.sender_name} ({m.sender_type}) • {new Date(m.created_at).toLocaleString()}</div>
                      <div>{m.body}</div>
                    </div>
                  ))}
                </div>
                <form onSubmit={handleCustomerReply} style={{ display: 'flex', gap: 8 }}>
                  <input required placeholder="Write a reply (or reopen resolved ticket)..." value={custReply} onChange={e => setCustReply(e.target.value)} style={{ flex: 1, padding: 8 }} />
                  <button type="submit" style={{ padding: '8px 14px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6 }}>Send</button>
                </form>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}