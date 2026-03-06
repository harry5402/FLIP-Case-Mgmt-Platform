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
  updated_at DATE,
  updated_by TEXT,
  court TEXT,
  notes TEXT,
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
  task_type TEXT NOT NULL,
  assigned_to_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'Open',
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
