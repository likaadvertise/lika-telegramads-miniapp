/* =========================================================
   خواندن تنظیمات از فایل .env
   ---------------------------------------------------------
   بدون هیچ کتابخانهٔ بیرونی؛ فقط امکانات خود Node.js.
   ========================================================= */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_DIR = path.resolve(HERE, "..");
export const REPO_DIR = path.resolve(SERVER_DIR, "..");
export const WEB_DIR = path.join(REPO_DIR, "web");

/* ---------- خواندن فایل .env ---------- */
function loadEnvFile() {
  const file = path.join(SERVER_DIR, ".env");
  if (!fs.existsSync(file)) return;

  for (const rawLine of fs.readFileSync(file, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    // حذف کوتیشن اگر کاربر گذاشته باشد
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // متغیرهای محیطی واقعی سیستم اولویت دارند
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile();

/* ---------- کمکی‌ها ---------- */
const str = (key, fallback = "") => (process.env[key] ?? fallback).trim();
const int = (key, fallback) => {
  const v = parseInt(str(key), 10);
  return Number.isFinite(v) ? v : fallback;
};
const bool = (key, fallback) => {
  const v = str(key).toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return fallback;
};
const idList = (key) =>
  str(key)
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);

/* ---------- تنظیمات نهایی ---------- */
export const config = {
  botToken: str("BOT_TOKEN"),

  /* توکن ربات دوم — فقط برای مینی‌اپ مدیریت (CRM).
     خالی بگذارید اگر CRM را روی همان ربات اصلی باز می‌کنید. */
  crmBotToken: str("CRM_BOT_TOKEN"),
  webappUrl: str("WEBAPP_URL").replace(/\/+$/, ""),
  adminChatId: str("ADMIN_CHAT_ID"),
  adminIds: idList("ADMIN_IDS"),

  port: int("PORT", 3000),
  dbPath: path.resolve(SERVER_DIR, str("DB_PATH", "./data/lika.db")),

  botMode: str("BOT_MODE", "polling").toLowerCase(),
  webhookSecret: str("WEBHOOK_SECRET"),
  serveWebapp: bool("SERVE_WEBAPP", true),

  // برای تست‌های خودکار قابل تغییر است
  botApiBase: str("BOT_API_BASE", "https://api.telegram.org"),

  // قوانین کسب‌وکار (باید با web/assets/js/config.js هماهنگ بماند)
  minBudgetUsd: Number(str("MIN_BUDGET_USD", "10")),
  maxBudgetUsd: Number(str("MAX_BUDGET_USD", "100000")),
  minCpmUsd: Number(str("MIN_CPM_USD", "0.5")),
  maxCpmUsd: Number(str("MAX_CPM_USD", "6")),
  adTextMaxLength: int("AD_TEXT_MAX_LENGTH", 160),

  // سقف کلیدواژه برای تبلیغ «جستجو» و حداقل تعداد کانال برای تبلیغ «کانال».
  // باید با web/assets/js/config.js یکی بماند.
  maxKeywords: int("MAX_KEYWORDS", 10),
  minChannels: int("MIN_CHANNELS", 5),

  // سقف تعداد سفارش هر کاربر در شبانه‌روز
  maxOrdersPerDay: int("MAX_ORDERS_PER_DAY", 20),

  /* ---------- پیامک ----------
     تا وقتی SMS_PROVIDER خالی باشد، پیامکی فرستاده نمی‌شود و کد
     مثل قبل در تلگرام می‌آید. توضیح کامل در server/src/sms.js
  */
  smsProvider: str("SMS_PROVIDER").toLowerCase(),   // kavenegar | smsir | custom
  smsApiKey: str("SMS_API_KEY"),
  smsTemplate: str("SMS_TEMPLATE"),
  smsBaseUrl: str("SMS_BASE_URL"),
  smsCodeParam: str("SMS_CODE_PARAM"),
  smsAuthHeader: str("SMS_AUTH_HEADER"),
  smsBody: str("SMS_BODY"),

  /* ---------- ورود به پنل مدیریت از راه وب ----------
     برای باز کردن پنل در مرورگر لپ‌تاپ، بدون تلگرام.
     تا وقتی هر دو خالی باشند، ورود با رمز خاموش است و پنل فقط از
     داخل تلگرام باز می‌شود (همان رفتار قبلی). */
  adminUser: str("ADMIN_USER"),
  adminPassword: str("ADMIN_PASSWORD"),
  // اختیاری. اگر خالی باشد، از روی رمز و توکن ربات ساخته می‌شود.
  adminSessionSecret: str("ADMIN_SESSION_SECRET"),

  // چند بار رمز غلط در ۱۰ دقیقه تحمل شود، قبل از قفل موقت.
  // برای رمز بلند، عدد بالا هم خطری ندارد؛ حدس زدن با ۲۰ تلاش در
  // ده دقیقه عملاً ناممکن است.
  adminLoginMaxAttempts: int("ADMIN_LOGIN_MAX_ATTEMPTS", 20),

  /* ---------- پرداخت کارت‌به‌کارت ----------
     تا وقتی درگاه پرداخت نداریم، مشتری مبلغ بسته را به این کارت
     می‌ریزد و رسیدش را برای پشتیبانی می‌فرستد.
     اگر شمارهٔ کارت خالی باشد، مینی‌اپ به‌جای کارت می‌گوید
     «برای پرداخت با پشتیبانی تماس بگیرید». */
  payCardNumber: str("PAY_CARD_NUMBER"),
  payCardHolder: str("PAY_CARD_HOLDER"),
  payCardBank: str("PAY_CARD_BANK"),

  /* مبالغ بزرگ را بانک‌ها با کارت‌به‌کارت قبول نمی‌کنند، پس از این
     مبلغ به بالا شمارهٔ شبا نشان داده می‌شود. اگر شبا خالی باشد،
     همان کارت نشان داده می‌شود — بهتر از کادر خالی. */
  payShebaNumber: str("PAY_SHEBA_NUMBER"),
  payShebaHolder: str("PAY_SHEBA_HOLDER"),
  payShebaBank: str("PAY_SHEBA_BANK"),
  payShebaMinToman: Number(str("PAY_SHEBA_MIN_TOMAN", "10000000")) || 10000000,


  // آیا در ثبت‌نام، کد تأیید به تلگرام کاربر فرستاده شود؟
  //   1 = بله (شماره → کد → نام)
  //   0 = خیر (شماره → نام)  ← مرحلهٔ کمتر، لید بیشتر
  requirePhoneCode: bool("REQUIRE_PHONE_CODE", true),

  /* ---------- سفارش‌های سایت (likaads.com) ----------
     سایت وردپرسی از راه /api/website-lead سفارش تلگرام‌ادز می‌فرستد،
     نه از داخل تلگرام — پس امضای initData را ندارد. به‌جایش این رمز
     مشترک را در هدر X-Website-Secret می‌فرستد. رمزی طولانی و تصادفی
     بگذارید و همان را در سایت وردپرسی هم وارد کنید. */
  websiteApiSecret: str("WEBSITE_API_SECRET")
};

export function isAdmin(userId) {
  const id = String(userId);
  return config.adminIds.includes(id) || id === String(config.adminChatId);
}

/* ---------- بررسی سلامت تنظیمات ---------- */
export function checkConfig() {
  const errors = [];
  const warnings = [];

  if (!config.botToken) {
    errors.push("BOT_TOKEN خالی است. توکن ربات را از @BotFather بگیرید و در فایل .env بگذارید.");
  } else if (!/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(config.botToken)) {
    errors.push("BOT_TOKEN معتبر به نظر نمی‌رسد. باید چیزی شبیه 1234567890:AAF... باشد.");
  }

  if (!config.webappUrl) {
    errors.push("WEBAPP_URL خالی است. آدرس اینترنتی مینی‌اپ را در فایل .env بگذارید.");
  } else if (!/^https:\/\//i.test(config.webappUrl) && !/^http:\/\/localhost/i.test(config.webappUrl)) {
    errors.push("WEBAPP_URL باید با https:// شروع شود (تلگرام آدرس بدون https را قبول نمی‌کند).");
  }

  if (!config.adminChatId) {
    warnings.push("ADMIN_CHAT_ID خالی است؛ سفارش‌های جدید برای هیچ‌کس ارسال نمی‌شود. با دستور /id در ربات آن را پیدا کنید.");
  }

  if (config.adminIds.length === 0) {
    warnings.push("ADMIN_IDS خالی است؛ هیچ‌کس نمی‌تواند وضعیت سفارش‌ها را از داخل تلگرام تغییر دهد.");
  }

  if (config.crmBotToken && !/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(config.crmBotToken)) {
    errors.push("CRM_BOT_TOKEN معتبر به نظر نمی‌رسد. باید چیزی شبیه 1234567890:AAF... باشد.");
  }

  if (config.botMode === "webhook" && !config.webhookSecret) {
    errors.push("در حالت webhook باید WEBHOOK_SECRET را پر کنید.");
  }

  // تلگرام برای این رمز فقط حروف انگلیسی، عدد، خط تیره و زیرخط را می‌پذیرد
  if (config.webhookSecret && !/^[A-Za-z0-9_-]{1,256}$/.test(config.webhookSecret)) {
    errors.push(
      "WEBHOOK_SECRET کاراکتر غیرمجاز دارد. تلگرام فقط حروف انگلیسی (a-z و A-Z)، " +
      "عدد (0-9)، خط تیره (-) و زیرخط (_) را قبول می‌کند — حداکثر ۲۵۶ کاراکتر. " +
      "نقطه، فاصله، حرف فارسی و علائم دیگر مجاز نیستند."
    );
  }

  if (!["polling", "webhook"].includes(config.botMode)) {
    errors.push('BOT_MODE فقط می‌تواند polling یا webhook باشد.');
  }

  return { errors, warnings };
}
