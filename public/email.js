"use strict";

// ---------------------------------------------------------------------------
// Auth guard
// ---------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  if (!getToken()) {
    window.location.href = "login.html";
    return;
  }

  // Handle logout
  const logoutBtn = document.getElementById("logout-button");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await apiFetch("/api/auth/logout", { method: "POST" });
      localStorage.removeItem("flipAuth");
      window.location.href = "login.html";
    });
  }

  // Handle OAuth redirect result
  const params = new URLSearchParams(window.location.search);
  if (params.get("connected") === "1") {
    showToast("Microsoft account connected successfully.", "success");
    history.replaceState({}, "", "/email.html");
  } else if (params.get("error")) {
    showToast("Failed to connect Microsoft account. Please try again.", "error");
    history.replaceState({}, "", "/email.html");
  }

  init();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function apiFetch(path, opts = {}) {
  const token = getToken();
  const res = await fetch(path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return res;
}

function showToast(msg, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  toast.style.cssText = `
    position:fixed;bottom:24px;right:24px;z-index:9999;
    background:${type === "success" ? "#27ae60" : type === "error" ? "#e74c3c" : "#333"};
    color:#fff;padding:12px 20px;border-radius:10px;font-size:13px;
    box-shadow:0 4px 16px rgba(0,0,0,0.2);animation:fadein 0.2s ease;
    max-width:360px;line-height:1.4;
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let accounts = [];
let folderMappings = {};   // accountId → array of mappings
let folderTrees = {};      // accountId → folder tree
let activeView = null;     // { type: 'folder'|'triage', accountId?, folderId?, folderName? }
let triageQueue = [];
let currentSkip = 0;
let currentMessages = [];
let activeMessageId = null;
let activeAccountId = null;
let reassignTriageId = null;
let replyMessageId = null;
let replyAccountId = null;
let replySubject = null;

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
async function init() {
  await loadAccounts();
  renderSidebar();
  loadTriageBadge();
}

// ---------------------------------------------------------------------------
// Load accounts
// ---------------------------------------------------------------------------
async function loadAccounts() {
  const res = await apiFetch("/api/email/accounts");
  if (!res.ok) { accounts = []; return; }
  accounts = await res.json();
}

// ---------------------------------------------------------------------------
// Load folder tree for an account (cached)
// ---------------------------------------------------------------------------
async function loadFolderTree(accountId) {
  if (folderTrees[accountId]) return folderTrees[accountId];
  const res = await apiFetch(`/api/email/accounts/${accountId}/folders`);
  if (!res.ok) return [];
  const tree = await res.json();
  folderTrees[accountId] = tree;
  return tree;
}

// ---------------------------------------------------------------------------
// Load triage badge count
// ---------------------------------------------------------------------------
async function loadTriageBadge() {
  // Use the first shared account (litigation) as the triage source
  const sharedAccount = accounts.find((a) => a.isShared);
  if (!sharedAccount) return;

  const res = await apiFetch(`/api/email/triage/queue?accountId=${sharedAccount.id}`);
  if (!res.ok) return;
  const queue = await res.json();
  const badge = document.getElementById("triage-badge");
  if (badge) {
    badge.textContent = queue.length;
    badge.classList.toggle("hidden", queue.length === 0);
  }
}

// ---------------------------------------------------------------------------
// Sidebar rendering
// ---------------------------------------------------------------------------
async function renderSidebar() {
  const container = document.getElementById("accounts-sidebar");
  if (!container) return;
  container.innerHTML = "";

  for (const account of accounts) {
    const block = document.createElement("div");
    block.className = "account-block email-sidebar-section";

    const header = document.createElement("div");
    header.className = "account-header";
    header.innerHTML = `
      <span class="account-badge ${account.isShared ? "shared" : ""}"></span>
      <span>${escapeHtml(account.displayName || account.msEmail)}</span>
      <span class="chevron">▶</span>
    `;
    block.appendChild(header);

    const treeContainer = document.createElement("div");
    treeContainer.className = "folder-tree hidden";
    treeContainer.innerHTML = `<div class="folder-item" style="opacity:0.5;"><span class="spinner"></span> Loading...</div>`;
    block.appendChild(treeContainer);

    header.addEventListener("click", async () => {
      const isExpanded = header.classList.contains("expanded");
      if (!isExpanded) {
        header.classList.add("expanded");
        treeContainer.classList.remove("hidden");
        const tree = await loadFolderTree(account.id);
        treeContainer.innerHTML = "";
        renderFolderTree(tree, treeContainer, account.id);
      } else {
        header.classList.remove("expanded");
        treeContainer.classList.add("hidden");
      }
    });

    container.appendChild(block);
  }

  // Connect buttons — fetch auth URL first (needs auth header), then redirect
  const startOAuth = async (shared = false) => {
    const res = await apiFetch("/api/email/oauth/start", {
      method: "POST",
      body: { shared },
    });
    if (!res.ok) {
      showToast("Failed to start Microsoft login. Please try again.", "error");
      return;
    }
    const { authUrl } = await res.json();
    window.location.href = authUrl;
  };

  document.getElementById("connect-personal-btn")?.addEventListener("click", () => startOAuth(false));
  document.getElementById("connect-shared-btn")?.addEventListener("click", () => startOAuth(true));

  // Triage nav button
  document.getElementById("triage-nav-btn")?.addEventListener("click", () => {
    const sharedAccount = accounts.find((a) => a.isShared);
    if (!sharedAccount) { showToast("No shared account connected.", "error"); return; }
    activeView = { type: "triage", accountId: sharedAccount.id };
    document.querySelectorAll(".folder-item.active, .triage-btn.active")
      .forEach((el) => el.classList.remove("active"));
    document.getElementById("triage-nav-btn").classList.add("active");
    renderTriageView(sharedAccount.id);
  });
}

function renderFolderTree(nodes, container, accountId, depth = 0) {
  for (const node of nodes) {
    const item = document.createElement("div");
    item.className = "folder-item";
    item.style.paddingLeft = `${10 + depth * 12}px`;
    item.innerHTML = `
      <span class="folder-icon">📁</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(node.name)}</span>
      ${node.unreadItemCount > 0 ? `<span class="folder-unread">${node.unreadItemCount}</span>` : ""}
    `;
    item.addEventListener("click", () => {
      document.querySelectorAll(".folder-item.active, .triage-btn.active")
        .forEach((el) => el.classList.remove("active"));
      item.classList.add("active");
      activeView = { type: "folder", accountId, folderId: node.id, folderName: node.name };
      loadMessages(accountId, node.id, node.name);
    });
    container.appendChild(item);

    if (node.children?.length) {
      renderFolderTree(node.children, container, accountId, depth + 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Message list
// ---------------------------------------------------------------------------
async function loadMessages(accountId, folderId, folderName, skip = 0) {
  const main = document.getElementById("email-main");
  if (skip === 0) {
    main.innerHTML = `
      <div class="email-toolbar">
        <h3>${escapeHtml(folderName)}</h3>
      </div>
      <div class="email-list" id="msg-list">
        <div class="empty-state"><span class="spinner"></span> Loading...</div>
      </div>
    `;
    currentMessages = [];
    currentSkip = 0;
  }

  activeAccountId = accountId;
  const res = await apiFetch(`/api/email/accounts/${accountId}/folders/${folderId}/messages?skip=${skip}`);
  if (!res.ok) {
    document.getElementById("msg-list").innerHTML = `<div class="empty-state">Failed to load messages.</div>`;
    return;
  }
  const data = await res.json();
  const messages = data.messages || [];
  currentMessages = skip === 0 ? messages : [...currentMessages, ...messages];
  currentSkip = skip + messages.length;

  const list = document.getElementById("msg-list");
  if (!list) return;

  if (messages.length === 0 && skip === 0) {
    list.innerHTML = `<div class="empty-state">No messages in this folder.</div>`;
    return;
  }

  const appendTarget = skip === 0 ? list : list;
  if (skip === 0) list.innerHTML = "";

  // Remove old load-more button if present
  const oldBtn = list.querySelector(".load-more-btn");
  if (oldBtn) oldBtn.remove();

  for (const msg of messages) {
    const row = document.createElement("div");
    row.className = `email-row${msg.isRead === false ? " unread" : ""}`;
    row.dataset.msgId = msg.id;
    row.dataset.accountId = accountId;
    row.innerHTML = `
      <div class="email-sender">${escapeHtml(msg.from?.name || msg.from?.address || "Unknown")}</div>
      <div class="email-subject-preview">
        <div class="email-subject">${escapeHtml(msg.subject || "(no subject)")}</div>
        <div class="email-preview">${escapeHtml(msg.preview || "")}</div>
      </div>
      <div class="email-date">${formatDate(msg.receivedAt)}</div>
    `;
    row.addEventListener("click", () => openMessage(accountId, msg.id, msg.subject, msg.conversationId));
    list.appendChild(row);
  }

  if (data.nextSkip !== null) {
    const btn = document.createElement("button");
    btn.className = "load-more-btn";
    btn.textContent = "Load more";
    btn.addEventListener("click", () => loadMessages(accountId, folderId, folderName, data.nextSkip));
    list.appendChild(btn);
  }
}

// ---------------------------------------------------------------------------
// Message detail
// ---------------------------------------------------------------------------
async function openMessage(accountId, messageId, subject, conversationId) {
  const panel = document.getElementById("message-panel");
  document.getElementById("msg-subject").textContent = subject || "(no subject)";
  document.getElementById("msg-meta").textContent = "Loading…";
  document.getElementById("msg-body").textContent = "";
  panel.classList.add("open");

  activeMessageId = messageId;
  replyMessageId = messageId;
  replyAccountId = accountId;
  replySubject = subject;

  const res = await apiFetch(`/api/email/accounts/${accountId}/messages/${messageId}`);
  if (!res.ok) {
    document.getElementById("msg-body").textContent = "Failed to load message.";
    return;
  }
  const msg = await res.json();

  const from = msg.from ? `${msg.from.name || ""} <${msg.from.address || ""}>` : "Unknown";
  const to = (msg.to || []).map((r) => `${r.name || ""} <${r.address || ""}>`).join(", ");
  document.getElementById("msg-meta").textContent = `From: ${from}   To: ${to}   ${formatDate(msg.receivedAt)}`;

  const bodyEl = document.getElementById("msg-body");
  if (msg.bodyType === "html") {
    // Render HTML safely in a sandboxed iframe
    const iframe = document.createElement("iframe");
    iframe.sandbox = "allow-same-origin";
    iframe.style.cssText = "width:100%;height:100%;border:none;";
    bodyEl.innerHTML = "";
    bodyEl.appendChild(iframe);
    iframe.srcdoc = msg.body || "";
  } else {
    bodyEl.textContent = msg.body || "";
  }

  // Reply button
  document.getElementById("msg-reply-btn").onclick = () => openReplyModal(messageId, accountId, subject);
  document.getElementById("msg-close").onclick = () => panel.classList.remove("open");
}

// ---------------------------------------------------------------------------
// Reply modal
// ---------------------------------------------------------------------------
function openReplyModal(messageId, accountId, subject) {
  replyMessageId = messageId;
  replyAccountId = accountId;
  replySubject = subject;
  document.getElementById("reply-modal-title").textContent = `Re: ${subject || "(no subject)"}`;
  document.getElementById("reply-thread-info").textContent = "";
  document.getElementById("reply-body").value = "";
  document.getElementById("reply-status").textContent = "";
  document.getElementById("reply-modal").classList.remove("hidden");
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("reply-close")?.addEventListener("click", () => {
    document.getElementById("reply-modal").classList.add("hidden");
  });

  document.getElementById("reply-send-btn")?.addEventListener("click", async () => {
    const body = document.getElementById("reply-body").value.trim();
    if (!body) { showToast("Reply body cannot be empty.", "error"); return; }

    const btn = document.getElementById("reply-send-btn");
    btn.disabled = true;
    btn.textContent = "Sending…";

    const res = await apiFetch("/api/email/send", {
      method: "POST",
      body: { accountId: replyAccountId, messageId: replyMessageId, body, subject: replySubject },
    });

    btn.disabled = false;
    btn.textContent = "Send Reply";

    if (res.ok) {
      document.getElementById("reply-modal").classList.add("hidden");
      document.getElementById("message-panel").classList.remove("open");
      showToast("Reply sent.", "success");
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || "Failed to send reply.", "error");
    }
  });

  document.getElementById("draft-settlement-btn")?.addEventListener("click", async () => {
    const btn = document.getElementById("draft-settlement-btn");
    btn.disabled = true;
    btn.textContent = "Generating…";
    document.getElementById("reply-status").textContent = "";

    // For settlement drafts we need a defendantId — show a notice if not in defendant context
    showToast("Settlement drafts are generated from the Defendant page. Navigate there to use this feature.", "info");
    btn.disabled = false;
    btn.textContent = "Generate Settlement Draft";
  });
});

// ---------------------------------------------------------------------------
// Triage view
// ---------------------------------------------------------------------------
async function renderTriageView(accountId) {
  const main = document.getElementById("email-main");
  main.innerHTML = `
    <div class="triage-view">
      <div class="triage-header">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px;">
          <h3>Pending Triage</h3>
          <button class="scan-btn" id="run-scan-btn">Scan Inbox</button>
        </div>
        <p>Review Claude's suggestions for unsorted emails. Approve to move them, or reassign to a different folder.</p>
      </div>
      <div id="triage-cards">
        <div class="empty-state"><span class="spinner"></span> Loading queue…</div>
      </div>
    </div>
  `;

  document.getElementById("run-scan-btn")?.addEventListener("click", () => runTriageScan(accountId));

  await loadTriageQueue(accountId);
}

async function loadTriageQueue(accountId) {
  const res = await apiFetch(`/api/email/triage/queue?accountId=${accountId}`);
  if (!res.ok) {
    document.getElementById("triage-cards").innerHTML = `<div class="empty-state">Failed to load triage queue.</div>`;
    return;
  }
  triageQueue = await res.json();
  renderTriageCards(accountId);
}

function renderTriageCards(accountId) {
  const container = document.getElementById("triage-cards");
  if (!container) return;

  if (!triageQueue.length) {
    container.innerHTML = `<div class="empty-state">No pending items. Click "Scan Inbox" to check for new unsorted emails.</div>`;
    return;
  }

  container.innerHTML = "";
  for (const item of triageQueue) {
    const confidenceClass = `confidence-${item.confidence || "low"}`;
    const hasSuggestion = item.suggested_folder_id && item.suggested_folder_id !== "UNMATCHED";
    const card = document.createElement("div");
    card.className = "triage-card";
    card.dataset.triageId = item.id;
    card.innerHTML = `
      <div class="triage-card-header">
        <div class="triage-subject">${escapeHtml(item.subject || "(no subject)")}</div>
      </div>
      <div class="triage-meta">
        From: ${escapeHtml(item.sender_name || item.sender_email || "Unknown")}
        &nbsp;·&nbsp; ${formatDate(item.received_at)}
      </div>
      ${hasSuggestion ? `
        <div class="triage-suggestion">
          <span class="confidence-dot ${confidenceClass}"></span>
          <div>
            <div class="triage-suggestion-text">→ <strong>${escapeHtml(item.suggested_folder_name)}</strong></div>
            <div class="triage-reasoning">${escapeHtml(item.claude_reasoning || "")}</div>
          </div>
        </div>
      ` : `
        <div class="triage-suggestion">
          <span class="confidence-dot confidence-low"></span>
          <span class="no-suggestion-badge">No match found</span>
          <span style="font-size:12px;color:var(--muted);margin-left:8px;">${escapeHtml(item.claude_reasoning || "")}</span>
        </div>
      `}
      <div class="triage-actions">
        ${hasSuggestion ? `<button class="triage-approve-btn" data-id="${item.id}">✓ Approve</button>` : ""}
        <button class="triage-reassign-btn" data-id="${item.id}" data-account="${accountId}">Move to…</button>
        <button class="triage-skip-btn" data-id="${item.id}">Skip</button>
      </div>
    `;
    container.appendChild(card);
  }

  // Bind approve buttons
  container.querySelectorAll(".triage-approve-btn").forEach((btn) => {
    btn.addEventListener("click", () => approveTriage(btn.dataset.id, accountId));
  });
  container.querySelectorAll(".triage-reassign-btn").forEach((btn) => {
    btn.addEventListener("click", () => openReassignModal(btn.dataset.id, btn.dataset.account));
  });
  container.querySelectorAll(".triage-skip-btn").forEach((btn) => {
    btn.addEventListener("click", () => skipTriage(btn.dataset.id, accountId));
  });
}

async function approveTriage(triageId, accountId) {
  const res = await apiFetch(`/api/email/triage/${triageId}/approve`, { method: "POST" });
  if (res.ok) {
    removeTriageCard(triageId);
    updateTriageBadge(-1);
    showToast("Email moved.", "success");
  } else {
    const err = await res.json().catch(() => ({}));
    showToast(err.error || "Failed to approve.", "error");
  }
}

async function skipTriage(triageId, accountId) {
  const res = await apiFetch(`/api/email/triage/${triageId}/skip`, { method: "POST" });
  if (res.ok) {
    removeTriageCard(triageId);
    showToast("Skipped.", "info");
  }
}

function removeTriageCard(triageId) {
  const card = document.querySelector(`.triage-card[data-triage-id="${triageId}"]`);
  if (card) card.remove();
  triageQueue = triageQueue.filter((i) => i.id !== triageId);
  if (!triageQueue.length) {
    const container = document.getElementById("triage-cards");
    if (container) container.innerHTML = `<div class="empty-state">All caught up! No pending items.</div>`;
  }
}

function updateTriageBadge(delta) {
  const badge = document.getElementById("triage-badge");
  if (!badge) return;
  const current = parseInt(badge.textContent || "0", 10);
  const next = Math.max(0, current + delta);
  badge.textContent = next;
  badge.classList.toggle("hidden", next === 0);
}

async function runTriageScan(accountId) {
  const btn = document.getElementById("run-scan-btn");
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = "Scanning…";

  const res = await apiFetch("/api/email/triage/scan", {
    method: "POST",
    body: { accountId },
  });

  btn.disabled = false;
  btn.textContent = "Scan Inbox";

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    showToast(err.error || "Scan failed.", "error");
    return;
  }
  const data = await res.json();
  showToast(`Scan complete — ${data.queued} new item${data.queued !== 1 ? "s" : ""} added to queue.`, "success");
  await loadTriageQueue(accountId);
  loadTriageBadge();
}

// ---------------------------------------------------------------------------
// Reassign modal
// ---------------------------------------------------------------------------
async function openReassignModal(triageId, accountId) {
  reassignTriageId = triageId;

  // Populate folder select from folder tree
  const tree = await loadFolderTree(accountId);
  const select = document.getElementById("reassign-folder-select");
  select.innerHTML = `<option value="">— Select a folder —</option>`;

  function addOptions(nodes, prefix = "") {
    for (const node of nodes) {
      const label = prefix ? `${prefix} / ${node.name}` : node.name;
      const opt = document.createElement("option");
      opt.value = node.id;
      opt.textContent = label;
      select.appendChild(opt);
      if (node.children?.length) addOptions(node.children, label);
    }
  }
  addOptions(tree);

  document.getElementById("reassign-modal").classList.remove("hidden");
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("reassign-close")?.addEventListener("click", () => {
    document.getElementById("reassign-modal").classList.add("hidden");
    reassignTriageId = null;
  });

  document.getElementById("reassign-confirm-btn")?.addEventListener("click", async () => {
    const select = document.getElementById("reassign-folder-select");
    const folderId = select.value;
    const folderName = select.options[select.selectedIndex]?.text || "";
    if (!folderId || !reassignTriageId) return;

    const res = await apiFetch(`/api/email/triage/${reassignTriageId}/reassign`, {
      method: "POST",
      body: { folderId, folderName },
    });

    if (res.ok) {
      document.getElementById("reassign-modal").classList.add("hidden");
      removeTriageCard(reassignTriageId);
      updateTriageBadge(-1);
      showToast("Email moved.", "success");
      reassignTriageId = null;
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || "Failed to move email.", "error");
    }
  });
});
