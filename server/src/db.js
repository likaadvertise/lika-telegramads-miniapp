/* =========================================================
   دیتابیس — SQLite
   ---------------------------------------------------------
   از دیتابیس داخلی خود Node.js استفاده می‌کنیم (node:sqlite)
   تا نیازی به نصب هیچ برنامهٔ اضافه‌ای نباشد.
   کل دیتابیس یک فایل است (پیش‌فرض: server/data/lika.db).
   ========================================================= */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
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

  CREATE TABLE IF NOT EXISTS phone_codes (
    user_id    INTEGER PRIMARY KEY,
    phone      TEXT    NOT NULL,
    code_hash  TEXT    NOT NULL,
    expires_at TEXT    NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 0,
    sent_at    TEXT    NOT NULL
  );
`);

/* ---------- افزودن ستون‌های تازه به جدول‌های قدیمی ---------- */
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("users", "phone", "TEXT NOT NULL DEFAULT ''");
ensureColumn("users", "reg_first_name", "TEXT NOT NULL DEFAULT ''");
ensureColumn("users", "reg_last_name", "TEXT NOT NULL DEFAULT ''");
ensureColumn("users", "registered_at", "TEXT NOT NULL DEFAULT ''");
ensureColumn("campaigns", "channel_title", "TEXT NOT NULL DEFAULT ''");

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

/* =========================================================
   ثبت‌نام کاربر (شماره تماس + نام)
   ========================================================= */
const CODE_TTL_MINUTES = 2;
const CODE_MAX_ATTEMPTS = 5;
const CODE_RESEND_SECONDS = 120;

const qCodeGet = db.prepare("SELECT * FROM phone_codes WHERE user_id = ?");
const qCodeSet = db.prepare(`
  INSERT INTO phone_codes (user_id, phone, code_hash, expires_at, attempts, sent_at)
  VALUES (?, ?, ?, ?, 0, ?)
  ON CONFLICT(user_id) DO UPDATE SET
    phone      = excluded.phone,
    code_hash  = excluded.code_hash,
    expires_at = excluded.expires_at,
    attempts   = 0,
    sent_at    = excluded.sent_at
`);
const qCodeAttempt = db.prepare("UPDATE phone_codes SET attempts = attempts + 1 WHERE user_id = ?");
const qCodeClear = db.prepare("DELETE FROM phone_codes WHERE user_id = ?");
const qUserSetPhone = db.prepare("UPDATE users SET phone = ? WHERE id = ?");
const qUserByPhone = db.prepare("SELECT * FROM users WHERE phone = ? LIMIT 1");
const qUserSetProfile = db.prepare(
  "UPDATE users SET reg_first_name = ?, reg_last_name = ?, registered_at = ? WHERE id = ?"
);

function hashCode(userId, code) {
  return crypto.createHash("sha256").update(`${userId}:${code}`).digest("hex");
}

/** کاربری که این شماره را قبلاً ثبت کرده (اگر باشد) */
export function findUserByPhone(phone) {
  return qUserByPhone.get(String(phone)) || null;
}

/** یک کد تصادفی ۵ رقمی می‌سازد و ذخیره می‌کند */
export function issuePhoneCode(userId, phone) {
  const existing = qCodeGet.get(Number(userId));

  if (existing) {
    const since = (Date.now() - new Date(existing.sent_at).getTime()) / 1000;
    if (since < CODE_RESEND_SECONDS) {
      return { ok: false, retryAfter: Math.ceil(CODE_RESEND_SECONDS - since) };
    }
  }

  // ۱۰۰۰۰ تا ۹۹۹۹۹ — همیشه ۵ رقمی
  const code = String(10000 + crypto.randomInt(90000));
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60000).toISOString();

  qCodeSet.run(Number(userId), phone, hashCode(userId, code), expiresAt, now());
  return {
    ok: true,
    code,
    expiresInSeconds: CODE_TTL_MINUTES * 60,
    resendAfterSeconds: CODE_RESEND_SECONDS
  };
}

/** کد واردشده را بررسی می‌کند */
export function checkPhoneCode(userId, code) {
  const row = qCodeGet.get(Number(userId));
  if (!row) return { ok: false, error: "کدی برای شما ارسال نشده است. دوباره درخواست کنید." };

  if (new Date(row.expires_at).getTime() < Date.now()) {
    qCodeClear.run(Number(userId));
    return { ok: false, error: "کد منقضی شده است. کد جدید بگیرید." };
  }

  if (row.attempts >= CODE_MAX_ATTEMPTS) {
    qCodeClear.run(Number(userId));
    return { ok: false, error: "تعداد تلاش‌ها بیش از حد مجاز بود. کد جدید بگیرید." };
  }

  const given = Buffer.from(hashCode(userId, String(code)), "hex");
  const want = Buffer.from(row.code_hash, "hex");

  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
    qCodeAttempt.run(Number(userId));
    const left = CODE_MAX_ATTEMPTS - (row.attempts + 1);
    return {
      ok: false,
      error: left > 0 ? `کد درست نیست. ${left} تلاش دیگر باقی مانده.` : "کد درست نیست."
    };
  }

  qCodeClear.run(Number(userId));
  qUserSetPhone.run(row.phone, Number(userId));
  return { ok: true, phone: row.phone };
}

/** ثبت شماره بدون کد تأیید (وقتی کد خاموش است) */
export function setPhoneDirect(userId, phone) {
  qUserSetPhone.run(phone, Number(userId));
  qCodeClear.run(Number(userId));
  return profileOf(userId);
}

/** نام و نام خانوادگی را ذخیره و ثبت‌نام را کامل می‌کند */
export function completeRegistration(userId, firstName, lastName) {
  qUserSetProfile.run(firstName, lastName, now(), Number(userId));
  return profileOf(userId);
}

/** وضعیت ثبت‌نام کاربر */
export function profileOf(userId) {
  const u = qUserGet.get(Number(userId));
  if (!u) return { phone: "", firstName: "", lastName: "", registered: false, phoneVerified: false };

  return {
    phone: u.phone || "",
    firstName: u.reg_first_name || "",
    lastName: u.reg_last_name || "",
    phoneVerified: Boolean(u.phone),
    registered: Boolean(u.phone && u.registered_at)
  };
}

/* ---------- کمپین‌ها ---------- */
const qCampaignInsert = db.prepare(`
  INSERT INTO campaigns (
    code, user_id, status,
    target_type, target_url, brand,
    ad_text, written_by_us,
    countries, languages, topics, channels,
    budget_usd, cpm_usd, start_when,
    notes, channel_title, created_at, updated_at
  ) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    data.channelTitle || "",
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
    target: {
      type: row.target_type,
      url: row.target_url,
      brand: row.brand,
      channelTitle: row.channel_title || ""
    },
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
