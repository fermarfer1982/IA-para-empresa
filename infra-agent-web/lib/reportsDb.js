import fs from "fs";
import path from "path";
import sqlite3 from "sqlite3";

const DB_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "infra-agent.db");

const REPORT_TYPES = new Set([
  "daily_summary",
  "correlation_matrix",
  "risks",
  "monitoring_gaps"
]);

const COMMUNICATION_TYPES = new Set(["email", "teams"]);
const COMMUNICATION_STATUSES = new Set([
  "draft",
  "ready_for_review",
  "reviewed",
  "copied",
  "discarded"
]);
const COMMUNICATION_SEND_STATUSES = new Set([
  "not_sent",
  "prepared",
  "sending",
  "sent",
  "failed"
]);
const COMMUNICATION_SOURCE_TYPES = new Set([
  "daily_report",
  "matrix",
  "incident",
  "risk",
  "manual"
]);

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{12,}/,
  /OPENAI_API_KEY\s*=/i,
  /OPENAI_WORKFLOW_ID\s*=/i,
  /client_secret/i,
  /Authorization:\s*Bearer\s+\S+/i,
  /MCP_SHARED_TOKEN/i,
  /GRAPH_CLIENT_SECRET/i,
  /PBS_TOKEN_SECRET/i,
  /PROXMOX_TOKEN_SECRET/i,
  /ZABBIX_TOKEN/i
];

let dbPromise;

function ensureDataDir() {
  fs.mkdirSync(DB_DIR, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(DB_DIR, 0o700);
  } catch {
    // Best effort; systemd runs as codexops and owns this app directory.
  }
}

function openDatabase() {
  ensureDataDir();

  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(DB_PATH, (error) => {
      if (error) {
        reject(error);
        return;
      }
      try {
        fs.chmodSync(DB_PATH, 0o600);
      } catch {
        // Best effort; the DB must remain readable by the service user only.
      }
      resolve(database);
    });
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) {
        reject(error);
        return;
      }
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(rows);
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(row || null);
    });
  });
}

async function initDatabase(db) {
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('daily_summary', 'correlation_matrix', 'risks', 'monitoring_gaps')),
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      response_markdown TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT,
      metadata_json TEXT
    )`
  );

  await run(
    db,
    "CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at DESC)"
  );
  await run(db, "CREATE INDEX IF NOT EXISTS idx_reports_type ON reports(type)");

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS communication_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('email', 'teams')),
      status TEXT NOT NULL CHECK(status IN ('draft', 'ready_for_review', 'reviewed', 'copied', 'discarded')) DEFAULT 'draft',
      recipient_label TEXT NOT NULL,
      recipient_email TEXT,
      subject TEXT NOT NULL,
      body_markdown TEXT NOT NULL,
      body_text TEXT NOT NULL,
      source_type TEXT NOT NULL CHECK(source_type IN ('daily_report', 'matrix', 'incident', 'risk', 'manual')),
      source_report_id INTEGER,
      source_incident_id TEXT,
      template_id TEXT,
      review_notes TEXT,
      reviewed_at TEXT,
      reviewed_by TEXT,
      copied_at TEXT,
      discarded_at TEXT,
      last_action_at TEXT,
      send_status TEXT,
      send_prepared_at TEXT,
      send_attempt_at TEXT,
      sent_at TEXT,
      sent_by TEXT,
      from_user TEXT,
      send_error TEXT,
      direct_send_requested INTEGER NOT NULL DEFAULT 0,
      direct_send_source TEXT,
      direct_send_requested_at TEXT,
      direct_send_from_user TEXT,
      direct_send_recipient_email TEXT,
      direct_send_source_incident_id TEXT,
      direct_send_send_status TEXT,
      direct_send_send_attempt_at TEXT,
      direct_send_sent_at TEXT,
      direct_send_sent_by TEXT,
      direct_send_send_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  );
  await run(
    db,
    "CREATE INDEX IF NOT EXISTS idx_communication_drafts_created_at ON communication_drafts(created_at DESC)"
  );
  await run(
    db,
    "CREATE INDEX IF NOT EXISTS idx_communication_drafts_status ON communication_drafts(status)"
  );
  await run(
    db,
    "CREATE INDEX IF NOT EXISTS idx_communication_drafts_type ON communication_drafts(type)"
  );
  await run(
    db,
    "CREATE INDEX IF NOT EXISTS idx_communication_drafts_template_id ON communication_drafts(template_id)"
  );

  await ensureCommunicationDraftSchema(db);

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS company_directory_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      display_name TEXT NOT NULL,
      mail TEXT,
      user_principal_name TEXT,
      job_title TEXT,
      department TEXT,
      office_location TEXT,
      business_phone TEXT,
      mobile_phone TEXT,
      account_enabled INTEGER,
      updated_at TEXT NOT NULL
    )`
  );
  await run(
    db,
    "CREATE INDEX IF NOT EXISTS idx_company_directory_display_name ON company_directory_cache(display_name COLLATE NOCASE)"
  );
  await run(
    db,
    "CREATE INDEX IF NOT EXISTS idx_company_directory_mail ON company_directory_cache(mail COLLATE NOCASE)"
  );
  await run(
    db,
    "CREATE INDEX IF NOT EXISTS idx_company_directory_department ON company_directory_cache(department COLLATE NOCASE)"
  );
  await run(
    db,
    "CREATE INDEX IF NOT EXISTS idx_company_directory_job_title ON company_directory_cache(job_title COLLATE NOCASE)"
  );
  await run(
    db,
    "CREATE INDEX IF NOT EXISTS idx_company_directory_upn ON company_directory_cache(user_principal_name COLLATE NOCASE)"
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS powerbi_catalog_cache (
      model_key TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      catalog_available INTEGER NOT NULL,
      xmla_available INTEGER NOT NULL,
      status TEXT NOT NULL,
      source TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      error TEXT,
      warnings_json TEXT,
      catalog_json TEXT NOT NULL
    )`
  );
  await run(
    db,
    "CREATE INDEX IF NOT EXISTS idx_powerbi_catalog_cache_updated_at ON powerbi_catalog_cache(updated_at DESC)"
  );
  await run(
    db,
    "CREATE INDEX IF NOT EXISTS idx_powerbi_catalog_cache_status ON powerbi_catalog_cache(status)"
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS powerbi_catalog_imports (
      model_key TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      imported_at TEXT,
      updated_at TEXT NOT NULL,
      error TEXT,
      warnings_json TEXT,
      catalog_json TEXT,
      file_manifest_json TEXT,
      file_count INTEGER NOT NULL DEFAULT 0
    )`
  );
  await run(
    db,
    "CREATE INDEX IF NOT EXISTS idx_powerbi_catalog_imports_updated_at ON powerbi_catalog_imports(updated_at DESC)"
  );
  await run(
    db,
    "CREATE INDEX IF NOT EXISTS idx_powerbi_catalog_imports_status ON powerbi_catalog_imports(status)"
  );
}

async function ensureCommunicationDraftSchema(db) {
  const schemaRow = await get(
    db,
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'communication_drafts'"
  );

  if (!schemaRow?.sql) {
    return;
  }

  const hasReviewColumns =
    schemaRow.sql.includes("ready_for_review") &&
    schemaRow.sql.includes("template_id") &&
    schemaRow.sql.includes("review_notes") &&
    schemaRow.sql.includes("last_action_at");

  if (!hasReviewColumns) {
    const columns = await all(db, "PRAGMA table_info(communication_drafts)");
    const existingColumns = new Set(columns.map((column) => column.name));
    const migrationTable = "communication_drafts_migration";

    await run(db, `DROP TABLE IF EXISTS ${migrationTable}`);
    await run(
      db,
      `CREATE TABLE ${migrationTable} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK(type IN ('email', 'teams')),
        status TEXT NOT NULL CHECK(status IN ('draft', 'ready_for_review', 'reviewed', 'copied', 'discarded')) DEFAULT 'draft',
        recipient_label TEXT NOT NULL,
        recipient_email TEXT,
        subject TEXT NOT NULL,
        body_markdown TEXT NOT NULL,
        body_text TEXT NOT NULL,
        source_type TEXT NOT NULL CHECK(source_type IN ('daily_report', 'matrix', 'incident', 'risk', 'manual')),
        source_report_id INTEGER,
        source_incident_id TEXT,
        template_id TEXT,
        review_notes TEXT,
        reviewed_at TEXT,
        reviewed_by TEXT,
        copied_at TEXT,
        discarded_at TEXT,
        last_action_at TEXT,
        send_status TEXT,
        send_prepared_at TEXT,
        send_attempt_at TEXT,
        sent_at TEXT,
        sent_by TEXT,
        from_user TEXT,
        send_error TEXT,
        direct_send_requested INTEGER NOT NULL DEFAULT 0,
        direct_send_source TEXT,
        direct_send_requested_at TEXT,
        direct_send_from_user TEXT,
        direct_send_recipient_email TEXT,
        direct_send_source_incident_id TEXT,
        direct_send_send_status TEXT,
        direct_send_send_attempt_at TEXT,
        direct_send_sent_at TEXT,
        direct_send_sent_by TEXT,
        direct_send_send_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`
    );

    const selectColumns = [
      "id",
      "type",
      "status",
      "recipient_label",
      "recipient_email",
      "subject",
      "body_markdown",
      "body_text",
      "source_type",
      "source_report_id",
      "source_incident_id",
      existingColumns.has("template_id") ? "template_id" : "NULL AS template_id",
      existingColumns.has("review_notes") ? "review_notes" : "NULL AS review_notes",
      existingColumns.has("reviewed_at") ? "reviewed_at" : "NULL AS reviewed_at",
      existingColumns.has("reviewed_by") ? "reviewed_by" : "NULL AS reviewed_by",
      existingColumns.has("copied_at") ? "copied_at" : "NULL AS copied_at",
      existingColumns.has("discarded_at") ? "discarded_at" : "NULL AS discarded_at",
      existingColumns.has("last_action_at") ? "last_action_at" : "updated_at AS last_action_at",
      "NULL AS send_status",
      "NULL AS send_prepared_at",
      "NULL AS send_attempt_at",
      "NULL AS sent_at",
      "NULL AS sent_by",
      "NULL AS from_user",
      "NULL AS send_error",
      "0 AS direct_send_requested",
      "NULL AS direct_send_source",
      "NULL AS direct_send_requested_at",
      "NULL AS direct_send_from_user",
      "NULL AS direct_send_recipient_email",
      "NULL AS direct_send_source_incident_id",
      "NULL AS direct_send_send_status",
      "NULL AS direct_send_send_attempt_at",
      "NULL AS direct_send_sent_at",
      "NULL AS direct_send_sent_by",
      "NULL AS direct_send_send_error",
      "created_at",
      "updated_at"
    ];

    await run(
      db,
      `INSERT INTO ${migrationTable}
        (id, type, status, recipient_label, recipient_email, subject, body_markdown, body_text,
         source_type, source_report_id, source_incident_id, template_id, review_notes, reviewed_at,
         reviewed_by, copied_at, discarded_at, last_action_at, send_status, send_prepared_at,
         send_attempt_at, sent_at, sent_by, from_user, send_error, direct_send_requested,
         direct_send_source, direct_send_requested_at, direct_send_from_user,
         direct_send_recipient_email, direct_send_source_incident_id, direct_send_send_status,
         direct_send_send_attempt_at, direct_send_sent_at, direct_send_sent_by,
         direct_send_send_error, created_at, updated_at)
        SELECT ${selectColumns.join(", ")}
          FROM communication_drafts`
    );

    await run(db, "DROP TABLE communication_drafts");
    await run(db, `ALTER TABLE ${migrationTable} RENAME TO communication_drafts`);
  }

  const columns = await all(db, "PRAGMA table_info(communication_drafts)");
  const existingColumns = new Set(columns.map((column) => column.name));
  for (const [name, type] of [
    ["send_status", "TEXT"],
    ["send_prepared_at", "TEXT"],
    ["send_attempt_at", "TEXT"],
    ["sent_at", "TEXT"],
    ["sent_by", "TEXT"],
    ["from_user", "TEXT"],
    ["send_error", "TEXT"],
    ["direct_send_requested", "INTEGER NOT NULL DEFAULT 0"],
    ["direct_send_source", "TEXT"],
    ["direct_send_requested_at", "TEXT"],
    ["direct_send_from_user", "TEXT"],
    ["direct_send_recipient_email", "TEXT"],
    ["direct_send_source_incident_id", "TEXT"],
    ["direct_send_send_status", "TEXT"],
    ["direct_send_send_attempt_at", "TEXT"],
    ["direct_send_sent_at", "TEXT"],
    ["direct_send_sent_by", "TEXT"],
    ["direct_send_send_error", "TEXT"]
  ]) {
    if (!existingColumns.has(name)) {
      await run(db, `ALTER TABLE communication_drafts ADD COLUMN ${name} ${type}`);
    }
  }

  await run(
    db,
    "CREATE INDEX IF NOT EXISTS idx_communication_drafts_created_at ON communication_drafts(created_at DESC)"
  );
  await run(
    db,
    "CREATE INDEX IF NOT EXISTS idx_communication_drafts_status ON communication_drafts(status)"
  );
  await run(
    db,
    "CREATE INDEX IF NOT EXISTS idx_communication_drafts_type ON communication_drafts(type)"
  );
  await run(
    db,
    "CREATE INDEX IF NOT EXISTS idx_communication_drafts_template_id ON communication_drafts(template_id)"
  );
}

async function getDb() {
  if (!dbPromise) {
    dbPromise = openDatabase().then(async (db) => {
      await initDatabase(db);
      return db;
    });
  }

  return dbPromise;
}

function normalizeString(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function parseDateBoundary(value, endOfDay = false) {
  const text = normalizeString(value, 32);
  if (!text) {
    return null;
  }

  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
  const date = dateOnly
    ? new Date(`${text}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`)
    : new Date(text);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function todayBounds() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return {
    from: start.toISOString(),
    to: end.toISOString()
  };
}

function daysAgoBoundary(days) {
  const boundedDays = Math.max(1, Math.min(Number(days) || 7, 90));
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (boundedDays - 1));
  return start.toISOString();
}

function parseMetadata(value) {
  if (value == null || value === "") {
    return null;
  }

  if (typeof value === "string") {
    JSON.parse(value);
    return value;
  }

  return JSON.stringify(value);
}

function assertNoObviousSecretsInTexts(...values) {
  const body = values.filter(Boolean).join("\n");

  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(body)) {
      throw new Error("El informe parece contener un secreto y no se ha guardado.");
    }
  }
}

function assertNoObviousSecrets(report) {
  assertNoObviousSecretsInTexts(
    report.title,
    report.prompt,
    report.response_markdown,
    report.created_by,
    report.metadata_json
  );
}

function normalizeOptionalString(value, maxLength) {
  const text = normalizeString(value, maxLength);
  return text ? text : null;
}

function normalizeRecipientEmail(value) {
  const text = normalizeString(value, 180);
  if (!text) {
    return null;
  }

  const mailtoMatch = text.match(/mailto:([^)\s>]+)/i);
  if (mailtoMatch?.[1]) {
    const candidate = normalizeString(mailtoMatch[1], 180).replace(/^mailto:/i, "");
    return candidate ? candidate.toLowerCase() : null;
  }

  const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return emailMatch ? emailMatch[0].toLowerCase() : text.toLowerCase();
}

function normalizeNullableString(value, existingValue, maxLength) {
  if (value === undefined) {
    return normalizeOptionalString(existingValue, maxLength);
  }
  if (value === null) {
    return null;
  }

  return normalizeOptionalString(value, maxLength);
}

function normalizeBooleanInteger(value, existingValue = 0) {
  if (value === undefined) {
    return Number(existingValue || 0) ? 1 : 0;
  }
  if (value === null || value === "") {
    return 0;
  }

  return value ? 1 : 0;
}

function normalizeIntegerOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) {
    throw new Error("source_report_id debe ser un entero positivo.");
  }

  return numeric;
}

export async function createReport(input) {
  const type = normalizeString(input?.type, 64);

  if (!REPORT_TYPES.has(type)) {
    throw new Error("Tipo de informe no permitido.");
  }

  const report = {
    type,
    title: normalizeString(input?.title, 180),
    prompt: normalizeString(input?.prompt, 20000),
    response_markdown: normalizeString(input?.response_markdown, 250000),
    created_at: new Date().toISOString(),
    created_by: normalizeString(input?.created_by || "infra-agent-web", 120),
    metadata_json: parseMetadata(input?.metadata_json)
  };

  if (!report.title || !report.prompt || !report.response_markdown) {
    throw new Error("Faltan title, prompt o response_markdown.");
  }

  assertNoObviousSecrets(report);

  const db = await getDb();
  const result = await run(
    db,
    `INSERT INTO reports
      (type, title, prompt, response_markdown, created_at, created_by, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      report.type,
      report.title,
      report.prompt,
      report.response_markdown,
      report.created_at,
      report.created_by,
      report.metadata_json
    ]
  );

  return getReport(result.lastID);
}

export async function listReports(limit = 10) {
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 10, 50));
  const db = await getDb();
  return all(
    db,
    `SELECT id, type, title, prompt, created_at, created_by
       FROM reports
      ORDER BY created_at DESC
      LIMIT ?`,
    [boundedLimit]
  );
}

export async function searchReports(options = {}) {
  const boundedLimit = Math.max(1, Math.min(Number(options.limit) || 10, 50));
  const filters = [];
  const params = [];
  const type = normalizeString(options.type, 64);
  const query = normalizeString(options.query, 180);
  const dateFrom = parseDateBoundary(options.date_from || options.from);
  const dateTo = parseDateBoundary(options.date_to || options.to, true);

  if (type && REPORT_TYPES.has(type)) {
    filters.push("type = ?");
    params.push(type);
  }

  if (query) {
    filters.push("(LOWER(title) LIKE LOWER(?) OR LOWER(prompt) LIKE LOWER(?))");
    params.push(`%${query}%`, `%${query}%`);
  }

  if (options.today === "1" || options.today === "true" || options.today === true) {
    const bounds = todayBounds();
    filters.push("created_at >= ? AND created_at < ?");
    params.push(bounds.from, bounds.to);
  } else if (options.days) {
    filters.push("created_at >= ?");
    params.push(daysAgoBoundary(options.days));
  } else {
    if (dateFrom) {
      filters.push("created_at >= ?");
      params.push(dateFrom);
    }
    if (dateTo) {
      filters.push("created_at <= ?");
      params.push(dateTo);
    }
  }

  params.push(boundedLimit);
  const db = await getDb();
  return all(
    db,
    `SELECT id, type, title, prompt, created_at, created_by
       FROM reports
      ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
      ORDER BY created_at DESC
      LIMIT ?`,
    params
  );
}

export async function getReportsForAnalytics(options = {}) {
  const boundedDays = Math.max(1, Math.min(Number(options.days) || 14, 90));
  const db = await getDb();
  return all(
    db,
    `SELECT id, type, title, prompt, response_markdown, created_at, created_by, metadata_json
       FROM reports
      WHERE created_at >= ?
      ORDER BY created_at ASC`,
    [daysAgoBoundary(boundedDays)]
  );
}

export async function getLatestReportByType(type) {
  const normalizedType = normalizeString(type, 64);
  if (!REPORT_TYPES.has(normalizedType)) {
    return null;
  }

  const db = await getDb();
  return get(
    db,
    `SELECT id, type, title, prompt, response_markdown, created_at, created_by, metadata_json
       FROM reports
      WHERE type = ?
      ORDER BY created_at DESC
      LIMIT 1`,
    [normalizedType]
  );
}

export async function getReport(id) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId < 1) {
    return null;
  }

  const db = await getDb();
  return get(
    db,
    `SELECT id, type, title, prompt, response_markdown, created_at, created_by, metadata_json
       FROM reports
      WHERE id = ?`,
    [numericId]
  );
}

export function getReportDbPath() {
  return DB_PATH;
}

function normalizeCommunicationDraft(input, existing = null) {
  const type = normalizeString(input?.type ?? existing?.type, 16);
  const status = normalizeString(input?.status ?? existing?.status ?? "draft", 16);
  const sourceType = normalizeString(input?.source_type ?? existing?.source_type, 24);
  const templateId = normalizeOptionalString(input?.template_id ?? existing?.template_id, 64);
  const inputRecipientName =
    input?.recipient_label ??
    input?.recipient_name ??
    input?.recipientName ??
    input?.recipientLabel ??
    input?.toName ??
    input?.targetName;
  const inputRecipientEmail =
    input?.recipient_email ??
    input?.recipientEmail ??
    input?.toEmail ??
    input?.targetEmail;
  const recipientLabel = normalizeString(
    inputRecipientName ?? existing?.recipient_label,
    180
  );
  const recipientEmail = normalizeOptionalString(
    normalizeRecipientEmail(inputRecipientEmail ?? existing?.recipient_email),
    180
  );
  const subject = normalizeString(input?.subject ?? existing?.subject, 200);
  const bodyMarkdown = normalizeString(input?.body_markdown ?? existing?.body_markdown, 50000);
  const bodyText = normalizeString(input?.body_text ?? existing?.body_text, 50000);
  const reviewNotes = normalizeOptionalString(input?.review_notes ?? existing?.review_notes, 4000);
  const reviewedAt = normalizeOptionalString(input?.reviewed_at ?? existing?.reviewed_at, 40);
  const reviewedBy = normalizeOptionalString(input?.reviewed_by ?? existing?.reviewed_by, 120);
  const copiedAt = normalizeOptionalString(input?.copied_at ?? existing?.copied_at, 40);
  const discardedAt = normalizeOptionalString(input?.discarded_at ?? existing?.discarded_at, 40);
  const lastActionAt = normalizeOptionalString(
    input?.last_action_at ?? existing?.last_action_at,
    40
  );
  const sendStatus =
    normalizeOptionalString(input?.send_status ?? existing?.send_status, 40) || "not_sent";
  const sendPreparedAt = normalizeNullableString(
    input?.send_prepared_at,
    existing?.send_prepared_at,
    40
  );
  const sendAttemptAt = normalizeNullableString(
    input?.send_attempt_at,
    existing?.send_attempt_at,
    40
  );
  const sentAt = normalizeNullableString(input?.sent_at, existing?.sent_at, 40);
  const sentBy = normalizeNullableString(input?.sent_by, existing?.sent_by, 120);
  const fromUser = normalizeNullableString(input?.from_user, existing?.from_user, 180);
  const sendError = normalizeNullableString(input?.send_error, existing?.send_error, 4000);
  const directSendRequested = normalizeBooleanInteger(
    input?.direct_send_requested,
    existing?.direct_send_requested
  );
  const directSendSource = normalizeOptionalString(
    input?.direct_send_source ?? existing?.direct_send_source,
    40
  );
  const directSendRequestedAt = normalizeNullableString(
    input?.direct_send_requested_at,
    existing?.direct_send_requested_at,
    40
  );
  const directSendFromUser = normalizeNullableString(
    input?.direct_send_from_user,
    existing?.direct_send_from_user,
    180
  );
  const directSendRecipientEmail = normalizeNullableString(
    input?.direct_send_recipient_email,
    existing?.direct_send_recipient_email,
    180
  );
  const directSendSourceIncidentId = normalizeNullableString(
    input?.direct_send_source_incident_id,
    existing?.direct_send_source_incident_id,
    120
  );
  const directSendSendStatus = normalizeOptionalString(
    input?.direct_send_send_status ?? existing?.direct_send_send_status,
    40
  );
  const directSendSendAttemptAt = normalizeNullableString(
    input?.direct_send_send_attempt_at,
    existing?.direct_send_send_attempt_at,
    40
  );
  const directSendSentAt = normalizeNullableString(
    input?.direct_send_sent_at,
    existing?.direct_send_sent_at,
    40
  );
  const directSendSentBy = normalizeNullableString(
    input?.direct_send_sent_by,
    existing?.direct_send_sent_by,
    120
  );
  const directSendSendError = normalizeNullableString(
    input?.direct_send_send_error,
    existing?.direct_send_send_error,
    4000
  );
  const sourceReportId =
    input?.source_report_id !== undefined
      ? normalizeIntegerOrNull(input.source_report_id)
      : existing?.source_report_id || null;
  const sourceIncidentId = normalizeOptionalString(
    input?.source_incident_id ?? existing?.source_incident_id,
    120
  );

  if (!COMMUNICATION_TYPES.has(type)) {
    throw new Error("Tipo de comunicación no permitido.");
  }
  if (!COMMUNICATION_STATUSES.has(status)) {
    throw new Error("Estado de borrador no permitido.");
  }
  if (!COMMUNICATION_SOURCE_TYPES.has(sourceType)) {
    throw new Error("source_type no permitido.");
  }
  if (!COMMUNICATION_SEND_STATUSES.has(sendStatus)) {
    throw new Error("send_status no permitido.");
  }
  if (!recipientLabel) {
    throw new Error("recipient_label es obligatorio.");
  }
  if (!subject) {
    throw new Error("subject es obligatorio.");
  }
  if (!bodyMarkdown || !bodyText) {
    throw new Error("body_markdown y body_text son obligatorios.");
  }

  const draft = {
    type,
    status,
    recipient_label: recipientLabel,
    recipient_email: recipientEmail,
    subject,
    body_markdown: bodyMarkdown,
    body_text: bodyText,
    source_type: sourceType,
    template_id: templateId,
    source_report_id: sourceReportId,
    source_incident_id: sourceIncidentId,
    review_notes: reviewNotes,
    reviewed_at: reviewedAt,
    reviewed_by: reviewedBy,
    copied_at: copiedAt,
    discarded_at: discardedAt,
    last_action_at: lastActionAt,
    send_status: sendStatus,
    send_prepared_at: sendPreparedAt,
    send_attempt_at: sendAttemptAt,
    sent_at: sentAt,
    sent_by: sentBy,
    from_user: fromUser,
    send_error: sendError,
    direct_send_requested: directSendRequested,
    direct_send_source: directSendSource,
    direct_send_requested_at: directSendRequestedAt,
    direct_send_from_user: directSendFromUser,
    direct_send_recipient_email: directSendRecipientEmail,
    direct_send_source_incident_id: directSendSourceIncidentId,
    direct_send_send_status: directSendSendStatus,
    direct_send_send_attempt_at: directSendSendAttemptAt,
    direct_send_sent_at: directSendSentAt,
    direct_send_sent_by: directSendSentBy,
    direct_send_send_error: directSendSendError
  };

  assertNoObviousSecretsInTexts(
    draft.recipient_label,
    draft.recipient_email,
    draft.subject,
    draft.body_markdown,
    draft.body_text,
    draft.source_type,
    draft.template_id,
    String(draft.source_report_id || ""),
    draft.source_incident_id,
    draft.review_notes,
    draft.reviewed_at,
    draft.reviewed_by,
    draft.copied_at,
    draft.discarded_at,
    draft.last_action_at,
    draft.send_status,
    draft.send_prepared_at,
    draft.send_attempt_at,
    draft.sent_at,
    draft.sent_by,
    draft.from_user,
    draft.send_error,
    String(draft.direct_send_requested || 0),
    draft.direct_send_source,
    draft.direct_send_requested_at,
    draft.direct_send_from_user,
    draft.direct_send_recipient_email,
    draft.direct_send_source_incident_id,
    draft.direct_send_send_status,
    draft.direct_send_send_attempt_at,
    draft.direct_send_sent_at,
    draft.direct_send_sent_by,
    draft.direct_send_send_error
  );

  return draft;
}

function draftRowQuery() {
  return `
    SELECT id,
           type,
           status,
           recipient_label,
           recipient_email,
           subject,
           body_markdown,
           body_text,
           source_type,
           source_report_id,
           source_incident_id,
           template_id,
           review_notes,
           reviewed_at,
           reviewed_by,
           copied_at,
           discarded_at,
           last_action_at,
           send_status,
           send_prepared_at,
           send_attempt_at,
           sent_at,
           sent_by,
           from_user,
           send_error,
           direct_send_requested,
           direct_send_source,
           direct_send_requested_at,
           direct_send_from_user,
           direct_send_recipient_email,
           direct_send_source_incident_id,
           direct_send_send_status,
           direct_send_send_attempt_at,
           direct_send_sent_at,
           direct_send_sent_by,
           direct_send_send_error,
           created_at,
           updated_at
      FROM communication_drafts
  `;
}

function decorateCommunicationDraft(row) {
  if (!row) {
    return row;
  }
  return {
    ...row,
    recipient_name: row.recipient_name || row.recipient_label || ""
  };
}

const COMMUNICATION_DRAFT_INSERT_COLUMNS = [
  "type",
  "status",
  "recipient_label",
  "recipient_email",
  "subject",
  "body_markdown",
  "body_text",
  "source_type",
  "source_report_id",
  "source_incident_id",
  "template_id",
  "review_notes",
  "reviewed_at",
  "reviewed_by",
  "copied_at",
  "discarded_at",
  "last_action_at",
  "send_status",
  "send_prepared_at",
  "send_attempt_at",
  "sent_at",
  "sent_by",
  "from_user",
  "send_error",
  "direct_send_requested",
  "direct_send_source",
  "direct_send_requested_at",
  "direct_send_from_user",
  "direct_send_recipient_email",
  "direct_send_source_incident_id",
  "direct_send_send_status",
  "direct_send_send_attempt_at",
  "direct_send_sent_at",
  "direct_send_sent_by",
  "direct_send_send_error",
  "created_at",
  "updated_at"
];

async function insertCommunicationDraft(db, draft) {
  const placeholders = COMMUNICATION_DRAFT_INSERT_COLUMNS.map(() => "?").join(", ");
  const columns = COMMUNICATION_DRAFT_INSERT_COLUMNS.join(", ");
  return run(
    db,
    `INSERT INTO communication_drafts (${columns}) VALUES (${placeholders})`,
    COMMUNICATION_DRAFT_INSERT_COLUMNS.map((column) => draft[column] ?? null)
  );
}

export async function createCommunicationDraft(input) {
  const draft = normalizeCommunicationDraft(input);
  const createdAt = new Date().toISOString();
  const lastActionAt = draft.last_action_at || createdAt;
  const reviewedAt = draft.status === "reviewed" ? draft.reviewed_at || createdAt : draft.reviewed_at;
  const reviewedBy =
    draft.status === "reviewed" ? draft.reviewed_by || "infra-agent-web" : draft.reviewed_by;
  const copiedAt = draft.status === "copied" ? draft.copied_at || createdAt : draft.copied_at;
  const discardedAt =
    draft.status === "discarded" ? draft.discarded_at || createdAt : draft.discarded_at;

  const db = await getDb();
  const result = await insertCommunicationDraft(db, {
    ...draft,
    reviewed_at: reviewedAt,
    reviewed_by: reviewedBy,
    copied_at: copiedAt,
    discarded_at: discardedAt,
    last_action_at: lastActionAt,
    created_at: createdAt,
    updated_at: createdAt
  });

  return getCommunicationDraft(result.lastID);
}

export async function listCommunicationDrafts(options = {}) {
  const boundedLimit = Math.max(1, Math.min(Number(options.limit) || 20, 100));
  const filters = [];
  const params = [];
  const status = normalizeOptionalString(options.status, 16);
  const type = normalizeOptionalString(options.type, 16);
  const sourceType = normalizeOptionalString(options.source_type, 24);
  const templateId = normalizeOptionalString(options.template_id, 64);

  if (status === "pending_review") {
    filters.push("status IN (?, ?)");
    params.push("draft", "ready_for_review");
  } else if (status && COMMUNICATION_STATUSES.has(status)) {
    filters.push("status = ?");
    params.push(status);
  }
  if (type && COMMUNICATION_TYPES.has(type)) {
    filters.push("type = ?");
    params.push(type);
  }
  if (sourceType && COMMUNICATION_SOURCE_TYPES.has(sourceType)) {
    filters.push("source_type = ?");
    params.push(sourceType);
  }
  if (templateId) {
    filters.push("template_id = ?");
    params.push(templateId);
  }

  params.push(boundedLimit);
  const db = await getDb();
  const rows = await all(
    db,
    `${draftRowQuery()}
      ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
      ORDER BY updated_at DESC, created_at DESC
      LIMIT ?`,
    params
  );
  return rows.map(decorateCommunicationDraft);
}

export async function getCommunicationDraftSummary() {
  const db = await getDb();
  const rows = await all(
    db,
    `SELECT status, COUNT(*) AS count
       FROM communication_drafts
      GROUP BY status`
  );

  const counts = rows.reduce((acc, row) => {
    acc[row.status] = Number(row.count || 0);
    return acc;
  }, {});

  const draft = counts.draft || 0;
  const readyForReview = counts.ready_for_review || 0;
  const reviewed = counts.reviewed || 0;
  const copied = counts.copied || 0;
  const discarded = counts.discarded || 0;

  return {
    total: draft + readyForReview + reviewed + copied + discarded,
    draft,
    ready_for_review: readyForReview,
    pending_review: draft + readyForReview,
    reviewed,
    copied,
    discarded
  };
}

export async function getCommunicationDraft(id) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId < 1) {
    return null;
  }

  const db = await getDb();
  return decorateCommunicationDraft(await get(db, `${draftRowQuery()} WHERE id = ?`, [numericId]));
}

export async function updateCommunicationDraft(id, input) {
  const existing = await getCommunicationDraft(id);
  if (!existing) {
    return null;
  }
  if (existing.send_status === "sent" || existing.sent_at) {
    throw new Error(
      "Este email ya fue enviado. Duplica el borrador si necesitas enviarlo de nuevo."
    );
  }

  const draft = normalizeCommunicationDraft(input, existing);
  const updatedAt = new Date().toISOString();
  const lastActionAt = updatedAt;
  const reviewedAt =
    draft.status === "reviewed"
      ? draft.reviewed_at || updatedAt
      : draft.reviewed_at || existing.reviewed_at || null;
  const reviewedBy =
    draft.status === "reviewed"
      ? draft.reviewed_by || existing.reviewed_by || "infra-agent-web"
      : draft.reviewed_by || existing.reviewed_by || null;
  const copiedAt =
    draft.status === "copied"
      ? draft.copied_at || updatedAt
      : draft.copied_at || existing.copied_at || null;
  const discardedAt =
    draft.status === "discarded"
      ? draft.discarded_at || updatedAt
      : draft.discarded_at || existing.discarded_at || null;
  const db = await getDb();

  await run(
    db,
    `UPDATE communication_drafts
        SET type = ?,
            status = ?,
            recipient_label = ?,
            recipient_email = ?,
            subject = ?,
            body_markdown = ?,
            body_text = ?,
            source_type = ?,
            source_report_id = ?,
            source_incident_id = ?,
            template_id = ?,
            review_notes = ?,
            reviewed_at = ?,
            reviewed_by = ?,
            copied_at = ?,
            discarded_at = ?,
            last_action_at = ?,
            send_status = ?,
            send_prepared_at = ?,
            send_attempt_at = ?,
            sent_at = ?,
            sent_by = ?,
            from_user = ?,
            send_error = ?,
            direct_send_requested = ?,
            direct_send_source = ?,
            direct_send_requested_at = ?,
            direct_send_from_user = ?,
            direct_send_recipient_email = ?,
            direct_send_source_incident_id = ?,
            direct_send_send_status = ?,
            direct_send_send_attempt_at = ?,
            direct_send_sent_at = ?,
            direct_send_sent_by = ?,
            direct_send_send_error = ?,
            updated_at = ?
      WHERE id = ?`,
    [
      draft.type,
      draft.status,
      draft.recipient_label,
      draft.recipient_email,
      draft.subject,
      draft.body_markdown,
      draft.body_text,
      draft.source_type,
      draft.source_report_id,
      draft.source_incident_id,
      draft.template_id,
      draft.review_notes,
      reviewedAt,
      reviewedBy,
      copiedAt,
      discardedAt,
      lastActionAt,
      draft.send_status,
      draft.send_prepared_at,
      draft.send_attempt_at,
      draft.sent_at,
      draft.sent_by,
      draft.from_user,
      draft.send_error,
      draft.direct_send_requested,
      draft.direct_send_source,
      draft.direct_send_requested_at,
      draft.direct_send_from_user,
      draft.direct_send_recipient_email,
      draft.direct_send_source_incident_id,
      draft.direct_send_send_status,
      draft.direct_send_send_attempt_at,
      draft.direct_send_sent_at,
      draft.direct_send_sent_by,
      draft.direct_send_send_error,
      updatedAt,
      Number(id)
    ]
  );

  return getCommunicationDraft(id);
}

export async function deleteCommunicationDraft(id) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId < 1) {
    return null;
  }

  const existing = await getCommunicationDraft(numericId);
  if (!existing) {
    return null;
  }
  if (existing.send_status === "sent" || existing.sent_at) {
    throw new Error(
      "Este email ya fue enviado. Duplica el borrador si necesitas enviarlo de nuevo."
    );
  }

  const db = await getDb();
  await run(db, "DELETE FROM communication_drafts WHERE id = ?", [numericId]);
  return existing;
}

function normalizeDirectoryField(value, maxLength = 180) {
  const text = normalizeString(value, maxLength);
  return text ? text : null;
}

function normalizeBusinessPhone(value) {
  if (Array.isArray(value)) {
    return normalizeDirectoryField(value.find(Boolean), 60);
  }

  return normalizeDirectoryField(value, 60);
}

function normalizeAccountEnabled(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return value ? 1 : 0;
}

export async function replaceCompanyDirectoryCache(entries = []) {
  const rows = Array.isArray(entries) ? entries : [];
  const db = await getDb();
  const now = new Date().toISOString();

  await run(db, "DELETE FROM company_directory_cache");

  for (const entry of rows) {
    const displayName = normalizeDirectoryField(entry?.display_name, 180);
    if (!displayName) {
      continue;
    }

    await run(
      db,
      `INSERT INTO company_directory_cache
        (display_name, mail, user_principal_name, job_title, department, office_location, business_phone, mobile_phone, account_enabled, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        displayName,
        normalizeDirectoryField(entry?.mail, 180),
        normalizeDirectoryField(entry?.user_principal_name, 180),
        normalizeDirectoryField(entry?.job_title, 180),
        normalizeDirectoryField(entry?.department, 180),
        normalizeDirectoryField(entry?.office_location, 180),
        normalizeBusinessPhone(entry?.business_phone),
        normalizeDirectoryField(entry?.mobile_phone, 60),
        normalizeAccountEnabled(entry?.account_enabled),
        normalizeDirectoryField(entry?.updated_at, 32) || now
      ]
    );
  }

  return listCompanyDirectoryUsers({ limit: 50 });
}

function companyDirectoryQueryClause(query) {
  const text = normalizeDirectoryField(query, 120);
  if (!text) {
    return { clause: "", params: [] };
  }

  return {
    clause:
      "(LOWER(display_name) LIKE LOWER(?) OR LOWER(COALESCE(mail, '')) LIKE LOWER(?) OR LOWER(COALESCE(user_principal_name, '')) LIKE LOWER(?) OR LOWER(COALESCE(job_title, '')) LIKE LOWER(?) OR LOWER(COALESCE(department, '')) LIKE LOWER(?) OR LOWER(COALESCE(office_location, '')) LIKE LOWER(?))",
    params: Array(6).fill(`%${text}%`)
  };
}

export async function listCompanyDirectoryUsers(options = {}) {
  const boundedLimit = Math.max(1, Math.min(Number(options.limit) || 50, 100));
  const db = await getDb();
  return all(
    db,
    `SELECT id,
            display_name,
            mail,
            user_principal_name,
            job_title,
            department,
            office_location,
            business_phone,
            mobile_phone,
            account_enabled,
            updated_at
       FROM company_directory_cache
      ORDER BY display_name COLLATE NOCASE ASC,
               COALESCE(mail, user_principal_name, '') COLLATE NOCASE ASC
      LIMIT ?`,
    [boundedLimit]
  );
}

export async function searchCompanyDirectoryCache(query, limit = 50) {
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
  const search = companyDirectoryQueryClause(query);
  const db = await getDb();
  const normalizedQuery = normalizeDirectoryField(query, 120) || "";
  return all(
    db,
    `SELECT id,
            display_name,
            mail,
            user_principal_name,
            job_title,
            department,
            office_location,
            business_phone,
            mobile_phone,
            account_enabled,
            updated_at
       FROM company_directory_cache
      ${search.clause ? `WHERE ${search.clause}` : ""}
      ORDER BY ${search.clause ? "CASE WHEN LOWER(display_name) = LOWER(?) THEN 0 ELSE 1 END, " : ""}display_name COLLATE NOCASE ASC,
               COALESCE(mail, user_principal_name, '') COLLATE NOCASE ASC
      LIMIT ?`,
    search.clause
      ? [...search.params, normalizedQuery, boundedLimit]
      : [boundedLimit]
  );
}

export async function getCompanyDirectoryCacheCount() {
  const db = await getDb();
  const row = await get(db, "SELECT COUNT(*) AS total FROM company_directory_cache");
  return Number(row?.total || 0);
}

export async function getCompanyDirectoryCacheUpdatedAt() {
  const db = await getDb();
  const row = await get(
    db,
    "SELECT MAX(updated_at) AS updated_at FROM company_directory_cache"
  );
  return normalizeOptionalString(row?.updated_at, 32);
}

function parseCatalogJson(value) {
  if (value == null) {
    return null;
  }

  if (typeof value === "object") {
    return value;
  }

  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

export async function upsertPowerBiCatalogCache(entry) {
  const modelKey = normalizeString(entry?.model_key, 64).toLowerCase();
  const displayName = normalizeString(entry?.display_name, 180);
  const catalogAvailable = entry?.catalog_available ? 1 : 0;
  const xmlaAvailable = entry?.xmla_available ? 1 : 0;
  const status = normalizeString(entry?.status, 40) || "unknown";
  const source = normalizeString(entry?.source, 40) || "rest";
  const generatedAt = normalizeString(entry?.generated_at, 40) || new Date().toISOString();
  const updatedAt = normalizeString(entry?.updated_at, 40) || new Date().toISOString();
  const error = normalizeOptionalString(entry?.error, 4000);
  const warnings = Array.isArray(entry?.warnings) ? entry.warnings : [];
  const catalog = parseCatalogJson(entry?.catalog_json ?? entry?.catalog);

  if (!modelKey || !displayName || !catalog) {
    throw new Error("Faltan campos para cachear el catálogo Power BI.");
  }

  const db = await getDb();
  await run(
    db,
    `INSERT INTO powerbi_catalog_cache
      (model_key, display_name, catalog_available, xmla_available, status, source, generated_at, updated_at, error, warnings_json, catalog_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(model_key) DO UPDATE SET
        display_name = excluded.display_name,
        catalog_available = excluded.catalog_available,
        xmla_available = excluded.xmla_available,
        status = excluded.status,
        source = excluded.source,
        generated_at = excluded.generated_at,
        updated_at = excluded.updated_at,
        error = excluded.error,
        warnings_json = excluded.warnings_json,
        catalog_json = excluded.catalog_json`,
    [
      modelKey,
      displayName,
      catalogAvailable,
      xmlaAvailable,
      status,
      source,
      generatedAt,
      updatedAt,
      error,
      JSON.stringify(warnings),
      JSON.stringify(catalog)
    ]
  );

  return getPowerBiCatalogCache(modelKey);
}

export async function getPowerBiCatalogCache(modelKey) {
  const key = normalizeString(modelKey, 64).toLowerCase();
  if (!key) {
    return null;
  }

  const db = await getDb();
  const row = await get(
    db,
    `SELECT model_key,
            display_name,
            catalog_available,
            xmla_available,
            status,
            source,
            generated_at,
            updated_at,
            error,
            warnings_json,
            catalog_json
       FROM powerbi_catalog_cache
      WHERE model_key = ?`,
    [key]
  );

  if (!row) {
    return null;
  }

  return {
    model_key: row.model_key,
    display_name: row.display_name,
    catalog_available: Boolean(row.catalog_available),
    xmla_available: Boolean(row.xmla_available),
    status: row.status,
    source: row.source,
    generated_at: row.generated_at,
    updated_at: row.updated_at,
    error: normalizeOptionalString(row.error, 4000),
    warnings: parseCatalogJson(row.warnings_json) || [],
    catalog: parseCatalogJson(row.catalog_json) || null
  };
}

export async function getPowerBiCatalogCacheSummary() {
  const db = await getDb();
  const rows = await all(
    db,
    `SELECT status, COUNT(*) AS count
       FROM powerbi_catalog_cache
      GROUP BY status`
  );
  const newest = await get(
    db,
    "SELECT MAX(updated_at) AS updated_at FROM powerbi_catalog_cache"
  );
  const counts = rows.reduce((acc, row) => {
    acc[row.status] = Number(row.count || 0);
    return acc;
  }, {});

  return {
    total: Object.values(counts).reduce((sum, value) => sum + value, 0),
    status_counts: counts,
    updated_at: normalizeOptionalString(newest?.updated_at, 32)
  };
}

export async function upsertPowerBiCatalogImport(entry) {
  const modelKey = normalizeString(entry?.model_key, 64).toLowerCase();
  const displayName = normalizeString(entry?.display_name, 180);
  const source = normalizeString(entry?.source, 20) || "tmdl";
  const status = normalizeString(entry?.status, 20) || "ok";
  const importedAt = normalizeOptionalString(entry?.imported_at, 40);
  const updatedAt = normalizeString(entry?.updated_at, 40) || new Date().toISOString();
  const error = normalizeOptionalString(entry?.error, 4000);
  const warnings = Array.isArray(entry?.warnings) ? entry.warnings : [];
  const catalog = parseCatalogJson(entry?.catalog_json ?? entry?.catalog);
  const manifest = parseCatalogJson(entry?.file_manifest_json ?? entry?.manifest);
  const fileCount = Math.max(0, Number(entry?.file_count) || 0);

  if (!modelKey || !displayName) {
    throw new Error("Faltan campos obligatorios para registrar la importación Power BI.");
  }

  const db = await getDb();
  await run(
    db,
    `INSERT INTO powerbi_catalog_imports
      (model_key, display_name, source, status, imported_at, updated_at, error, warnings_json, catalog_json, file_manifest_json, file_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(model_key) DO UPDATE SET
        display_name = excluded.display_name,
        source = excluded.source,
        status = excluded.status,
        imported_at = excluded.imported_at,
        updated_at = excluded.updated_at,
        error = excluded.error,
        warnings_json = excluded.warnings_json,
        catalog_json = excluded.catalog_json,
        file_manifest_json = excluded.file_manifest_json,
        file_count = excluded.file_count`,
    [
      modelKey,
      displayName,
      source,
      status,
      importedAt,
      updatedAt,
      error,
      JSON.stringify(warnings),
      catalog ? JSON.stringify(catalog) : null,
      manifest ? JSON.stringify(manifest) : null,
      fileCount
    ]
  );

  return getPowerBiCatalogImport(modelKey);
}

export async function getPowerBiCatalogImport(modelKey) {
  const key = normalizeString(modelKey, 64).toLowerCase();
  if (!key) {
    return null;
  }

  const db = await getDb();
  const row = await get(
    db,
    `SELECT model_key,
            display_name,
            source,
            status,
            imported_at,
            updated_at,
            error,
            warnings_json,
            catalog_json,
            file_manifest_json,
            file_count
       FROM powerbi_catalog_imports
      WHERE model_key = ?`,
    [key]
  );

  if (!row) {
    return null;
  }

  return {
    model_key: row.model_key,
    display_name: row.display_name,
    source: row.source,
    status: row.status,
    imported_at: row.imported_at,
    updated_at: row.updated_at,
    error: normalizeOptionalString(row.error, 4000),
    warnings: parseCatalogJson(row.warnings_json) || [],
    catalog: parseCatalogJson(row.catalog_json) || null,
    file_manifest: parseCatalogJson(row.file_manifest_json) || [],
    file_count: Number(row.file_count || 0)
  };
}

export async function listPowerBiCatalogImports() {
  const db = await getDb();
  return all(
    db,
    `SELECT model_key,
            display_name,
            source,
            status,
            imported_at,
            updated_at,
            error,
            file_count
       FROM powerbi_catalog_imports
      ORDER BY updated_at DESC`
  );
}

export async function getPowerBiCatalogImportsSummary() {
  const db = await getDb();
  const rows = await all(
    db,
    `SELECT source, status, COUNT(*) AS count
       FROM powerbi_catalog_imports
      GROUP BY source, status`
  );
  const latest = await get(
    db,
    "SELECT MAX(updated_at) AS updated_at FROM powerbi_catalog_imports"
  );
  const counts = rows.reduce((acc, row) => {
    const source = String(row.source || "unknown");
    const status = String(row.status || "unknown");
    acc[source] = acc[source] || {};
    acc[source][status] = Number(row.count || 0);
    return acc;
  }, {});

  return {
    total: rows.reduce((sum, row) => sum + Number(row.count || 0), 0),
    source_counts: counts,
    updated_at: normalizeOptionalString(latest?.updated_at, 32)
  };
}
