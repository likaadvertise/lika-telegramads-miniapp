/* =========================================================
   دیتابیس — نسخهٔ SQLite
   ---------------------------------------------------------
   از دیتابیس داخلی خود Node.js استفاده می‌کند (node:sqlite)
   تا نیازی به نصب هیچ برنامهٔ اضافه‌ای نباشد.
   کل دیتابیس یک فایل است (پیش‌فرض: server/data/lika.db).

   این نسخه وقتی به کار می‌رود که POSTGRES_URL تنظیم نشده باشد:
   روی کامپیوتر خودتان، در تست‌ها، و روی سرور اوبونتو.

   توابع اینجا async هستند نه چون SQLite کند است — بلکه چون
   نسخهٔ Postgres ناچار async است و هر دو باید یک شکل باشند.
   ========================================================= */

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";
import {
  CODE_OFFSET, CODE_TTL_MINUTES, CODE_MAX_ATTEMPTS, CODE_RESEND_SECONDS,
  CODE_ERRORS, now, hashCode, codeMatches, makeCode,
  rowToCampaign, profileFromUser, summaryFromCampaigns, adminUserRow, websiteUserId
} from "./db-shared.js";

export const kind = "sqlite";

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
    show_picture   INTEGER NOT NULL DEFAULT 0,

    countries      TEXT    NOT NULL DEFAULT '[]',
    languages      TEXT    NOT NULL DEFAULT '[]',
    topics         TEXT    NOT NULL DEFAULT '[]',
    channels       TEXT    NOT NULL DEFAULT '[]',
    keywords       TEXT    NOT NULL DEFAULT '[]',

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
ensureColumn("users", "email", "TEXT NOT NULL DEFAULT ''");
ensureColumn("campaigns", "channel_title", "TEXT NOT NULL DEFAULT ''");
ensureColumn("campaigns", "ad_title", "TEXT NOT NULL DEFAULT ''");
ensureColumn("campaigns", "keywords", "TEXT NOT NULL DEFAULT '[]'");
ensureColumn("campaigns", "show_picture", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("campaigns", "package_id", "TEXT NOT NULL DEFAULT ''");
ensureColumn("campaigns", "package_views", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("campaigns", "price_toman", "REAL NOT NULL DEFAULT 0");
ensureColumn("campaigns", "discount_percent", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("campaigns", "start_date", "TEXT NOT NULL DEFAULT ''");
ensureColumn("campaigns", "poster_file_id", "TEXT NOT NULL DEFAULT ''");
ensureColumn("campaigns", "receipt_file_id", "TEXT NOT NULL DEFAULT ''");
ensureColumn("campaigns", "receipt_at", "TEXT NOT NULL DEFAULT ''");
ensureColumn("campaigns", "joins", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("users", "source", "TEXT NOT NULL DEFAULT 'telegram'");
ensureColumn("campaigns", "source", "TEXT NOT NULL DEFAULT 'telegram'");

/** برای هماهنگی با نسخهٔ Postgres؛ اینجا کاری لازم نیست */
export async function init() {}

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

export async function upsertUser(u) {
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

export async function getUser(id) {
  return qUserGet.get(Number(id));
}

/* =========================================================
   ثبت‌نام کاربر (شماره تماس + نام)
   ========================================================= */
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
  "UPDATE users SET reg_first_name = ?, reg_last_name = ?, email = ?, registered_at = ? WHERE id = ?"
);

/** کاربری که این شماره را قبلاً ثبت کرده (اگر باشد) */
export async function findUserByPhone(phone) {
  return qUserByPhone.get(String(phone)) || null;
}

/** یک کد تصادفی ۵ رقمی می‌سازد و ذخیره می‌کند */
export async function issuePhoneCode(userId, phone) {
  const existing = qCodeGet.get(Number(userId));

  if (existing) {
    const since = (Date.now() - new Date(existing.sent_at).getTime()) / 1000;
    if (since < CODE_RESEND_SECONDS) {
      return { ok: false, retryAfter: Math.ceil(CODE_RESEND_SECONDS - since) };
    }
  }

  const code = makeCode();
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
export async function checkPhoneCode(userId, code) {
  const row = qCodeGet.get(Number(userId));
  if (!row) return { ok: false, error: CODE_ERRORS.notSent };

  if (new Date(row.expires_at).getTime() < Date.now()) {
    qCodeClear.run(Number(userId));
    return { ok: false, error: CODE_ERRORS.expired };
  }

  if (row.attempts >= CODE_MAX_ATTEMPTS) {
    qCodeClear.run(Number(userId));
    return { ok: false, error: CODE_ERRORS.tooManyAttempts };
  }

  if (!codeMatches(userId, code, row.code_hash)) {
    qCodeAttempt.run(Number(userId));
    return { ok: false, error: CODE_ERRORS.wrong(CODE_MAX_ATTEMPTS - (row.attempts + 1)) };
  }

  qCodeClear.run(Number(userId));
  qUserSetPhone.run(row.phone, Number(userId));
  return { ok: true, phone: row.phone };
}

/** ثبت شماره بدون کد تأیید (وقتی کد خاموش است) */
export async function setPhoneDirect(userId, phone) {
  qUserSetPhone.run(phone, Number(userId));
  qCodeClear.run(Number(userId));
  return profileOf(userId);
}

/** نام و نام خانوادگی (و ایمیل اختیاری) را ذخیره و ثبت‌نام را کامل می‌کند */
export async function completeRegistration(userId, firstName, lastName, email = "") {
  qUserSetProfile.run(firstName, lastName, email, now(), Number(userId));
  return profileOf(userId);
}

/** وضعیت ثبت‌نام کاربر */
export async function profileOf(userId) {
  return profileFromUser(qUserGet.get(Number(userId)));
}

/* ---------- کمپین‌ها ---------- */
const qCampaignInsert = db.prepare(`
  INSERT INTO campaigns (
    code, user_id, status,
    target_type, target_url, brand,
    ad_text, written_by_us, show_picture,
    countries, languages, topics, channels, keywords,
    budget_usd, cpm_usd, start_when,
    package_id, package_views, price_toman, discount_percent, start_date,
    poster_file_id,
    notes, channel_title, ad_title, created_at, updated_at
  ) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

/** ردیف را همراه تاریخچه‌اش به شکل کمپین درمی‌آورد */
function withHistory(row) {
  if (!row) return null;
  return rowToCampaign(row, qEventsByCampaign.all(row.id));
}

export async function countOrdersToday(userId) {
  const since = new Date(Date.now() - 86400000).toISOString();
  return Number(qCountToday.get(Number(userId), since).n);
}

export async function createCampaign(userId, data) {
  const t = now();

  const info = qCampaignInsert.run(
    "", // کد موقت؛ بعد از گرفتن id ساخته می‌شود
    Number(userId),
    data.targetType,
    data.targetUrl,
    data.brand,
    data.adText,
    data.writtenByUs ? 1 : 0,
    data.showPicture ? 1 : 0,
    JSON.stringify(data.countries),
    JSON.stringify(data.languages),
    JSON.stringify(data.topics),
    JSON.stringify(data.channels),
    JSON.stringify(data.keywords || []),
    data.budgetUsd,
    data.cpmUsd,
    data.startWhen,
    data.packageId || "",
    Number(data.packageViews) || 0,
    Number(data.priceToman) || 0,
    Number(data.discountPercent) || 0,
    data.startDate || "",
    data.posterFileId || "",
    data.notes,
    data.channelTitle || "",
    data.adTitle || "",
    t,
    t
  );

  const id = Number(info.lastInsertRowid);
  const code = "LK-" + (CODE_OFFSET + id);

  qCampaignSetCode.run(code, id);
  qEventInsert.run(id, "pending", "", "customer", t);

  return withHistory(qCampaignById.get(id));
}

/* =========================================================
   سفارش‌های سایت (likaads.com)
   ---------------------------------------------------------
   همان منطق نسخهٔ Postgres: یک «کاربر سایت» با آیدی منفیِ ساخته‌شده
   از شماره تلفن، بعد کمپینی با source='website'.
   ========================================================= */
const qWebsiteUserUpsert = db.prepare(`
  INSERT INTO users (
    id, first_name, last_name, username, language_code,
    phone, reg_first_name, reg_last_name, registered_at, email,
    source, created_at, last_seen_at
  ) VALUES (?, ?, ?, '', 'fa', ?, ?, ?, ?, ?, 'website', ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    first_name     = excluded.first_name,
    last_name      = excluded.last_name,
    phone          = excluded.phone,
    reg_first_name = excluded.reg_first_name,
    reg_last_name  = excluded.reg_last_name,
    email          = CASE WHEN excluded.email <> '' THEN excluded.email ELSE users.email END,
    last_seen_at   = excluded.last_seen_at
`);

const qWebsiteCampaignInsert = db.prepare(`
  INSERT INTO campaigns (
    code, user_id, status, source,
    target_type, target_url, brand,
    ad_text, written_by_us, show_picture,
    countries, languages, topics, channels, keywords,
    budget_usd, cpm_usd, start_when,
    package_id, package_views, price_toman, discount_percent, start_date,
    notes, channel_title, ad_title, created_at, updated_at
  ) VALUES ('', ?, 'pending', 'website', ?, ?, ?, ?, 0, 0, '[]', '[]', '[]', ?, ?, 0, 0, ?, ?, ?, ?, 0, ?, ?, '', ?, ?, ?)
`);

export async function createWebsiteCampaign(input) {
  const t = now();
  const userId = websiteUserId(input.phone);

  qWebsiteUserUpsert.run(
    userId, input.firstName, input.lastName,
    input.phone, input.firstName, input.lastName,
    t, input.email || "",
    t, t
  );

  const info = qWebsiteCampaignInsert.run(
    userId,
    input.targetType,
    input.targetUrl,
    input.brand,
    input.adText || "",
    JSON.stringify(input.channels || []),
    JSON.stringify(input.keywords || []),
    input.startWhen || "asap",
    input.packageId || "",
    Number(input.packageViews) || 0,
    Number(input.priceToman) || 0,
    input.startDate || "",
    input.notes || "",
    input.adTitle || "",
    t,
    t
  );

  const id = Number(info.lastInsertRowid);
  const code = "LK-" + (CODE_OFFSET + id);

  qCampaignSetCode.run(code, id);
  qEventInsert.run(id, "pending", "از سایت likaads.com", "website", t);

  return { campaign: withHistory(qCampaignById.get(id)), userId };
}

export async function getCampaignByCode(code) {
  return withHistory(qCampaignByCode.get(String(code)));
}

export async function listCampaignsByUser(userId, limit = 50) {
  return qCampaignsByUser.all(Number(userId), limit).map(withHistory);
}

const qCampaignSetStatus = db.prepare(
  "UPDATE campaigns SET status = ?, updated_at = ? WHERE id = ?"
);

export async function setCampaignStatus(code, status, actor, note = "") {
  const row = qCampaignByCode.get(String(code));
  if (!row) return null;
  if (row.status === status) return withHistory(row);

  const t = now();
  qCampaignSetStatus.run(status, t, row.id);
  qEventInsert.run(row.id, status, note, actor, t);

  return withHistory(qCampaignByCode.get(String(code)));
}

const qCampaignSetStats = db.prepare(
  "UPDATE campaigns SET views = ?, clicks = ?, joins = ?, updated_at = ? WHERE id = ?"
);

export async function setCampaignStats(code, views, clicks, joins) {
  const row = qCampaignByCode.get(String(code));
  if (!row) return null;
  qCampaignSetStats.run(Number(views) || 0, Number(clicks) || 0, Number(joins) || 0, now(), row.id);
  return withHistory(qCampaignByCode.get(String(code)));
}

export async function summaryForUser(userId) {
  return summaryFromCampaigns(await listCampaignsByUser(userId, 500));
}

/* =========================================================
   پنل مدیریت
   ---------------------------------------------------------
   فقط برای کسانی که در ADMIN_IDS هستند. دسترسی در api.js
   بررسی می‌شود، نه اینجا.
   ========================================================= */

const qAllUsers = db.prepare(`
  SELECT u.*, (SELECT COUNT(*) FROM campaigns c WHERE c.user_id = u.id) AS orders
  FROM users u
  WHERE u.registered_at <> ''
  ORDER BY u.registered_at DESC
  LIMIT ?
`);

export async function listRegisteredUsers(limit = 500) {
  return qAllUsers.all(limit).map(adminUserRow);
}

const qAllCampaigns = db.prepare("SELECT * FROM campaigns ORDER BY id DESC LIMIT ?");

export async function listAllCampaigns(limit = 500) {
  return qAllCampaigns.all(limit).map((row) => rowToCampaign(row, []));
}

/** ویرایش سفارش توسط مدیر — همان رکوردی که مشتری می‌بیند */
const qCampaignEdit = db.prepare(`
  UPDATE campaigns SET
    ad_title = ?, brand = ?, target_url = ?, ad_text = ?,
    channels = ?, keywords = ?,
    status = ?, admin_note = ?, updated_at = ?
  WHERE code = ?
`);

export async function editCampaign(code, d, actor = "مدیر") {
  const row = qCampaignByCode.get(String(code));
  if (!row) return null;

  const t = now();
  qCampaignEdit.run(
    d.adTitle, d.brand, d.targetUrl, d.adText,
    JSON.stringify(d.channels), JSON.stringify(d.keywords),
    d.status, d.adminNote, t, String(code)
  );

  qEventInsert.run(row.id, d.status, d.adminNote || "ویرایش توسط تیم", actor, t);
  return withHistory(qCampaignByCode.get(String(code)));
}

/** حذف کامل یک سفارش — فقط برای مدیر؛ برگشت‌ناپذیر است */
const qCampaignDelete = db.prepare("DELETE FROM campaigns WHERE code = ?");

export async function deleteCampaign(code) {
  const row = qCampaignByCode.get(String(code));
  if (!row) return false;
  qCampaignDelete.run(String(code));
  return true;
}

/** ویرایش مشخصات مشتری توسط مدیر */
const qUserEdit = db.prepare(
  "UPDATE users SET reg_first_name = ?, reg_last_name = ?, phone = ? WHERE id = ?"
);

export async function editUser(id, { firstName, lastName, phone }) {
  const row = qUserGet.get(Number(id));
  if (!row) return null;
  qUserEdit.run(firstName, lastName, phone, Number(id));
  return adminUserRow({ ...qUserGet.get(Number(id)), orders: row.orders || 0 });
}

/** حذف مشتری — فقط اگر هیچ سفارشی نداشته باشد (وگرنه رکورد سفارش‌ها یتیم می‌ماند) */
const qCampaignCountByUser = db.prepare("SELECT COUNT(*) AS n FROM campaigns WHERE user_id = ?");
const qUserDelete = db.prepare("DELETE FROM users WHERE id = ?");

export async function deleteUser(id) {
  const row = qUserGet.get(Number(id));
  if (!row) return { ok: false, error: "مشتری پیدا نشد." };

  const { n } = qCampaignCountByUser.get(Number(id));
  if (n > 0) {
    return { ok: false, error: `این مشتری ${n} سفارش دارد؛ اول باید سفارش‌هایش حذف شوند.` };
  }

  qUserDelete.run(Number(id));
  return { ok: true };
}

/* ---------- رسید پرداخت ---------- */
const qSetReceipt = db.prepare(
  "UPDATE campaigns SET receipt_file_id = ?, receipt_at = ?, updated_at = ? WHERE code = ?"
);

export async function setCampaignReceipt(code, fileId) {
  const t = now();
  qSetReceipt.run(String(fileId), t, t, String(code));
  return withHistory(qCampaignByCode.get(String(code)));
}
