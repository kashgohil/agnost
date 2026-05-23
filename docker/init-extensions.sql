-- Runs once when the Postgres volume is first initialized.
-- Existing volumes need this applied manually (see README/setup notes).
CREATE EXTENSION IF NOT EXISTS vector;
