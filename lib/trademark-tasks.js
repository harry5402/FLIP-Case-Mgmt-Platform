// Trademark item tasks — assignable work on a docket item, modelled on
// litigation_actions. Each task (and each collaborator on it) is mirrored into
// the shared `tasks` table via source_trademark_task_id so it shows in My Tasks,
// the Weekly Task List, the Friday reminder and the weekly report.
// Every function takes a `db` with a pg-style query(); pass a transaction
// client for multi-step writes.

const TASK_TYPE_PREFIX = "Trademark: ";

const d = (col) => `to_char(${col}, 'YYYY-MM-DD')`;

const TASK_SELECT = `
  SELECT t.id, t.item_id, t.action,
         ${d("t.internal_due_date")} AS internal_due_date, ${d("t.final_due_date")} AS final_due_date,
         t.notes, t.assigned_to_user_id, u.name AS assigned_to_name,
         t.is_in_progress, t.is_completed, t.is_hidden, t.completed_at, t.completed_by,
         t.sort_order, t.updated_at, t.updated_by,
         COALESCE(collabs.collaborators, '[]'::json) AS collaborators
  FROM trademark_item_tasks t
  LEFT JOIN users u ON u.id = t.assigned_to_user_id
  LEFT JOIN LATERAL (
    SELECT json_agg(
      json_build_object(
        'userId', c.user_id,
        'name', cu.name,
        'email', cu.email,
        'isInProgress', c.is_in_progress,
        'isComplete', c.is_complete,
        'completedAt', c.completed_at,
        'completedBy', c.completed_by
      ) ORDER BY c.created_at
    ) AS collaborators
    FROM trademark_item_task_collaborators c
    LEFT JOIN users cu ON cu.id = c.user_id
    WHERE c.task_id = t.id
  ) collabs ON TRUE`;

const mapTask = (r) => ({
  id: r.id,
  itemId: r.item_id,
  action: r.action || "",
  internalDueDate: r.internal_due_date,
  finalDueDate: r.final_due_date,
  notes: r.notes || "",
  assignedToUserId: r.assigned_to_user_id,
  assignedToName: r.assigned_to_name || "",
  isInProgress: r.is_in_progress,
  isCompleted: r.is_completed,
  isHidden: r.is_hidden,
  completedAt: r.completed_at,
  completedBy: r.completed_by,
  sortOrder: r.sort_order,
  collaborators: Array.isArray(r.collaborators) ? r.collaborators : [],
  updatedAt: r.updated_at,
  updatedBy: r.updated_by,
});

const loadItemTasks = async (db, itemId) => {
  const { rows } = await db.query(
    `${TASK_SELECT} WHERE t.item_id = $1 AND NOT t.is_hidden ORDER BY t.sort_order, t.created_at`,
    [itemId]
  );
  return rows.map(mapTask);
};

const loadTask = async (db, taskId) => {
  const { rows } = await db.query(`${TASK_SELECT} WHERE t.id = $1`, [taskId]);
  return rows[0] ? mapTask(rows[0]) : null;
};

// Collaborators to keep, excluding the owner and duplicates.
const normalizeCollaboratorIds = (value, ownerUserId = null) => {
  const list = Array.isArray(value) ? value : [];
  const owner = String(ownerUserId || "");
  return [...new Set(list.map((v) => String(v || "").trim()).filter(Boolean))].filter((v) => v !== owner);
};

// Replace a task's collaborator list; people already on it keep their progress.
const syncCollaborators = async (db, taskId, userIds) => {
  if (userIds.length) {
    await db.query(
      `DELETE FROM trademark_item_task_collaborators WHERE task_id = $1 AND user_id <> ALL($2::uuid[])`,
      [taskId, userIds]
    );
  } else {
    await db.query(`DELETE FROM trademark_item_task_collaborators WHERE task_id = $1`, [taskId]);
  }
  for (const userId of userIds) {
    await db.query(
      `INSERT INTO trademark_item_task_collaborators (task_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (task_id, user_id) DO NOTHING`,
      [taskId, userId]
    );
  }
};

// Rebuild the `tasks` mirror rows for every task on one item. Hidden tasks, and
// all tasks on a hidden (deleted) item, get no mirror rows.
const syncItemTaskMirrors = async (db, itemId, createdByUserId = null) => {
  await db.query(
    `DELETE FROM tasks
     WHERE source_trademark_task_id IN (SELECT id FROM trademark_item_tasks WHERE item_id = $1)`,
    [itemId]
  );
  const item = await db.query(`SELECT is_hidden FROM trademark_docket_items WHERE id = $1`, [itemId]);
  if (!item.rows.length || item.rows[0].is_hidden) return;

  const insert = (task, userId, status, completedAt, role) =>
    db.query(
      `INSERT INTO tasks
        (case_id, defendant_id, group_id, task_type, assigned_to_user_id, due_date, status,
         completed_at, created_by_user_id, source_trademark_task_id, task_role, notes)
       VALUES (NULL, NULL, NULL, $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        `${TASK_TYPE_PREFIX}${task.action.trim()}`,
        userId,
        task.internalDueDate || task.finalDueDate || null,
        status,
        status === "Complete" ? completedAt || new Date() : null,
        createdByUserId,
        task.id,
        role,
        task.notes || null,
      ]
    );

  for (const task of await loadItemTasks(db, itemId)) {
    if (!task.action.trim()) continue;
    await insert(
      task,
      task.assignedToUserId || null,
      task.isCompleted ? "Complete" : task.isInProgress ? "In Progress" : "Open",
      task.completedAt,
      "owner"
    );
    for (const c of task.collaborators) {
      if (!c.userId) continue;
      const done = task.isCompleted || c.isComplete;
      await insert(
        task,
        c.userId,
        done ? "Complete" : c.isInProgress ? "In Progress" : "Open",
        c.completedAt || task.completedAt,
        "collaborator"
      );
    }
  }
};

// Set a task's state from the docket. With collaboratorUserId, only that
// collaborator's progress changes. Returns false if the task/collaborator is missing.
const setTaskState = async (db, taskId, { isCompleted, isInProgress, isHidden, collaboratorUserId }, actor) => {
  if (collaboratorUserId) {
    const result = await db.query(
      `UPDATE trademark_item_task_collaborators
       SET is_in_progress = CASE WHEN $3 THEN FALSE ELSE $2 END,
           is_complete = $3,
           completed_at = CASE WHEN $3 THEN NOW() ELSE NULL END,
           completed_by = CASE WHEN $3 THEN $4 ELSE NULL END
       WHERE task_id = $1 AND user_id = $5
       RETURNING task_id`,
      [taskId, Boolean(isInProgress), Boolean(isCompleted), actor, collaboratorUserId]
    );
    return result.rows.length > 0;
  }
  const completed = Boolean(isCompleted);
  const result = await db.query(
    `UPDATE trademark_item_tasks
     SET is_in_progress = $2,
         is_completed = $3,
         is_hidden = $4,
         completed_at = CASE WHEN $3 THEN COALESCE(completed_at, NOW()) ELSE NULL END,
         completed_by = CASE WHEN $3 THEN COALESCE(completed_by, $5) ELSE NULL END,
         updated_at = NOW(),
         updated_by = $5
     WHERE id = $1
     RETURNING id`,
    [taskId, completed ? false : Boolean(isInProgress), completed, Boolean(isHidden), actor]
  );
  if (!result.rows.length) return false;
  if (completed) {
    await db.query(
      `UPDATE trademark_item_task_collaborators SET is_in_progress = FALSE WHERE task_id = $1`,
      [taskId]
    );
  }
  return true;
};

// A mirror row in `tasks` was completed from My Tasks / Weekly Task List:
// carry it back to the trademark task. Same cascade as litigation docket tasks.
const completeFromMirror = async (db, mirror, actor) => {
  if (mirror.task_role === "collaborator") {
    const result = await db.query(
      `UPDATE trademark_item_task_collaborators
       SET is_in_progress = FALSE, is_complete = TRUE, completed_at = NOW(), completed_by = $3
       WHERE task_id = $1 AND user_id = $2
       RETURNING task_id`,
      [mirror.source_trademark_task_id, mirror.assigned_to_user_id, actor]
    );
    return result.rows.length > 0;
  }
  const result = await db.query(
    `UPDATE trademark_item_tasks
     SET is_in_progress = FALSE, is_completed = TRUE, completed_at = NOW(), completed_by = $2,
         updated_at = NOW(), updated_by = $2
     WHERE id = $1 AND NOT is_hidden
     RETURNING id`,
    [mirror.source_trademark_task_id, actor]
  );
  if (!result.rows.length) return false;
  await db.query(
    `UPDATE tasks SET status = 'Complete', completed_at = NOW()
     WHERE source_trademark_task_id = $1 AND id <> $2 AND status <> 'Complete'`,
    [mirror.source_trademark_task_id, mirror.id]
  );
  await db.query(
    `UPDATE trademark_item_task_collaborators
     SET is_complete = TRUE, is_in_progress = FALSE, completed_at = NOW(), completed_by = $2
     WHERE task_id = $1 AND NOT is_complete`,
    [mirror.source_trademark_task_id, actor]
  );
  return true;
};

// A mirror row was marked In Progress / Open from My Tasks: carry it back and
// rebuild the item's mirrors.
const progressFromMirror = async (db, mirror, inProgress, actor, userId = null) => {
  if (mirror.task_role === "collaborator") {
    await db.query(
      `UPDATE trademark_item_task_collaborators
       SET is_in_progress = CASE WHEN is_complete THEN FALSE ELSE $3 END
       WHERE task_id = $1 AND user_id = $2`,
      [mirror.source_trademark_task_id, mirror.assigned_to_user_id, inProgress]
    );
  } else {
    await db.query(
      `UPDATE trademark_item_tasks
       SET is_in_progress = CASE WHEN is_completed THEN FALSE ELSE $2 END,
           updated_at = NOW(), updated_by = $3
       WHERE id = $1 AND NOT is_hidden`,
      [mirror.source_trademark_task_id, inProgress, actor]
    );
  }
  const owner = await db.query(`SELECT item_id FROM trademark_item_tasks WHERE id = $1`, [mirror.source_trademark_task_id]);
  if (owner.rows.length) await syncItemTaskMirrors(db, owner.rows[0].item_id, userId);
};

module.exports = {
  TASK_TYPE_PREFIX,
  mapTask,
  loadItemTasks,
  loadTask,
  normalizeCollaboratorIds,
  syncCollaborators,
  syncItemTaskMirrors,
  setTaskState,
  completeFromMirror,
  progressFromMirror,
};
