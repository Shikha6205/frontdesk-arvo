CREATE TABLE IF NOT EXISTS agents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS holidays (
  id INT AUTO_INCREMENT PRIMARY KEY,
  holiday_date DATE NOT NULL UNIQUE,
  description VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS tickets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  subject VARCHAR(255) NOT NULL,
  customer_name VARCHAR(100) NOT NULL,
  customer_email VARCHAR(150) NOT NULL,
  priority ENUM('LOW', 'MEDIUM', 'HIGH') NOT NULL DEFAULT 'MEDIUM',
  status ENUM('OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED') NOT NULL DEFAULT 'OPEN',
  assigned_agent_id INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  first_responded_at DATETIME NULL,
  resolved_at DATETIME NULL,
  paused_at DATETIME NULL,
  paused_working_minutes INT NOT NULL DEFAULT 0,
  sla_response_due_at DATETIME NOT NULL,
  sla_resolution_due_at DATETIME NOT NULL,
  FOREIGN KEY (assigned_agent_id) REFERENCES agents(id)
);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ticket_id INT NOT NULL,
  sender_type ENUM('CUSTOMER', 'AGENT') NOT NULL,
  sender_name VARCHAR(100) NOT NULL,
  body TEXT NOT NULL,
  is_internal BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ticket_id INT NOT NULL,
  actor_name VARCHAR(100) NOT NULL,
  action VARCHAR(100) NOT NULL,
  details TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
);

INSERT INTO agents (name, email) VALUES 
  ('Meera Nair', 'meera@arvosystems.com'),
  ('Rahul Menon', 'rahul@arvosystems.com'),
  ('Priya Das', 'priya@arvosystems.com');

INSERT INTO holidays (holiday_date, description) VALUES 
  ('2026-11-25', 'Company Festival Holiday'),
  ('2026-12-25', 'Christmas Holiday');

INSERT INTO tickets (subject, customer_name, customer_email, priority, status, assigned_agent_id, created_at, first_responded_at, paused_at, sla_response_due_at, sla_resolution_due_at)
VALUES 
  ('Production payment gateway down', 'Vikram Rao', 'vikram@finpay.in', 'HIGH', 'OPEN', NULL, DATE_SUB(NOW(), INTERVAL 2 DAY), NULL, NULL, DATE_SUB(NOW(), INTERVAL 1 DAY), DATE_SUB(NOW(), INTERVAL 12 HOUR)),
  ('Invoice PDF export formatting issue', 'Sneha Kapoor', 'sneha@retailhub.com', 'MEDIUM', 'WAITING_ON_CUSTOMER', 1, DATE_SUB(NOW(), INTERVAL 1 DAY), DATE_SUB(NOW(), INTERVAL 20 HOUR), DATE_SUB(NOW(), INTERVAL 18 HOUR), NOW(), DATE_ADD(NOW(), INTERVAL 2 DAY)),
  ('Request to add two new team seats', 'Arjun Nair', 'arjun@keralatech.io', 'LOW', 'IN_PROGRESS', 2, '2026-11-20 18:00:00', NULL, NULL, '2026-11-23 18:00:00', '2026-11-27 18:00:00');

INSERT INTO ticket_messages (ticket_id, sender_type, sender_name, body, is_internal)
VALUES
  (1, 'CUSTOMER', 'Vikram Rao', 'Checkout API is returning 502 errors for all users.', FALSE),
  (2, 'CUSTOMER', 'Sneha Kapoor', 'Our GST number is cut off on exported invoices.', FALSE),
  (2, 'AGENT', 'Meera Nair', 'Could you share a sample invoice ID so we can reproduce this?', FALSE),
  (2, 'AGENT', 'Meera Nair', 'Internal note: Check wkhtmltopdf margin config before replying.', TRUE),
  (3, 'CUSTOMER', 'Arjun Nair', 'Please enable access for two new interns on Monday.', FALSE);

INSERT INTO audit_logs (ticket_id, actor_name, action, details)
VALUES
  (1, 'Vikram Rao', 'TICKET_CREATED', 'Priority: HIGH'),
  (2, 'Sneha Kapoor', 'TICKET_CREATED', 'Priority: MEDIUM'),
  (2, 'Meera Nair', 'TICKET_CLAIMED', 'Claimed by Meera Nair'),
  (2, 'Meera Nair', 'SLA_PAUSED', 'Waiting on customer reply'),
  (2, 'Meera Nair', 'INTERNAL_NOTE', 'Added private team note'),
  (3, 'Arjun Nair', 'TICKET_CREATED', 'Priority: LOW (Arrived Friday 6:00 PM)');