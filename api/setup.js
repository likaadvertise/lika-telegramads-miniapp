/* =========================================================
   راه‌اندازی یک‌بارهٔ ربات روی Vercel
   ---------------------------------------------------------
   بعد از اینکه پروژه روی Vercel بالا آمد، یک‌بار این آدرس را
   در مرورگر باز کنید:

       https://آدرس-پروژه/api/setup?secret=مقدارِ-WEBHOOK_SECRET

   این کار سه چیز را انجام می‌دهد:
     ۱) جدول‌های دیتابیس را می‌سازد (اگر نباشند)
     ۲) دستورها و دکمهٔ منوی ربات را تنظیم می‌کند
     ۳) آدرس دریافت پیام‌ها (webhook) را به تلگرام معرفی می‌کند

   بعد از هر تغییر در WEBAPP_URL یا WEBHOOK_SECRET دوباره بازش کنید.
   ========================================================= */

import crypto from "node:crypto";
import { config, checkConfig } from "../server/src/config.js";
import { setupBot, call } from "../server/src/telegram.js";
import { initDb } from "../server/src/db.js";

/** مقایسهٔ رمز به‌گونه‌ای که از روی زمانِ پاسخ نشود حدسش زد */
function secretMatches(given, expected) {
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);

  if (!config.webhookSecret) {
    res.status(500).json({
      ok: false,
      error: "WEBHOOK_SECRET در تنظیمات Vercel خالی است. یک رشتهٔ تصادفی طولانی برایش بگذارید."
    });
    return;
  }

  if (!secretMatches(url.searchParams.get("secret") || "", config.webhookSecret)) {
    res.status(401).json({ ok: false, error: "رمز درست نیست." });
    return;
  }

  const { errors, warnings } = checkConfig();
  if (errors.length) {
    res.status(400).json({ ok: false, error: "تنظیمات ناقص است.", موارد: errors });
    return;
  }

  const steps = [];

  try {
    const kind = await initDb();
    steps.push(`دیتابیس آماده شد (${kind})`);
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: "اتصال به دیتابیس ممکن نشد.",
      جزئیات: err.message,
      راهنما: "در تنظیمات Vercel مطمئن شوید POSTGRES_URL وجود دارد و دیتابیس به پروژه وصل است."
    });
    return;
  }

  let me;
  try {
    me = await setupBot();
    steps.push(`ربات متصل شد: @${me.username}`);
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: "اتصال به تلگرام ممکن نشد.",
      جزئیات: err.message,
      راهنما: "معمولاً یعنی BOT_TOKEN اشتباه است."
    });
    return;
  }

  const webhookUrl = `${config.webappUrl}/api/telegram`;

  try {
    await call("setWebhook", {
      url: webhookUrl,
      secret_token: config.webhookSecret,
      allowed_updates: ["message", "callback_query"]
    });
    steps.push(`آدرس دریافت پیام‌ها ثبت شد: ${webhookUrl}`);
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: "ثبت آدرس دریافت پیام‌ها ممکن نشد.",
      جزئیات: err.message,
      راهنما: "مطمئن شوید WEBAPP_URL دقیقاً همان آدرس https پروژه روی Vercel است."
    });
    return;
  }

  res.status(200).json({
    ok: true,
    پیام: "همه‌چیز آماده است. حالا در تلگرام به ربات /start بدهید.",
    ربات: `@${me.username}`,
    مینی‌اپ: config.webappUrl,
    مراحل: steps,
    هشدارها: warnings
  });
}
