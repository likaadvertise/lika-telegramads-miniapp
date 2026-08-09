/* =========================================================
   گرفتن نام و عکس کانال/ربات از تلگرام
   ---------------------------------------------------------
   برای اینکه پیش‌نمایش تبلیغ دقیقاً مثل چیزی باشد که مخاطب
   در تلگرام می‌بیند، نام واقعی و عکس پروفایل مقصد را از خود
   تلگرام می‌گیریم.

   ⚠️ آدرس دانلود فایل شامل توکن ربات است، پس هرگز به مینی‌اپ
      داده نمی‌شود؛ عکس از طریق همین سرور رد می‌شود.
   ========================================================= */

import { config } from "./config.js";
import { call } from "./telegram.js";

const INFO_TTL_MS = 10 * 60 * 1000;   // نام کانال: ۱۰ دقیقه
const PHOTO_TTL_MS = 60 * 60 * 1000;  // عکس: ۱ ساعت

const infoCache = new Map();
const photoCache = new Map();

/** آدرس ورودی را به @username تمیز تبدیل می‌کند */
export function normalizeUsername(input) {
  const raw = String(input ?? "").trim();
  const m = raw.match(/^(?:https?:\/\/)?(?:t\.me\/)?@?([A-Za-z0-9_]{4,32})\/?$/i);
  return m ? "@" + m[1] : null;
}

function fromCache(map, key, ttl) {
  const hit = map.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > ttl) { map.delete(key); return null; }
  return hit.value;
}

/**
 * نام و مشخصات کانال یا ربات
 * @returns {Promise<{ok:true, title:string, username:string, type:string, hasPhoto:boolean}
 *                  | {ok:false, error:string}>}
 */
export async function getChatInfo(input) {
  const username = normalizeUsername(input);
  if (!username) return { ok: false, error: "آدرس معتبر نیست." };

  const cached = fromCache(infoCache, username, INFO_TTL_MS);
  if (cached) return cached;

  let chat;
  try {
    chat = await call("getChat", { chat_id: username });
  } catch (err) {
    const result = {
      ok: false,
      error: /not found|chat not found/i.test(err.message)
        ? "این آدرس در تلگرام پیدا نشد."
        : "دریافت اطلاعات از تلگرام ممکن نشد."
    };
    infoCache.set(username, { at: Date.now(), value: result });
    return result;
  }

  const result = {
    ok: true,
    title: chat.title || chat.first_name || username.slice(1),
    username,
    type: chat.type || "",
    hasPhoto: Boolean(chat.photo)
  };

  infoCache.set(username, { at: Date.now(), value: result });
  return result;
}

/**
 * عکس پروفایل مقصد (بایت‌های تصویر)
 * @returns {Promise<{ok:true, body:Buffer, contentType:string} | {ok:false}>}
 */
export async function getChatPhoto(input) {
  const username = normalizeUsername(input);
  if (!username) return { ok: false };

  const cached = fromCache(photoCache, username, PHOTO_TTL_MS);
  if (cached) return cached;

  try {
    const chat = await call("getChat", { chat_id: username });
    const fileId = chat?.photo?.small_file_id;
    if (!fileId) {
      const miss = { ok: false };
      photoCache.set(username, { at: Date.now(), value: miss });
      return miss;
    }

    const file = await call("getFile", { file_id: fileId });
    const url = `${config.botApiBase}/file/bot${config.botToken}/${file.file_path}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error("HTTP " + res.status);

    const value = {
      ok: true,
      body: Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get("content-type") || "image/jpeg"
    };
    photoCache.set(username, { at: Date.now(), value });
    return value;
  } catch (err) {
    console.error("[chatinfo] عکس گرفته نشد:", err.message);
    const miss = { ok: false };
    photoCache.set(username, { at: Date.now(), value: miss });
    return miss;
  }
}
