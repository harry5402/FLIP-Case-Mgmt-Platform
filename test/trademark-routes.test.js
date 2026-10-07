// Route tests for /api/trademark with a stubbed database (no network, no real data).
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const registerTrademarkRoutes = require("../routes/trademark");
const { buildItemFilters } = require("../routes/trademark");

const ITEM_ID = "11111111-1111-4111-8111-111111111111";
const MATTER_ID = "22222222-2222-4222-8222-222222222222";

const itemRow = (overrides = {}) => ({
  id: ITEM_ID,
  matter_id: MATTER_ID,
  stage: "office_action",
  action_type: "office_action",
  internal_due_date: "2026-11-01",
  response_due_date: "2026-12-01",
  work_state: "open",
  reported: false,
  ready_to_bill: false,
  services_entered: false,
  expenses_entered: false,
  invoiced: false,
  is_closed: false,
  is_hidden: false,
  needs_review: false,
  review_reasons: [],
  extra: {},
  matter_no: "3T10001",
  matter_archived: false,
  ...overrides,
});

const makeApp = ({ item = itemRow(), role = "user" } = {}) => {
  const calls = [];
  const audits = [];
  const state = { item };
  const query = async (text, params = []) => {
    calls.push({ text, params });
    if (/FROM trademark_docket_items i/.test(text) && /WHERE i\.id = \$1/.test(text)) {
      return { rows: state.item && params[0] === state.item.id ? [state.item] : [], rowCount: state.item ? 1 : 0 };
    }
    if (/^\s*UPDATE trademark_docket_items/.test(text)) {
      return { rows: [{ id: params[0] }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  };
  const withTransaction = async (fn) => fn({ query });
  const writeAuditLog = async (req, entry) => audits.push(entry);
  const requireAdmin = (req, res, next) =>
    req.session.role === "admin" ? next() : res.status(403).json({ error: "Admin access required" });

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { userId: "u1", email: "tester@example.test", name: "Tester", role };
    next();
  });
  registerTrademarkRoutes(app, { query, withTransaction, writeAuditLog, requireAdmin });
  app.use((err, req, res, next) => res.status(500).json({ error: "Internal server error" }));
  return { app, calls, audits, state };
};

const withServer = async (app, fn) => {
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(async (method, path, body) => {
      const res = await fetch(base + path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, body: await res.json() };
    });
  } finally {
    server.close();
  }
};

test("POST /items requires a stage and a matter", async () => {
  const { app } = makeApp();
  await withServer(app, async (call) => {
    assert.equal((await call("POST", "/api/trademark/items", { brand: "X" })).status, 400);
    const noMatter = await call("POST", "/api/trademark/items", { stage: "sou" });
    assert.equal(noMatter.status, 400);
    assert.match(noMatter.body.error, /matter/i);
    assert.equal((await call("POST", "/api/trademark/items", { stage: "bogus", matterId: MATTER_ID })).status, 400);
  });
});

test("PUT /items/:id validates dates and enums before touching the DB", async () => {
  const { app, calls } = makeApp();
  await withServer(app, async (call) => {
    const bad = await call("PUT", `/api/trademark/items/${ITEM_ID}`, { internalDueDate: "2026-02-30" });
    assert.equal(bad.status, 400);
    assert.equal((await call("PUT", `/api/trademark/items/${ITEM_ID}`, { workState: "nope" })).status, 400);
    assert.equal((await call("PUT", `/api/trademark/items/${ITEM_ID}`, {})).status, 400);
  });
  assert.equal(calls.length, 0);
});

test("PUT /items/:id updates, stamps the actor and audit-logs before/after", async () => {
  const { app, calls, audits } = makeApp();
  await withServer(app, async (call) => {
    const res = await call("PUT", `/api/trademark/items/${ITEM_ID}`, { comment: "Called client", internalDueDate: "2026-11-15" });
    assert.equal(res.status, 200);
  });
  const update = calls.find((c) => /^\s*UPDATE trademark_docket_items/.test(c.text));
  assert.ok(update.params.includes("Tester"));
  assert.ok(update.params.includes("2026-11-15"));
  assert.equal(audits[0].action, "trademark.item.update");
  assert.equal(audits[0].entityType, "trademark_item");
  assert.ok(audits[0].before && audits[0].after);
});

test("unknown item returns 404", async () => {
  const { app } = makeApp({ item: null });
  await withServer(app, async (call) => {
    assert.equal((await call("GET", `/api/trademark/items/${ITEM_ID}`)).status, 404);
    assert.equal((await call("PUT", `/api/trademark/items/${ITEM_ID}/state`, { isClosed: true })).status, 404);
  });
});

test("closing an item with unbilled activity needs confirmation (409 UNBILLED)", async () => {
  const { app, audits } = makeApp({ item: itemRow({ reported: true }) });
  await withServer(app, async (call) => {
    const blocked = await call("PUT", `/api/trademark/items/${ITEM_ID}/state`, { isClosed: true });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.code, "UNBILLED");
    assert.equal(audits.length, 0);
    const ok = await call("PUT", `/api/trademark/items/${ITEM_ID}/state`, { isClosed: true, confirmUnbilled: true });
    assert.equal(ok.status, 200);
  });
  assert.equal(audits[0].action, "trademark.item.close");
});

test("closing an invoiced item needs no confirmation", async () => {
  const { app } = makeApp({ item: itemRow({ reported: true, invoiced: true }) });
  await withServer(app, async (call) => {
    assert.equal((await call("PUT", `/api/trademark/items/${ITEM_ID}/state`, { isClosed: true })).status, 200);
  });
});

test("PUT /items/:id/billing sets invoiced_at when invoiced flips on", async () => {
  const { app, calls, audits } = makeApp();
  await withServer(app, async (call) => {
    assert.equal((await call("PUT", `/api/trademark/items/${ITEM_ID}/billing`, { invoiced: "yes" })).status, 400);
    assert.equal((await call("PUT", `/api/trademark/items/${ITEM_ID}/billing`, { invoiced: true })).status, 200);
  });
  const update = calls.find((c) => /^\s*UPDATE trademark_docket_items/.test(c.text));
  assert.match(update.text, /invoiced_at = /);
  assert.equal(audits[0].action, "trademark.item.billing");
});

test("client merge is admin-only", async () => {
  const { app } = makeApp({ role: "user" });
  await withServer(app, async (call) => {
    const res = await call("POST", `/api/trademark/clients/${MATTER_ID}/merge`, { targetId: ITEM_ID });
    assert.equal(res.status, 403);
  });
});

test("list views validate their required filters", async () => {
  const { app } = makeApp();
  await withServer(app, async (call) => {
    assert.equal((await call("GET", "/api/trademark/items?view=stage")).status, 400);
    assert.equal((await call("GET", "/api/trademark/items?view=portfolio")).status, 400);
    assert.equal((await call("GET", "/api/trademark/items?stage=nope")).status, 400);
    assert.equal((await call("GET", "/api/trademark/items?view=stage&stage=sou")).status, 200);
  });
});

test("buildItemFilters: default view hides closed and archived; search terms are escaped", () => {
  const def = buildItemFilters({});
  assert.ok(def.where.includes("NOT i.is_closed"));
  assert.ok(def.where.includes("NOT m.archived"));
  assert.match(def.order, /COALESCE\(i\.internal_due_date, i\.response_due_date\) ASC NULLS LAST/);

  const closed = buildItemFilters({ view: "closed" });
  assert.ok(closed.where.includes("i.is_closed"));

  const rtb = buildItemFilters({ view: "ready_to_bill" });
  assert.ok(rtb.where.includes("i.ready_to_bill"));
  assert.ok(rtb.where.includes("NOT i.invoiced"));

  const search = buildItemFilters({ q: "50%_off" });
  assert.equal(search.params[0], "%50\\%\\_off%");
  assert.ok(!/\$T/.test(search.where.join(" ")));
});
