/* =========================================================
   دیتابیس — SQLite
   ---------------------------------------------------------
   از دیتابیس داخلی خود Node.js استفاده می‌کنیم (node:sqlite)
   تا نیازی به نصب هیچ برنامهٔ اضافه‌ای نباشد.
   کل دیتابیس یک فایل است (پیش‌فرض: server/data/lika.db).
   ========================================================= */

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";

/* شمارهٔ سفارش‌ها از LK-1044 شروع می‌شود (۱۰۴۳ در نسخهٔ نمایشی استفاده شده بود) */
const CODE_OFFSET = 1043;

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

/* ---------- ساخت جدول‌ها (فقط بار اول) ---------- */
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    first_name    TEXT,
    last_name     TEXT,
    username      TEXT,
    language_code TEXT,
    is_blocked    INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    last_seen_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS campaigns (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    code           TEXT    NOT NULL UNIQUE,
    user_id        INTEGER NOT NULL REFERENCES users(id),
    status         TEXT    NOT NULL DEFAULT 'pending',

    target_type    TEXT    NOT NULL,
    target_url     TEXT    NOT NULL,
    brand          TEXT    NOT NULL,

    ad_text        TEXT    NOT NULL DEFAULT '',
    written_by_us  INTEGER NOT NULL DEFAULT 0,

    countries      TEXT    NOT NULL DEFAULT '[]',
    languages      TEXT    NOT NULL DEFAULT '[]',
    topics         TEXT    NOT NULL DEFAULT '[]',
    channels       TEXT    NOT NULL DEFAULT '[]',

    budget_usd     REAL    NOT NULL,
    cpm_usd        REAL    NOT NULL,
    start_when     TEXT    NOT NULL DEFAULT 'asap',

    notes          TEXT    NOT NULL DEFAULT '',
    admin_note     TEXT    NOT NULL DEFAULT '',

    views          INTEGER NOT NULL DEFAULT 0,
    clicks         INTEGER NOT NULL DEFAULT 0,

    created_at     TEXT    NOT NULL,
    updated_at     TEXT    NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_campaigns_user   ON campaigns(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status, created_at DESC);

  CREATE TABLE IF NOT EXISTS campaign_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    status      TEXT    NOT NULL,
    note        TEXT    NOT NULL DEFAULT '',
    actor       TEXT    NOT NULL DEFAULT 'system',
    at          TEXT    NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_events_campaign ON campaign_events(campaign_id, id);
`);

const now = () => new Date().toISOString();

/* ---------- کاربران ---------- */
const qUserUpsert = db.prepare(`
  INSERT INTO users (id, first_name, last_name, username, language_code, created_at, last_seen_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    first_name    = excluded.first_name,
    last_name     = excluded.last_name,
    username      = excluded.username,
    language_code = excluded.language_code,
    last_seen_at  = excluded.last_seen_at
`);

const qUserGet = db.prepare("SELECT * FROM users WHERE id = ?");

export function upsertUser(u) {
  const t = now();
  qUserUpsert.run(
    Number(u.id),
    u.first_name ?? "",
    u.last_name ?? "",
    u.username ?? "",
    u.language_code ?? "",
    t,
    t
  );
  return qUserGet.get(Number(u.id));
}

export function getUser(id) {
  return qUserGet.get(Number(id));
}

/* ---------- کمپین‌ها ---------- */
const qCampaignInsert = db.prepare(`
  INSERT INTO campaigns (
    code, user_id, status,
    target_type, target_url, brand,
    ad_text, written_by_us,
    countries, languages, topics, channels,
    budget_usd, cpm_usd, start_when,
    notes, created_at, updated_at
  ) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const qCampaignSetCode = db.prepare("UPDATE campaigns SET code = ? WHERE id = ?");
const qCampaignById = db.prepare("SELECT * FROM campaigns WHERE id = ?");
const qCampaignByCode = db.prepare("SELECT * FROM campaigns WHERE code = ?");
const qCampaignsByUser = db.prepare(
  "SELECT * FROM campaigns WHERE user_id = ? ORDER BY id DESC LIMIT ?"
);
const qEventInsert = db.prepare(
  "INSERT INTO campaign_events (campaign_id, status, note, actor, at) VALUES (?, ?, ?, ?, ?)"
);
const qEventsByCampaign = db.prepare(
  "SELECT status, note, actor, at FROM campaign_events WHERE campaign_id = ? ORDER BY id"
);
const qCountToday = db.prepare(
  "SELECT COUNT(*) AS n FROM campaigns WHERE user_id = ? AND created_at > ?"
);

export function countOrdersToday(userId) {
  const since = new Date(Date.now() - 86400000).toISOString();
  return qCountToday.get(Number(userId), since).n;
}

export function createCampaign(userId, data) {
  const t = now();

  const info = qCampaignInsert.run(
    "", // کد موقت؛ بعد از گرفتن id ساخته می‌شود
    Number(userId),
    data.targetType,
    data.targetUrl,
    data.brand,
    data.adText,
    data.writtenByUs ? 1 : 0,
    JSON.stringify(data.countries),
    JSON.stringify(data.languages),
    JSON.stringify(data.topics),
    JSON.stringify(data.channels),
    data.budgetUsd,
    data.cpmUsd,
    data.startWhen,
    data.notes,
    t,
    t
  );

  const id = Number(info.lastInsertRowid);
  const code = "LK-" + (CODE_OFFSET + id);

  qCampaignSetCode.run(code, id);
  qEventInsert.run(id, "pending", "", "customer", t);

  return rowToCampaign(qCampaignById.get(id));
}

export function getCampaignByCode(code) {
  const row = qCampaignByCode.get(String(code));
  return row ? rowToCampaign(row) : null;
}

export function listCampaignsByUser(userId, limit = 50) {
  return qCampaignsByUser.all(Number(userId), limit).map(rowToCampaign);
}

const qCampaignSetStatus = db.prepare(
  "UPDATE campaigns SET status = ?, updated_at = ? WHERE id = ?"
);

export function setCampaignStatus(code, status, actor, note = "") {
  const row = qCampaignByCode.get(String(code));
  if (!row) return null;
  if (row.status === status) return rowToCampaign(row);

  const t = now();
  qCampaignSetStatus.run(status, t, row.id);
  qEventInsert.run(row.id, status, note, actor, t);

  return rowToCampaign(qCampaignByCode.get(String(code)));
}

const qCampaignSetStats = db.prepare(
  "UPDATE campaigns SET views = ?, clicks = ?, updated_at = ? WHERE id = ?"
);

export function setCampaignStats(code, views, clicks) {
  const row = qCampaignByCode.get(String(code));
  if (!row) return null;
  qCampaignSetStats.run(Number(views) || 0, Number(clicks) || 0, now(), row.id);
  return rowToCampaign(qCampaignByCode.get(String(code)));
}

/* ---------- تبدیل ردیف دیتابیس به شکلی که مینی‌اپ می‌فهمد ---------- */
function safeParse(json) {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function rowToCampaign(row) {
  if (!row) return null;
  return {
    id: row.code,
    userId: row.user_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isSample: false,
    target: { type: row.target_type, url: row.target_url, brand: row.brand },
    creative: { text: row.ad_text, writtenByUs: row.written_by_us === 1 },
    targeting: {
      countries: safeParse(row.countries),
      languages: safeParse(row.languages),
      topics: safeParse(row.topics),
      channels: safeParse(row.channels)
    },
    budget: { amountUsd: row.budget_usd, cpmUsd: row.cpm_usd, startWhen: row.start_when },
    notes: row.notes,
    adminNote: row.admin_note,
    stats: { views: row.views, clicks: row.clicks },
    history: qEventsByCampaign.all(row.id).map((e) => ({ status: e.status, at: e.at, note: e.note }))
  };
}

export function summaryForUser(userId) {
  const all = listCampaignsByUser(userId, 500);
  return {
    total: all.length,
    active: all.filter((c) => ["approved", "running"].includes(c.status)).length,
    waiting: all.filter((c) => ["pending", "review"].includes(c.status)).length,
    spend: all
      .filter((c) => ["running", "done"].includes(c.status))
      .reduce((s, c) => s + c.budget.amountUsd, 0),
    views: all.reduce((s, c) => s + c.stats.views, 0)
  };
}
