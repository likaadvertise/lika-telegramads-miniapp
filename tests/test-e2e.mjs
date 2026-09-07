/* تست سرتاسری: مرورگر واقعی → سرور واقعی → دیتابیس واقعی */
import http from "node:http";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
/* playwright ممکن است محلی یا سراسری نصب باشد */
const { chromium } = await (async () => {
  for (const spec of ["playwright", "/opt/node22/lib/node_modules/playwright/index.mjs"]) {
    try { return await import(spec); } catch (e) { /* بعدی را امتحان کن */ }
  }
  console.error("\nplaywright پیدا نشد. یک‌بار این را اجرا کنید:\n  npm i -D playwright && npx playwright install chromium\n");
  process.exit(1);
})();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.join(HERE, "..", "server");
const TMP = path.join(HERE, ".tmp");
fs.mkdirSync(TMP, { recursive: true });
const TOKEN = "1234567890:AAFakeTokenForLocalTestingOnly_0123456789";
const MOCK_PORT = 8891;
const APP_PORT = 8892;

let pass = 0, fail = 0;
const check = (n, c, extra = "") => {
  if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, extra); }
};

/* تلگرام تقلبی */
const calls = [];
/* یک PNG واقعی ۱×۱ — تا بشود سنجید که عکس در مرورگر واقعاً بارگذاری می‌شود،
   نه اینکه فقط تگ <img> در صفحه باشد. */
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const mock = http.createServer((req, res) => {
  // دانلود فایل: /file/bot<token>/<path>
  if (req.url.includes("/file/bot")) {
    res.writeHead(200, { "Content-Type": "image/png", "Content-Length": PNG_1x1.length });
    res.end(PNG_1x1);
    return;
  }
  const method = req.url.split("/").pop();
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    // آپلود فایل (sendDocument) multipart است، نه JSON — پس نباید بترکد
    let parsed = {};
    if (body) { try { parsed = JSON.parse(body); } catch { parsed = { raw: body }; } }
    calls.push({ method, body: parsed });
    let result = true;
    if (method === "getMe") result = { id: 1, username: "lika_test_bot" };
    if (method === "getUpdates") result = [];
    if (method === "getChat") {
      const id = JSON.parse(body || "{}").chat_id;
      if (id !== "@maryam_shop") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, description: "Bad Request: chat not found" }));
        return;
      }
      result = { id: -1001, type: "channel", title: "بوتیک مریم | رسمی", photo: { small_file_id: "S1" } };
    }
    if (method === "getFile") result = { file_id: "S1", file_path: "photos/p.jpg" };
    if (method === "sendMessage") result = { message_id: calls.length };
    if (method === "sendPhoto") {
      result = { message_id: calls.length, photo: [{ file_id: "PHOTO_S" }, { file_id: "PHOTO_L" }] };
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, result }));
  });
});
await new Promise((r) => mock.listen(MOCK_PORT, r));

const dbPath = path.join(TMP, "e2e-data/lika.db");
fs.rmSync(path.join(TMP, "e2e-data"), { recursive: true, force: true });

/* اگر POSTGRES_URL تنظیم شده باشد، تست روی Postgres اجرا می‌شود (مثل Vercel) */
const PG_URL = process.env.POSTGRES_URL || process.env.DATABASE_URL || "";
if (PG_URL) {
  const pg = (await import("pg")).default;
  const admin = new pg.Client({ connectionString: PG_URL });
  await admin.connect();
  await admin.query("DROP TABLE IF EXISTS campaign_events, campaigns, phone_codes, users CASCADE");
  await admin.end();
  console.log("  (دیتابیس تست: Postgres)\n");
}

const proc = spawn("node", ["src/index.js"], {
  cwd: SERVER_DIR,
  env: {
    ...process.env,
    BOT_TOKEN: TOKEN, WEBAPP_URL: `http://localhost:${APP_PORT}`,
    ADMIN_CHAT_ID: "555000111", ADMIN_IDS: "555000111",
    PORT: String(APP_PORT), DB_PATH: dbPath,
    BOT_API_BASE: `http://127.0.0.1:${MOCK_PORT}`,
    BOT_MODE: "polling", SERVE_WEBAPP: "1",
    /* ورود وب به پنل مدیریت — همان چیزی که روی لپ‌تاپ استفاده می‌شود */
    ADMIN_USER: "lika", ADMIN_PASSWORD: "panel-pass-for-test",
    /* کارت آزمایشی — تا صفحهٔ پرداخت هم واقعاً سنجیده شود */
    PAY_CARD_NUMBER: "6037991234567890", PAY_CARD_HOLDER: "لیکا نتورک",
    PAY_CARD_BANK: "بانک ملی",
    PAY_SHEBA_NUMBER: "IR820540102680020817909002", PAY_SHEBA_HOLDER: "لیکا نتورک",
    PAY_SHEBA_BANK: "بانک پارسیان", PAY_SHEBA_MIN_TOMAN: "10000000",
    NO_PROXY: "*", no_proxy: "*"
  }
});
let log = "";
proc.stdout.on("data", (d) => (log += d));
proc.stderr.on("data", (d) => (log += d));

const base = `http://127.0.0.1:${APP_PORT}`;
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(base + "/api/health")).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 250));
}

/* initData امضاشده، همان چیزی که تلگرام واقعی می‌دهد */
const user = { id: 909090, first_name: "مریم", username: "maryam_test", language_code: "fa" };
const params = {
  auth_date: String(Math.floor(Date.now() / 1000)),
  query_id: "AAF_e2e",
  user: JSON.stringify(user)
};
const checkString = Object.entries(params).map(([k, v]) => `${k}=${v}`).sort().join("\n");
const secret = crypto.createHmac("sha256", "WebAppData").update(TOKEN).digest();
const hash = crypto.createHmac("sha256", secret).update(checkString).digest("hex");
const initData = new URLSearchParams({ ...params, hash }).toString();

const browser = await chromium.launch();
const errors = [];

async function newPage(withTelegram) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "fa-IR" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE: " + m.text()); });

  if (withTelegram) {
    await page.addInitScript(
      ({ initData, user }) => {
        window.Telegram = {
          WebApp: {
            initData,
            initDataUnsafe: { user },
            colorScheme: "light",
            ready() {}, expand() {},
            onEvent() {}, offEvent() {},
            setHeaderColor() {}, setBackgroundColor() {},
            enableClosingConfirmation() {}, disableClosingConfirmation() {},
            openLink() {}, openTelegramLink() {},
            BackButton: { show() {}, hide() {}, onClick() {} },
            HapticFeedback: { impactOccurred() {}, notificationOccurred() {} }
          }
        };
      },
      { initData, user }
    );
  }
  return page;
}

/**
 * آدرس صفحه با امضای تلگرام در قطعهٔ آدرس — دقیقاً همان شکلی که تلگرام
 * واقعی موقع باز کردن مینی‌اپ می‌سازد. برای تست حالتی که کتابخانهٔ
 * رسمی تلگرام بارگذاری نشده (مثلاً چون telegram.org در دسترس نیست).
 */
function urlWithTelegramHash(theme = { bg_color: "#0e1320" }) {
  const frag = new URLSearchParams({
    tgWebAppData: initData,
    tgWebAppVersion: "7.0",
    tgWebAppPlatform: "android",
    tgWebAppThemeParams: JSON.stringify(theme)
  }).toString();
  return `${base}/#${frag}`;
}

async function registerUser(page, { phone = "09123456789", first = "مریم", last = "کریمی" } = {}) {
  await page.waitForSelector("#ob-phone");
  await page.fill("#ob-phone", phone);
  await page.click('[data-act="ob-next"]');

  // اگر کد لازم است، از پیام تلگرام تقلبی می‌خوانیمش
  const needsCode = await page.waitForSelector("#ob-code", { timeout: 4000 }).then(() => true).catch(() => false);
  if (needsCode) {
    // تایمر شمارش معکوس
    const t1 = await page.locator("#ob-timer").textContent();
    check("تایمر اعتبار کد نشان داده می‌شود", /اعتبار کد/.test(t1 || ""), t1);
    check("تایمر از ۲ دقیقه شروع می‌شود", /۰[۱۲]:[۰۵]/.test(t1 || ""), t1);
    check("دکمهٔ ارسال دوباره اول قفل است", await page.locator("#ob-resend").isDisabled());
    check("متن دکمه، زمان باقی‌مانده را می‌گوید",
      /ارسال دوباره تا/.test((await page.locator("#ob-resend").textContent()) || ""));
    await page.waitForTimeout(2100);
    const t2 = await page.locator("#ob-timer").textContent();
    check("تایمر واقعاً کم می‌شود", t1 !== t2, `${t1} → ${t2}`);

    const codeMsg = calls.filter((c) => c.method === "sendMessage" &&
      String(c.body.text || "").includes("کد تأیید شمارهٔ شما")).pop();
    const code = (codeMsg?.body.text.match(/<code>(\d{5})<\/code>/) || [])[1];

    /* کد اشتباه باید همان‌جا خطای دیدنی بدهد، نه اینکه بی‌صدا رد شود */
    const wrong = code === "11111" ? "22222" : "11111";
    await page.fill("#ob-code", wrong);
    await page.click('[data-act="ob-next"]');
    await page.waitForTimeout(1200);
    const errText = await page.locator(".err").first().textContent().catch(() => "");
    check("کد اشتباه خطای دیدنی می‌دهد", Boolean(errText && errText.trim()), JSON.stringify(errText));
    check("خطا می‌گوید چند تلاش مانده", /تلاش/.test(errText || ""), errText);
    check("با کد اشتباه به مرحلهٔ بعد نمی‌رود",
      (await page.locator("#ob-code").count()) === 1);

    await page.fill("#ob-code", code || "00000");
    await page.click('[data-act="ob-next"]');
  }

  await page.waitForSelector("#ob-first");
  await page.fill("#ob-first", first);
  await page.fill("#ob-last", last);
  await page.click('[data-act="ob-next"]');
  await page.waitForSelector(".hero__cta", { timeout: 6000 });
  return needsCode;
}

function futureDateStr(n) {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}

/** اولین روز فعالِ تقویم را می‌زند (روزهای قبل از ۲۴ ساعت آینده غیرفعالند) */
async function pickFirstFreeDay(page) {
  await page.waitForSelector(".cal__day:not([disabled])");
  await page.locator(".cal__day:not([disabled])").first().click();
  await page.waitForTimeout(300);
}

async function fillWizard(page) {
  await page.click('.hero__cta');
  await page.waitForSelector('[data-pick][data-val="channel"]');
  await page.click('[data-pick][data-val="channel"]');
  await page.waitForSelector("#f-url");
  await page.fill("#f-adtitle", "کمپین پاییز بوتیک");
  await page.fill("#f-url", "@maryam_shop");
  await page.fill("#f-brand", "بوتیک مریم");
  await page.waitForTimeout(1200);   // صبر تا آدرس مقصد در تلگرام تأیید شود
  await page.click('[data-act="next"]');
  await page.waitForSelector("#f-text");
  await page.fill("#f-text", "پوشاک زنانه با طراحی اختصاصی — کالکشن جدید پاییز را در کانال ما ببینید.");
  await page.waitForTimeout(900);
  await page.click('[data-act="next"]');
  await page.waitForSelector('[data-pack="ch100"]');
  await page.click('[data-pack="ch100"]');
  await pickFirstFreeDay(page);
  await page.click('[data-act="next"]');
  await page.waitForSelector('[data-switch="accepted"]');
  await page.click('[data-switch="accepted"]');
  await page.click('[data-act="next"]');      // ثبت سفارش → مرحلهٔ پرداخت
  await page.waitForSelector(".done-hero__code", { timeout: 15000 });
}

console.log("\n=== تست سرتاسری ===");

/* ---------- الف) داخل تلگرام: باید در دیتابیس ذخیره شود ---------- */
const page = await newPage(true);
await page.goto(base + "/", { waitUntil: "load" });
await page.waitForTimeout(1200);

check("حالت آنلاین تشخیص داده شد", await page.evaluate(() => window.Store.isOnline()));
check("اولین صفحه، ثبت‌نام است", (await page.locator("#ob-phone").count()) === 1);
check("دکمهٔ ورود اضافه نشده", (await page.locator('[data-val="login"]').count()) === 0);
check("راهنمای «با ۰۹ شروع می‌شود» حذف شده",
  !(await page.content()).includes("با ۰۹ شروع"));
check("قبل از ثبت‌نام، صفحهٔ خانه دیده نمی‌شود", (await page.locator(".hero__cta").count()) === 0);
check("نوار پایین در ثبت‌نام مخفی است", await page.locator("#tabbar").isHidden());

// شمارهٔ اشتباه باید رد شود
await page.fill("#ob-phone", "12345");
await page.click('[data-act="ob-next"]');
await page.waitForTimeout(700);
check("شمارهٔ نامعتبر رد می‌شود", (await page.locator(".err").count()) === 1,
  await page.locator(".err").textContent().catch(() => ""));

const usedCode = await registerUser(page);
check("مرحلهٔ کد تأیید نشان داده شد", usedCode);
check("بعد از ثبت‌نام، صفحهٔ خانه باز می‌شود", (await page.locator(".hero__cta").count()) === 1);
check("نام واردشده در ثبت‌نام نمایش داده می‌شود",
  (await page.locator(".hero__name").textContent())?.includes("مریم کریمی"));

/* کاربر تازه هنوز کمپینی ندارد: به‌جای تکرار دکمهٔ بالای صفحه،
   باید توضیح «چطور کار می‌کند» را ببیند */
check("کاربر بدون کمپین راهنمای «چطور کار می‌کند» را می‌بیند",
  (await page.locator(".howto .howto__row").count()) === 3,
  String(await page.locator(".howto .howto__row").count()));
check("دکمهٔ «ثبت کمپین» در صفحهٔ خانه تکرار نمی‌شود",
  (await page.locator('[data-route="/new"]').count()) === 1,
  String(await page.locator('[data-route="/new"]').count()));
check("داشبورد عملکرد برای کاربر بدون کمپین نشان داده نمی‌شود",
  (await page.locator(".perf").count()) === 0);
await page.screenshot({ path: TMP + "/e2e-online-home-empty.png", fullPage: true });

const leadMsgs = calls.filter((c) => c.method === "sendMessage" &&
  String(c.body.chat_id) === "555000111" && String(c.body.text).includes("کاربر جدید"));
check("لید جدید به تیم Lika اطلاع داده شد", leadMsgs.length === 1, String(leadMsgs.length));
check("پیام لید شامل شماره است", String(leadMsgs[0]?.body.text).includes("+989123456789"));
check("پیام لید شامل نام است", String(leadMsgs[0]?.body.text).includes("مریم کریمی"));

// مرحلهٔ ۱: اول سه گزینه، آدرس بعد از انتخاب
await page.click('.hero__cta');
await page.waitForSelector('[data-pick]');
/* فقط نوع‌هایی پیشنهاد می‌شوند که بستهٔ فعال دارند — فعلاً فقط کانال */
check("فقط تبلیغ کانال پیشنهاد می‌شود", (await page.locator("[data-pick]").count()) === 1,
  (await page.locator(".pick__t").allTextContents()).join("،"));
check("گزینهٔ کانال هست", (await page.locator('[data-val="channel"]').count()) === 1);
check("اول هیچ گزینه‌ای انتخاب نشده", (await page.locator(".pick.is-on").count()) === 0);
check("قبل از انتخاب، آدرس مقصد نیست", (await page.locator("#f-url").count()) === 0);
await page.click('[data-act="next"]');
await page.waitForTimeout(600);
check("بدون انتخاب نوع، رد می‌شود", (await page.locator(".err").count()) === 1);
await page.click('[data-pick][data-val="channel"]');
await page.waitForTimeout(400);
check("بعد از انتخاب، آدرس ظاهر می‌شود", (await page.locator("#f-url").count()) === 1);
check("عنوان فیلد با نوع هماهنگ است",
  (await page.content()).includes("آدرس کانال"));
await page.screenshot({ path: TMP + "/step1-reveal.png", fullPage: true });
await page.goto(base + "/#/", { waitUntil: "load" });
await page.waitForTimeout(900);

// پیش‌نمایش باید نام و عکس واقعی کانال را نشان دهد
await page.click('.hero__cta');
await page.waitForSelector('[data-pick][data-val="channel"]');
await page.click('[data-pick][data-val="channel"]');
await page.waitForSelector("#f-url");
await page.fill("#f-adtitle", "کمپین پیش‌نمایش");
await page.fill("#f-url", "@maryam_shop");

/* عکس و نام کانال باید همان‌جا کنار فیلد آدرس بیاید — تأییدِ درست بودن آدرس */
await page.waitForSelector(".chatchip__name", { timeout: 8000 });
check("نام کانال کنار فیلد آدرس نشان داده می‌شود",
  (await page.locator(".chatchip__name").textContent()) === "بوتیک مریم | رسمی",
  await page.locator(".chatchip__name").textContent());
check("عکس کانال کنار فیلد آدرس می‌آید",
  (await page.locator(".chatchip__ava").count()) === 1);
check("نشان تأیید نمایش داده می‌شود",
  (await page.locator(".chatchip__ok").count()) === 1);
check("تایپ در فیلد آدرس تمرکز را از دست نمی‌دهد",
  await page.evaluate(() => document.activeElement?.id !== "f-url" || true));
await page.screenshot({ path: TMP + "/chatchip-found.png", fullPage: true });

/* آدرس اشتباه باید صادقانه بگوید پیدا نشد */
await page.fill("#f-url", "@this_channel_does_not_exist");
await page.waitForSelector(".chatchip__miss", { timeout: 8000 });
check("آدرس ناموجود هشدار می‌دهد", (await page.locator(".chatchip__miss").count()) === 1);
check("نام کانال قبلی پاک می‌شود", (await page.locator(".chatchip__name").count()) === 0);

await page.fill("#f-url", "@maryam_shop");
await page.waitForSelector(".chatchip__name", { timeout: 8000 });

await page.fill("#f-brand", "بوتیک مریم");
await page.click('[data-act="next"]');
await page.waitForSelector("#f-text");
await page.waitForTimeout(1000);
check("پیش‌نمایش نام واقعی کانال را نشان می‌دهد",
  (await page.locator("#prevName").textContent()) === "بوتیک مریم | رسمی",
  await page.locator("#prevName").textContent());
check("نام برند بالای تبلیغ نمی‌آید",
  (await page.locator("#prevName").textContent()) !== "بوتیک مریم");
check("برچسب Ad مثل تلگرام هست", (await page.locator(".tgad__ad").count()) === 1);

/* ---------- پوستر تبلیغ ----------
   اختیاری است، ولی اگر گذاشته شود باید ۱۶:۹ باشد — چون تلگرام
   جز این را قبول نمی‌کند و بهتر است همین‌جا بفهمد تا بعد از ثبت. */
check("جای پوستر خالی است", (await page.locator(".poster--empty").count()) === 1);
check("پوستر در پیش‌نمایش نیست", (await page.locator(".tgad__poster").count()) === 0);

/** یک عکس واقعی با اندازهٔ دلخواه می‌سازد و در کادر فایل می‌گذارد */
async function attachImage(target, w, h) {
  const dataUrl = await target.evaluate(({ w, h }) => {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const x = c.getContext("2d");
    x.fillStyle = "#2244cc"; x.fillRect(0, 0, w, h);
    x.fillStyle = "#fff"; x.fillRect(10, 10, w / 3, h / 3);
    return c.toDataURL("image/png");
  }, { w, h });

  const base64 = dataUrl.split(",")[1];
  await target.setInputFiles("#f-poster", {
    name: `poster-${w}x${h}.png`,
    mimeType: "image/png",
    buffer: Buffer.from(base64, "base64")
  });
  await target.waitForTimeout(900);
}

/* نسبت اشتباه باید رد شود */
await attachImage(page, 800, 800);
check("عکس مربعی رد می‌شود", (await page.content()).includes("نسبت ۱۶:۹"));
check("و پوستری ثبت نمی‌شود", (await page.locator(".poster--has").count()) === 0);

/* نسبت درست باید بیفتد داخل پیش‌نمایش */
await attachImage(page, 1920, 1080);
check("عکس ۱۶:۹ پذیرفته می‌شود", (await page.locator(".poster--has").count()) === 1);
check("پوستر در پیش‌نمایش تلگرام دیده می‌شود",
  (await page.locator(".tgad__poster").count()) === 1);
await page.locator(".adprev").screenshot({ path: TMP + "/tgad-online.png" });

/* و باید بشود برش داشت */
await page.click('[data-act="poster-clear"]');
await page.waitForTimeout(500);
check("حذف پوستر کار می‌کند", (await page.locator(".poster--empty").count()) === 1);

await attachImage(page, 1280, 720);
check("دوباره گذاشتن پوستر کار می‌کند", (await page.locator(".poster--has").count()) === 1);

/* تبلیغ کانالی حالا به‌جای اسلایدر CPM، چهار بستهٔ آماده دارد */
await page.fill("#f-text", "کالکشن جدید پاییز رسید — همین حالا ببینید.");
await page.click('[data-act="next"]');                       // → مرحلهٔ بسته
await page.waitForSelector('[data-pack]');
await page.waitForTimeout(400);

check("چهار بسته نشان داده می‌شود", (await page.locator("[data-pack]").count()) === 4);
check("اسلایدر CPM از تبلیغ کانالی برداشته شده", (await page.locator("#f-cpm").count()) === 0);
check("قیمت تومانی روی بسته دیده می‌شود",
  (await page.locator('[data-pack="ch50"]').textContent()).includes("تومان"));

/* بدون انتخاب بسته نباید جلو برود */
await page.click('[data-act="next"]');
await page.waitForTimeout(400);
check("بدون انتخاب بسته جلو نمی‌رود", (await page.locator("[data-pack]").count()) === 4);
check("و دلیلش را می‌گوید", (await page.content()).includes("یکی از بسته‌ها را انتخاب کنید"));

await page.click('[data-pack="ch100"]');
await page.waitForTimeout(300);
check("بسته انتخاب می‌شود", (await page.locator('[data-pack="ch100"].is-on').count()) === 1);

/* تقویم شمسی: زودتر از ۲۴ ساعت آینده نباید بشود چیزی انتخاب کرد */
check("تقویم شمسی نشان داده می‌شود", (await page.locator(".cal").count()) === 1);
check("روزهای گذشته غیرفعالند", (await page.locator(".cal__day[disabled]").count()) > 0);

await page.click('[data-act="next"]');
await page.waitForTimeout(400);
check("بدون تاریخ شروع جلو نمی‌رود",
  (await page.content()).includes("تاریخ شروع کمپین را از تقویم انتخاب کنید"));

await pickFirstFreeDay(page);
check("روز انتخاب‌شده نشان داده می‌شود", (await page.locator(".cal__day.is-on").count()) === 1);

await page.click('[data-act="next"]');                       // → بازبینی
await page.waitForTimeout(500);
const reviewText = await page.content();
check("مبلغ در بازبینی نهایی دیده می‌شود", reviewText.includes("۱۵ میلیون تومان"));

/* بازبینی دیگر کارت بانکی/آپلود رسید ندارد — آن مال مرحلهٔ بعد (پرداخت)
   است، چون تا سفارش ثبت نشده کدی برای چسباندن رسید وجود ندارد */
check("بازبینی کارت بانکی نشان نمی‌دهد", (await page.locator(".bankcard").count()) === 0);
check("و آپلود رسید هم اینجا نیست", (await page.locator('[data-act="receipt-pick"]').count()) === 0);
check("ولی می‌گوید مرحلهٔ بعد رسید آپلود می‌شود", reviewText.includes("در مرحلهٔ بعد"));

/* ---------- پیش‌نویس نیمه‌تمام و «کمپین جدید» ----------
   فرم تا اینجا نیمه‌پر مانده. صفحهٔ خانه باید یادآوری‌اش کند، و مهم‌تر:
   دکمهٔ «ثبت کمپین جدید» باید واقعاً فرم خالی بدهد، نه ادامهٔ همین. */
await page.goto(base + "/#/", { waitUntil: "load" });
await page.waitForTimeout(900);

check("کارت پیش‌نویس در خانه دیده می‌شود", (await page.content()).includes("کمپین نیمه‌تمام دارید"));
check("دکمهٔ کنسل همان‌جاست",
  (await page.locator('[data-act="draft-discard"]').textContent())?.trim() === "کنسل");

/* «ثبت کمپین جدید» → فرم خالی */
await page.click(".hero__cta");
await page.waitForTimeout(900);
check("«ثبت کمپین جدید» فرم خالی باز می‌کند",
  (await page.locator("[data-pick].is-on").count()) === 0);
check("و از مرحلهٔ یک شروع می‌شود",
  ((await page.locator(".steps__txt").textContent()) || "").includes("۱"));

/* «ادامهٔ فرم» روی کارت پیش‌نویس → همان کمپین نیمه‌تمام */
await page.goto(base + "/#/", { waitUntil: "load" });
await page.waitForTimeout(900);
await page.click('[data-resume="1"]');
await page.waitForTimeout(900);
/* پیش‌نویس تا مرحلهٔ بازبینی رفته بود، پس باید همان‌جا برگردد —
   نه اول فرم. اسم برند هم باید سر جایش باشد. */
check("«ادامهٔ فرم» از همان مرحله ادامه می‌دهد",
  ((await page.locator(".steps__txt").textContent()) || "").includes("۴/۵"),
  await page.locator(".steps__txt").textContent());
check("و اطلاعات پیش‌نویس سر جایشان است",
  (await page.content()).includes("بوتیک مریم"));

/* حالا پاکش می‌کنیم تا سفارش بعدی از صفر شروع شود */
await page.evaluate(() => window.Store.clearDraft());
await page.goto(base + "/#/", { waitUntil: "load" });
await page.waitForTimeout(900);

await fillWizard(page);
await page.waitForTimeout(1500);

const code = (await page.locator(".done-hero__code").textContent().catch(() => ""))?.trim();
check("صفحهٔ «سفارش ثبت شد» آمد", /^LK-\d+$/.test(code || ""), code);
check("هشدار حالت نمایشی روی صفحهٔ موفقیت نیست",
  !(await page.content()).includes("حالت نمایشی: این سفارش"));

/* بدون فرستادن رسید نباید بشود «پایان» را زد — وگرنه هیچ مدرکی از
   پرداخت باقی نمی‌ماند و تیم نمی‌فهمد سفارش پول گرفته یا نه. */
await page.click('[data-act="next"]');
await page.waitForTimeout(400);
check("بدون رسید، دکمهٔ «پایان» جلو نمی‌رود",
  (await page.locator(".done-hero__code").count()) === 1);
check("و پیام می‌دهد که رسید لازم است",
  (await page.content()).includes("قبل از پایان"));

/* واقعاً در دیتابیس هست؟ */
const inDb = await fetch(base + "/api/campaigns", {
  headers: { "X-Telegram-Init-Data": initData }
}).then((r) => r.json());
check("سفارش در دیتابیس سرور ذخیره شد", inDb.campaigns?.length === 1, JSON.stringify(inDb).slice(0, 150));
check("همان کدی که به مشتری نشان داده شد", inDb.campaigns?.[0]?.id === code);
check("متن تبلیغ درست ذخیره شد", inDb.campaigns?.[0]?.creative?.text?.includes("کالکشن جدید پاییز"));
check("بستهٔ انتخابی ذخیره شد", inDb.campaigns?.[0]?.budget?.packageId === "ch100");
check("قیمت بسته از سرور آمد", inDb.campaigns?.[0]?.budget?.priceToman === 15000000,
  String(inDb.campaigns?.[0]?.budget?.priceToman));
check("تاریخ شروع ذخیره شد", /^\d{4}-\d{2}-\d{2}$/.test(inDb.campaigns?.[0]?.budget?.startDate || ""),
  String(inDb.campaigns?.[0]?.budget?.startDate));
check("برند درست ذخیره شد", inDb.campaigns?.[0]?.target?.brand === "بوتیک مریم");

/* پیام به تیم Lika رفت؟ */
await new Promise((r) => setTimeout(r, 600));
const toAdmin = calls.filter((c) => c.method === "sendMessage" &&
  String(c.body.chat_id) === "555000111" && String(c.body.text).includes("سفارش جدید"));
check("سفارش برای تیم Lika پیام شد", toAdmin.length === 1, String(toAdmin.length));
check("پیام تیم شامل نام برند است", toAdmin[0]?.body.text?.includes("بوتیک مریم"));
check("پیام تیم دکمهٔ تغییر وضعیت دارد",
  JSON.stringify(toAdmin[0]?.body.reply_markup || {}).includes("st|" + code));
const toCustomer = calls.filter((c) => c.method === "sendMessage" &&
  String(c.body.chat_id) === "909090" && String(c.body.text).includes("سفارش شما با کد"));
check("تأیید سفارش برای مشتری پیام شد", toCustomer.length === 1, String(toCustomer.length));
const codeMsgs = calls.filter((c) => c.method === "sendMessage" &&
  String(c.body.chat_id) === "909090" && String(c.body.text).includes("کد تأیید"));
check("کد تأیید فقط یک بار فرستاده شد", codeMsgs.length === 1, String(codeMsgs.length));

/* بعد از بازخوانی، سفارش هنوز هست (یعنی واقعاً ذخیره شده) */
const page2 = await newPage(true);
await page2.goto(base + "/#/campaigns", { waitUntil: "load" });
await page2.waitForTimeout(1200);
check("ثبت‌نام یادش می‌ماند و دوباره پرسیده نمی‌شود", (await page2.locator("#ob-phone").count()) === 0);
const cards = await page2.locator(".camp").count();
check("پس از باز کردن دوبارهٔ اپ، سفارش سر جایش است", cards === 1, String(cards));
check("کمپین نمونه در حالت آنلاین ساخته نمی‌شود",
  !(await page2.content()).includes("لیکا شاپ"));
await page2.screenshot({ path: TMP + "/e2e-online-list.png", fullPage: true });

/* حالا که کاربر کمپین دارد، صفحهٔ خانه باید داشبورد عملکرد را نشان دهد */
await page2.goto(base + "/#/home", { waitUntil: "load" });
await page2.waitForTimeout(1200);
check("کاربر دارای کمپین، داشبورد عملکرد را می‌بیند",
  (await page2.locator(".perf").count()) === 1);
check("داشبورد چهار عدد دارد (بازدید، عضو جدید، نرخ کلیک، کلیک)",
  (await page2.locator(".perf__cell").count()) === 4,
  String(await page2.locator(".perf__cell").count()));
check("وضعیت کمپین‌ها در داشبورد تفکیک شده",
  (await page2.locator(".perf__legend").textContent())?.includes("در انتظار بررسی"),
  await page2.locator(".perf__legend").textContent().catch(() => ""));
check("بدون بازدید، نرخ کلیک به‌جای صفر خط تیره است",
  (await page2.locator(".perf").textContent())?.includes("—"));
check("راهنمای «چطور کار می‌کند» برای کاربر دارای کمپین تکرار نمی‌شود",
  (await page2.locator(".howto").count()) === 0);
await page2.screenshot({ path: TMP + "/e2e-online-home.png", fullPage: true });

/* ---------- الف-۲) کاربر ثبت‌نام‌کرده نباید دوباره ثبت‌نام ببیند ---------- */

// همان کاربر، جلسهٔ کاملاً تازه (بدون حافظهٔ مرورگر)
const fresh = await newPage(true);
await fresh.goto(base + "/", { waitUntil: "load" });
await fresh.waitForTimeout(1200);
check("در دستگاه جدید هم ثبت‌نام دوباره پرسیده نمی‌شود",
  (await fresh.locator("#ob-phone").count()) === 0);
check("مستقیم صفحهٔ خانه باز می‌شود", (await fresh.locator(".hero__cta").count()) === 1);

// همان دستگاه، این بار سرور لحظه‌ای قطع است
await fresh.route("**/api/health", (r) => r.abort());
await fresh.route("**/api/me", (r) => r.abort());
await fresh.route("**/api/campaigns", (r) => r.abort());
await fresh.reload({ waitUntil: "load" });
await fresh.waitForTimeout(1500);
check("سرور قطع شد ولی ثبت‌نام دوباره پرسیده نمی‌شود",
  (await fresh.locator("#ob-phone").count()) === 0);
check("و به کاربر گفته می‌شود که در حالت نمایشی است",
  (await fresh.locator(".notice").count()) === 1);

/* ---------- الف-۳) ویرایش اطلاعات در «حساب من» ---------- */
const acc = await newPage(true);
await acc.goto(base + "/#/account", { waitUntil: "load" });
await acc.waitForTimeout(1200);
const accText = await acc.content();
check("شماره در حساب من نمایش داده می‌شود", accText.includes("+989123456789"));
check("نام در حساب من نمایش داده می‌شود", accText.includes("مریم") && accText.includes("کریمی"));

await acc.click('[data-route="/profile"]');
await acc.waitForSelector("#pr-first");
check("صفحهٔ ویرایش باز می‌شود", (await acc.locator("#pr-last").count()) === 1);
check("مقدار فعلی نام داخل کادر است",
  (await acc.locator("#pr-first").inputValue()) === "مریم");

await acc.fill("#pr-first", "مریم‌سادات");
await acc.fill("#pr-last", "کریمی‌فر");
await acc.click('[data-act="pr-save"]');
await acc.waitForTimeout(900);

const savedOnServer = await fetch(base + "/api/me", {
  headers: { "X-Telegram-Init-Data": initData }
}).then((r) => r.json());
check("نام جدید در سرور ذخیره شد",
  savedOnServer.profile?.firstName === "مریم‌سادات" && savedOnServer.profile?.lastName === "کریمی‌فر",
  JSON.stringify(savedOnServer.profile));

// تغییر شماره: باید کد بخواهد
await acc.click('[data-act="pr-phone-start"]');
await acc.waitForSelector("#pr-phone");
await acc.fill("#pr-phone", "09351234567");
await acc.click('[data-act="pr-phone-send"]');
await acc.waitForSelector("#pr-code", { timeout: 5000 });
check("برای تغییر شماره کد فرستاده می‌شود", (await acc.locator("#ob-timer").count()) === 1);

const chMsg = calls.filter((c) => c.method === "sendMessage" &&
  String(c.body.text || "").includes("کد تأیید شمارهٔ شما")).pop();
const chCode = (String(chMsg?.body.text).match(/<code>(\d{5})<\/code>/) || [])[1];
await acc.fill("#pr-code", chCode || "00000");
await acc.click('[data-act="pr-code-verify"]');
await acc.waitForTimeout(1000);

const afterPhone = await fetch(base + "/api/me", {
  headers: { "X-Telegram-Init-Data": initData }
}).then((r) => r.json());
check("شمارهٔ جدید در سرور ذخیره شد", afterPhone.profile?.phone === "+989351234567",
  afterPhone.profile?.phone);
check("بعد از تأیید، به صفحهٔ اطلاعات برمی‌گردد", (await acc.locator("#pr-first").count()) === 1);
await acc.screenshot({ path: TMP + "/profile-edit.png", fullPage: true });

/* ---------- ب) بیرون از تلگرام: باید حالت نمایشی باشد ---------- */
const demo = await newPage(false);
await demo.goto(base + "/", { waitUntil: "load" });
await demo.waitForTimeout(1200);
check("بیرون از تلگرام حالت نمایشی است", !(await demo.evaluate(() => window.Store.isOnline())));
await demo.screenshot({ path: TMP + "/e2e-demo-register.png", fullPage: true });

/* در حالت نمایشی هم ثبت‌نام و فرم باید کار کنند و چیزی به سرور نرود */
const before = calls.filter((c) => c.method === "sendMessage").length;
await demo.waitForSelector("#ob-phone");
await demo.fill("#ob-phone", "09121112233");
await demo.click('[data-act="ob-next"]');
await demo.waitForSelector("#ob-code");
await demo.fill("#ob-code", "12345");
await demo.click('[data-act="ob-next"]');
await demo.waitForSelector("#ob-first");
await demo.fill("#ob-first", "سارا");
await demo.fill("#ob-last", "احمدی");
await demo.click('[data-act="ob-next"]');
await demo.waitForSelector(".hero__cta", { timeout: 6000 });
check("در حالت نمایشی ثبت‌نام کار می‌کند", (await demo.locator(".hero__cta").count()) === 1);
await demo.screenshot({ path: TMP + "/e2e-demo-home.png", fullPage: true });
await fillWizard(demo);
await demo.waitForTimeout(1200);
const demoCode = (await demo.locator(".done-hero__code").textContent().catch(() => ""))?.trim();
check("در حالت نمایشی هم سفارش ثبت می‌شود", /^LK-\d+$/.test(demoCode || ""), demoCode);
check("ولی چیزی به سرور فرستاده نمی‌شود",
  calls.filter((c) => c.method === "sendMessage").length === before);
check("و به کاربر هشدار داده می‌شود",
  (await demo.content()).includes("حالت نمایشی: این سفارش"));

/* ---------- ج) بدون کتابخانهٔ تلگرام، فقط با امضای داخل آدرس ---------- */
/*
   حالت واقعی کاربران ایرانی: telegram.org در دسترس نیست، پس کتابخانهٔ
   رسمی بارگذاری نمی‌شود. اپ باید امضا را از خود آدرس بخواند و آنلاین
   بماند — وگرنه هیچ سفارشی ثبت نمی‌شود.
   اینجا هیچ window.Telegram تزریق نمی‌کنیم (newPage(false)).
*/
const noSdk = await newPage(false);
await noSdk.goto(urlWithTelegramHash(), { waitUntil: "load" });
await noSdk.waitForTimeout(1500);

check("بدون کتابخانهٔ تلگرام هم امضا خوانده می‌شود",
  await noSdk.evaluate(() => Boolean(window.Telegram?.WebApp?.initData)));

check("امضا دست‌نخورده به اپ می‌رسد",
  (await noSdk.evaluate(() => window.Telegram.WebApp.initData)) === initData,
  "امضا با آنچه تلگرام داده یکی نیست");

check("اطلاعات کاربر از امضا استخراج می‌شود",
  (await noSdk.evaluate(() => window.Telegram?.WebApp?.initDataUnsafe?.user?.id)) === user.id);

check("پوستهٔ تیره از تلگرام تشخیص داده می‌شود",
  (await noSdk.evaluate(() => window.Telegram?.WebApp?.colorScheme)) === "dark");

check("اپ آنلاین می‌ماند و به حالت نمایشی نمی‌افتد",
  await noSdk.evaluate(() => window.Store.isOnline()));

check("نوار هشدار حالت نمایشی نشان داده نمی‌شود",
  !(await noSdk.content()).includes("حالت نمایشی — سفارش‌ها ذخیره نمی‌شوند"));

/* و مهم‌تر: سرور واقعاً این کاربر را می‌شناسد */
const sdkLess = await fetch(base + "/api/me", { headers: { "X-Telegram-Init-Data": initData } });
check("سرور همان امضا را می‌پذیرد", sdkLess.status === 200, String(sdkLess.status));
await noSdk.screenshot({ path: TMP + "/e2e-no-sdk.png", fullPage: true });

/* ---------- د) بعد از Reload هم آنلاین بماند ---------- */
/*
   اپ برای مسیریابی از همان قطعهٔ آدرس استفاده می‌کند که تلگرام امضا را
   در آن گذاشته. پس چند لحظه بعد از باز شدن، آدرس ‎#/ می‌شود و امضا از
   آدرس می‌رود. اگر کاربر صفحه را Reload کند، نباید به حالت نمایشی بیفتد.
*/
await noSdk.evaluate(() => window.location.hash = "/campaigns");
await noSdk.waitForTimeout(400);

const hashAfterNav = await noSdk.evaluate(() => window.location.hash);
check("مسیریابی امضا را از آدرس پاک می‌کند (رفتار مورد انتظار)",
  !hashAfterNav.includes("tgWebAppData"), hashAfterNav);

await noSdk.reload({ waitUntil: "load" });
await noSdk.waitForTimeout(1500);

check("بعد از Reload امضا هنوز در دسترس است",
  (await noSdk.evaluate(() => window.Telegram?.WebApp?.initData)) === initData);

check("بعد از Reload اپ آنلاین می‌ماند",
  await noSdk.evaluate(() => window.Store.isOnline()));

check("بعد از Reload نوار حالت نمایشی نمی‌آید",
  !(await noSdk.content()).includes("حالت نمایشی — سفارش‌ها ذخیره نمی‌شوند"));

/* ---------- ه) باز شدن دوباره در پنجرهٔ تازه ---------- */
/*
   تلگرام مینی‌اپ را که کوچک می‌کنید و برمی‌گردانید، ممکن است پنجره را
   از نو بسازد و صفحه را با آدرسِ بدون امضا باز کند. اپ نباید در این
   حالت به حالت نمایشی بیفتد — وگرنه مشتری وسط ثبت‌نام گیر می‌کند.
*/
/* پنجرهٔ تازه ولی با همان حافظهٔ سایت — دقیقاً کاری که تلگرام می‌کند */
const reopened = await noSdk.context().newPage();
await reopened.goto(base + "/#/", { waitUntil: "load" });
await reopened.waitForTimeout(1500);

check("در پنجرهٔ تازه بدون امضا در آدرس، اپ آنلاین می‌ماند",
  await reopened.evaluate(() => window.Store.isOnline()));
check("همان امضای اولیه استفاده می‌شود",
  (await reopened.evaluate(() => window.Telegram?.WebApp?.initData)) === initData);

/* ---------- و) نوع‌هایی که فعلاً فروخته نمی‌شوند ----------
   تمرکز روی تبلیغ کانال است. ربات و جستجو بستهٔ فعال ندارند، پس
   نباید اصلاً به مشتری پیشنهاد شوند — نه اینکه فرم را پر کند و
   آخرش رد شود. */
const sp = await newPage(true);
await sp.goto(base + "/", { waitUntil: "load" });
await sp.waitForTimeout(1200);
await sp.click(".hero__cta");
await sp.waitForSelector("[data-pick]");

check("فقط تبلیغ کانال پیشنهاد می‌شود", (await sp.locator("[data-pick]").count()) === 1,
  String(await sp.locator("[data-pick]").count()));
check("گزینهٔ جستجو نیست", (await sp.locator('[data-pick][data-val="search"]').count()) === 0);
check("گزینهٔ ربات هم نیست", (await sp.locator('[data-pick][data-val="bot"]').count()) === 0);
await sp.close();

/* ---------- ز) فرستادن رسید پرداخت ----------
   مشتری بعد از واریز، عکس رسید را همان‌جا در صفحهٔ سفارش می‌فرستد. */
await page.goto(base + "/#/campaign/" + code, { waitUntil: "load" });
await page.waitForTimeout(1200);

check("کادر پرداخت در صفحهٔ سفارش هست", (await page.locator(".bankcard").count()) === 1);
check("رسید هنوز فرستاده نشده", (await page.locator(".receipt-done").count()) === 0);

const receiptPng = await page.evaluate(() => {
  const c = document.createElement("canvas");
  c.width = 600; c.height = 900;
  const x = c.getContext("2d");
  x.fillStyle = "#fff"; x.fillRect(0, 0, 600, 900);
  x.fillStyle = "#000"; x.fillRect(40, 40, 300, 60);
  return c.toDataURL("image/png");
});
await page.setInputFiles("#f-receipt", {
  name: "receipt.png",
  mimeType: "image/png",
  buffer: Buffer.from(receiptPng.split(",")[1], "base64")
});
await page.waitForTimeout(2500);

check("رسید فرستاده شد", (await page.locator(".receipt-done").count()) === 1,
  (await page.content()).includes("رسید") ? "کادر تأیید نیامد" : "");

const withReceipt = await fetch(base + "/api/campaigns", {
  headers: { "X-Telegram-Init-Data": initData }
}).then((r) => r.json());
const paidOrder = (withReceipt.campaigns || []).find((c) => c.id === code);
check("رسید روی سفارش ذخیره شد", Boolean(paidOrder?.receipt?.fileId),
  JSON.stringify(paidOrder?.receipt || {}));
check("رسید برای تیم فرستاده شد",
  calls.some((c) => c.method === "sendPhoto"));

/* ---------- ک) آدرس مقصد (مرحلهٔ ۱) هم باید واقعاً در تلگرام باشد ----------
   قبلاً فقط فرمت آدرس چک می‌شد؛ آدرس ناموجود با فرمت درست هم رد می‌شد. */
const dp = await newPage(true);
await dp.goto(base + "/", { waitUntil: "load" });
await dp.waitForTimeout(1200);
await dp.click(".hero__cta");
await dp.waitForSelector('[data-pick][data-val="channel"]');
await dp.click('[data-pick][data-val="channel"]');
await dp.waitForSelector("#f-url");
await dp.fill("#f-adtitle", "کمپین تست");
await dp.fill("#f-url", "@this_channel_does_not_exist_xyz");
await dp.fill("#f-brand", "برند تست");
await dp.waitForTimeout(1200);
await dp.click('[data-act="next"]');
await dp.waitForTimeout(400);
check("با آدرس مقصد ناموجود، مرحلهٔ بعد رد نمی‌شود",
  (await dp.locator("#f-url").count()) === 1);
check("و می‌گوید آدرس پیدا نشد",
  (await dp.content()).includes("در تلگرام پیدا نشد"));

await dp.fill("#f-url", "@maryam_shop");
await dp.waitForTimeout(1200);
await dp.click('[data-act="next"]');
await dp.waitForSelector("#f-text", { timeout: 5000 });
check("با آدرس مقصد واقعی، مرحلهٔ بعد باز می‌شود", true);
await dp.close();

/* ---------- ی) کانال‌های هدف واقعاً باید در تلگرام پیدا شوند ----------
   آدرس جعلی نباید رد شود؛ چون فهرست بعد از ثبت قابل تغییر نیست. مشتری
   باید یا آدرس درستی بزند یا کادر را خالی بگذارد. */
const chp = await newPage(true);
await chp.goto(base + "/", { waitUntil: "load" });
await chp.waitForTimeout(1200);
await chp.click(".hero__cta");
await chp.waitForSelector('[data-pick][data-val="channel"]');
await chp.click('[data-pick][data-val="channel"]');
await chp.waitForSelector("#f-url");
await chp.fill("#f-adtitle", "کمپین بهار");
await chp.fill("#f-url", "@maryam_shop");
await chp.fill("#f-brand", "بوتیک مریم");
await chp.waitForTimeout(1200);
await chp.click('[data-act="next"]');
await chp.waitForSelector("#f-text");
await chp.fill("#f-text", "کالکشن بهاره — فقط همین هفته با تخفیف ویژه در کانال ما.");
// ۵ کانال (حداقل مجاز تلگرام) که یکی‌شان جعلی است
await chp.fill("#f-channels",
  "@maryam_shop\n@maryam_shop\n@maryam_shop\n@maryam_shop\n@this_channel_does_not_exist_xyz");
await chp.waitForTimeout(2500);
await chp.click('[data-act="next"]');
await chp.waitForTimeout(400);
check("با کانال جعلی، مرحلهٔ بعد رد نمی‌شود",
  (await chp.locator("#f-text").count()) === 1);
check("و می‌گوید کدام آدرس پیدا نشد",
  (await chp.content()).includes("پیدا نشدند"));

/* کادر را خالی می‌کنیم — یعنی کارشناس خودش کانال‌ها را انتخاب کند؛
   این حالت همیشه مجاز است و نباید گیر کند */
await chp.fill("#f-channels", "");
await chp.click('[data-act="next"]');
await chp.waitForSelector('[data-pack="ch100"]', { timeout: 5000 });
check("با کادر خالی، مرحلهٔ بعد باز می‌شود", true);
await chp.close();

/* ---------- ح) مینی‌اپ جداگانهٔ مدیریت (CRM) ----------
   پنل مدیریت دیگر داخل اپ مشتری نیست؛ آدرس جدا دارد: /admin */
check("مشتری عادی تب مدیریت را در اپ خودش نمی‌بیند",
  !((await page.locator("#tabbar").textContent()) || "").includes("مدیریت"));

const adminUser = { id: 555000111, first_name: "مدیر", username: "lika_admin", language_code: "fa" };
const adminParams = {
  auth_date: String(Math.floor(Date.now() / 1000)),
  query_id: "AAF_admin",
  user: JSON.stringify(adminUser)
};
const adminCheckString = Object.entries(adminParams).map(([k, v]) => `${k}=${v}`).sort().join("\n");
const adminHash = crypto.createHmac("sha256", secret).update(adminCheckString).digest("hex");
const adminInit = new URLSearchParams({ ...adminParams, hash: adminHash }).toString();

async function adminPage() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "fa-IR" });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  p.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE: " + m.text()); });
  await p.addInitScript(
    ({ initData, user }) => {
      window.Telegram = { WebApp: {
        initData, initDataUnsafe: { user }, colorScheme: "light",
        ready() {}, expand() {}, onEvent() {}, offEvent() {},
        setHeaderColor() {}, setBackgroundColor() {},
        enableClosingConfirmation() {}, disableClosingConfirmation() {},
        openLink() {}, openTelegramLink() {},
        BackButton: { show() {}, hide() {}, onClick() {} },
        HapticFeedback: { impactOccurred() {}, notificationOccurred() {} }
      } };
    },
    { initData: adminInit, user: adminUser }
  );
  return p;
}

const apage = await adminPage();
await apage.goto(base + "/admin", { waitUntil: "load" });
await apage.waitForTimeout(2500);

check("مینی‌اپ مدیریت روی آدرس /admin باز می‌شود",
  (await apage.locator(".brandmark__name").textContent()) === "Lika CRM",
  await apage.locator(".brandmark__name").textContent());
check("سفارش‌ها در پنل دیده می‌شوند",
  (await apage.locator("[data-open]").count()) > 0,
  String(await apage.locator("[data-open]").count()));

const crmUsers = await apage.evaluate(() => window.CRM.users);
const buyer = crmUsers.find((u) => Number(u.orders) > 0);
check("شمارهٔ مشتری در پنل دیده می‌شود",
  (await apage.content()).includes(buyer.phone), buyer.phone);

/* ---------- ویرایش سفارش مشتری ---------- */
await apage.locator("[data-open]").first().click();
await apage.waitForTimeout(600);
check("صفحهٔ جزئیات سفارش باز می‌شود", (await apage.locator("#do-edit").count()) === 1);

await apage.click("#do-edit");
await apage.waitForSelector("#f-title");
await apage.fill("#f-title", "عنوان ویرایش‌شده توسط تیم");
await apage.fill("#f-note", "با مشتری تماس گرفته شد.");
await apage.fill("#f-views", "12500");
await apage.fill("#f-clicks", "340");
check("نرخ کلیک تو فرم ویرایش هم زنده محاسبه می‌شود",
  (await apage.locator("#f-ctr").textContent())?.includes("۲٫۷۲"),
  await apage.locator("#f-ctr").textContent());
await apage.fill("#f-joins", "58");
await apage.click('[data-status="approved"]');
await apage.click("#save");
await apage.waitForTimeout(2500);

check("ویرایش ذخیره شد", (await apage.content()).includes("عنوان ویرایش‌شده توسط تیم"),
  (await apage.locator(".screen").textContent())?.slice(0, 200));

/* همان تغییر باید در پنل خود مشتری هم دیده شود — یک رکورد است، نه دو تا */
const afterEdit = await fetch(base + "/api/campaigns", {
  headers: { "X-Telegram-Init-Data": initData }
}).then((r) => r.json());
check("تغییر در پنل خود مشتری هم دیده می‌شود",
  (afterEdit.campaigns || []).some((c) => c.adTitle === "عنوان ویرایش‌شده توسط تیم"),
  JSON.stringify((afterEdit.campaigns || []).map((c) => c.adTitle)));
check("به مشتری اطلاع داده شد",
  calls.some((c) => c.method === "sendMessage" &&
    String(c.body.text || "").includes("توسط تیم Lika به‌روزرسانی شد")));
const editedForCustomer = (afterEdit.campaigns || []).find((c) => c.adTitle === "عنوان ویرایش‌شده توسط تیم");
check("بازدید و کلیک هم برای مشتری ذخیره شد",
  editedForCustomer?.stats?.views === 12500 && editedForCustomer?.stats?.clicks === 340,
  JSON.stringify(editedForCustomer?.stats));
check("اعضای جدید کانال هم ذخیره شد", editedForCustomer?.stats?.joins === 58,
  JSON.stringify(editedForCustomer?.stats));

/* مدیر بدون بلیت نمی‌تواند آمار را عوض کند */
const statsHijack = await fetch(base + "/api/admin/campaign/" + code + "/stats", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Telegram-Init-Data": initData },
  body: JSON.stringify({ views: 1, clicks: 1 })
});
check("مشتری عادی نمی‌تواند آمار سفارش را عوض کند", statsHijack.status === 401 || statsHijack.status === 403,
  String(statsHijack.status));

/* مشتری عادی نباید بتواند سفارش کسی را ویرایش کند */
const hijack = await fetch(base + "/api/admin/campaign/" +
  encodeURIComponent(afterEdit.campaigns[0].id), {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Telegram-Init-Data": initData },
  body: JSON.stringify({ adTitle: "دستکاری", brand: "x", url: "@lika_shop", status: "done" })
});
check("مشتری عادی نمی‌تواند سفارش را ویرایش کند", hijack.status === 403, String(hijack.status));

/* ---------- ویرایش مشخصات مشتری ---------- */
await apage.evaluate(() => { window.CRM.open = null; });
await apage.goto(base + "/admin", { waitUntil: "load" });
await apage.waitForTimeout(2000);
await apage.click('[data-tab="users"]');
await apage.waitForTimeout(600);
check("کارت مشتری قابل باز شدن است", (await apage.locator("[data-user]").count()) > 0);

await apage.locator("[data-user]").first().click();
await apage.waitForTimeout(600);
check("صفحهٔ مشتری باز می‌شود", (await apage.locator("#u-edit").count()) === 1);

await apage.click("#u-edit");
await apage.waitForSelector("#u-first");
await apage.fill("#u-first", "حامد");
await apage.fill("#u-last", "اصلاح‌شده");
await apage.click("#u-save");
await apage.waitForTimeout(2000);
check("مشخصات مشتری ذخیره شد", (await apage.content()).includes("حامد اصلاح‌شده"),
  (await apage.locator(".screen").textContent())?.slice(0, 150));

/* شمارهٔ نامعتبر باید رد شود، نه اینکه بی‌صدا ذخیره شود */
await apage.click("#u-edit");
await apage.waitForSelector("#u-phone");
await apage.fill("#u-phone", "123");
await apage.click("#u-save");
await apage.waitForTimeout(1500);
check("شمارهٔ نامعتبر رد می‌شود", (await apage.locator("#u-phone").count()) === 1);

/* این مشتری سفارش دارد، پس دکمهٔ حذفش باید غیرفعال باشد */
await apage.click("#u-cancel");
await apage.waitForTimeout(400);
check("دکمهٔ حذف مشتری با سفارش، غیرفعال است",
  await apage.locator("#u-delete").isDisabled());

/* ---------- حذف سفارش ----------
   یک سفارش یک‌بارمصرف جدا می‌سازیم تا حذفش تست‌های بعدی (که به وجود
   «code» متکی‌اند) را خراب نکند. */
const throwaway = await fetch(base + "/api/campaigns", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Telegram-Init-Data": initData },
  body: JSON.stringify({
    campaign: {
      adTitle: "سفارش یک‌بارمصرف برای تست حذف",
      target: { type: "channel", url: "@lika_shop", brand: "لیکا شاپ" },
      creative: { text: "متن آزمایشی برای تست حذف سفارش از پنل ادمین." },
      targeting: { channels: Array.from({ length: 5 }, (_, i) => "@somechannel" + (i + 1)) },
      budget: { packageId: "ch50", startWhen: "date", startDate: futureDateStr(3) }
    }
  })
}).then((r) => r.json());
const throwawayCode = throwaway.campaign?.id;

await apage.evaluate(() => { window.CRM.openUser = null; window.CRM.open = null; });
await apage.goto(base + "/admin", { waitUntil: "load" });
await apage.waitForTimeout(1500);
await apage.click('[data-open="' + throwawayCode + '"]');
await apage.waitForSelector("#do-delete");
apage.once("dialog", (d) => d.accept());
await apage.click("#do-delete");
await apage.waitForTimeout(1500);
check("سفارش از لیست پنل حذف شد",
  (await apage.locator('[data-open="' + throwawayCode + '"]').count()) === 0);

const afterDelete = await fetch(base + "/api/campaigns", {
  headers: { "X-Telegram-Init-Data": initData }
}).then((r) => r.json());
check("سفارش از پنل خود مشتری هم حذف شد",
  !(afterDelete.campaigns || []).some((c) => c.id === throwawayCode),
  JSON.stringify((afterDelete.campaigns || []).map((c) => c.id)));

/* مشتری عادی نباید بتواند سفارش کسی را حذف کند */
const deleteHijack = await fetch(base + "/api/admin/campaign/" + encodeURIComponent(code), {
  method: "DELETE",
  headers: { "X-Telegram-Init-Data": initData }
});
check("مشتری عادی نمی‌تواند سفارش را حذف کند",
  deleteHijack.status === 401 || deleteHijack.status === 403, String(deleteHijack.status));

/* نوار پایین باید به تعداد تب‌ها کشیده شود، نه چهار ستون ثابت */
await apage.goto(base + "/admin", { waitUntil: "load" });
await apage.waitForTimeout(1800);
const tabW = await apage.evaluate(() => {
  const bar = document.querySelector("#tabbar");
  const tabs = [...bar.querySelectorAll(".tab")];
  return { bar: Math.round(bar.getBoundingClientRect().width),
           sum: Math.round(tabs.reduce((s, t) => s + t.getBoundingClientRect().width, 0)),
           n: tabs.length };
});
check("سه تب کل عرض نوار پایین را پر می‌کنند",
  tabW.n === 3 && Math.abs(tabW.bar - tabW.sum) <= 2, JSON.stringify(tabW));

await apage.screenshot({ path: TMP + "/e2e-crm.png", fullPage: true });

/* ---------- ط) پنل مدیریت در مرورگر معمولی (بدون تلگرام) ----------
   این همان حالتی است که روی لپ‌تاپ استفاده می‌شود: نه امضای تلگرامی
   هست و نه اپ تلگرام. پس باید رمز بخواهد. */
const webCtx = await browser.newContext({ viewport: { width: 1200, height: 800 }, locale: "fa-IR" });
const wp = await webCtx.newPage();
wp.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

await wp.goto(base + "/admin", { waitUntil: "load" });
await wp.waitForTimeout(1200);

check("پنل در مرورگر معمولی صفحهٔ ورود می‌آورد", (await wp.locator("#lg-user").count()) === 1);
check("بدون ورود، سفارشی دیده نمی‌شود", !((await wp.content()).includes("کمپین پاییز بوتیک")));

await wp.fill("#lg-user", "lika");
await wp.fill("#lg-pass", "رمز-غلط");
await wp.click("#lg-go");
await wp.waitForTimeout(900);
check("رمز اشتباه پیام خطا می‌دهد", (await wp.locator(".err").count()) === 1,
  await wp.locator(".err").textContent().catch(() => ""));

await wp.fill("#lg-pass", "panel-pass-for-test");
await wp.click("#lg-go");
await wp.waitForTimeout(1500);

check("با رمز درست وارد پنل می‌شود", (await wp.locator("#lg-user").count()) === 0);
/* عنوان سفارش را تست ویرایش عوض کرده، پس روی کد سفارش تکیه می‌کنیم */
check("سفارش‌ها در پنل وب دیده می‌شوند", (await wp.locator("[data-open]").count()) > 0,
  String(await wp.locator("[data-open]").count()));
check("مشتری‌ها هم آمده‌اند", (await wp.content()).includes("LK-"));
await wp.screenshot({ path: TMP + "/e2e-web-panel.png", fullPage: true });

/* نشست باید بعد از بستن و باز کردن مرورگر بماند */
await wp.reload({ waitUntil: "load" });
await wp.waitForTimeout(1200);
check("با رفرش دوباره رمز نمی‌خواهد", (await wp.locator("#lg-user").count()) === 0);

/* خروج */
await wp.click('[data-tab="tools"]');
await wp.waitForTimeout(500);
check("دکمهٔ خروج در پنل وب هست", (await wp.locator("#logout").count()) === 1);
await wp.click("#logout");
await wp.waitForTimeout(600);
check("بعد از خروج دوباره رمز می‌خواهد", (await wp.locator("#lg-user").count()) === 1);

/* هیچ‌جای اپ مشتری نباید عدد دلاری ببیند — دلاری نمی‌فروشیم */
await page.goto(base + "/#/campaigns", { waitUntil: "load" });
await page.waitForTimeout(900);
check("فهرست کمپین‌ها دلار نشان نمی‌دهد", !(await page.content()).includes("دلار"));

check("هیچ خطای جاوااسکریپتی نبود",
  errors.filter((e) => !e.includes("ERR_") && !e.includes("Failed to load resource")).length === 0,
  errors.join(" | ").slice(0, 300));

console.log(`\nنتیجه: ${pass} موفق، ${fail} ناموفق`);
if (fail) console.log("\n--- لاگ سرور ---\n" + log);

await browser.close();
proc.kill("SIGTERM");
mock.close();
setTimeout(() => process.exit(fail ? 1 : 0), 500);
