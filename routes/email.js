"use strict";

const msal = require("@azure/msal-node");
const Anthropic = require("@anthropic-ai/sdk");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const MS_SCOPES = [
  "Mail.Read",
  "Mail.ReadWrite",
  "Mail.Send",
  "User.Read",
  "User.ReadBasic.All",
  "Chat.Create",
  "ChatMessage.Send",
  "offline_access",
];

// Lazy-initialize so missing env vars don't crash the server at startup
let _msalClient = null;
const getMsalClient = () => {
  if (!_msalClient) {
    if (!process.env.MS_CLIENT_ID || !process.env.MS_CLIENT_SECRET || !process.env.MS_TENANT_ID) {
      throw new Error("MS_CLIENT_ID, MS_CLIENT_SECRET, and MS_TENANT_ID must be set in environment variables.");
    }
    _msalClient = new msal.ConfidentialClientApplication({
      auth: {
        clientId: process.env.MS_CLIENT_ID,
        clientSecret: process.env.MS_CLIENT_SECRET,
        authority: `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}`,
      },
    });
  }
  return _msalClient;
};

let _anthropic = null;
const getAnthropic = () => {
  if (!_anthropic) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY must be set.");
    _anthropic = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropic;
};

const getRedirectUri = () => `${process.env.APP_URL}/auth/microsoft/callback`;

// ---------------------------------------------------------------------------
// Graph API helpers
// ---------------------------------------------------------------------------
async function graphRequest(token, endpoint, options = {}) {
  const url = endpoint.startsWith("http") ? endpoint : `${GRAPH_BASE}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph API ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ---------------------------------------------------------------------------
// Token management
// Direct HTTP calls to Microsoft's token endpoint — MSAL does not expose
// refresh tokens in its public API, so we manage them ourselves.
// ---------------------------------------------------------------------------
async function exchangeCodeForTokens(code) {
  const res = await fetch(
    `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: process.env.MS_CLIENT_ID,
        client_secret: process.env.MS_CLIENT_SECRET,
        code,
        redirect_uri: getRedirectUri(),
        scope: MS_SCOPES.join(" "),
      }),
    }
  );
  const data = await res.json();
  if (data.error) throw new Error(`Token exchange failed: ${data.error_description || data.error}`);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

async function refreshAccessToken(refreshToken) {
  const res = await fetch(
    `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: process.env.MS_CLIENT_ID,
        client_secret: process.env.MS_CLIENT_SECRET,
        refresh_token: refreshToken,
        scope: MS_SCOPES.join(" "),
      }),
    }
  );
  const data = await res.json();
  if (data.error) throw new Error(`Token refresh failed: ${data.error_description || data.error}`);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken, // MS returns a new one; fall back if not
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

async function getValidToken(accountId, db) {
  const { rows } = await db(
    "SELECT id, access_token, refresh_token, token_expires_at FROM ms_connected_accounts WHERE id = $1",
    [accountId]
  );
  if (!rows.length) throw new Error("MS account not found");
  const account = rows[0];

  const expiresAt = account.token_expires_at ? new Date(account.token_expires_at) : new Date(0);
  const bufferMs = 5 * 60 * 1000; // refresh 5 min before expiry
  if (Date.now() < expiresAt.getTime() - bufferMs) {
    return account.access_token;
  }

  if (!account.refresh_token) {
    throw new Error("No refresh token stored — account needs to be reconnected.");
  }

  try {
    const tokens = await refreshAccessToken(account.refresh_token);
    await db(
      `UPDATE ms_connected_accounts
       SET access_token = $1, refresh_token = $2, token_expires_at = $3, updated_at = NOW()
       WHERE id = $4`,
      [tokens.accessToken, tokens.refreshToken, tokens.expiresAt, accountId]
    );
    return tokens.accessToken;
  } catch (err) {
    throw new Error(`Token refresh failed — account may need to be reconnected: ${err.message}`);
  }
}

// Returns accessible accounts for the current FLIP user.
// Shared accounts are visible to everyone; personal accounts only to their owner.
async function getAccessibleAccounts(userId, db) {
  const { rows } = await db(
    `SELECT id, ms_email, display_name, is_shared, connected_by_user_id, ms_user_id
     FROM ms_connected_accounts
     WHERE is_shared = TRUE OR connected_by_user_id = $1
     ORDER BY is_shared DESC, display_name`,
    [userId]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Folder tree helper — concurrency-limited recursive fetch
// Microsoft throttles at 4 concurrent requests per mailbox. We cap at 3.
// ---------------------------------------------------------------------------
const FOLDER_FIELDS = "id,displayName,totalItemCount,unreadItemCount,childFolderCount";
const FOLDER_CONCURRENCY = 3;

async function limitedParallel(items, limit, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

async function fetchFolderLevel(token, parentId = null) {
  const endpoint = parentId
    ? `/me/mailFolders/${parentId}/childFolders?$top=100&$select=${FOLDER_FIELDS}`
    : `/me/mailFolders?$top=100&$select=${FOLDER_FIELDS}`;
  const data = await graphRequest(token, endpoint);
  return data.value || [];
}

async function fetchFolderTree(token) {
  const topLevel = await fetchFolderLevel(token);

  const buildNodes = async (folders) =>
    limitedParallel(folders, FOLDER_CONCURRENCY, async (f) => {
      const node = {
        id: f.id,
        name: f.displayName,
        totalItemCount: f.totalItemCount || 0,
        unreadItemCount: f.unreadItemCount || 0,
        children: [],
      };
      if (f.childFolderCount > 0) {
        const children = await fetchFolderLevel(token, f.id);
        node.children = await buildNodes(children);
      }
      return node;
    });

  return buildNodes(topLevel);
}

// ---------------------------------------------------------------------------
// Teams notification helper
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Teams notification helpers
// ---------------------------------------------------------------------------

/** Look up a user's Microsoft 365 object ID by their email address */
async function lookupMsUserByEmail(token, email) {
  try {
    const data = await graphRequest(token, `/users/${encodeURIComponent(email)}?$select=id,displayName`);
    return data; // { id, displayName }
  } catch (err) {
    console.error(`[Teams] Could not look up MS user for ${email}:`, err.message);
    return null;
  }
}

/**
 * Resolve a recipient's MS object ID.
 * 1. By FLIP user ID via connected_by_user_id (most reliable — no email mismatch)
 * 2. By email match in ms_connected_accounts
 * 3. Graph API lookup (requires User.ReadBasic.All admin consent)
 * Returns null if we can't resolve — caller should skip the notification gracefully.
 */
async function resolveRecipientMsId(token, recipientEmail, db, flipUserId = null) {
  // Fast path 1: look up by FLIP user ID (bypasses any email mismatch)
  if (flipUserId) {
    const { rows } = await db(
      `SELECT ms_user_id FROM ms_connected_accounts
       WHERE connected_by_user_id = $1 AND is_shared = FALSE AND ms_user_id IS NOT NULL
       LIMIT 1`,
      [flipUserId]
    );
    if (rows[0]?.ms_user_id) {
      console.log(`[Teams] Resolved user ${flipUserId} from connected accounts (by user ID)`);
      return rows[0].ms_user_id;
    }
  }

  // Fast path 2: match by MS email
  const { rows: emailRows } = await db(
    `SELECT ms_user_id FROM ms_connected_accounts
     WHERE LOWER(ms_email) = LOWER($1) AND ms_user_id IS NOT NULL
     LIMIT 1`,
    [recipientEmail]
  );
  if (emailRows[0]?.ms_user_id) {
    console.log(`[Teams] Resolved ${recipientEmail} from connected accounts (by email)`);
    return emailRows[0].ms_user_id;
  }

  // Graph API fallback (needs User.ReadBasic.All)
  const looked = await lookupMsUserByEmail(token, recipientEmail);
  if (looked?.id) {
    console.log(`[Teams] Resolved ${recipientEmail} via Graph API`);
    return looked.id;
  }

  console.warn(`[Teams] Could not resolve MS user ID for ${recipientEmail} — notification skipped`);
  return null;
}

/** Get the first connected account (litigation account) to use as sender */
async function getDefaultSendingAccount(db) {
  const { rows } = await db(
    `SELECT id, ms_user_id, ms_email AS email FROM ms_connected_accounts
     ORDER BY is_shared DESC, created_at ASC LIMIT 1`
  );
  return rows[0] || null;
}

/** Core: send a Teams DM from the default account to a recipient MS user ID */
async function sendTeamsDM(senderAccount, recipientMsUserId, htmlMessage, db) {
  const token = await getValidToken(senderAccount.id, db);
  const senderMsUserId = senderAccount.ms_user_id;
  if (!senderMsUserId) throw new Error("Sender account has no ms_user_id stored");

  // Create or retrieve 1:1 chat
  const chat = await graphRequest(token, "/chats", {
    method: "POST",
    body: {
      chatType: "oneOnOne",
      members: [
        {
          "@odata.type": "#microsoft.graph.aadUserConversationMember",
          roles: ["owner"],
          "user@odata.bind": `https://graph.microsoft.com/v1.0/users/${senderMsUserId}`,
        },
        {
          "@odata.type": "#microsoft.graph.aadUserConversationMember",
          roles: ["owner"],
          "user@odata.bind": `https://graph.microsoft.com/v1.0/users/${recipientMsUserId}`,
        },
      ],
    },
  });

  await graphRequest(token, `/chats/${chat.id}/messages`, {
    method: "POST",
    body: { body: { contentType: "html", content: htmlMessage } },
  });
}

/**
 * High-level: notify a FLIP user by their firm email that a task was assigned to them.
 * Non-fatal — a Teams failure never blocks the task operation.
 *
 * taskInfo: { taskType, dueDate, caseName, assignedByName }
 */
async function notifyTaskAssigned(recipientEmail, taskInfo, db) {
  try {
    const sender = await getDefaultSendingAccount(db);
    if (!sender) return; // No connected accounts yet

    const token = await getValidToken(sender.id, db);
    const recipientId = await resolveRecipientMsId(token, recipientEmail, db, taskInfo.flipUserId || null);
    if (!recipientId) return;

    const due = taskInfo.dueDate
      ? new Date(taskInfo.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : "no due date";

    const caseLabel = taskInfo.caseName ? ` on <b>${taskInfo.caseName}</b>` : "";
    const byLabel = taskInfo.assignedByName ? ` by ${taskInfo.assignedByName}` : "";

    const html = `
      <p>📋 <b>New task assigned to you${byLabel} in FLIP</b></p>
      <p><b>Task:</b> ${taskInfo.taskType}${caseLabel}</p>
      <p><b>Due:</b> ${due}</p>
      <p><a href="https://www.flipcasemgmt.com">Open FLIP →</a></p>
    `.trim();

    await sendTeamsDM(sender, recipientId, html, db);
    console.log(`[Teams] Task notification sent to ${recipientEmail}`);
  } catch (err) {
    console.error("[Teams] notifyTaskAssigned failed:", err.message);
  }
}

/**
 * High-level: send a Friday overdue task summary to a user.
 * tasks: [{ taskType, caseName, dueDate }]
 */
async function notifyOverdueSummary(recipientEmail, tasks, db) {
  if (!tasks || tasks.length === 0) return;
  try {
    const sender = await getDefaultSendingAccount(db);
    if (!sender) return;

    const token = await getValidToken(sender.id, db);
    const recipientId = await resolveRecipientMsId(token, recipientEmail, db);
    if (!recipientId) return;

    const taskLines = tasks.map((t) => {
      const due = t.dueDate
        ? new Date(t.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })
        : "no date";
      const caseLabel = t.caseName ? ` — ${t.caseName}` : "";
      return `<li>${t.taskType}${caseLabel} <span style="color:#cc0000">(due ${due})</span></li>`;
    }).join("");

    const html = `
      <p>⏰ <b>FLIP Weekly Reminder — You have ${tasks.length} overdue task${tasks.length === 1 ? "" : "s"}</b></p>
      <ul>${taskLines}</ul>
      <p><a href="https://www.flipcasemgmt.com">Open FLIP →</a></p>
    `.trim();

    await sendTeamsDM(sender, recipientId, html, db);
    console.log(`[Teams] Overdue summary sent to ${recipientEmail} (${tasks.length} tasks)`);
  } catch (err) {
    console.error("[Teams] notifyOverdueSummary failed:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Claude triage helper
// ---------------------------------------------------------------------------
async function suggestFolder(subject, folders) {
  const folderList = folders
    .map((f) => `- "${f.path}" (id: ${f.folder_id})`)
    .join("\n");

  const response = await getAnthropic().messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 256,
    messages: [
      {
        role: "user",
        content: `You sort law firm emails into matter folders by matching the subject line to a folder name.

Look for: case numbers (e.g. 25-cv-07293), brand/matter names (e.g. "Louis Poulsen", "Wing Rails"), or firm names.
Reply with ONLY valid JSON — no explanation: { "folder_id": "...", "folder_name": "...", "confidence": "high|medium|low", "reasoning": "one sentence" }

Subject: "${subject}"

Folders:
${folderList}

If nothing matches, use folder_id "UNMATCHED" and folder_name "No match found".`,
      },
    ],
  });

  try {
    const text = response.content[0].text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");
    return JSON.parse(jsonMatch[0]);
  } catch {
    return { folder_id: "UNMATCHED", folder_name: "No match found", confidence: "low", reasoning: "Could not parse suggestion" };
  }
}

// ---------------------------------------------------------------------------
// Claude settlement draft helper
// ---------------------------------------------------------------------------
async function draftSettlementReply(context) {
  const { caseNumber, caseName, jurisdiction, docketStatus, defendantName,
    platform, threadSubject, hasRepresentation } = context;

  const tone = hasRepresentation
    ? "professional lawyer-to-lawyer tone, addressed to opposing counsel"
    : "professional but direct tone, addressed to the defendant directly";

  const response = await getAnthropic().messages.create({
    model: "claude-opus-4-5",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `Draft a settlement agreement email for the following case. Use a ${tone}.
Do not include a subject line. Write only the email body, starting with the salutation.
Leave placeholders like [SETTLEMENT AMOUNT] and [DEADLINE DATE] where specific terms need to be filled in.

Case: ${caseName} (${caseNumber})
Jurisdiction: ${jurisdiction}
Docket Status: ${docketStatus}
Defendant/Seller: ${defendantName} on ${platform}
Thread subject: ${threadSubject}
Has legal representation: ${hasRepresentation ? "Yes" : "No"}`,
      },
    ],
  });

  return response.content[0].text.trim();
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------
function registerEmailRoutes(app, { requireSession, query, withTransaction, writeAuditLog }) {
  // -------------------------------------------------------------------------
  // GET /api/email/cases-for-mapping
  // All cases including docket-only — lightweight list for folder mapping dropdown
  // -------------------------------------------------------------------------
  app.get("/api/email/cases-for-mapping", requireSession, async (req, res) => {
    try {
      const { rows } = await query(
        `SELECT c.id, c.case_name, c.case_number, c.jurisdiction, c.is_docket_only
         FROM cases c
         ORDER BY c.is_docket_only ASC, c.case_name ASC`
      );
      res.json(rows.map((r) => ({
        id: r.id,
        caseName: r.case_name,
        caseNumber: r.case_number,
        jurisdiction: r.jurisdiction,
        isDocketOnly: r.is_docket_only,
      })));
    } catch (err) {
      console.error("[email/cases-for-mapping]", err);
      res.status(500).json({ error: "Failed to load cases" });
    }
  });

  // -------------------------------------------------------------------------
  // OAuth — Start (API endpoint — returns auth URL to frontend)
  // POST /api/email/oauth/start  { shared: true|false }
  // Frontend calls this with fetch (auth header included), then redirects to URL
  // -------------------------------------------------------------------------
  app.post("/api/email/oauth/start", requireSession, async (req, res) => {
    try {
      const isShared = req.body?.shared === true;
      const state = Buffer.from(
        JSON.stringify({ userId: req.session.userId, isShared })
      ).toString("base64");

      const authUrl = await getMsalClient().getAuthCodeUrl({
        scopes: MS_SCOPES,
        redirectUri: getRedirectUri(),
        state,
        prompt: "select_account",
      });

      res.json({ authUrl });
    } catch (err) {
      console.error("[OAuth] Start error:", err);
      res.status(500).json({ error: "Failed to generate Microsoft login URL." });
    }
  });

  // -------------------------------------------------------------------------
  // OAuth — Callback
  // GET /auth/microsoft/callback
  // -------------------------------------------------------------------------
  app.get("/auth/microsoft/callback", async (req, res) => {
    const { code, state, error } = req.query;

    if (error) {
      console.error("[OAuth] Callback error:", error);
      return res.redirect("/email.html?error=oauth_denied");
    }

    try {
      const { userId, isShared } = JSON.parse(Buffer.from(state, "base64").toString());

      // Use direct HTTP exchange so we get the actual refresh token
      const tokens = await exchangeCodeForTokens(code);

      // Get MS user profile
      const profile = await graphRequest(tokens.accessToken, "/me?$select=id,mail,displayName");
      const msEmail = profile.mail || "";
      const displayName = profile.displayName || msEmail;
      const msUserId = profile.id;

      await query(
        `INSERT INTO ms_connected_accounts
          (connected_by_user_id, ms_user_id, ms_email, display_name, is_shared,
           access_token, refresh_token, token_expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (ms_email) DO UPDATE SET
           connected_by_user_id = EXCLUDED.connected_by_user_id,
           ms_user_id           = EXCLUDED.ms_user_id,
           display_name         = EXCLUDED.display_name,
           is_shared            = EXCLUDED.is_shared,
           access_token         = EXCLUDED.access_token,
           refresh_token        = EXCLUDED.refresh_token,
           token_expires_at     = EXCLUDED.token_expires_at,
           updated_at           = NOW()`,
        [
          userId,
          msUserId,
          msEmail,
          displayName,
          isShared,
          tokens.accessToken,
          tokens.refreshToken,
          tokens.expiresAt,
        ]
      );

      res.redirect("/email.html?connected=1");
    } catch (err) {
      console.error("[OAuth] Callback processing error:", err);
      res.redirect("/email.html?error=oauth_callback_failed");
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/email/accounts
  // List MS accounts accessible to the current user
  // -------------------------------------------------------------------------
  app.get("/api/email/accounts", requireSession, async (req, res) => {
    try {
      const accounts = await getAccessibleAccounts(req.session.userId, query);
      res.json(accounts.map((a) => ({
        id: a.id,
        msEmail: a.ms_email,
        displayName: a.display_name,
        isShared: a.is_shared,
        isOwner: a.connected_by_user_id === req.session.userId,
      })));
    } catch (err) {
      console.error("[email/accounts]", err);
      res.status(500).json({ error: "Failed to load accounts" });
    }
  });

  // -------------------------------------------------------------------------
  // DELETE /api/email/accounts/:id
  // Disconnect an MS account (admin or owner only)
  // -------------------------------------------------------------------------
  app.delete("/api/email/accounts/:id", requireSession, async (req, res) => {
    try {
      const { rows } = await query(
        "SELECT connected_by_user_id FROM ms_connected_accounts WHERE id = $1",
        [req.params.id]
      );
      if (!rows.length) return res.status(404).json({ error: "Account not found" });
      if (rows[0].connected_by_user_id !== req.session.userId && req.session.role !== "admin") {
        return res.status(403).json({ error: "Not authorized to disconnect this account" });
      }
      await query("DELETE FROM ms_connected_accounts WHERE id = $1", [req.params.id]);
      res.json({ ok: true });
    } catch (err) {
      console.error("[email/accounts DELETE]", err);
      res.status(500).json({ error: "Failed to disconnect account" });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/email/accounts/:id/folders
  // Fetch full folder tree for an account
  // -------------------------------------------------------------------------
  app.get("/api/email/accounts/:id/folders", requireSession, async (req, res) => {
    try {
      const token = await getValidToken(req.params.id, query);
      const tree = await fetchFolderTree(token);
      res.json(tree);
    } catch (err) {
      console.error("[email/folders]", err);
      res.status(500).json({ error: err.message });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/email/folder-mappings?accountId=
  // Return flat list of folder→case mappings for an account
  // -------------------------------------------------------------------------
  app.get("/api/email/folder-mappings", requireSession, async (req, res) => {
    try {
      const { accountId } = req.query;
      if (!accountId) return res.status(400).json({ error: "accountId required" });
      const { rows } = await query(
        `SELECT fm.*, c.case_name, c.case_number
         FROM email_folder_mappings fm
         LEFT JOIN cases c ON c.id = fm.case_id
         WHERE fm.ms_account_id = $1
         ORDER BY fm.folder_name`,
        [accountId]
      );
      res.json(rows);
    } catch (err) {
      console.error("[email/folder-mappings GET]", err);
      res.status(500).json({ error: "Failed to load folder mappings" });
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/email/folder-mappings
  // Create or update a folder→case (or free-text label) mapping
  // -------------------------------------------------------------------------
  app.post("/api/email/folder-mappings", requireSession, async (req, res) => {
    try {
      const { accountId, folderId, folderName, parentFolderId, caseId, matterLabel } = req.body;
      if (!accountId || !folderId || !folderName) {
        return res.status(400).json({ error: "accountId, folderId, and folderName are required" });
      }
      const { rows } = await query(
        `INSERT INTO email_folder_mappings
          (ms_account_id, folder_id, folder_name, parent_folder_id, case_id, matter_label)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (ms_account_id, folder_id) DO UPDATE SET
           folder_name      = EXCLUDED.folder_name,
           parent_folder_id = EXCLUDED.parent_folder_id,
           case_id          = EXCLUDED.case_id,
           matter_label     = EXCLUDED.matter_label
         RETURNING *`,
        [accountId, folderId, folderName, parentFolderId || null, caseId || null, matterLabel || null]
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      console.error("[email/folder-mappings POST]", err);
      res.status(500).json({ error: "Failed to save folder mapping" });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/email/accounts/:id/folders/:folderId/messages
  // List messages in a folder (paginated, 30 per page)
  // -------------------------------------------------------------------------
  app.get("/api/email/accounts/:id/folders/:folderId/messages", requireSession, async (req, res) => {
    try {
      const token = await getValidToken(req.params.id, query);
      const skip = parseInt(req.query.skip || "0", 10);
      const endpoint =
        `/me/mailFolders/${req.params.folderId}/messages` +
        `?$top=30&$skip=${skip}` +
        `&$select=id,subject,from,receivedDateTime,isRead,conversationId,bodyPreview,hasAttachments` +
        `&$orderby=receivedDateTime desc`;

      const data = await graphRequest(token, endpoint);
      res.json({
        messages: (data.value || []).map((m) => ({
          id: m.id,
          subject: m.subject,
          from: m.from?.emailAddress,
          receivedAt: m.receivedDateTime,
          isRead: m.isRead,
          conversationId: m.conversationId,
          preview: m.bodyPreview,
          hasAttachments: m.hasAttachments,
        })),
        nextSkip: data["@odata.nextLink"] ? skip + 30 : null,
      });
    } catch (err) {
      console.error("[email/messages]", err);
      res.status(500).json({ error: err.message });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/email/accounts/:id/messages/:messageId
  // Fetch a single message with full body
  // -------------------------------------------------------------------------
  app.get("/api/email/accounts/:id/messages/:messageId", requireSession, async (req, res) => {
    try {
      const token = await getValidToken(req.params.id, query);
      const msg = await graphRequest(
        token,
        `/me/messages/${req.params.messageId}?$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,body,conversationId,internetMessageId`
      );
      res.json({
        id: msg.id,
        subject: msg.subject,
        from: msg.from?.emailAddress,
        to: (msg.toRecipients || []).map((r) => r.emailAddress),
        cc: (msg.ccRecipients || []).map((r) => r.emailAddress),
        receivedAt: msg.receivedDateTime,
        body: msg.body?.content,
        bodyType: msg.body?.contentType,
        conversationId: msg.conversationId,
        internetMessageId: msg.internetMessageId,
      });
    } catch (err) {
      console.error("[email/message detail]", err);
      res.status(500).json({ error: err.message });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/email/accounts/:id/inbox/unsorted
  // Fetch messages sitting directly in the Inbox (not in a sub-folder)
  // that are not already in the triage queue
  // -------------------------------------------------------------------------
  app.get("/api/email/accounts/:id/inbox/unsorted", requireSession, async (req, res) => {
    try {
      const token = await getValidToken(req.params.id, query);

      // Get the inbox folder ID
      const inboxData = await graphRequest(token, "/me/mailFolders/inbox");
      const inboxId = inboxData.id;

      const data = await graphRequest(
        token,
        `/me/mailFolders/${inboxId}/messages` +
          `?$top=50&$select=id,subject,from,receivedDateTime,conversationId` +
          `&$orderby=receivedDateTime desc`
      );

      const messages = data.value || [];
      if (!messages.length) return res.json([]);

      // Filter out messages already queued
      const messageIds = messages.map((m) => m.id);
      const { rows: alreadyQueued } = await query(
        `SELECT message_id FROM email_triage_queue
         WHERE ms_account_id = $1 AND message_id = ANY($2::text[])`,
        [req.params.id, messageIds]
      );
      const queuedSet = new Set(alreadyQueued.map((r) => r.message_id));

      const unsorted = messages
        .filter((m) => !queuedSet.has(m.id))
        .map((m) => ({
          id: m.id,
          subject: m.subject,
          from: m.from?.emailAddress,
          receivedAt: m.receivedDateTime,
          conversationId: m.conversationId,
        }));

      res.json(unsorted);
    } catch (err) {
      console.error("[email/inbox/unsorted]", err);
      res.status(500).json({ error: err.message });
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/email/triage/scan
  // Run Claude on all unsorted inbox messages for an account, populate queue
  // -------------------------------------------------------------------------
  app.post("/api/email/triage/scan", requireSession, async (req, res) => {
    try {
      const { accountId } = req.body;
      if (!accountId) return res.status(400).json({ error: "accountId required" });

      const token = await getValidToken(accountId, query);

      // Load all known folder mappings for this account (flat list)
      const { rows: mappings } = await query(
        `SELECT folder_id, folder_name, parent_folder_id, case_id, matter_label
         FROM email_folder_mappings
         WHERE ms_account_id = $1`,
        [accountId]
      );

      // Build full path-qualified folder names up to 3 levels deep
      // e.g. "Edison / Illinois / 25-cv-01059 Wing Rails 1.2 CS-1180.1"
      const folderMap = {};
      for (const m of mappings) folderMap[m.folder_id] = m;

      const buildPath = (m) => {
        const parts = [m.folder_name];
        let current = m;
        for (let i = 0; i < 3; i++) {
          const parent = current.parent_folder_id ? folderMap[current.parent_folder_id] : null;
          if (!parent) break;
          parts.unshift(parent.folder_name);
          current = parent;
        }
        // Also append the matter label if it adds context beyond the folder name
        if (m.matter_label && m.matter_label !== m.folder_name) {
          parts.push(`[${m.matter_label}]`);
        }
        return parts.join(" / ");
      };

      const foldersForClaude = mappings.map((m) => ({
        folder_id: m.folder_id,
        path: buildPath(m),
      }));

      // Get unsorted inbox messages
      const inboxData = await graphRequest(token, "/me/mailFolders/inbox");
      const inboxId = inboxData.id;
      const data = await graphRequest(
        token,
        `/me/mailFolders/${inboxId}/messages?$top=50&$select=id,subject,from,receivedDateTime,conversationId&$orderby=receivedDateTime desc`
      );
      const messages = data.value || [];
      if (!messages.length) return res.json({ scanned: 0, queued: 0 });

      const messageIds = messages.map((m) => m.id);
      const { rows: alreadyQueued } = await query(
        `SELECT message_id FROM email_triage_queue
         WHERE ms_account_id = $1 AND message_id = ANY($2::text[])`,
        [accountId, messageIds]
      );
      const queuedSet = new Set(alreadyQueued.map((r) => r.message_id));
      const toProcess = messages.filter((m) => !queuedSet.has(m.id));

      let queued = 0;
      for (const msg of toProcess) {
        const suggestion = foldersForClaude.length
          ? await suggestFolder(msg.subject || "(no subject)", foldersForClaude)
          : { folder_id: "UNMATCHED", folder_name: "No match found", confidence: "low", reasoning: "No folders mapped yet" };

        const suggestedMapping = suggestion.folder_id !== "UNMATCHED"
          ? mappings.find((m) => m.folder_id === suggestion.folder_id)
          : null;

        await query(
          `INSERT INTO email_triage_queue
            (ms_account_id, message_id, subject, sender_email, sender_name, received_at,
             suggested_folder_id, suggested_folder_name, suggested_case_id, confidence, claude_reasoning)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (ms_account_id, message_id) DO NOTHING`,
          [
            accountId,
            msg.id,
            msg.subject || "",
            msg.from?.emailAddress?.address || "",
            msg.from?.emailAddress?.name || "",
            msg.receivedDateTime,
            suggestion.folder_id !== "UNMATCHED" ? suggestion.folder_id : null,
            suggestion.folder_name,
            suggestedMapping?.case_id || null,
            suggestion.confidence,
            suggestion.reasoning,
          ]
        );
        queued++;
      }

      res.json({ scanned: toProcess.length, queued });
    } catch (err) {
      console.error("[email/triage/scan]", err);
      res.status(500).json({ error: err.message });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/email/triage/queue?accountId=
  // Return pending triage items
  // -------------------------------------------------------------------------
  app.get("/api/email/triage/queue", requireSession, async (req, res) => {
    try {
      const { accountId } = req.query;
      if (!accountId) return res.status(400).json({ error: "accountId required" });

      const { rows } = await query(
        `SELECT q.*, c.case_name, c.case_number
         FROM email_triage_queue q
         LEFT JOIN cases c ON c.id = q.suggested_case_id
         WHERE q.ms_account_id = $1 AND q.status = 'pending'
         ORDER BY q.received_at DESC`,
        [accountId]
      );
      res.json(rows);
    } catch (err) {
      console.error("[email/triage/queue]", err);
      res.status(500).json({ error: "Failed to load triage queue" });
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/email/triage/:id/approve
  // Approve Claude's suggestion — moves email to the suggested folder in Outlook
  // -------------------------------------------------------------------------
  app.post("/api/email/triage/:id/approve", requireSession, async (req, res) => {
    try {
      const { rows } = await query(
        "SELECT * FROM email_triage_queue WHERE id = $1 AND status = 'pending'",
        [req.params.id]
      );
      if (!rows.length) return res.status(404).json({ error: "Triage item not found or already actioned" });
      const item = rows[0];

      if (!item.suggested_folder_id) {
        return res.status(400).json({ error: "No folder suggestion to approve — use reassign instead" });
      }

      const token = await getValidToken(item.ms_account_id, query);
      await graphRequest(token, `/me/messages/${item.message_id}/move`, {
        method: "POST",
        body: { destinationId: item.suggested_folder_id },
      });

      await query(
        `UPDATE email_triage_queue
         SET status = 'approved', reviewed_by = $1, reviewed_at = NOW(), final_folder_id = $2
         WHERE id = $3`,
        [req.session.userId, item.suggested_folder_id, req.params.id]
      );

      await writeAuditLog(req, {
        action: "email.triage.approve",
        entityType: "email_triage",
        entityId: req.params.id,
        after: { messageId: item.message_id, folderId: item.suggested_folder_id },
      });

      res.json({ ok: true });
    } catch (err) {
      console.error("[email/triage/approve]", err);
      res.status(500).json({ error: err.message });
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/email/triage/:id/reassign
  // Override Claude's suggestion and move to a different folder
  // -------------------------------------------------------------------------
  app.post("/api/email/triage/:id/reassign", requireSession, async (req, res) => {
    try {
      const { folderId, folderName } = req.body;
      if (!folderId) return res.status(400).json({ error: "folderId required" });

      const { rows } = await query(
        "SELECT * FROM email_triage_queue WHERE id = $1 AND status = 'pending'",
        [req.params.id]
      );
      if (!rows.length) return res.status(404).json({ error: "Triage item not found or already actioned" });
      const item = rows[0];

      const token = await getValidToken(item.ms_account_id, query);
      await graphRequest(token, `/me/messages/${item.message_id}/move`, {
        method: "POST",
        body: { destinationId: folderId },
      });

      await query(
        `UPDATE email_triage_queue
         SET status = 'reassigned', reviewed_by = $1, reviewed_at = NOW(),
             final_folder_id = $2
         WHERE id = $3`,
        [req.session.userId, folderId, req.params.id]
      );

      await writeAuditLog(req, {
        action: "email.triage.reassign",
        entityType: "email_triage",
        entityId: req.params.id,
        after: { messageId: item.message_id, folderId, folderName },
      });

      res.json({ ok: true });
    } catch (err) {
      console.error("[email/triage/reassign]", err);
      res.status(500).json({ error: err.message });
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/email/triage/:id/skip
  // Leave the email in the inbox, mark as skipped
  // -------------------------------------------------------------------------
  app.post("/api/email/triage/:id/skip", requireSession, async (req, res) => {
    try {
      await query(
        `UPDATE email_triage_queue
         SET status = 'skipped', reviewed_by = $1, reviewed_at = NOW()
         WHERE id = $2 AND status = 'pending'`,
        [req.session.userId, req.params.id]
      );
      res.json({ ok: true });
    } catch (err) {
      console.error("[email/triage/skip]", err);
      res.status(500).json({ error: "Failed to skip item" });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/email/defendants/:id/threads
  // List email threads linked to a defendant
  // -------------------------------------------------------------------------
  app.get("/api/email/defendants/:id/threads", requireSession, async (req, res) => {
    try {
      const { rows } = await query(
        `SELECT etd.*, a.ms_email AS account_email, a.display_name AS account_display_name
         FROM email_thread_defendants etd
         JOIN ms_connected_accounts a ON a.id = etd.ms_account_id
         WHERE etd.defendant_id = $1
         ORDER BY etd.is_primary DESC, etd.linked_at`,
        [req.params.id]
      );
      res.json(rows);
    } catch (err) {
      console.error("[email/defendants/threads GET]", err);
      res.status(500).json({ error: "Failed to load threads" });
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/email/defendants/:id/threads
  // Link an email thread to a defendant
  // -------------------------------------------------------------------------
  app.post("/api/email/defendants/:id/threads", requireSession, async (req, res) => {
    try {
      const { accountId, conversationId, caseId, isPrimary, threadLabel } = req.body;
      if (!accountId || !conversationId || !caseId) {
        return res.status(400).json({ error: "accountId, conversationId, and caseId are required" });
      }

      // If marking as primary, demote existing primary
      if (isPrimary) {
        await query(
          `UPDATE email_thread_defendants
           SET is_primary = FALSE
           WHERE defendant_id = $1`,
          [req.params.id]
        );
      }

      const { rows } = await query(
        `INSERT INTO email_thread_defendants
          (ms_account_id, conversation_id, defendant_id, case_id, is_primary, thread_label, linked_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (ms_account_id, conversation_id, defendant_id) DO UPDATE SET
           is_primary   = EXCLUDED.is_primary,
           thread_label = EXCLUDED.thread_label
         RETURNING *`,
        [
          accountId,
          conversationId,
          req.params.id,
          caseId,
          isPrimary !== false,
          threadLabel || null,
          req.session.userId,
        ]
      );

      await writeAuditLog(req, {
        action: "email.thread.linked",
        entityType: "defendant",
        entityId: req.params.id,
        after: rows[0],
      });

      res.status(201).json(rows[0]);
    } catch (err) {
      console.error("[email/defendants/threads POST]", err);
      res.status(500).json({ error: err.message });
    }
  });

  // -------------------------------------------------------------------------
  // DELETE /api/email/thread-defendants/:id
  // Unlink a thread from a defendant
  // -------------------------------------------------------------------------
  app.delete("/api/email/thread-defendants/:id", requireSession, async (req, res) => {
    try {
      await query("DELETE FROM email_thread_defendants WHERE id = $1", [req.params.id]);
      res.json({ ok: true });
    } catch (err) {
      console.error("[email/thread-defendants DELETE]", err);
      res.status(500).json({ error: "Failed to unlink thread" });
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/email/draft/settlement
  // Generate a Claude settlement draft using defendant/case context
  // -------------------------------------------------------------------------
  app.post("/api/email/draft/settlement", requireSession, async (req, res) => {
    try {
      const { defendantId, conversationId, accountId } = req.body;
      if (!defendantId) return res.status(400).json({ error: "defendantId required" });

      // Load defendant + case context from DB
      const { rows: defRows } = await query(
        `SELECT d.name, d.platform, d.defendant_rep_email,
                c.case_name, c.case_number, c.jurisdiction,
                lcs.docket_status
         FROM defendants d
         JOIN cases c ON c.id = d.case_id
         LEFT JOIN litigation_case_state lcs ON lcs.case_id = c.id
         WHERE d.id = $1`,
        [defendantId]
      );
      if (!defRows.length) return res.status(404).json({ error: "Defendant not found" });
      const def = defRows[0];

      // Check for multiple threads (representation indicator)
      const { rows: threadRows } = await query(
        "SELECT COUNT(*) AS cnt FROM email_thread_defendants WHERE defendant_id = $1",
        [defendantId]
      );
      const hasRepresentation = parseInt(threadRows[0].cnt, 10) > 1;

      // Get subject from most recent message in thread (if conversationId provided)
      let threadSubject = "Settlement Discussion";
      if (conversationId && accountId) {
        try {
          const token = await getValidToken(accountId, query);
          const threadData = await graphRequest(
            token,
            `/me/messages?$filter=conversationId eq '${conversationId}'&$top=1&$select=subject&$orderby=receivedDateTime desc`
          );
          if (threadData.value?.[0]?.subject) {
            threadSubject = threadData.value[0].subject;
          }
        } catch {
          // non-fatal, use default subject
        }
      }

      const draft = await draftSettlementReply({
        caseNumber: def.case_number,
        caseName: def.case_name,
        jurisdiction: def.jurisdiction,
        docketStatus: def.docket_status,
        defendantName: def.name,
        platform: def.platform,
        threadSubject,
        hasRepresentation,
      });

      res.json({ draft, hasRepresentation, threadSubject });
    } catch (err) {
      console.error("[email/draft/settlement]", err);
      res.status(500).json({ error: err.message });
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/email/send
  // Send an email reply into an existing conversation thread
  // -------------------------------------------------------------------------
  app.post("/api/email/send", requireSession, async (req, res) => {
    try {
      const { accountId, messageId, body, subject } = req.body;
      if (!accountId || !messageId || !body) {
        return res.status(400).json({ error: "accountId, messageId, and body are required" });
      }

      const token = await getValidToken(accountId, query);

      // Reply to the specific message (preserves thread)
      await graphRequest(token, `/me/messages/${messageId}/reply`, {
        method: "POST",
        body: {
          message: {
            body: { contentType: "HTML", content: body.replace(/\n/g, "<br>") },
          },
          comment: "",
        },
      });

      await writeAuditLog(req, {
        action: "email.sent",
        entityType: "email",
        entityId: messageId,
        after: { accountId, subject },
      });

      res.json({ ok: true });
    } catch (err) {
      console.error("[email/send]", err);
      res.status(500).json({ error: err.message });
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/email/test-teams  (admin only — remove after debugging)
  // Body: { recipientEmail, message }
  // Returns full success/error detail so we can debug Teams DM flow
  // -------------------------------------------------------------------------
  app.post("/api/email/test-teams", requireSession, async (req, res) => {
    const { recipientEmail, message } = req.body;
    if (!recipientEmail) return res.status(400).json({ error: "recipientEmail required" });

    try {
      // Step 1: get sending account
      const sender = await getDefaultSendingAccount(query);
      if (!sender) return res.status(500).json({ step: "getDefaultSendingAccount", error: "No connected accounts found" });

      // Step 2: get valid token
      let token;
      try {
        token = await getValidToken(sender.id, query);
      } catch (e) {
        return res.status(500).json({ step: "getValidToken", error: e.message, accountId: sender.id });
      }

      // Step 3: resolve recipient MS user ID
      const recipientId = await resolveRecipientMsId(token, recipientEmail, query);
      if (!recipientId) {
        return res.status(500).json({
          step: "resolveRecipientMsId",
          error: `Could not resolve MS user ID for ${recipientEmail}. Either connect this account in the Email Portal, or have IT grant User.ReadBasic.All in Azure.`,
          senderMsUserId: sender.ms_user_id,
        });
      }

      // Step 4: attempt DM
      try {
        await sendTeamsDM(sender, recipientId, message || "<p>Test from FLIP 👋</p>", query);
      } catch (e) {
        return res.status(500).json({
          step: "sendTeamsDM",
          error: e.message,
          senderMsUserId: sender.ms_user_id,
          recipientId,
        });
      }

      res.json({ ok: true, senderEmail: sender.email, recipientId });
    } catch (err) {
      res.status(500).json({ step: "unknown", error: err.message });
    }
  });

};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = registerEmailRoutes;
module.exports.notifyTaskAssigned = notifyTaskAssigned;
module.exports.notifyOverdueSummary = notifyOverdueSummary;
