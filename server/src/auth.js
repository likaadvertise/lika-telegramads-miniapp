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

let cachedSecret = null;
function secretKey() {
  if (!cachedSecret) {
    cachedSecret = crypto.createHmac("sha256", "WebAppData").update(config.botToken).digest();
  }
  return cachedSecret;
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

  const checkString = [...params.entries()]
    .filter(([key]) => key !== "hash" && key !== "signature")
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");

  const computed = crypto.createHmac("sha256", secretKey()).update(checkString).digest("hex");

  const a = Buffer.from(computed, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "امضای initData معتبر نیست." };
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

  return { ok: true, user, authDate };
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
