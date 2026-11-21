# Arvo Frontdesk — Customer Support & SLA Management System

A full-stack support ticketing system built with **React (Vite)**, **Node.js (Express)**, and **MySQL**, designed to replace Arvo Systems' shared spreadsheet with business-hour SLA tracking, concurrency-safe ticket claiming, private note isolation, and an immutable audit log.

## Extracted Business Rules & Architectural Decisions

1. **Working Hours SLA Engine (`server/utils/slaCalculator.js`):**
   - Operates strictly within **Monday–Friday, 09:30 to 18:30** (9 working hours / 540 minutes per day).
   - Automatically skips nights, weekends, and configurable festival holidays (`holidays` table).
   - **Priority Tiers:**
     - **High (Urgent):** 2 working hours first response / 1 working day (9h) resolution.
     - **Medium:** Half working day (4.5h) first response / 3 working days (27h) resolution.
     - **Low:** 1 working day (9h) first response / 1 working week (5 days / 45h) resolution.
2. **Customer Wait Pause & Auto-Close:**
   - Moving a ticket to `WAITING_ON_CUSTOMER` pauses the SLA clock; customer replies resume it and shift SLA deadlines forward by the exact working minutes waited.
   - Tickets waiting on a customer for **1 working week (45 working hours)** auto-close via `/api/system/auto-close`.
3. **1-Week Reopen Window:**
   - Customers replying to a `RESOLVED` ticket within **1 working week (45 working hours)** reopen the existing ticket; replies after 1 working week automatically generate a new follow-up ticket.
4. **Mid-Ticket Priority Escalation (Resolved Ambiguity):**
   - When an agent escalates a ticket's priority mid-flight, SLA response and resolution deadlines are recalculated from the original `created_at` timestamp using the stricter tier's target window, immediately flagging the ticket if elapsed working time already exceeds the new SLA.
5. **Incident Report Safeguards:**
   - **INC-0291 (Double-Claim Prevention):** Atomic conditional SQL update (`WHERE id = ? AND assigned_agent_id IS NULL`) returns HTTP `409 Conflict` if another agent claims the ticket first.
   - **INC-0304 (Private Note Isolation):** Customer-facing API (`/api/customer/tickets/:id`) enforces `WHERE is_internal = FALSE` at the database query level and omits internal metadata.
   - **INC-0318 (Immutable Audit Trail):** All state transitions, assignments, replies, and notes are recorded in an append-only `audit_logs` table with no update or delete routes exposed.

## Local Setup Instructions

1. **Database Setup (MySQL):**
   - Start MySQL and execute `server/schema.sql` to create tables, seed agents, holidays, and sample tickets.
2. **Backend Setup:**
   ```bash
   cd server
   npm install
   # Create .env with PORT=5000, DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
   node server.js
   ```
3. **Frontend Setup:**
   ```bash
   cd client
   npm install
   npm run dev
   ```
   Open `http://localhost:5173`.