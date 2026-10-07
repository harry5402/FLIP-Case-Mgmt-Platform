// Idempotent DDL for the Trademark Docket. Awaited from start() in server.js
// (after ensureLitigationTables) and by scripts/import-trademark-workbook.js.
const {
  STAGE_KEYS,
  ACTION_TYPE_KEYS,
  APPLICATION_STATUSES,
  WORK_STATE_KEYS,
  TODO_STATUSES,
  CLIENT_KINDS,
  MATTER_FAMILIES,
} = require("./trademark");

const sqlList = (values) => values.map((v) => `'${String(v).replace(/'/g, "''")}'`).join(", ");

// Re-created on every boot so the allowed lists can grow with the constants.
const CHECKS = [
  ["trademark_clients", "trademark_clients_kind_check", `kind IN (${sqlList(CLIENT_KINDS)})`],
  ["trademark_matters", "trademark_matters_family_check", `matter_family IN (${sqlList(MATTER_FAMILIES)})`],
  [
    "trademark_matters",
    "trademark_matters_status_check",
    `application_status IS NULL OR application_status IN (${sqlList(APPLICATION_STATUSES)})`,
  ],
  ["trademark_docket_items", "trademark_items_stage_check", `stage IN (${sqlList(STAGE_KEYS)})`],
  ["trademark_docket_items", "trademark_items_action_check", `action_type IN (${sqlList(ACTION_TYPE_KEYS)})`],
  ["trademark_docket_items", "trademark_items_state_check", `work_state IN (${sqlList(WORK_STATE_KEYS)})`],
  ["trademark_docket_items", "trademark_items_source_check", `source IS NULL OR source IN ('workbook')`],
  ["trademark_todos", "trademark_todos_kind_check", `kind IN ('todo','note')`],
  ["trademark_todos", "trademark_todos_status_check", `status IN (${sqlList(TODO_STATUSES)})`],
  ["trademark_billing_questions", "trademark_bq_scope_check", `scope IN ('matter','all')`],
];

const ensureTrademarkTables = async (query) => {
  // Per-user access to the Trademark Docket (admins always have access).
  await query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS allow_trademark_docket BOOLEAN NOT NULL DEFAULT FALSE
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS trademark_clients (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      aliases TEXT[] NOT NULL DEFAULT '{}',
      kind TEXT NOT NULL DEFAULT 'direct',
      has_portfolio_view BOOLEAN NOT NULL DEFAULT FALSE,
      is_unresponsive BOOLEAN NOT NULL DEFAULT FALSE,
      payment_risk BOOLEAN NOT NULL DEFAULT FALSE,
      contact_note TEXT,
      notes TEXT,
      needs_review BOOLEAN NOT NULL DEFAULT FALSE,
      review_reasons TEXT[] NOT NULL DEFAULT '{}',
      is_archived BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS trademark_import_batches (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      source_basename TEXT,
      source_sha256 TEXT,
      actor TEXT,
      summary JSONB
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS trademark_matters (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      matter_no TEXT,
      matter_no_norm TEXT,
      synthetic_key TEXT UNIQUE,
      matter_family TEXT NOT NULL DEFAULT 'OTHER',
      parent_matter_no_norm TEXT,
      client_id UUID REFERENCES trademark_clients(id) ON DELETE RESTRICT,
      client_ref TEXT,
      jurisdiction TEXT NOT NULL DEFAULT 'US',
      mark_text TEXT,
      nice_classes SMALLINT[] NOT NULL DEFAULT '{}',
      title TEXT,
      application_status TEXT,
      serial_no TEXT,
      registration_no TEXT,
      proceeding_no TEXT,
      filing_date DATE,
      registration_date DATE,
      noa_date DATE,
      notes TEXT,
      needs_review BOOLEAN NOT NULL DEFAULT FALSE,
      review_reasons TEXT[] NOT NULL DEFAULT '{}',
      archived BOOLEAN NOT NULL DEFAULT FALSE,
      archived_at TIMESTAMPTZ,
      archived_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT
    )
  `);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS trademark_matters_no_norm_uidx
    ON trademark_matters (matter_no_norm) WHERE matter_no_norm IS NOT NULL
  `);
  await query(`CREATE INDEX IF NOT EXISTS trademark_matters_client_idx ON trademark_matters (client_id)`);
  await query(`CREATE INDEX IF NOT EXISTS trademark_matters_status_idx ON trademark_matters (application_status)`);

  await query(`
    CREATE TABLE IF NOT EXISTS trademark_docket_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      matter_id UUID NOT NULL REFERENCES trademark_matters(id) ON DELETE RESTRICT,
      stage TEXT NOT NULL,
      action_type TEXT NOT NULL DEFAULT 'other',
      action_label TEXT,
      brand TEXT,
      trigger_date DATE,
      internal_due_date DATE,
      internal_due_text TEXT,
      response_due_date DATE,
      response_due_text TEXT,
      client_due_date DATE,
      client_due_text TEXT,
      received_date DATE,
      work_state TEXT NOT NULL DEFAULT 'open',
      comment TEXT,
      client_comment TEXT,
      meeting_notes TEXT,
      reported BOOLEAN NOT NULL DEFAULT FALSE,
      ready_to_bill BOOLEAN NOT NULL DEFAULT FALSE,
      services_entered BOOLEAN NOT NULL DEFAULT FALSE,
      expenses_entered BOOLEAN NOT NULL DEFAULT FALSE,
      invoiced BOOLEAN NOT NULL DEFAULT FALSE,
      invoiced_at TIMESTAMPTZ,
      cost_estimate TEXT,
      is_closed BOOLEAN NOT NULL DEFAULT FALSE,
      closed_at TIMESTAMPTZ,
      closed_by TEXT,
      is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
      assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      needs_review BOOLEAN NOT NULL DEFAULT FALSE,
      review_reasons TEXT[] NOT NULL DEFAULT '{}',
      source TEXT,
      source_tab TEXT,
      source_row INTEGER,
      import_key TEXT,
      import_hash TEXT,
      import_batch_id UUID REFERENCES trademark_import_batches(id) ON DELETE SET NULL,
      extra JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT
    )
  `);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS trademark_items_import_key_uidx
    ON trademark_docket_items (import_key) WHERE import_key IS NOT NULL
  `);
  await query(`CREATE INDEX IF NOT EXISTS trademark_items_matter_idx ON trademark_docket_items (matter_id)`);
  await query(`
    CREATE INDEX IF NOT EXISTS trademark_items_open_stage_idx
    ON trademark_docket_items (stage) WHERE NOT is_closed AND NOT is_hidden
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS trademark_items_open_due_idx
    ON trademark_docket_items ((COALESCE(internal_due_date, response_due_date)))
    WHERE NOT is_closed AND NOT is_hidden
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS trademark_items_billing_idx
    ON trademark_docket_items (ready_to_bill, invoiced) WHERE NOT is_hidden
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS trademark_item_deadlines (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      item_id UUID NOT NULL REFERENCES trademark_docket_items(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      due_date DATE,
      source_text TEXT,
      is_done BOOLEAN NOT NULL DEFAULT FALSE,
      is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
      needs_review BOOLEAN NOT NULL DEFAULT FALSE,
      import_key TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS trademark_deadlines_item_idx ON trademark_item_deadlines (item_id)`);
  await query(`
    CREATE INDEX IF NOT EXISTS trademark_deadlines_due_idx
    ON trademark_item_deadlines (due_date) WHERE NOT is_done AND NOT is_hidden
  `);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS trademark_deadlines_import_key_uidx
    ON trademark_item_deadlines (import_key) WHERE import_key IS NOT NULL
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS trademark_todos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      kind TEXT NOT NULL DEFAULT 'todo',
      due_date DATE,
      due_text TEXT,
      received_date DATE,
      action_item TEXT,
      email_subject TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      status_note TEXT,
      assignee_initials TEXT,
      assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      matter_id UUID REFERENCES trademark_matters(id) ON DELETE SET NULL,
      is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
      import_key TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT
    )
  `);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS trademark_todos_import_key_uidx
    ON trademark_todos (import_key) WHERE import_key IS NOT NULL
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS trademark_billing_questions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      matter_id UUID REFERENCES trademark_matters(id) ON DELETE SET NULL,
      matter_no_text TEXT,
      scope TEXT NOT NULL DEFAULT 'matter',
      question TEXT NOT NULL,
      answer TEXT,
      is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
      import_key TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT
    )
  `);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS trademark_bq_import_key_uidx
    ON trademark_billing_questions (import_key) WHERE import_key IS NOT NULL
  `);

  for (const [table, name, expr] of CHECKS) {
    await query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${name}`);
    await query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${expr})`);
  }
};

module.exports = { ensureTrademarkTables };
