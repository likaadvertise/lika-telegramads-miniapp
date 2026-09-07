/* =========================================================
   تست مسیر Vercel
   ---------------------------------------------------------
   این تست همان چیزی را بررسی می‌کند که روی Vercel اجرا می‌شود:
     • دیتابیس Postgres (نه SQLite)
     • ربات با webhook (نه polling)
     • توابع پوشهٔ api (نه server/src/index.js)

   تلگرام واقعی صدا زده نمی‌شود؛ یک تلگرام تقلبی محلی بالا می‌آید.

   اجرا:
     POSTGRES_URL=... node tests/test-vercel.mjs
   ========================================================= */

import http from "node:http";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const TOKEN = "1234567890:AAFakeTokenForLocalTestingOnly_0123456789";
const SECRET = "test-webhook-secret-0123456789";
const MOCK_PORT = 8795;
const APP_PORT = 8796;

const PG_URL = process.env.POSTGRES_URL || process.env.DATABASE_URL || "";
if (!PG_URL) {
  console.error("✖ این تست به Postgres نیاز دارد. مثال:");
  console.error("   POSTGRES_URL=postgresql://user:pass@127.0.0.1:5432/db node tests/test-vercel.mjs");
  process.exit(1);
}

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  ✓", name); }
  else { fail++; console.log("  ✗", name, extra); }
};

/* ---------- ۱) تلگرام تقلبی ---------- */
const calls = [];
const mock = http.createServer((req, res) => {
  const method = req.url.split("/").pop();
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    calls.push({ method, body: body ? JSON.parse(body) : {} });
    let result = true;
    if (method === "getMe") result = { id: 1234567890, username: "lika_test_bot", first_name: "Lika" };
    if (method === "sendMessage") result = { message_id: calls.length };
    if (method === "getChat") {
      const id = JSON.parse(body || "{}").chat_id;
      if (id !== "@lika_shop") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, description: "Bad Request: chat not found" }));
        return;
      }
      result = { id: -100123, type: "channel", title: "لیکا شاپ رسمی", photo: { small_file_id: "SMALL1" } };
    }
    if (method === "getFile") result = { file_id: "SMALL1", file_path: "photos/file_1.jpg" };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, result }));
  });
});
await new Promise((r) => mock.listen(MOCK_PORT, r));

/* ---------- ۲) پاک کردن دیتابیس ---------- */
{
  const pg = (await import("pg")).default;
  const admin = new pg.Client({ connectionString: PG_URL });
  await admin.connect();
  await admin.query("DROP TABLE IF EXISTS campaign_events, campaigns, phone_codes, users CASCADE");
  await admin.end();
}

/* ---------- ۳) بالا آوردن شبیه‌ساز Vercel ---------- */
const env = {
  ...process.env,
  BOT_TOKEN: TOKEN,
  WEBAPP_URL: `http://localhost:${APP_PORT}`,
  ADMIN_CHAT_ID: "555000111",
  ADMIN_IDS: "555000111",
  PORT: String(APP_PORT),
  BOT_API_BASE: `http://127.0.0.1:${MOCK_PORT}`,
  BOT_MODE: "webhook",
  WEBHOOK_SECRET: SECRET,
  SERVE_WEBAPP: "0",
  POSTGRES_URL: PG_URL,
  NO_PROXY: "*", no_proxy: "*"
};

const proc = spawn("node", ["tests/vercel-shim.mjs"], { cwd: ROOT, env });
let log = "";
proc.stdout.on("data", (d) => (log += d));
proc.stderr.on("data", (d) => (log += d));

const base = `http://127.0.0.1:${APP_PORT}`;
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(base + "/api/health");
    if (r.ok) break;
  } catch { /* هنوز بالا نیامده */ }
  await new Promise((r) => setTimeout(r, 250));
}

/* ---------- کمکی‌ها ---------- */
function makeInitData(user, { authDate = Math.floor(Date.now() / 1000) } = {}) {
  const params = { auth_date: String(authDate), query_id: "AAF_test", user: JSON.stringify(user) };
  const checkString = Object.entries(params).map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(TOKEN).digest();
  const hash = crypto.createHmac("sha256", secret).update(checkString).digest("hex");
  return new URLSearchParams({ ...params, hash }).toString();
}

const customer = { id: 881001, first_name: "زهرا", last_name: "کریمی", username: "zahra_test", language_code: "fa" };
const initData = makeInitData(customer);

const api = (p, opts = {}) =>
  fetch(base + p, {
    ...opts,
    headers: { "Content-Type": "application/json", "X-Telegram-Init-Data": initData, ...(opts.headers || {}) }
  });

/** یک پیام تلگرام را مثل تلگرام واقعی به webhook می‌فرستد */
const webhook = (update, { secret = SECRET } = {}) =>
  fetch(base + "/api/telegram", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": secret },
    body: JSON.stringify(update)
  });

console.log("\n=== تست مسیر Vercel ===\n");

/* ---------- سلامت ---------- */
const health = await fetch(base + "/api/health");
check("سلامت سرور (تابع catch-all کار می‌کند)", health.status === 200);

/* ---------- setup ---------- */
console.log("\n-- راه‌اندازی اولیه --");
const badSecret = await fetch(base + "/api/setup?secret=wrong");
check("setup بدون رمز درست رد می‌شود (۴۰۱)", badSecret.status === 401);

const setup = await fetch(base + `/api/setup?secret=${SECRET}`);
const setupBody = await setup.json();
check("setup با رمز درست اجرا می‌شود", setup.status === 200, JSON.stringify(setupBody).slice(0, 200));
check("دیتابیس Postgres آماده شد", JSON.stringify(setupBody).includes("postgres"));

const setWebhook = calls.find((c) => c.method === "setWebhook");
check("آدرس webhook به تلگرام معرفی شد", Boolean(setWebhook));
check("آدرس webhook درست است", setWebhook?.body?.url === `${base.replace("127.0.0.1", "localhost")}/api/telegram`,
  String(setWebhook?.body?.url));
check("رمز webhook همراهش فرستاده شد", setWebhook?.body?.secret_token === SECRET);
check("دکمهٔ منوی مینی‌اپ تنظیم شد", calls.some((c) => c.method === "setChatMenuButton"));

/* ---------- امنیت webhook ---------- */
console.log("\n-- امنیت webhook --");
const noSecret = await fetch(base + "/api/telegram", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message: { chat: { id: 1, type: "private" }, text: "/start" } })
});
check("پیام بدون رمز رد می‌شود (۴۰۱)", noSecret.status === 401);

const wrongSecret = await webhook({ message: { chat: { id: 1, type: "private" }, text: "/start" } }, { secret: "nope" });
check("پیام با رمز اشتباه رد می‌شود (۴۰۱)", wrongSecret.status === 401);

const getMethod = await fetch(base + "/api/telegram");
check("درخواست GET به webhook رد می‌شود (۴۰۵)", getMethod.status === 405);

/* ---------- ربات از راه webhook ---------- */
console.log("\n-- ربات با webhook --");
calls.length = 0;
const start = await webhook({
  update_id: 1,
  message: { message_id: 1, chat: { id: customer.id, type: "private" }, from: customer, text: "/start" }
});
check("پیام /start پذیرفته شد (۲۰۰)", start.status === 200);

const welcome = calls.find((c) => c.method === "sendMessage");
check("ربات به /start جواب داد", Boolean(welcome));
check("پیام خوش‌آمد دکمهٔ پنل دارد",
  JSON.stringify(welcome?.body?.reply_markup || {}).includes("ورود به پنل تبلیغات"));

/* ---------- ثبت‌نام ---------- */
console.log("\n-- ثبت‌نام --");
calls.length = 0;
const phone = await api("/api/register/phone", {
  method: "POST",
  body: JSON.stringify({ phone: "09121234567" })
});
const phoneBody = await phone.json();
check("درخواست کد پذیرفته شد", phone.status === 200 && phoneBody.codeSent === true,
  JSON.stringify(phoneBody).slice(0, 200));

const codeMsg = calls.find((c) => c.method === "sendMessage");
const code = String(codeMsg?.body?.text || "").match(/\d{5}/)?.[0];
check("کد ۵ رقمی به تلگرام کاربر فرستاده شد", Boolean(code), String(codeMsg?.body?.text).slice(0, 80));

const wrongCode = await api("/api/register/verify", {
  method: "POST",
  body: JSON.stringify({ code: code === "11111" ? "22222" : "11111" })
});
check("کد اشتباه رد می‌شود", wrongCode.status === 400);

const verify = await api("/api/register/verify", { method: "POST", body: JSON.stringify({ code }) });
const verifyBody = await verify.json();
check("کد درست پذیرفته شد", verify.status === 200 && verifyBody.profile?.phoneVerified === true,
  JSON.stringify(verifyBody).slice(0, 200));

calls.length = 0;
const profile = await api("/api/register/profile", {
  method: "POST",
  body: JSON.stringify({ firstName: "زهرا", lastName: "کریمی" })
});
const profileBody = await profile.json();
check("ثبت‌نام کامل شد", profile.status === 200 && profileBody.profile?.registered === true,
  JSON.stringify(profileBody).slice(0, 200));

await new Promise((r) => setTimeout(r, 300));
check("لید جدید به تیم اطلاع داده شد",
  calls.some((c) => c.method === "sendMessage" && String(c.body.chat_id) === "555000111"));

/* ---------- ثبت سفارش ---------- */
console.log("\n-- ثبت سفارش --");
calls.length = 0;
const order = await api("/api/campaigns", {
  method: "POST",
  body: JSON.stringify({
    adTitle: "کمپین تست Vercel",
    target: { type: "channel", url: "@lika_shop", brand: "لیکا شاپ" },
    creative: { text: "فروش ویژه لوازم جانبی موبایل با ۳۰٪ تخفیف — همین حالا کانال ما را ببینید." },
    targeting: { countries: ["IR"], languages: ["فارسی"], topics: ["shopping"], channels: [] },
    budget: { amountUsd: 50, cpmUsd: 1.5, startWhen: "asap" },
    notes: "تست Vercel"
  })
});
const orderBody = await order.json();
check("سفارش ثبت شد", order.status === 201, JSON.stringify(orderBody).slice(0, 300));

const campaignCode = orderBody.campaign?.id;
check("کد سفارش ساخته شد", /^LK-\d+$/.test(String(campaignCode)), String(campaignCode));
check("نام واقعی کانال از تلگرام گرفته شد",
  orderBody.campaign?.target?.channelTitle === "لیکا شاپ رسمی",
  String(orderBody.campaign?.target?.channelTitle));
check("تاریخچهٔ سفارش ساخته شد", orderBody.campaign?.history?.length === 1);
check("عنوان تبلیغ در Postgres ذخیره شد", orderBody.campaign?.adTitle === "کمپین تست Vercel",
  String(orderBody.campaign?.adTitle));

await new Promise((r) => setTimeout(r, 300));
const adminMsg = calls.find((c) => c.method === "sendMessage" && String(c.body.chat_id) === "555000111");
check("سفارش برای تیم فرستاده شد", Boolean(adminMsg));
check("پیام تیم دکمهٔ تغییر وضعیت دارد",
  JSON.stringify(adminMsg?.body?.reply_markup || {}).includes("st|"));

/* ---------- خواندن سفارش‌ها ---------- */
const list = await api("/api/campaigns");
const listBody = await list.json();
check("لیست سفارش‌ها از Postgres خوانده شد",
  list.status === 200 && listBody.campaigns?.length === 1,
  JSON.stringify(listBody).slice(0, 200));

const single = await api("/api/campaigns/" + campaignCode);
check("یک سفارش مشخص خوانده می‌شود", single.status === 200);

const other = makeInitData({ id: 881002, first_name: "دیگری" });
const foreign = await fetch(base + "/api/campaigns/" + campaignCode, {
  headers: { "X-Telegram-Init-Data": other }
});
check("سفارش کاربر دیگر دیده نمی‌شود (۴۰۴)", foreign.status === 404);

const me = await api("/api/me");
const meBody = await me.json();
check("GET /api/me کار می‌کند", me.status === 200 && meBody.summary?.total === 1,
  JSON.stringify(meBody.summary || {}));

/* ---------- تغییر وضعیت توسط تیم (دکمهٔ داخل تلگرام) ---------- */
console.log("\n-- تغییر وضعیت از داخل تلگرام --");
calls.length = 0;
const cb = await webhook({
  update_id: 2,
  callback_query: {
    id: "cb1",
    from: { id: 555000111, first_name: "مدیر" },
    message: { message_id: 5, chat: { id: 555000111 } },
    data: `st|${campaignCode}|approved`
  }
});
check("دکمهٔ تغییر وضعیت پذیرفته شد (۲۰۰)", cb.status === 200);

const after = await api("/api/campaigns/" + campaignCode);
const afterBody = await after.json();
check("وضعیت در Postgres عوض شد", afterBody.campaign?.status === "approved",
  String(afterBody.campaign?.status));
check("تاریخچه یک مرحله اضافه شد", afterBody.campaign?.history?.length === 2,
  String(afterBody.campaign?.history?.length));
check("به مشتری اطلاع داده شد",
  calls.some((c) => c.method === "sendMessage" && String(c.body.chat_id) === String(customer.id)));

/* ---------- غیرمدیر نباید بتواند وضعیت را عوض کند ---------- */
calls.length = 0;
await webhook({
  update_id: 3,
  callback_query: {
    id: "cb2",
    from: { id: 999999, first_name: "غریبه" },
    message: { message_id: 6, chat: { id: 999999 } },
    data: `st|${campaignCode}|done`
  }
});
const stillApproved = await api("/api/campaigns/" + campaignCode);
check("غیرمدیر نمی‌تواند وضعیت را عوض کند",
  (await stillApproved.json()).campaign?.status === "approved");

/* ---------- احراز هویت ---------- */
console.log("\n-- امنیت API --");
const noAuth = await fetch(base + "/api/me");
check("بدون initData رد می‌شود (۴۰۱)", noAuth.status === 401);

const oldData = makeInitData(customer, { authDate: Math.floor(Date.now() / 1000) - 90000 });
const expired = await fetch(base + "/api/me", { headers: { "X-Telegram-Init-Data": oldData } });
check("initData منقضی رد می‌شود (۴۰۱)", expired.status === 401);

/* ---------- ماندگاری واقعی داده ---------- */
console.log("\n-- ماندگاری داده --");
{
  const pg = (await import("pg")).default;
  const client = new pg.Client({ connectionString: PG_URL });
  await client.connect();
  const campaigns = await client.query("SELECT code, status FROM campaigns");
  const users = await client.query("SELECT id, phone, reg_first_name FROM users WHERE id = $1", [customer.id]);
  const events = await client.query("SELECT COUNT(*) AS n FROM campaign_events");
  await client.end();

  check("سفارش در جدول Postgres هست", campaigns.rows.length === 1 && campaigns.rows[0].code === campaignCode);
  check("وضعیت در Postgres ذخیره شده", campaigns.rows[0]?.status === "approved");
  check("کاربر و شماره‌اش در Postgres هست",
    users.rows[0]?.phone === "+989121234567" && users.rows[0]?.reg_first_name === "زهرا",
    JSON.stringify(users.rows[0] || {}));
  check("تاریخچهٔ وضعیت در Postgres هست", Number(events.rows[0].n) === 2, String(events.rows[0].n));
}

console.log(`\nنتیجه: ${pass} موفق، ${fail} ناموفق`);
if (fail) console.log("\n--- لاگ سرور ---\n" + log);

proc.kill("SIGTERM");
mock.close();
setTimeout(() => process.exit(fail ? 1 : 0), 500);
