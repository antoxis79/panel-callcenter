
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1) REGISTROS (SUBIDA)
CREATE TABLE IF NOT EXISTS records (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),

  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_user text NOT NULL,        -- username AD (sAMAccountName)
  created_by_agent_name text NOT NULL,  -- nombre visible
  created_by_group text NOT NULL,       -- gusanitos | pericotitos

  visibility text NOT NULL CHECK (visibility IN ('group','public','private_superior')) DEFAULT 'group',

  status text NOT NULL CHECK (status IN ('draft','in_filter_1','in_filter_2','in_filter_3','done','cancelled','paused')) DEFAULT 'draft',
  current_filter int NOT NULL DEFAULT 0 CHECK (current_filter BETWEEN 0 AND 3),

  next_due_at timestamptz NULL,

  base_data jsonb NOT NULL DEFAULT '{}'::jsonb,

  final_choice int NULL CHECK (final_choice BETWEEN 1 AND 3),
  finalized_at timestamptz NULL,

  cancel_reason text NULL,
  cancelled_by_user text NULL,
  cancelled_at timestamptz NULL,

  pause_reason text NULL,
  paused_by_user text NULL,
  paused_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_records_updated ON records(status, next_due_at);

-- 2) FILTROS (1..3) por registro
CREATE TABLE IF NOT EXISTS filters (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  record_id uuid NOT NULL REFERENCES records(id) ON DELETE CASCADE,

  n int NOT NULL CHECK (n BETWEEN 1 AND 3),
  status text NOT NULL CHECK (status IN ('not_started','in_progress','completed','cancelled','paused')) DEFAULT 'not_started',

  performed_by_user text NULL,
  performed_by_name text NULL,

  started_at timestamptz NULL,
  finished_at timestamptz NULL,

  filter_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  offer_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  client_response jsonb NOT NULL DEFAULT '{}'::jsonb,

  next_due_at timestamptz NULL,

  cancel_reason text NULL,
  paused_reason text NULL,

  UNIQUE(record_id, n)
);

CREATE INDEX IF NOT EXISTS idx_filters_record ON filters(record_id, n);

-- 3) LOCKS (edit / filter)
CREATE TABLE IF NOT EXISTS locks (
  record_id uuid PRIMARY KEY REFERENCES records(id) ON DELETE CASCADE,
  lock_type text NOT NULL CHECK (lock_type IN ('edit','filter')),
  locked_by_user text NOT NULL,
  locked_by_name text NOT NULL,
  locked_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_locks_expires ON locks(expires_at);