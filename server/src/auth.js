/* =========================================================
   احراز هویت کاربر مینی‌اپ
   ---------------------------------------------------------
   تلگرام هنگام باز شدن مینی‌اپ یک رشتهٔ امضاشده به نام initData
   به آن می‌دهد. اینجا آن امضا را با توکن ربات بررسی می‌کنیم تا
   مطمئن شویم درخواست واقعاً از تلگرام آمده و کسی خودش را
   جای کاربر دیگری جا نزده است.
   ========================================================= */

import crypto from "node:crypto";
import { config } from "./config.js";

/* حداکثر عمر مجاز initData: ۲۴ ساعت */
const MAX_AGE_SECONDS = 24 * 60 * 60;

/* پنل مدیریت روی ربات دوم باز می‌شود، و تلگرام امضای initData را با
   توکنِ همان رباتی می‌زند که مینی‌اپ از آن باز شده. پس باید هر دو
   کلید را بشناسیم، وگرنه مدیر با خطای ۴۰۱ پشت در می‌ماند.

   امنیت کم نمی‌شود: هر دو کلید متعلق به خودمان‌اند و ساختن امضای
   معتبر بدون داشتن توکن ممکن نیست. */
let cachedSecrets = null;
function secretKeys() {
  if (!cachedSecrets) {
    const tokens = [config.botToken, config.crmBotToken].filter(Boolean);
    cachedSecrets = tokens.map((t) => ({
      bot: t === config.botToken ? "main" : "crm",
      key: crypto.createHmac("sha256", "WebAppData").update(t).digest()
    }));
  }
  return cachedSecrets;
}

/**
 * بررسی صحت initData
 * @returns {{ok: true, user: object, authDate: number} | {ok: false, reason: string}}
 */
export function verifyInitData(initData) {
  if (!initData || typeof initData !== "string") {
    return { ok: false, reason: "initData ارسال نشده است." };
  }

  let params;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, reason: "initData قابل خواندن نیست." };
  }

  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "امضای initData وجود ندارد." };

  /*
     رشته‌ای که تلگرام رویش امضا زده است.

     تلگرام در نسخه‌های تازه فیلد signature را هم اضافه کرده و اینکه
     این فیلد در محاسبهٔ امضا حساب شود یا نه، بین نسخه‌های کلاینت
     یکسان نیست. پس هر دو حالت را امتحان می‌کنیم.

     این کار امنیت را کم نمی‌کند: ساختن هر کدام از این دو امضا بدون
     داشتن توکن ربات ممکن نیست.
  */
  const fields = [...params.entries()].filter(([key]) => key !== "hash");

  const candidates = [
    fields.filter(([key]) => key !== "signature"),
    fields
  ];

  let signedBy = null;
  for (const set of candidates) {
    const checkString = set
      .map(([key, value]) => `${key}=${value}`)
      .sort()
      .join("\n");

    for (const { bot, key } of secretKeys()) {
      const computed = crypto.createHmac("sha256", key).update(checkString).digest("hex");
      const a = Buffer.from(computed, "hex");
      const b = Buffer.from(hash, "hex");
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) { signedBy = bot; break; }
    }
    if (signedBy) break;
  }

  if (!signedBy) {
    // نام فیلدها (نه مقدارشان) برای عیب‌یابی؛ هیچ‌کدام محرمانه نیستند
    const names = fields.map(([key]) => key).sort().join("، ");
    return { ok: false, reason: `امضای initData معتبر نیست. فیلدهای دریافتی: ${names}.` };
  }

  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate) return { ok: false, reason: "زمان ورود مشخص نیست." };

  const age = Math.floor(Date.now() / 1000) - authDate;
  if (age > MAX_AGE_SECONDS) {
    return { ok: false, reason: "نشست شما منقضی شده است. لطفاً مینی‌اپ را دوباره باز کنید." };
  }

  let user;
  try {
    user = JSON.parse(params.get("user") || "null");
  } catch {
    user = null;
  }
  if (!user || !user.id) return { ok: false, reason: "اطلاعات کاربر در initData نیست." };

  return { ok: true, user, authDate, bot: signedBy };
}

/* =========================================================
   محدودکنندهٔ ساده نرخ درخواست (در حافظه)
   ========================================================= */
const buckets = new Map();

export function rateLimit(key, { max = 60, windowMs = 60000 } = {}) {
  const nowMs = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || nowMs > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: nowMs + windowMs });
    return { allowed: true, remaining: max - 1 };
  }

  bucket.count += 1;
  if (bucket.count > max) return { allowed: false, remaining: 0 };
  return { allowed: true, remaining: max - bucket.count };
}

/* پاک‌سازی دوره‌ای تا حافظه پر نشود */
const cleanupTimer = setInterval(() => {
  const nowMs = Date.now();
  for (const [key, bucket] of buckets) {
    if (nowMs > bucket.resetAt) buckets.delete(key);
  }
}, 5 * 60 * 1000);

cleanupTimer.unref();
