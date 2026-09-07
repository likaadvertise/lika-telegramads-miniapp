/* =========================================================
   ورود به پنل مدیریت از راه وب
   ---------------------------------------------------------
   پنل تا امروز فقط از داخل تلگرام باز می‌شد و هویت را از امضای
   تلگرام می‌گرفت. برای کار کردن با لپ‌تاپ، یک راه ورود دوم لازم
   است: نام کاربری و رمز.

   بلیت ورود (token) در دیتابیس ذخیره نمی‌شود؛ خودش امضا دارد.
   یعنی سرور بدون نگه داشتن هیچ چیزی می‌تواند بگوید این بلیت را
   خودش صادر کرده یا نه — که روی Vercel مهم است، چون آنجا سرور
   بین درخواست‌ها حافظه‌ای ندارد.

   ⚠️ رمز و کلید امضا هر دو از فایل .env می‌آیند و هیچ‌وقت داخل کد
      نوشته نمی‌شوند.
   ========================================================= */

import crypto from "node:crypto";
import { config } from "./config.js";

/* اعتبار هر بار ورود: ۱۲ ساعت. بعد از آن دوباره رمز خواسته می‌شود. */
const TTL_SECONDS = 12 * 3600;

/**
 * کلید امضای بلیت‌ها.
 * اگر ADMIN_SESSION_SECRET نگذاشته باشند، از روی رمز و توکن ربات
 * ساخته می‌شود — پس با عوض شدن رمز، همهٔ بلیت‌های قبلی باطل می‌شوند.
 */
function signingKey() {
  const explicit = config.adminSessionSecret;
  if (explicit) return Buffer.from(explicit, "utf8");
  return crypto.createHash("sha256")
    .update("lika-admin|" + config.adminPassword + "|" + config.botToken)
    .digest();
}

function sign(data) {
  return crypto.createHmac("sha256", signingKey()).update(data).digest("base64url");
}

/** آیا ورود با رمز اصلاً روشن است؟ */
export function webLoginEnabled() {
  return Boolean(config.adminUser && config.adminPassword);
}

/** مقایسهٔ امن در برابر حملهٔ زمانی (طول رشته‌ها هم لو نرود) */
function sameSecret(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * بررسی نام کاربری و رمز.
 * @returns {{ok: true, token: string, expiresAt: number} | {ok: false, error: string}}
 */
export function login(username, password) {
  if (!webLoginEnabled()) {
    return { ok: false, error: "ورود با رمز روی این سرور تنظیم نشده است." };
  }

  const userOk = sameSecret(String(username ?? "").trim(), config.adminUser);
  const passOk = sameSecret(String(password ?? ""), config.adminPassword);

  // هر دو را می‌سنجیم تا از روی زمان پاسخ نشود فهمید کدام غلط بوده
  if (!userOk || !passOk) {
    return {
      ok: false,
      error: "نام کاربری یا رمز درست نیست.",
      // فقط برای لاگ سرور؛ هیچ‌وقت به مرورگر فرستاده نمی‌شود
      detail: !userOk && !passOk ? "هر دو غلط بود"
            : !userOk ? "نام کاربری با ADMIN_USER نمی‌خواند"
            : "رمز با ADMIN_PASSWORD نمی‌خواند"
    };
  }

  return makeToken();
}

function makeToken() {
  const expiresAt = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const payload = Buffer.from(JSON.stringify({ u: config.adminUser, exp: expiresAt }), "utf8")
    .toString("base64url");
  return { ok: true, token: payload + "." + sign(payload), expiresAt };
}

/**
 * آیا این بلیت را خودمان صادر کرده‌ایم و هنوز معتبر است؟
 * @returns {{ok: true, user: string} | {ok: false, reason: string}}
 */
export function verifyToken(token) {
  const raw = String(token || "").trim();
  if (!raw) return { ok: false, reason: "بلیت ورود ارسال نشده است." };

  const dot = raw.lastIndexOf(".");
  if (dot < 1) return { ok: false, reason: "بلیت ورود معتبر نیست." };

  const payload = raw.slice(0, dot);
  const given = raw.slice(dot + 1);
  const expected = sign(payload);

  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "بلیت ورود معتبر نیست." };
  }

  let data;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "بلیت ورود خوانده نشد." };
  }

  if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: "نشست شما تمام شد. دوباره وارد شوید." };
  }

  /* اگر رمز عوض شده باشد، کلید امضا هم عوض می‌شود و بلیت‌های قدیمی
     خودبه‌خود بالا رد می‌شوند. این بررسی برای وقتی است که نام کاربری
     عوض شده ولی رمز همان مانده. */
  if (config.adminUser && data.u !== config.adminUser) {
    return { ok: false, reason: "نشست شما دیگر معتبر نیست." };
  }

  return { ok: true, user: data.u };
}

/** بلیت را از هدر Authorization درمی‌آورد */
export function bearerOf(req) {
  const header = String(req.headers?.authorization || "");
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}
