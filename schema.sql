CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_name TEXT NOT NULL,
  client_name TEXT NOT NULL,
  plaintiff TEXT,
  brand_name TEXT,
  ip_claims_summary TEXT,
  plaintiff_profit_per_unit NUMERIC,
  jurisdiction TEXT,
  case_number TEXT,
  judge TEXT,
  status TEXT,
  recent_status TEXT,
  filed_date DATE,
  updated_at TIMESTAMPTZ,
  updated_by TEXT,
  court TEXT,
  notes TEXT,
  is_docket_only BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS defendants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES cases(id) ON DELETE CASCADE,
  doe_number TEXT,
  group_name TEXT,
  group_id UUID,
  platform TEXT,
  merchant_id TEXT,
  backend_id TEXT,
  name TEXT,
  email TEXT,
  business_name TEXT,
  located_in TEXT,
  seller_location TEXT,
  seller_url TEXT,
  status TEXT,
  defendant_rep_email TEXT,
  defendant_rep_name TEXT,
  updated_at DATE,
  updated_by TEXT,
  notes TEXT,
  listings_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES cases(id) ON DELETE CASCADE,
  group_name TEXT NOT NULL,
  plaintiff_rep_name TEXT,
  defendant_rep_email TEXT,
  status TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS docket_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES cases(id) ON DELETE CASCADE,
  entry_date DATE,
  entry TEXT
);

CREATE TABLE IF NOT EXISTS ip_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES cases(id) ON DELETE CASCADE,
  defendant_id UUID REFERENCES defendants(id) ON DELETE CASCADE,
  brand_name TEXT,
  type TEXT,
  sub_type TEXT,
  application_date DATE,
  registration_date DATE,
  serial_number TEXT,
  registration_number TEXT,
  specimen_folder TEXT,
  listings_count INTEGER,
  defendant_count INTEGER
);

CREATE TABLE IF NOT EXISTS negotiations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  defendant_id UUID REFERENCES defendants(id) ON DELETE CASCADE,
  legal_status TEXT,
  plaintiff_last_offer NUMERIC,
  defendant_last_offer NUMERIC,
  settlement_date DATE,
  settlement_amount NUMERIC,
  agreement_uploaded TEXT
);

CREATE TABLE IF NOT EXISTS collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  defendant_id UUID REFERENCES defendants(id) ON DELETE CASCADE,
  settlement_collected_date DATE,
  collected_amount NUMERIC,
  settlement_payment_id TEXT,
  restrained_funds_collected_amount NUMERIC,
  total_collected_amount NUMERIC
);

CREATE TABLE IF NOT EXISTS bookkeeping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  defendant_id UUID REFERENCES defendants(id) ON DELETE CASCADE,
  status TEXT,
  agreement_processed TEXT
);

CREATE TABLE IF NOT EXISTS listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  defendant_id UUID REFERENCES defendants(id) ON DELETE CASCADE,
  product_id TEXT,
  marketplace_id TEXT,
  title TEXT,
  inf_type TEXT,
  url TEXT,
  sales INTEGER,
  screenshot_date DATE,
  screenshots TEXT,
  test_purchase TEXT,
  test_purchase_status TEXT,
  notes TEXT,
  listing_copyright_links TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES cases(id) ON DELETE CASCADE,
  defendant_id UUID REFERENCES defendants(id) ON DELETE CASCADE,
  group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
  task_type TEXT NOT NULL,
  assigned_to_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'Open',
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  task_role TEXT NOT NULL DEFAULT 'owner',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS case_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES cases(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  template_file_url TEXT,
  data_file_url TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_negotiations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID UNIQUE REFERENCES groups(id) ON DELETE CASCADE,
  legal_status TEXT,
  plaintiff_last_offer NUMERIC,
  defendant_last_offer NUMERIC,
  settlement_date DATE,
  settlement_amount NUMERIC,
  agreement_uploaded TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  user_email TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  before_data JSONB,
  after_data JSONB,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs (created_at DESC);

CREATE TABLE IF NOT EXISTS litigation_case_state (
  case_id UUID PRIMARY KEY REFERENCES cases(id) ON DELETE CASCADE,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  archived_at TIMESTAMPTZ,
  archived_by TEXT,
  docket_defendant_count INTEGER,
  docket_status TEXT,
  docketbird_case_id TEXT,
  docketbird_last_synced_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS litigation_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES cases(id) ON DELETE CASCADE,
  action TEXT,
  internal_due_date DATE,
  final_due_date DATE,
  notes TEXT,
  assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_to_label TEXT,
  is_in_progress BOOLEAN NOT NULL DEFAULT FALSE,
  is_completed BOOLEAN NOT NULL DEFAULT FALSE,
  is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  completed_by TEXT,
  source TEXT,
  source_reference_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS litigation_actions_source_ref_idx
  ON litigation_actions (case_id, source, source_reference_id);

CREATE TABLE IF NOT EXISTS litigation_action_collaborators (
  action_id UUID REFERENCES litigation_actions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  is_in_progress BOOLEAN NOT NULL DEFAULT FALSE,
  is_complete BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  completed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (action_id, user_id)
);

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS source_litigation_action_id UUID REFERENCES litigation_actions(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS litigation_collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES cases(id) ON DELETE CASCADE,
  platform TEXT,
  sent_to_platform TEXT,
  acknowledged TEXT,
  breakdown TEXT,
  all_def_accounted_for TEXT,
  money_received TEXT,
  sent_to_plaintiff TEXT,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS mbfd_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_name TEXT NOT NULL,
  doe_number TEXT NOT NULL,
  amount NUMERIC(12, 2),
  attorney_email TEXT,
  notes TEXT,
  is_completed BOOLEAN NOT NULL DEFAULT FALSE,
  is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  completed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);
