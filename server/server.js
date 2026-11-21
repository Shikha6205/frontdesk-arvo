const express = require('express');
const cors = require('cors');
const path = require('path');
const pool = require('./db');
const { SLA_TARGETS, addWorkingMinutes, getWorkingMinutesBetween } = require('./utils/slaCalculator');

const app = express();
app.use(cors());
app.use(express.json());

// Helper: Fetch holiday dates as ['2026-11-25', ...]
async function getHolidayDates(conn = pool) {
  const [rows] = await conn.query('SELECT DATE_FORMAT(holiday_date, "%Y-%m-%d") AS d FROM holidays');
  return rows.map(r => r.d);
}

// Helper: INC-0318 Immutable Audit Log
async function logAudit(conn, ticketId, actorName, action, details) {
  await conn.query(
    'INSERT INTO audit_logs (ticket_id, actor_name, action, details) VALUES (?, ?, ?, ?)',
    [ticketId, actorName, action, details]
  );
}

// 1. Get all agents (for dropdown switcher)
app.get('/api/agents', async (req, res) => {
  const [agents] = await pool.query('SELECT * FROM agents');
  res.json(agents);
});

// 2. Get all tickets for Agent Dashboard (with live SLA overdue calculation)
app.get('/api/tickets', async (req, res) => {
  try {
    const holidays = await getHolidayDates();
    const [tickets] = await pool.query(`
      SELECT t.*, a.name AS assigned_agent_name 
      FROM tickets t 
      LEFT JOIN agents a ON t.assigned_agent_id = a.id 
      ORDER BY t.created_at DESC
    `);

    const now = new Date();
    const enriched = tickets.map(t => {
      // If paused (waiting on customer), shift due dates forward by paused duration
      let extraPauseMins = t.paused_working_minutes || 0;
      if (t.status === 'WAITING_ON_CUSTOMER' && t.paused_at) {
        extraPauseMins += getWorkingMinutesBetween(new Date(t.paused_at), now, holidays);
      }

      const effectiveResponseDue = addWorkingMinutes(new Date(t.sla_response_due_at), extraPauseMins, holidays);
      const effectiveResolutionDue = addWorkingMinutes(new Date(t.sla_resolution_due_at), extraPauseMins, holidays);

      const isActive = !['RESOLVED', 'CLOSED', 'WAITING_ON_CUSTOMER'].includes(t.status);
      const responseBreached = !t.first_responded_at && now > effectiveResponseDue;
      const resolutionBreached = isActive && now > effectiveResolutionDue;

      return {
        ...t,
        effective_response_due: effectiveResponseDue,
        effective_resolution_due: effectiveResolutionDue,
        is_overdue: responseBreached || resolutionBreached
      };
    });

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Get single ticket details for Agent (includes internal notes + audit trail)
app.get('/api/tickets/:id', async (req, res) => {
  try {
    const [[ticket]] = await pool.query(
      'SELECT t.*, a.name AS assigned_agent_name FROM tickets t LEFT JOIN agents a ON t.assigned_agent_id = a.id WHERE t.id = ?',
      [req.params.id]
    );
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    const [messages] = await pool.query(
      'SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC',
      [req.params.id]
    );
    const [auditLogs] = await pool.query(
      'SELECT * FROM audit_logs WHERE ticket_id = ? ORDER BY created_at ASC',
      [req.params.id]
    );

    res.json({ ticket, messages, auditLogs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. INC-0304: Customer View of Ticket (STRICTLY hides internal notes & audit logs)
app.get('/api/customer/tickets/:id', async (req, res) => {
  try {
    const [[ticket]] = await pool.query(
      'SELECT id, subject, customer_name, priority, status, created_at, resolved_at FROM tickets WHERE id = ?',
      [req.params.id]
    );
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    const [messages] = await pool.query(
      'SELECT id, sender_type, sender_name, body, created_at FROM ticket_messages WHERE ticket_id = ? AND is_internal = FALSE ORDER BY created_at ASC',
      [req.params.id]
    );

    res.json({ ticket, messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Customer creates a new ticket
app.post('/api/tickets', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { subject, customer_name, customer_email, priority = 'MEDIUM', message } = req.body;
    const holidays = await getHolidayDates(conn);
    const now = new Date();
    const targets = SLA_TARGETS[priority] || SLA_TARGETS.MEDIUM;

    const responseDue = addWorkingMinutes(now, targets.responseMins, holidays);
    const resolutionDue = addWorkingMinutes(now, targets.resolutionMins, holidays);

    const [result] = await conn.query(
      `INSERT INTO tickets (subject, customer_name, customer_email, priority, created_at, sla_response_due_at, sla_resolution_due_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [subject, customer_name, customer_email, priority, now, responseDue, resolutionDue]
    );
    const ticketId = result.insertId;

    await conn.query(
      'INSERT INTO ticket_messages (ticket_id, sender_type, sender_name, body, is_internal) VALUES (?, "CUSTOMER", ?, ?, FALSE)',
      [ticketId, customer_name, message]
    );

    await logAudit(conn, ticketId, customer_name, 'TICKET_CREATED', `Priority: ${priority}`);
    await conn.commit();
    res.status(201).json({ id: ticketId });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// 6. INC-0291: Atomic Claim Ticket (prevents two agents from grabbing the same ticket)
app.post('/api/tickets/:id/claim', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { agent_id, agent_name } = req.body;

    const [result] = await conn.query(
      'UPDATE tickets SET assigned_agent_id = ?, status = "IN_PROGRESS" WHERE id = ? AND assigned_agent_id IS NULL',
      [agent_id, req.params.id]
    );

    if (result.affectedRows === 0) {
      await conn.rollback();
      return res.status(409).json({ error: 'Conflict: Another agent already claimed this ticket!' });
    }

    await logAudit(conn, req.params.id, agent_name, 'TICKET_CLAIMED', `Claimed by ${agent_name}`);
    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// 7. Post a Message (Agent Public Reply, Agent Internal Note, or Customer Reply/Reopen)
app.post('/api/tickets/:id/messages', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const ticketId = req.params.id;
    const { sender_type, sender_name, body, is_internal = false, wait_for_customer = false } = req.body;
    const holidays = await getHolidayDates(conn);
    const now = new Date();

    const [[ticket]] = await conn.query('SELECT * FROM tickets WHERE id = ? FOR UPDATE', [ticketId]);
    if (!ticket) {
      await conn.rollback();
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Rule: If ticket is RESOLVED and customer replies within 1 working week (2700 mins), reopen it.
    // If > 1 working week, create a NEW ticket instead!
    if (sender_type === 'CUSTOMER' && (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED')) {
      const elapsedSinceResolve = ticket.resolved_at
        ? getWorkingMinutesBetween(new Date(ticket.resolved_at), now, holidays)
        : 99999;

      if (ticket.status === 'RESOLVED' && elapsedSinceResolve <= 2700) {
        await conn.query('UPDATE tickets SET status = "OPEN", resolved_at = NULL WHERE id = ?', [ticketId]);
        await logAudit(conn, ticketId, sender_name, 'TICKET_REOPENED', 'Customer reopened within 1 working week');
      } else {
        // Create a brand-new ticket
        const targets = SLA_TARGETS[ticket.priority];
        const [newRes] = await conn.query(
          `INSERT INTO tickets (subject, customer_name, customer_email, priority, created_at, sla_response_due_at, sla_resolution_due_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            `[Follow-up] ${ticket.subject}`,
            ticket.customer_name,
            ticket.customer_email,
            ticket.priority,
            now,
            addWorkingMinutes(now, targets.responseMins, holidays),
            addWorkingMinutes(now, targets.resolutionMins, holidays)
          ]
        );
        await conn.query(
          'INSERT INTO ticket_messages (ticket_id, sender_type, sender_name, body, is_internal) VALUES (?, "CUSTOMER", ?, ?, FALSE)',
          [newRes.insertId, sender_name, body]
        );
        await logAudit(conn, newRes.insertId, sender_name, 'TICKET_CREATED', `New ticket created after 1-week reopen window expired on #${ticketId}`);
        await conn.commit();
        return res.json({ redirectedToNewTicketId: newRes.insertId });
      }
    }

    // Insert message
    await conn.query(
      'INSERT INTO ticket_messages (ticket_id, sender_type, sender_name, body, is_internal) VALUES (?, ?, ?, ?, ?)',
      [ticketId, sender_type, sender_name, body, Boolean(is_internal)]
    );

    // Handle SLA timer updates
    if (sender_type === 'AGENT' && !is_internal) {
      if (!ticket.first_responded_at) {
        await conn.query('UPDATE tickets SET first_responded_at = ? WHERE id = ?', [now, ticketId]);
      }
      if (wait_for_customer && ticket.status !== 'WAITING_ON_CUSTOMER') {
        await conn.query('UPDATE tickets SET status = "WAITING_ON_CUSTOMER", paused_at = ? WHERE id = ?', [now, ticketId]);
        await logAudit(conn, ticketId, sender_name, 'SLA_PAUSED', 'Waiting on customer reply');
      }
      await logAudit(conn, ticketId, sender_name, 'PUBLIC_REPLY', 'Sent reply to customer');
    } else if (sender_type === 'AGENT' && is_internal) {
      await logAudit(conn, ticketId, sender_name, 'INTERNAL_NOTE', 'Added private team note');
    } else if (sender_type === 'CUSTOMER') {
      // Resume timer if it was waiting on customer
      if (ticket.status === 'WAITING_ON_CUSTOMER' && ticket.paused_at) {
        const pausedMins = getWorkingMinutesBetween(new Date(ticket.paused_at), now, holidays);
        await conn.query(
          'UPDATE tickets SET status = "IN_PROGRESS", paused_at = NULL, paused_working_minutes = paused_working_minutes + ? WHERE id = ?',
          [pausedMins, ticketId]
        );
        await logAudit(conn, ticketId, sender_name, 'SLA_RESUMED', `Customer replied after ${pausedMins} working mins`);
      } else {
        await logAudit(conn, ticketId, sender_name, 'CUSTOMER_REPLY', 'Customer sent a message');
      }
    }

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// 8. Change Ticket Status (e.g., Mark Resolved) or Escalate Priority
app.patch('/api/tickets/:id', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { status, priority, actor_name } = req.body;
    const holidays = await getHolidayDates(conn);
    const now = new Date();

    const [[ticket]] = await conn.query('SELECT * FROM tickets WHERE id = ? FOR UPDATE', [req.params.id]);

    if (status && status !== ticket.status) {
      const resolvedAt = status === 'RESOLVED' ? now : ticket.resolved_at;
      await conn.query('UPDATE tickets SET status = ?, resolved_at = ? WHERE id = ?', [status, resolvedAt, req.params.id]);
      await logAudit(conn, req.params.id, actor_name, 'STATUS_CHANGED', `${ticket.status} -> ${status}`);
    }

    // Rule: Escalating priority recalculates SLA deadlines from original created_at
    if (priority && priority !== ticket.priority) {
      const targets = SLA_TARGETS[priority];
      const newRespDue = addWorkingMinutes(new Date(ticket.created_at), targets.responseMins, holidays);
      const newResDue = addWorkingMinutes(new Date(ticket.created_at), targets.resolutionMins, holidays);
      await conn.query(
        'UPDATE tickets SET priority = ?, sla_response_due_at = ?, sla_resolution_due_at = ? WHERE id = ?',
        [priority, newRespDue, newResDue, req.params.id]
      );
      await logAudit(conn, req.params.id, actor_name, 'PRIORITY_CHANGED', `${ticket.priority} -> ${priority} (SLA recalculated from creation)`);
    }

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// 9. Housekeeping: Auto-close tickets waiting on customer for > 1 working week (2700 mins)
app.post('/api/system/auto-close', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const holidays = await getHolidayDates(conn);
    const now = new Date();
    const [waitingTickets] = await conn.query('SELECT * FROM tickets WHERE status = "WAITING_ON_CUSTOMER" AND paused_at IS NOT NULL');

    let closedCount = 0;
    for (const t of waitingTickets) {
      const waitedMins = getWorkingMinutesBetween(new Date(t.paused_at), now, holidays);
      if (waitedMins >= 2700) {
        await conn.query('UPDATE tickets SET status = "CLOSED", paused_at = NULL WHERE id = ?', [t.id]);
        await logAudit(conn, t.id, 'System', 'AUTO_CLOSED', 'Customer did not reply within 1 working week (45 working hours)');
        closedCount++;
      }
    }
    await conn.commit();
    res.json({ closedCount });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// Serve React frontend in production
app.use(express.static(path.join(__dirname, '../client/dist')));
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Frontdesk server running on port ${PORT}`));