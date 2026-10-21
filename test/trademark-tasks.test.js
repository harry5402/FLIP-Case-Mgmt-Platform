// Trademark item tasks: routes + the `tasks` mirror/cascade helpers, with a
// stubbed database (no network, no real data).
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const registerTrademarkRoutes = require("../routes/trademark");
const tmTasks = require("../lib/trademark-tasks");

const ITEM_ID = "11111111-1111-4111-8111-111111111111";
const MATTER_ID = "22222222-2222-4222-8222-222222222222";
const TASK_ID = "33333333-3333-4333-8333-333333333333";
const ME = "44444444-4444-4444-8444-444444444444";
const OTHER = "55555555-5555-4555-8555-555555555555";
const HELPER = "66666666-6666-4666-8666-666666666666";

const itemRow = (overrides = {}) => ({
  id: ITEM_ID,
  matter_id: MATTER_ID,
  stage: "office_action",
  action_type: "office_action",
  brand: "ACME",
  work_state: "open",
  is_closed: false,
  is_hidden: false,
  review_reasons: [],
  extra: {},
  matter_no: "3T10001",
  ...overrides,
});

const taskRow = (overrides = {}) => ({
  id: TASK_ID,
  item_id: ITEM_ID,
  action: "Draft response",
  internal_due_date: "2026-11-01",
  final_due_date: "2026-11-15",
  notes: null,
  assigned_to_user_id: OTHER,
  is_in_progress: false,
  is_completed: false,
  is_hidden: false,
  completed_at: null,
  collaborators: [],
  ...overrides,
});

// Records every query; answers the few reads the code depends on.
const makeDb = ({ item = itemRow(), tasks = [], existingAssignee = null } = {}) => {
  const calls = [];
  const query = async (text, params = []) => {
    calls.push({ text, params });
    if (/SELECT allow_trademark_docket FROM users/.test(text)) return { rows: [{ allow_trademark_docket: true }] };
    if (/FROM trademark_docket_items i/.test(text) && /WHERE i\.id = \$1/.test(text)) return { rows: item ? [item] : [] };
    if (/SELECT is_hidden FROM trademark_docket_items/.test(text)) return { rows: item ? [{ is_hidden: item.is_hidden }] : [] };
    if (/FROM trademark_item_tasks t/.test(text) && /WHERE t\.item_id = \$1/.test(text)) return { rows: tasks };
    if (/FROM trademark_item_tasks t/.test(text) && /WHERE t\.id = \$1/.test(text)) {
      return { rows: tasks.filter((t) => t.id === params[0]) };
    }
    if (/SELECT assigned_to_user_id FROM trademark_item_tasks/.test(text)) {
      return { rows: tasks.some((t) => t.id === params[0]) ? [{ assigned_to_user_id: existingAssignee }] : [] };
    }
    if (/INSERT INTO trademark_item_tasks/.test(text)) return { rows: [{ id: TASK_ID }] };
    if (/SELECT email FROM users/.test(text)) return { rows: [{ email: `${params[0]}@example.test` }] };
    if (/^\s*UPDATE/.test(text)) return { rows: [{ id: params[0], task_id: params[0] }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  };
  return { query, calls };
};

const makeApp = (dbOptions) => {
  const db = makeDb(dbOptions);
  const audits = [];
  const notified = [];
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { userId: ME, email: "me@example.test", name: "Tester", role: "admin" };
    next();
  });
  registerTrademarkRoutes(app, {
    query: db.query,
    withTransaction: async (fn) => fn({ query: db.query }),
    writeAuditLog: async (req, entry) => audits.push(entry),
    requireAdmin: (req, res, next) => next(),
    notifyTaskAssigned: async (email, info) => notified.push({ email, info }),
  });
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return { app, calls: db.calls, audits, notified };
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

const settle = () => new Promise((r) => setTimeout(r, 20));

test("saving tasks validates before touching the database", async () => {
  const { app, calls } = makeApp();
  await withServer(app, async (call) => {
    const url = `/api/trademark/items/${ITEM_ID}/tasks`;
    assert.equal((await call("PUT", url, { tasks: "nope" })).status, 400);
    const noText = await call("PUT", url, { tasks: [{ assignedToUserId: OTHER }] });
    assert.equal(noText.status, 400);
    assert.match(noText.body.error, /description/i);
    assert.equal((await call("PUT", url, { tasks: [{ action: "X", internalDueDate: "2026-02-30" }] })).status, 400);
    assert.equal((await call("PUT", url, { tasks: [{ action: "X", assignedToUserId: "bob" }] })).status, 400);
  });
  assert.equal(calls.filter((c) => !/allow_trademark_docket/.test(c.text)).length, 0);
});

test("blank new rows are ignored", async () => {
  const { app, calls } = makeApp();
  await withServer(app, async (call) => {
    const res = await call("PUT", `/api/trademark/items/${ITEM_ID}/tasks`, { tasks: [{ action: "  " }] });
    assert.equal(res.status, 200);
  });
  assert.ok(!calls.some((c) => /INSERT INTO trademark_item_tasks/.test(c.text)));
});

test("saving a new task inserts it, mirrors it into tasks, audit-logs and notifies the assignee", async () => {
  const { app, calls, audits, notified } = makeApp({ tasks: [taskRow()] });
  await withServer(app, async (call) => {
    const res = await call("PUT", `/api/trademark/items/${ITEM_ID}/tasks`, {
      tasks: [{ action: "Draft response", assignedToUserId: OTHER, internalDueDate: "2026-11-01", collaboratorUserIds: [OTHER, HELPER] }],
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.tasks.length, 1);
  });
  await settle();
  const insert = calls.find((c) => /INSERT INTO trademark_item_tasks/.test(c.text));
  assert.deepEqual(insert.params.slice(0, 2), [ITEM_ID, "Draft response"]);
  // The owner is never also a collaborator.
  const collab = calls.filter((c) => /INSERT INTO trademark_item_task_collaborators/.test(c.text));
  assert.deepEqual(collab.map((c) => c.params[1]), [HELPER]);
  const mirror = calls.find((c) => /INSERT INTO tasks/.test(c.text));
  assert.equal(mirror.params[0], "Trademark: Draft response");
  assert.equal(mirror.params[1], OTHER);
  assert.equal(mirror.params[2], "2026-11-01");
  assert.equal(audits[0].action, "trademark.item.tasks.save");
  assert.equal(notified.length, 1);
  assert.equal(notified[0].info.caseName, "3T10001 – ACME");
});

test("no Teams message when assigning to yourself or when the assignee didn't change", async () => {
  const self = makeApp();
  await withServer(self.app, async (call) => {
    await call("PUT", `/api/trademark/items/${ITEM_ID}/tasks`, { tasks: [{ action: "Mine", assignedToUserId: ME }] });
  });
  const same = makeApp({ tasks: [taskRow()], existingAssignee: OTHER });
  await withServer(same.app, async (call) => {
    const res = await call("PUT", `/api/trademark/items/${ITEM_ID}/tasks`, {
      tasks: [{ id: TASK_ID, action: "Draft response", assignedToUserId: OTHER }],
    });
    assert.equal(res.status, 200);
  });
  await settle();
  assert.equal(self.notified.length, 0);
  assert.equal(same.notified.length, 0);
});

test("a task id from another item is rejected", async () => {
  const { app } = makeApp({ tasks: [] });
  await withServer(app, async (call) => {
    const res = await call("PUT", `/api/trademark/items/${ITEM_ID}/tasks`, { tasks: [{ id: TASK_ID, action: "X" }] });
    assert.equal(res.status, 400);
  });
});

test("task state: unknown task is 404, completing resyncs the mirrors and audit-logs", async () => {
  const missing = makeApp({ tasks: [] });
  await withServer(missing.app, async (call) => {
    assert.equal((await call("PUT", `/api/trademark/item-tasks/${TASK_ID}/state`, { isCompleted: true })).status, 404);
    assert.equal((await call("PUT", `/api/trademark/item-tasks/${TASK_ID}/state`, {})).status, 400);
  });
  const { app, calls, audits } = makeApp({ tasks: [taskRow()] });
  await withServer(app, async (call) => {
    const res = await call("PUT", `/api/trademark/item-tasks/${TASK_ID}/state`, { isCompleted: true });
    assert.equal(res.status, 200);
  });
  const update = calls.find((c) => /UPDATE trademark_item_tasks/.test(c.text));
  assert.deepEqual(update.params.slice(0, 4), [TASK_ID, false, true, false]);
  assert.ok(calls.some((c) => /DELETE FROM tasks/.test(c.text)));
  assert.equal(audits[0].action, "trademark.task.state");
});

test("mirrors: none for a deleted item; completed tasks and collaborators carry their status", async () => {
  const hidden = makeDb({ item: itemRow({ is_hidden: true }), tasks: [taskRow()] });
  await tmTasks.syncItemTaskMirrors(hidden, ITEM_ID);
  assert.ok(hidden.calls.some((c) => /DELETE FROM tasks/.test(c.text)));
  assert.ok(!hidden.calls.some((c) => /INSERT INTO tasks/.test(c.text)));

  const db = makeDb({
    tasks: [
      taskRow({
        is_completed: true,
        completed_at: "2026-10-20T15:00:00Z",
        collaborators: [{ userId: HELPER, isComplete: false, isInProgress: true }],
      }),
      taskRow({ id: "77777777-7777-4777-8777-777777777777", action: " ", collaborators: [] }),
    ],
  });
  await tmTasks.syncItemTaskMirrors(db, ITEM_ID);
  const inserts = db.calls.filter((c) => /INSERT INTO tasks/.test(c.text));
  assert.equal(inserts.length, 2); // blank-description task gets no mirror
  assert.equal(inserts[0].params[3], "Complete");
  assert.equal(inserts[0].params[4], "2026-10-20T15:00:00Z");
  assert.equal(inserts[1].params[1], HELPER);
  assert.equal(inserts[1].params[3], "Complete"); // owner finished the whole task
  assert.equal(inserts[1].params[7], "collaborator");
});

test("completing from My Tasks: owner completes the task and everyone's copy; collaborator only their part", async () => {
  const owner = makeDb();
  const mirror = { id: "m1", source_trademark_task_id: TASK_ID, assigned_to_user_id: OTHER, task_role: "owner" };
  assert.equal(await tmTasks.completeFromMirror(owner, mirror, "Tester"), true);
  assert.ok(owner.calls.some((c) => /UPDATE trademark_item_tasks/.test(c.text)));
  assert.ok(owner.calls.some((c) => /UPDATE tasks SET status = 'Complete'/.test(c.text)));
  assert.ok(owner.calls.some((c) => /UPDATE trademark_item_task_collaborators/.test(c.text)));

  const helper = makeDb();
  await tmTasks.completeFromMirror(helper, { ...mirror, assigned_to_user_id: HELPER, task_role: "collaborator" }, "Tester");
  assert.equal(helper.calls.length, 1);
  assert.match(helper.calls[0].text, /UPDATE trademark_item_task_collaborators/);
  assert.deepEqual(helper.calls[0].params, [TASK_ID, HELPER, "Tester"]);
});

test("deleting an item rebuilds its task mirrors (drops them from My Tasks)", async () => {
  const { app, calls } = makeApp({ tasks: [taskRow()] });
  await withServer(app, async (call) => {
    assert.equal((await call("PUT", `/api/trademark/items/${ITEM_ID}/state`, { isHidden: true })).status, 200);
  });
  assert.ok(calls.some((c) => /DELETE FROM tasks/.test(c.text)));
});
