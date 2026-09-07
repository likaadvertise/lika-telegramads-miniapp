/* تست کامل سرور: تلگرام تقلبی + سرور واقعی + درخواست‌های واقعی */
import http from "node:http";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.join(HERE, "..", "server");
const TMP = path.join(HERE, ".tmp");
fs.mkdirSync(TMP, { recursive: true });
const TOKEN = "1234567890:AAFakeTokenForLocalTestingOnly_0123456789";
/* ربات دوم — پنل مدیریت روی همین باز می‌شود */
const CRM_TOKEN = "9876543210:BBFakeCrmTokenForLocalTestingOnly_98765";
const MOCK_PORT = 8791;
const APP_PORT = 8792;

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  ✓", name); }
  else { fail++; console.log("  ✗", name, extra); }
};

/* ---------- ۱) تلگرام تقلبی ---------- */
const calls = [];
const pendingUpdates = [];
const mock = http.createServer((req, res) => {
  const method = req.url.split("/").pop();
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    // آپلود فایل (sendDocument) multipart است، نه JSON — پس نباید بترکد
    let parsed = {};
    if (body) { try { parsed = JSON.parse(body); } catch { parsed = { raw: body }; } }
    calls.push({ method, body: parsed, url: req.url });
    let result = true;
    if (method === "getMe") result = { id: 1234567890, username: "lika_test_bot", first_name: "Lika" };
    if (method === "getUpdates") {
      result = pendingUpdates.splice(0, pendingUpdates.length);
    }
    if (method === "sendMessage") result = { message_id: calls.length };
    if (method === "sendPhoto") {
      result = { message_id: calls.length, photo: [{ file_id: "POSTER_SMALL" }, { file_id: "POSTER_BIG" }] };
    }
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

/* ---------- دروازهٔ پیامک تقلبی ----------
   تا زیرساخت پیامک بدون داشتن پنل واقعی هم آزموده شود. */
const smsSent = [];
const SMS_PORT = 8793;
const smsGateway = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    smsSent.push({ url: req.url, body: body ? JSON.parse(body) : {} });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: 1 }));
  });
});
await new Promise((r) => smsGateway.listen(SMS_PORT, r));

/* ---------- ۲) محیط تست ---------- */
/*
   تست‌ها با هر دو دیتابیس اجرا می‌شوند:
     • بدون POSTGRES_URL → SQLite (حالت پیش‌فرض)
     • با POSTGRES_URL    → Postgres (همان چیزی که روی Vercel اجرا می‌شود)
   در هر دو حالت دیتابیس اول پاک می‌شود تا تست از صفر شروع کند.
*/
const PG_URL = process.env.POSTGRES_URL || process.env.DATABASE_URL || "";
const usingPostgres = Boolean(PG_URL);

const dbPath = path.join(TMP, "test-data/lika-test.db");
fs.rmSync(path.join(TMP, "test-data"), { recursive: true, force: true });

if (usingPostgres) {
  const pg = (await import("pg")).default;
  const admin = new pg.Client({ connectionString: PG_URL });
  await admin.connect();
  await admin.query("DROP TABLE IF EXISTS campaign_events, campaigns, phone_codes, users CASCADE");
  await admin.end();
  console.log("  (دیتابیس تست: Postgres)\n");
} else {
  console.log("  (دیتابیس تست: SQLite)\n");
}

const env = {
  ...process.env,
  BOT_TOKEN: TOKEN,
  CRM_BOT_TOKEN: CRM_TOKEN,
  WEBAPP_URL: `http://localhost:${APP_PORT}`,
  ADMIN_CHAT_ID: "555000111",
  ADMIN_IDS: "555000111",
  PORT: String(APP_PORT),
  DB_PATH: dbPath,
  BOT_API_BASE: `http://127.0.0.1:${MOCK_PORT}`,
  BOT_MODE: "polling",
  SERVE_WEBAPP: "1",
  ADMIN_USER: "lika", ADMIN_PASSWORD: "s3cret-panel-pass",
  NO_PROXY: "*", no_proxy: "*"
};

const proc = spawn("node", ["src/index.js"], { cwd: SERVER_DIR, env });
let log = "";
proc.stdout.on("data", (d) => (log += d));
proc.stderr.on("data", (d) => (log += d));

/* صبر تا سرور بالا بیاید */
const base = `http://127.0.0.1:${APP_PORT}`;
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(base + "/api/health");
    if (r.ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}

/* ---------- ۳) ساخت initData امضاشده ---------- */
function makeInitData(user, { badSignature = false, authDate = Math.floor(Date.now() / 1000) } = {}) {
  const params = { auth_date: String(authDate), query_id: "AAF_test", user: JSON.stringify(user) };
  const checkString = Object.entries(params).map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(TOKEN).digest();
  let hash = crypto.createHmac("sha256", secret).update(checkString).digest("hex");
  if (badSignature) hash = hash.replace(/^./, (c) => (c === "a" ? "b" : "a"));
  return new URLSearchParams({ ...params, hash }).toString();
}

const customer = { id: 777001, first_name: "علی", last_name: "رضایی", username: "ali_test", language_code: "fa" };
const initData = makeInitData(customer);

const api = (p, opts = {}) =>
  fetch(base + p, {
    ...opts,
    headers: { "Content-Type": "application/json", "X-Telegram-Init-Data": initData, ...(opts.headers || {}) }
  });

/** تاریخ میلادی n روز بعد، به شکل YYYY-MM-DD */
function futureDate(n) {
  const d = new Date(Date.now() + n * 86400000);
  return d.toISOString().slice(0, 10);
}

const goodCampaign = {
  adTitle: "کمپین آزمایشی پاییز",
  target: { type: "channel", url: "@lika_shop", brand: "لیکا شاپ" },
  creative: { text: "فروش ویژه لوازم جانبی موبایل با ۳۰٪ تخفیف — همین حالا کانال ما را ببینید." },
  targeting: {
    countries: ["IR", "AE"], languages: ["فارسی"], topics: ["shopping"],
    // تلگرام تبلیغ کانالی را روی کمتر از ۵ کانال اجرا نمی‌کند
    channels: Array.from({ length: 5 }, (_, i) => "@somechannel" + (i + 1))
  },
  /* تبلیغ کانالی حالا با بستهٔ آماده فروخته می‌شود، نه بودجهٔ دلاری */
  budget: { packageId: "ch50", startWhen: "date", startDate: futureDate(3) },
  notes: "توضیح تستی"
};

console.log("\n=== تست‌ها ===");

/* سلامت */
const health = await (await fetch(base + "/api/health")).json();
check("GET /api/health", health.ok === true);

/* بدون احراز هویت */
const noAuth = await fetch(base + "/api/campaigns");
check("بدون initData رد می‌شود (۴۰۱)", noAuth.status === 401);

/* امضای جعلی */
const badSig = await fetch(base + "/api/campaigns", {
  headers: { "X-Telegram-Init-Data": makeInitData(customer, { badSignature: true }) }
});
check("امضای جعلی رد می‌شود (۴۰۱)", badSig.status === 401);

/* initData قدیمی */
const old = await fetch(base + "/api/campaigns", {
  headers: { "X-Telegram-Init-Data": makeInitData(customer, { authDate: Math.floor(Date.now() / 1000) - 90000 }) }
});
check("initData منقضی رد می‌شود (۴۰۱)", old.status === 401);

/* ---------- سازگاری با نسخه‌های تازهٔ تلگرام ----------
   تلگرام حالا فیلد signature را هم می‌فرستد و بین نسخه‌های کلاینت،
   حساب شدن یا نشدنش در امضا فرق می‌کند. هر دو باید پذیرفته شوند —
   وگرنه مینی‌اپ روی گوشی واقعی با خطای ۴۰۱ می‌خوابد. */
function makeInitDataWithSignature(user, { signatureInHash }) {
  const params = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: "AAF_sig",
    user: JSON.stringify(user),
    signature: "Zm9vYmFyX3NpZ25hdHVyZV9leGFtcGxl"
  };
  const entries = Object.entries(params)
    .filter(([k]) => signatureInHash || k !== "signature");
  const checkString = entries.map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(TOKEN).digest();
  const hash = crypto.createHmac("sha256", secret).update(checkString).digest("hex");
  return new URLSearchParams({ ...params, hash }).toString();
}

for (const inHash of [false, true]) {
  const res = await fetch(base + "/api/me", {
    headers: { "X-Telegram-Init-Data": makeInitDataWithSignature(customer, { signatureInHash: inHash }) }
  });
  check(`امضا با فیلد signature پذیرفته می‌شود (${inHash ? "داخل" : "بیرون"} محاسبه)`,
    res.status === 200, String(res.status));
}

const forgedSig = await fetch(base + "/api/me", {
  headers: {
    "X-Telegram-Init-Data": makeInitDataWithSignature(customer, { signatureInHash: false })
      .replace(/hash=[0-9a-f]+/, "hash=" + "0".repeat(64))
  }
});
check("امضای جعلی با وجود signature همچنان رد می‌شود", forgedSig.status === 401, String(forgedSig.status));

/* ---------- ثبت‌نام ---------- */
const beforeReg = await api("/api/campaigns", { method: "POST", body: JSON.stringify({ campaign: goodCampaign }) });
check("سفارش بدون ثبت‌نام رد می‌شود (۴۰۳)", beforeReg.status === 403, String(beforeReg.status));

const badPhone = await api("/api/register/phone", { method: "POST", body: JSON.stringify({ phone: "12345" }) });
check("شمارهٔ نامعتبر رد می‌شود", badPhone.status === 400);

const sent = await api("/api/register/phone", { method: "POST", body: JSON.stringify({ phone: "۰۹۱۲۳۴۵۶۷۸۹" }) });
const sentJson = await sent.json();
check("درخواست کد با شمارهٔ فارسی پذیرفته شد", sent.status === 200 && sentJson.codeSent === true,
  JSON.stringify(sentJson).slice(0, 120));

const codeMsg = calls.filter((c) => c.method === "sendMessage" &&
  String(c.body.text || "").includes("کد تأیید شمارهٔ شما")).pop();
check("کد تأیید به تلگرام کاربر فرستاده شد", Boolean(codeMsg) && String(codeMsg.body.chat_id) === "777001");
const realCode = (String(codeMsg?.body.text).match(/<code>(\d{5})<\/code>/) || [])[1];
check("کد ۵ رقمی است", /^\d{5}$/.test(realCode || ""), realCode);

const resend = await api("/api/register/phone", { method: "POST", body: JSON.stringify({ phone: "09123456789" }) });
check("درخواست فوری کد دوباره رد می‌شود (۴۲۹)", resend.status === 429, String(resend.status));

const wrongCode = await api("/api/register/verify", { method: "POST", body: JSON.stringify({ code: "00000" }) });
check("کد اشتباه رد می‌شود", wrongCode.status === 400);

const noPhoneYet = await api("/api/register/profile", {
  method: "POST", body: JSON.stringify({ firstName: "علی", lastName: "رضایی" })
});
check("بدون تأیید شماره نمی‌توان نام ثبت کرد", noPhoneYet.status === 400);

const okCode = await api("/api/register/verify", { method: "POST", body: JSON.stringify({ code: realCode }) });
const okCodeJson = await okCode.json();
check("کد درست پذیرفته می‌شود", okCode.status === 200 && okCodeJson.profile?.phoneVerified === true);
check("شماره به شکل بین‌المللی ذخیره شد", okCodeJson.profile?.phone === "+989123456789", okCodeJson.profile?.phone);

const badName = await api("/api/register/profile", {
  method: "POST", body: JSON.stringify({ firstName: "ع", lastName: "رضایی" })
});
check("نام خیلی کوتاه رد می‌شود", badName.status === 400);

const badName2 = await api("/api/register/profile", {
  method: "POST", body: JSON.stringify({ firstName: "علی123", lastName: "رضایی" })
});
check("نام با عدد رد می‌شود", badName2.status === 400);

const badEmail = await api("/api/register/profile", {
  method: "POST", body: JSON.stringify({ firstName: "علی", lastName: "رضایی", email: "not-an-email" })
});
check("ایمیل نامعتبر رد می‌شود", badEmail.status === 400);

const done = await api("/api/register/profile", {
  method: "POST", body: JSON.stringify({ firstName: "علی", lastName: "رضایی" })
});
const doneJson = await done.json();
check("ثبت‌نام کامل شد", done.status === 200 && doneJson.profile?.registered === true);
check("بدون ایمیل هم ثبت‌نام کامل می‌شود", doneJson.profile?.email === "", doneJson.profile?.email);

const withEmail = await api("/api/register/profile", {
  method: "POST", body: JSON.stringify({ firstName: "علی", lastName: "رضایی", email: "Ali@Example.com" })
});
const withEmailJson = await withEmail.json();
check("ایمیل معتبر ذخیره می‌شود (با حروف کوچک)",
  withEmail.status === 200 && withEmailJson.profile?.email === "ali@example.com", withEmailJson.profile?.email);

await new Promise((r) => setTimeout(r, 400));
const leadMsg = calls.filter((c) => c.method === "sendMessage" &&
  String(c.body.chat_id) === "555000111" && String(c.body.text).includes("کاربر جدید"));
check("لید جدید به تیم اطلاع داده شد", leadMsg.length === 1, String(leadMsg.length));

/* همان شماره روی حساب تلگرام دیگر:
   نباید مسدود شود (کاربر واقعی به بن‌بست می‌خورد) ولی تیم باید بداند. */
const beforeReuse = calls.filter((c) => c.method === "sendMessage").length;
const otherUserInit = makeInitData({ id: 777003, first_name: "نیما" });
const dup = await fetch(base + "/api/register/phone", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Telegram-Init-Data": otherUserInit },
  body: JSON.stringify({ phone: "09123456789" })
});
check("همان شماره روی حساب دیگر مسدود نمی‌شود", dup.status === 200, String(dup.status));

await new Promise((r) => setTimeout(r, 400));
const reuseMsg = calls.slice(beforeReuse).find((c) =>
  c.method === "sendMessage" &&
  String(c.body.chat_id) === "555000111" &&
  String(c.body.text || "").includes("حساب دوم"));
check("تیم از ثبت شماره روی حساب دوم باخبر می‌شود", Boolean(reuseMsg));
check("پیام هر دو شناسه را می‌گوید",
  String(reuseMsg?.body?.text || "").includes("777003") &&
  String(reuseMsg?.body?.text || "").includes("777001"),
  String(reuseMsg?.body?.text || "").slice(0, 200));

/* ---------- نام و عکس مقصد برای پیش‌نمایش ---------- */
const chatOk = await (await api("/api/chat?u=%40lika_shop")).json();
check("نام کانال از تلگرام گرفته می‌شود", chatOk.ok === true && chatOk.title === "لیکا شاپ رسمی",
  JSON.stringify(chatOk).slice(0, 120));
check("وجود عکس کانال گزارش می‌شود", chatOk.hasPhoto === true);

const chatBad = await api("/api/chat?u=%40no_such_channel_here");
check("کانال ناموجود ۴۰۴ می‌دهد", chatBad.status === 404, String(chatBad.status));

const chatJunk = await api("/api/chat?u=hello%20world");
check("آدرس بی‌ربط رد می‌شود", chatJunk.status === 404);

const meAfter = await (await api("/api/me")).json();
check("GET /api/me پروفایل را برمی‌گرداند", meAfter.profile?.registered === true && meAfter.requireCode === true);

/* ثبت سفارش */
const created = await api("/api/campaigns", { method: "POST", body: JSON.stringify({ campaign: goodCampaign }) });
const createdJson = await created.json();
check("ثبت سفارش (۲۰۱)", created.status === 201, JSON.stringify(createdJson).slice(0, 200));
check("کد سفارش ساخته شد", /^LK-\d+$/.test(createdJson.campaign?.id || ""), createdJson.campaign?.id);
check("وضعیت اولیه pending است", createdJson.campaign?.status === "pending");
check("آرایه‌ها درست ذخیره شدند", createdJson.campaign?.targeting?.countries?.join() === "IR,AE");
check("نام واقعی کانال کنار سفارش ذخیره شد",
  createdJson.campaign?.target?.channelTitle === "لیکا شاپ رسمی",
  createdJson.campaign?.target?.channelTitle);

/* ---------- بستهٔ آماده و قیمت ---------- */
check("بسته ذخیره شد", createdJson.campaign?.budget?.packageId === "ch50",
  String(createdJson.campaign?.budget?.packageId));
check("قیمت بسته از فهرست سرور آمد", createdJson.campaign?.budget?.priceToman === 7500000,
  String(createdJson.campaign?.budget?.priceToman));
check("تعداد بازدید بسته ذخیره شد", createdJson.campaign?.budget?.packageViews === 50000,
  String(createdJson.campaign?.budget?.packageViews));

/* ---------- عنوان تبلیغ ---------- */
check("عنوان تبلیغ ذخیره شد", createdJson.campaign?.adTitle === "کمپین آزمایشی پاییز",
  String(createdJson.campaign?.adTitle));

const noTitle = await api("/api/campaigns", {
  method: "POST",
  body: JSON.stringify({ ...goodCampaign, adTitle: "" })
});
check("رد می‌شود: بدون عنوان تبلیغ", noTitle.status === 400, String(noTitle.status));


check("عنوان تبلیغ در پیام تیم هست",
  calls.some((c) => c.method === "sendMessage" && String(c.body.text || "").includes("کمپین آزمایشی پاییز")));

/* اعتبارسنجی سرور */
const bad = [
  [{ ...goodCampaign, budget: { ...goodCampaign.budget, packageId: "" } }, "بدون انتخاب بسته"],
  [{ ...goodCampaign, budget: { ...goodCampaign.budget, packageId: "ch999" } }, "بستهٔ ناشناخته"],
  [{ ...goodCampaign, target: { ...goodCampaign.target, url: "https://example.com" } }, "لینک غیرتلگرامی"],
  [{ ...goodCampaign, creative: { text: "x".repeat(300) } }, "متن بیش از ۱۶۰ کاراکتر"],
  [{ ...goodCampaign, targeting: { ...goodCampaign.targeting, channels: ["@a", "@b"] } }, "کمتر از ۱۰ کانال"]
];
for (const [payload, name] of bad) {
  const r = await api("/api/campaigns", { method: "POST", body: JSON.stringify({ campaign: payload }) });
  check("رد می‌شود: " + name, r.status === 400, String(r.status));
}


/* لیست و جزئیات */
const list = await (await api("/api/campaigns")).json();
check("لیست فقط ۱ سفارش دارد", list.campaigns?.length === 1, String(list.campaigns?.length));

const code = createdJson.campaign.id;
const one = await (await api("/api/campaigns/" + code)).json();
check("دریافت یک کمپین", one.campaign?.id === code);

/* کمپین کاربر دیگر نباید دیده شود */
const otherInit = makeInitData({ id: 777002, first_name: "سارا" });
const stolen = await fetch(base + "/api/campaigns/" + code, { headers: { "X-Telegram-Init-Data": otherInit } });
check("کمپین کاربر دیگر دیده نمی‌شود (۴۰۴)", stolen.status === 404);

/* me */
const me = await (await api("/api/me")).json();
check("GET /api/me", me.user?.id === 777001 && me.summary?.total === 1);

/* مهم‌ترین بررسی این بخش: مشتری نتواند قیمت خودش را تحمیل کند.
   اگر روزی قیمت از روی درخواست خوانده شود، همین تست می‌افتد. */
const cheatRes = await api("/api/campaigns", {
  method: "POST",
  body: JSON.stringify({
    campaign: {
      ...goodCampaign,
      budget: { packageId: "ch200", startWhen: "date", startDate: futureDate(3), priceToman: 1000, amountUsd: 1, cpmUsd: 0.5 }
    }
  })
});
const cheatJson = await cheatRes.json().catch(() => ({}));
check("قیمت دست‌کاری‌شدهٔ مشتری نادیده گرفته می‌شود",
  cheatJson.campaign?.budget?.priceToman === 28000000,
  String(cheatJson.campaign?.budget?.priceToman));


/* ---------- تبلیغ نوع «جستجو» ----------
   در فرم واقعی Telegram Ads تب Search کادر «متن تبلیغ» ندارد و به‌جایش
   «Target search queries» می‌گیرد. پس قواعد این نوع با بقیه فرق دارد. */
const searchCampaign = {
  adTitle: "کمپین جستجوی لپ‌تاپ",
  target: { type: "search", url: "@lika_shop", brand: "لیکا شاپ" },
  creative: { text: "" },
  targeting: {
    countries: ["IR"], languages: [], topics: [], channels: [],
    keywords: ["خرید لپ تاپ", "لپ تاپ گیمینگ"]
  },
  budget: { packageId: "sr50", startWhen: "date", startDate: futureDate(4) },
  notes: ""
};

/* فعلاً فقط تبلیغ کانال فروخته می‌شود؛ ربات و جستجو بسته ندارند.
   سفارششان باید صریح رد شود، نه اینکه ثبت شود و بعد معلوم نباشد
   قیمتش چیست. */
const searchRes = await api("/api/campaigns", {
  method: "POST",
  body: JSON.stringify({ campaign: searchCampaign })
});
const searchJson = await searchRes.json().catch(() => ({}));
check("تبلیغ جستجو فعلاً پذیرفته نمی‌شود", searchRes.status === 400, String(searchRes.status));
check("و دلیلش را می‌گوید", String(searchJson.error || "").includes("بستهٔ آماده"),
  String(searchJson.error || ""));

const botRes = await api("/api/campaigns", {
  method: "POST",
  body: JSON.stringify({
    campaign: { ...goodCampaign, adTitle: "تبلیغ ربات", target: { ...goodCampaign.target, type: "bot" } }
  })
});
check("تبلیغ ربات هم پذیرفته نمی‌شود", botRes.status === 400, String(botRes.status));

/* قواعد کلیدواژه پیش از قیمت بررسی می‌شوند، پس هنوز پیام خودشان را دارند */
const noKeywords = await api("/api/campaigns", {
  method: "POST",
  body: JSON.stringify({
    campaign: { ...searchCampaign, targeting: { ...searchCampaign.targeting, keywords: [] } }
  })
});
const noKwJson = await noKeywords.json().catch(() => ({}));
check("رد می‌شود: تبلیغ جستجو بدون کلیدواژه",
  noKeywords.status === 400 && String(noKwJson.error || "").includes("کلیدواژه"),
  String(noKwJson.error || ""));

/* متن همچنان برای تبلیغ کانال اجباری است */
const channelNoText = await api("/api/campaigns", {
  method: "POST",
  body: JSON.stringify({ campaign: { ...goodCampaign, creative: { text: "" } } })
});
check("رد می‌شود: تبلیغ کانال بدون متن", channelNoText.status === 400, String(channelNoText.status));


/* ---------- پوستر تبلیغ ----------
   عکس در دیتابیس ما ذخیره نمی‌شود؛ به چت تیم می‌رود و فقط شناسه‌اش
   می‌ماند. پس اینجا می‌سنجیم که واقعاً به تلگرام فرستاده شده باشد. */
const tinyJpeg = "data:image/jpeg;base64," + Buffer.from(
  "ffd8ffe000104a46494600010100000100010000ffdb00430001010101010101010101010101010101" +
  "0101010101010101010101010101010101010101010101010101010101010101010101010101010101" +
  "0101010101010101ffc00011080009001001011100021101031101ffc4001f00000105010101010101" +
  "00000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01" +
  "020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718" +
  "191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a7374" +
  "75767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9ba" +
  "c2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffda00" +
  "08010100003f00fbfea28a28a28a28a28a28a2803ffd9", "hex"
).toString("base64");

const withPoster = await api("/api/campaigns", {
  method: "POST",
  body: JSON.stringify({
    campaign: {
      ...goodCampaign,
      adTitle: "کمپین با پوستر",
      creative: { ...goodCampaign.creative, poster: tinyJpeg }
    }
  })
});
const posterJson = await withPoster.json().catch(() => ({}));
check("سفارش با پوستر پذیرفته می‌شود", withPoster.status === 201,
  withPoster.status + " " + JSON.stringify(posterJson).slice(0, 160));

await new Promise((r) => setTimeout(r, 600));
check("پوستر به تلگرام فرستاده شد",
  calls.some((c) => c.method === "sendPhoto"),
  calls.map((c) => c.method).slice(-6).join(", "));

/* پوستر خراب نباید سفارش را خراب کند، ولی باید صریح رد شود */
const badPoster = await api("/api/campaigns", {
  method: "POST",
  body: JSON.stringify({
    campaign: {
      ...goodCampaign,
      adTitle: "پوستر خراب",
      creative: { ...goodCampaign.creative, poster: "data:text/html;base64,PHNjcmlwdD4=" }
    }
  })
});
check("فایل غیرعکس به‌عنوان پوستر رد می‌شود", badPoster.status === 400, String(badPoster.status));

/* ---------- حدهای شمارشی ----------
   هر دو از قواعد خود تلگرام می‌آیند: سقف ۱۰ کلیدواژه برای تبلیغ جستجو،
   و حداقل ۱۰ کانال برای تبلیغ کانالی. */
const tooManyKeywords = await api("/api/campaigns", {
  method: "POST",
  body: JSON.stringify({
    campaign: {
      ...searchCampaign,
      targeting: {
        ...searchCampaign.targeting,
        keywords: Array.from({ length: 11 }, (_, i) => "کلیدواژه " + (i + 1))
      }
    }
  })
});
check("رد می‌شود: بیش از ۱۰ کلیدواژه", tooManyKeywords.status === 400, String(tooManyKeywords.status));

const tenKeywords = await api("/api/campaigns", {
  method: "POST",
  body: JSON.stringify({
    campaign: {
      ...searchCampaign,
      adTitle: "جستجو با ۱۰ کلیدواژه",
      targeting: {
        ...searchCampaign.targeting,
        keywords: Array.from({ length: 10 }, (_, i) => "کلیدواژه " + (i + 1))
      }
    }
  })
});
/* ۱۰ کلیدواژه از نظر قاعده درست است؛ چیزی که جلویش را می‌گیرد
   نبودِ بسته برای تبلیغ جستجوست، نه تعداد کلیدواژه */
const tenKwJson = await tenKeywords.json().catch(() => ({}));
check("۱۰ کلیدواژه از نظر تعداد ایراد ندارد",
  !String(tenKwJson.error || "").includes("کلیدواژه"), String(tenKwJson.error || ""));

const fewChannels = await api("/api/campaigns", {
  method: "POST",
  body: JSON.stringify({
    campaign: {
      ...goodCampaign,
      targeting: { ...goodCampaign.targeting, channels: ["@one", "@two", "@three"] }
    }
  })
});
check("رد می‌شود: کمتر از ۵ کانال", fewChannels.status === 400, String(fewChannels.status));

/* فهرست خالی ایراد ندارد — یعنی کارشناس لیکا خودش کانال‌ها را می‌چیند */
const noChannels = await api("/api/campaigns", {
  method: "POST",
  body: JSON.stringify({
    campaign: {
      ...goodCampaign,
      adTitle: "کمپین بدون کانال دستی",
      targeting: { ...goodCampaign.targeting, channels: [] }
    }
  })
});
check("بدون کانال دستی پذیرفته می‌شود (کارشناس می‌چیند)",
  noChannels.status === 201, String(noChannels.status));

/* کشور، زبان و موضوع از فرم حذف شدند چون تلگرام در هیچ تبی کادری برایشان
   ندارد. سرور نباید نبودشان را ایراد بگیرد، وگرنه فرم تازه کار نمی‌کند. */
const noBrief = await api("/api/campaigns", {
  method: "POST",
  body: JSON.stringify({
    campaign: {
      ...goodCampaign,
      adTitle: "کمپین بدون کشور و موضوع",
      targeting: { channels: goodCampaign.targeting.channels }
    }
  })
});
check("بدون کشور/زبان/موضوع پذیرفته می‌شود", noBrief.status === 201, String(noBrief.status));

/* ---------- عکس پروفایل کانال ----------
   مرورگر عکس را با تگ <img> می‌گیرد و روی چنین درخواستی نمی‌تواند هدر
   بگذارد. پس این مسیر باید بدون احراز هویت هم جواب بدهد، وگرنه عکس
   هیچ‌وقت در مینی‌اپ دیده نمی‌شود. */
const photoNoHeader = await fetch(base + "/api/chat-photo?u=@lika_shop");
check("عکس کانال بدون هدر احراز هویت هم می‌آید",
  photoNoHeader.status === 200, String(photoNoHeader.status));
check("و واقعاً بدنهٔ تصویر دارد",
  Number(photoNoHeader.headers.get("content-length")) > 0,
  String(photoNoHeader.headers.get("content-length")));

const photoMissing = await fetch(base + "/api/chat-photo?u=@no_such_channel_here");
check("کانال ناموجود ۴۰۴ می‌دهد نه ۴۰۱", photoMissing.status === 404, String(photoMissing.status));

/* ---------- پنل مدیریت ----------
   هویت از همان امضای تلگرام می‌آید، پس رمز جداگانه‌ای در کار نیست.
   مهم‌ترین چیزی که باید ثابت شود: مشتری عادی نباید بتواند شمارهٔ
   بقیه را ببیند. */
const notAdmin = await api("/api/admin/users");
check("مشتری عادی به پنل مدیریت راه ندارد (۴۰۳)", notAdmin.status === 403, String(notAdmin.status));

const adminUser = { id: 555000111, first_name: "مدیر", username: "lika_admin", language_code: "fa" };
const adminInit = makeInitData(adminUser);
const adminApi = (p, opts = {}) =>
  fetch(base + p, {
    ...opts,
    headers: { "Content-Type": "application/json", "X-Telegram-Init-Data": adminInit, ...(opts.headers || {}) }
  });

const au = await adminApi("/api/admin/users");
const auJson = await au.json().catch(() => ({}));
check("مدیر لیست مشتری‌ها را می‌بیند", au.status === 200, String(au.status));
check("شمارهٔ مشتری در لیست هست",
  (auJson.users || []).some((u) => u.phone === "+989123456789"),
  JSON.stringify(auJson.users || []).slice(0, 200));
check("تعداد سفارش هر مشتری شمرده می‌شود",
  (auJson.users || []).some((u) => Number(u.orders) > 0),
  JSON.stringify((auJson.users || []).map((u) => u.orders)));

const ac = await adminApi("/api/admin/campaigns");
const acJson = await ac.json().catch(() => ({}));
check("مدیر همهٔ سفارش‌ها را می‌بیند — نه فقط مال خودش",
  (acJson.campaigns || []).length > 1, String((acJson.campaigns || []).length));

/* کاربری که هنوز ثبت‌نام نکرده نباید در لیست مشتری‌ها بیاید */
check("فقط کاربران ثبت‌نام‌کرده در لیست‌اند",
  (auJson.users || []).every((u) => u.registeredAt),
  JSON.stringify((auJson.users || []).map((u) => u.registeredAt)));

/* خروجی اکسل: فایل باید در تلگرام خودِ مدیر فرستاده شود */
const exp = await adminApi("/api/admin/export", { method: "POST", body: "{}" });
check("خروجی اکسل برای مدیر کار می‌کند", exp.status === 200, String(exp.status));
await new Promise((r) => setTimeout(r, 400));
const doc = calls.filter((c) => c.method === "sendDocument").pop();
check("فایل واقعاً در تلگرام فرستاده شد", Boolean(doc));

const expDenied = await api("/api/admin/export", { method: "POST", body: "{}" });
check("مشتری عادی نمی‌تواند خروجی بگیرد", expDenied.status === 403, String(expDenied.status));

/* ---------- ربات دوم (CRM) ----------
   پنل مدیریت روی ربات جداست، و تلگرام امضای initData را با توکنِ همان
   ربات می‌زند. اگر سرور فقط توکن ربات اول را بشناسد، مدیر پشت خطای
   ۴۰۱ می‌ماند و پنل هیچ‌وقت باز نمی‌شود. */
function makeCrmInitData(user) {
  const params = { auth_date: String(Math.floor(Date.now() / 1000)), query_id: "AAF_crm", user: JSON.stringify(user) };
  const checkString = Object.entries(params).map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(CRM_TOKEN).digest();
  const hash = crypto.createHmac("sha256", secret).update(checkString).digest("hex");
  return new URLSearchParams({ ...params, hash }).toString();
}

const crmInit = makeCrmInitData(adminUser);
const viaCrm = await fetch(base + "/api/admin/users", {
  headers: { "X-Telegram-Init-Data": crmInit }
});
check("مدیر از راه ربات دوم هم شناخته می‌شود", viaCrm.status === 200, String(viaCrm.status));

/* و امضای ربات اول همچنان کار می‌کند — دومی جای اولی را نگرفته */
const viaMain = await adminApi("/api/admin/users");
check("امضای ربات اول هنوز معتبر است", viaMain.status === 200, String(viaMain.status));

/* امضای جعلی با توکنی که مال ما نیست، همچنان رد می‌شود */
const fakeSecret = crypto.createHmac("sha256", "WebAppData").update("111:NOT_OUR_TOKEN_AT_ALL_0123456789012").digest();
const fp = { auth_date: String(Math.floor(Date.now() / 1000)), query_id: "AAF_x", user: JSON.stringify(adminUser) };
const fcs = Object.entries(fp).map(([k, v]) => `${k}=${v}`).sort().join("\n");
const fakeInit = new URLSearchParams({
  ...fp, hash: crypto.createHmac("sha256", fakeSecret).update(fcs).digest("hex")
}).toString();
const viaFake = await fetch(base + "/api/admin/users", { headers: { "X-Telegram-Init-Data": fakeInit } });
check("امضای رباتِ غریبه رد می‌شود", viaFake.status === 401, String(viaFake.status));

/* فایل خروجی باید از همان رباتی برود که مدیر از آن وارد شده */
const expCrm = await fetch(base + "/api/admin/export", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Telegram-Init-Data": crmInit },
  body: "{}"
});
check("خروجی از راه ربات دوم هم کار می‌کند", expCrm.status === 200, String(expCrm.status));
await new Promise((r) => setTimeout(r, 400));
check("فایل با توکن ربات دوم فرستاده شد",
  calls.some((c) => c.method === "sendDocument" && String(c.url || "").includes(CRM_TOKEN)),
  calls.filter((c) => c.method === "sendDocument").map((c) => c.url).join(" | "));

await new Promise((r) => setTimeout(r, 600));
const briefMsg = calls.filter((c) => c.method === "sendMessage" &&
  String(c.body.text || "").includes("کمپین بدون کشور و موضوع")).pop();
check("پیام تیم خط خالی «کشورها» چاپ نمی‌کند",
  !String(briefMsg?.body.text || "").includes("کشورها:"),
  String(briefMsg?.body.text || "").slice(0, 250));
check("پیام تیم می‌گوید کانال‌ها را چه کسی انتخاب کرده",
  String(briefMsg?.body.text || "").includes("کانال‌های هدف:"));

/* عنوان بلندتر از حد مجاز باید بریده شود، نه اینکه سفارش رد شود.
   عمداً اینجاست چون یک سفارش تازه می‌سازد و شمارش‌های بالا را جابه‌جا می‌کند. */
const longTitle = await api("/api/campaigns", {
  method: "POST",
  body: JSON.stringify({ ...goodCampaign, adTitle: "ت".repeat(60) })
});
const longTitleBody = await longTitle.json();
check("عنوان بلند بریده می‌شود نه رد",
  longTitle.status === 201 && longTitleBody.campaign?.adTitle?.length === 40,
  String(longTitleBody.campaign?.adTitle?.length));

/* اعلان‌ها */
await new Promise((r) => setTimeout(r, 600));
const sends = calls.filter((c) => c.method === "sendMessage");
check("اعلان سفارش به تیم ارسال شد",
  sends.some((c) => String(c.body.chat_id) === "555000111" && String(c.body.text).includes("سفارش جدید")));
check("تأیید سفارش به مشتری ارسال شد",
  sends.some((c) => String(c.body.chat_id) === "777001" && String(c.body.text).includes("سفارش شما با کد")));
check("پیام تأیید کوتاه است و بودجهٔ دلاری ندارد",
  !sends.some((c) => String(c.body.chat_id) === "777001" && String(c.body.text).includes("دلار")));
check("پیام تأیید دکمهٔ پشتیبانی دارد",
  sends.some((c) => String(c.body.chat_id) === "777001" &&
    JSON.stringify(c.body.reply_markup || {}).includes("likaadvertise_crm")));
check("پیام تیم دکمهٔ تغییر وضعیت دارد",
  sends.some((c) => JSON.stringify(c.body.reply_markup || {}).includes("st|" + code)));
check("پیام تیم هم بودجهٔ دلاری ندارد",
  !sends.some((c) => String(c.body.chat_id) === "555000111" && String(c.body.text).includes("دلار")));

/* راه‌اندازی ربات */
check("getMe فراخوانی شد", calls.some((c) => c.method === "getMe"));
check("دکمهٔ منوی مینی‌اپ تنظیم شد", calls.some((c) => c.method === "setChatMenuButton"));
check("دستورهای ربات ثبت شد", calls.some((c) => c.method === "setMyCommands"));

/* دستور /start از طریق polling واقعی */
const startMark = calls.length;
pendingUpdates.push({
  update_id: 1,
  message: {
    message_id: 1,
    date: Math.floor(Date.now() / 1000),
    chat: { id: 777001, type: "private" },
    from: customer,
    text: "/start"
  }
});
await new Promise((r) => setTimeout(r, 2500));
const startMsgs = calls.slice(startMark).filter((c) => c.method === "sendMessage" && String(c.body.chat_id) === "777001");
const kb = startMsgs.find((c) => c.body.reply_markup?.keyboard);
check("دستور /start صفحه‌کلید همیشگی می‌فرستد", Boolean(kb));
check("دکمهٔ «پنل تبلیغات» مینی‌اپ را باز می‌کند",
  kb?.body.reply_markup.keyboard?.[0]?.[0]?.web_app?.url === `http://localhost:${APP_PORT}`,
  JSON.stringify(kb?.body.reply_markup?.keyboard?.[0]));
/* ردیف اول فقط دکمهٔ پنل؛ ردیف دوم پشتیبانی و کانال کنار هم */
check("صفحه‌کلید سه دکمه در دو ردیف دارد",
  kb?.body.reply_markup.keyboard?.length === 2 &&
  kb?.body.reply_markup.keyboard[0].length === 1 &&
  kb?.body.reply_markup.keyboard[1].length === 2,
  JSON.stringify(kb?.body.reply_markup?.keyboard));
check("دکمهٔ پشتیبانی و کانال هم هستند",
  kb?.body.reply_markup.keyboard?.[1]?.[0]?.text === "ارتباط با پشتیبانی" &&
  kb?.body.reply_markup.keyboard?.[1]?.[1]?.text === "کانال ما",
  JSON.stringify(kb?.body.reply_markup?.keyboard?.[1]));
check("پیام خوش‌آمد کوتاه است", (startMsgs[0]?.body.text || "").split("\n").length <= 7,
  String((startMsgs[0]?.body.text || "").split("\n").length));
check("پیام خوش‌آمد یک پیام است، نه دوتا", startMsgs.length === 1, String(startMsgs.length));
check("متن دکمه «ورود به پنل تبلیغات» است",
  kb?.body.reply_markup.keyboard?.[0]?.[0]?.text === "ورود به پنل تبلیغات",
  kb?.body.reply_markup.keyboard?.[0]?.[0]?.text);
check("صفحه‌کلید همیشگی است",
  kb?.body.reply_markup.is_persistent === true && kb?.body.reply_markup.resize_keyboard === true);

/* زدن دکمهٔ «ارتباط با پشتیبانی» — باید لینک مستقیم چت پشتیبانی بیاید */
const supportMark = calls.length;
pendingUpdates.push({
  update_id: 2,
  message: {
    message_id: 2, date: Math.floor(Date.now() / 1000),
    chat: { id: 777001, type: "private" }, from: customer,
    text: "ارتباط با پشتیبانی"
  }
});
await new Promise((r) => setTimeout(r, 2000));
const supportMsg = calls.slice(supportMark).find((c) => c.method === "sendMessage" && String(c.body.chat_id) === "777001");
check("دکمهٔ پشتیبانی لینک چت پشتیبانی را می‌فرستد",
  supportMsg?.body.reply_markup?.inline_keyboard?.[0]?.[0]?.url === "https://t.me/likaadvertise_crm",
  JSON.stringify(supportMsg?.body.reply_markup));

/* زدن دکمهٔ «کانال ما» — باید لینک کانال بیاید */
const channelMark = calls.length;
pendingUpdates.push({
  update_id: 3,
  message: {
    message_id: 3, date: Math.floor(Date.now() / 1000),
    chat: { id: 777001, type: "private" }, from: customer,
    text: "کانال ما"
  }
});
await new Promise((r) => setTimeout(r, 2000));
const channelMsg = calls.slice(channelMark).find((c) => c.method === "sendMessage" && String(c.body.chat_id) === "777001");
check("دکمهٔ کانال لینک کانال را می‌فرستد",
  channelMsg?.body.reply_markup?.inline_keyboard?.[0]?.[0]?.url === "https://t.me/likaads_channel",
  JSON.stringify(channelMsg?.body.reply_markup));

/* سرو شدن مینی‌اپ */
const page = await fetch(base + "/");
const html = await page.text();
check("مینی‌اپ سرو می‌شود", page.status === 200 && html.includes("Lika Ads"));
const css = await fetch(base + "/assets/css/app.css");
check("فایل CSS سرو می‌شود", css.status === 200);
const traversal = await fetch(base + "/../server/.env.example");
check("خروج از پوشهٔ web ممکن نیست", traversal.status === 404 || traversal.status === 403, String(traversal.status));

/* ---------- زیرساخت پیامک ----------
   پنل واقعی نداریم، ولی مسیر باید همین حالا آزموده شود: وقتی
   SMS_PROVIDER تنظیم شود، کد باید به‌جای تلگرام به دروازهٔ پیامک برود.
   یک سرور جداگانه با همان تنظیمات، ولی این بار با پیامک، بالا می‌آوریم. */
{
  const smsPort = 8794;
  const smsProc = spawn("node", ["src/index.js"], {
    cwd: SERVER_DIR,
    env: {
      ...env,
      PORT: String(smsPort),
      DB_PATH: path.join(TMP, "sms-data/lika.db"),
      SMS_PROVIDER: "custom",
      SMS_API_KEY: "fake-key",
      SMS_BASE_URL: `http://127.0.0.1:${SMS_PORT}/send`,
      SMS_BODY: '{"to":"{phone}","text":"code {code}"}'
    }
  });
  fs.rmSync(path.join(TMP, "sms-data"), { recursive: true, force: true });

  const smsBase = `http://127.0.0.1:${smsPort}`;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(smsBase + "/api/health")).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }

  const smsUser = { id: 777444, first_name: "نگار", language_code: "fa" };
  const before = calls.filter((c) => c.method === "sendMessage").length;

  const res = await fetch(smsBase + "/api/register/phone", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Telegram-Init-Data": makeInitData(smsUser) },
    body: JSON.stringify({ phone: "09121234567" })
  });
  const bodyJson = await res.json();

  check("با پنل پیامکی، کد پیامک می‌شود", res.status === 200 && bodyJson.sentBy === "sms",
    JSON.stringify(bodyJson).slice(0, 160));
  check("دروازهٔ پیامک صدا زده شد", smsSent.length === 1, String(smsSent.length));
  check("شماره به شکل ۰۹… به پنل می‌رود", smsSent[0]?.body?.to === "09121234567",
    String(smsSent[0]?.body?.to));
  check("کد ۵ رقمی داخل متن پیامک هست", /code \d{5}/.test(smsSent[0]?.body?.text || ""),
    String(smsSent[0]?.body?.text));
  check("وقتی پیامک روشن است، کد به تلگرام نمی‌رود",
    calls.filter((c) => c.method === "sendMessage").length === before);

  smsProc.kill("SIGTERM");
}

/* ---------- اعتبارسنجی WEBHOOK_SECRET ---------- */
/*
   تلگرام برای secret_token فقط حروف انگلیسی، عدد، - و _ را می‌پذیرد.
   اگر خودمان جلویش را نگیریم، کاربر خطای انگلیسی خام تلگرام را می‌بیند.
*/
async function configErrors(extraEnv) {
  const { execFileSync } = await import("node:child_process");
  const out = execFileSync(
    "node",
    ["-e", "import('./src/config.js').then(m => console.log(JSON.stringify(m.checkConfig().errors)))"],
    { cwd: SERVER_DIR, env: { ...env, ...extraEnv }, encoding: "utf8" }
  );
  return JSON.parse(out.trim().split("\n").pop());
}

const badSecret = await configErrors({ BOT_MODE: "webhook", WEBHOOK_SECRET: "پسورد.من!" });
check("رمز webhook با کاراکتر غیرمجاز رد می‌شود",
  badSecret.some((e) => e.includes("WEBHOOK_SECRET") && e.includes("غیرمجاز")),
  JSON.stringify(badSecret));

const goodSecret = await configErrors({ BOT_MODE: "webhook", WEBHOOK_SECRET: "lika_ads-Secret123" });
check("رمز webhook سالم پذیرفته می‌شود",
  !goodSecret.some((e) => e.includes("WEBHOOK_SECRET")),
  JSON.stringify(goodSecret));

/* دیتابیس ماندگار است */
if (usingPostgres) {
  const pg = (await import("pg")).default;
  const client = new pg.Client({ connectionString: PG_URL });
  await client.connect();
  const { rows } = await client.query("SELECT COUNT(*) AS n FROM campaigns");
  await client.end();
  check("سفارش‌ها در Postgres ذخیره شدند", Number(rows[0].n) > 0, `تعداد=${rows[0].n}`);
} else {
  /* ---------- ورود به پنل از راه وب ---------- */
console.log("\n--- پنل وب ---");

const noToken = await fetch(base + "/api/admin/campaigns");
check("پنل بدون بلیت باز نمی‌شود (۴۰۱)", noToken.status === 401, String(noToken.status));

const badLogin = await fetch(base + "/api/admin/login", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "lika", password: "غلط" })
});
check("رمز اشتباه رد می‌شود (۴۰۱)", badLogin.status === 401, String(badLogin.status));

const okLogin = await fetch(base + "/api/admin/login", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "lika", password: "s3cret-panel-pass" })
});
const loginJson = await okLogin.json().catch(() => ({}));
check("ورود با رمز درست انجام می‌شود", okLogin.status === 200 && Boolean(loginJson.token),
  JSON.stringify(loginJson).slice(0, 120));

const withToken = await fetch(base + "/api/admin/campaigns", {
  headers: { Authorization: "Bearer " + loginJson.token }
});
const tokenJson = await withToken.json().catch(() => ({}));
check("با بلیت، سفارش‌ها خوانده می‌شوند",
  withToken.status === 200 && Array.isArray(tokenJson.campaigns),
  String(withToken.status));

/* دست‌کاری بلیت نباید کار کند */
const tampered = loginJson.token.replace(/.$/, (ch) => (ch === "A" ? "B" : "A"));
const withBad = await fetch(base + "/api/admin/campaigns", {
  headers: { Authorization: "Bearer " + tampered }
});
check("بلیت دست‌کاری‌شده رد می‌شود", withBad.status === 401, String(withBad.status));

/* خروجی اکسل در پنل وب باید خودِ فایل باشد، نه پیام تلگرام */
const csv = await fetch(base + "/api/admin/export", {
  method: "POST",
  headers: { Authorization: "Bearer " + loginJson.token, "Content-Type": "application/json" },
  body: "{}"
});
check("خروجی اکسل در وب دانلود می‌شود",
  csv.status === 200 && (csv.headers.get("content-type") || "").includes("text/csv"),
  csv.status + " " + csv.headers.get("content-type"));
check("نام فایل پیشنهاد می‌شود",
  (csv.headers.get("content-disposition") || "").includes("lika-orders"));

/* مشتری عادی با بلیت جعلی نتواند وارد شود */
const fakeToken = await fetch(base + "/api/admin/users", {
  headers: { Authorization: "Bearer " + Buffer.from('{"u":"lika","exp":99999999999}').toString("base64url") + ".xxx" }
});
check("بلیت خودساخته رد می‌شود", fakeToken.status === 401, String(fakeToken.status));

check("فایل دیتابیس ساخته شد", fs.existsSync(dbPath));
}

console.log(`\nنتیجه: ${pass} موفق، ${fail} ناموفق`);
if (fail) console.log("\n--- لاگ سرور ---\n" + log);
else console.log("\n--- لاگ سرور ---\n" + log.split("\n").slice(0, 8).join("\n"));

proc.kill("SIGTERM");
mock.close();
smsGateway.close();
setTimeout(() => process.exit(fail ? 1 : 0), 500);
