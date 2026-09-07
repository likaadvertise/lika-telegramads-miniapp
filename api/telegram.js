/* =========================================================
   دریافت پیام‌های تلگرام روی Vercel (webhook)
   ---------------------------------------------------------
   روی سرور معمولی، ربات خودش هر چند ثانیه از تلگرام می‌پرسد
   «پیام جدیدی هست؟» (polling). روی Vercel این ممکن نیست، چون
   برنامه همیشه در حال اجرا نیست.

   پس برعکسش می‌کنیم: تلگرام هر پیام را به این آدرس می‌فرستد.
   آدرس این صفحه یک‌بار با /api/setup به تلگرام معرفی می‌شود.
   ========================================================= */

import { config } from "../server/src/config.js";
import { handleUpdate } from "../server/src/bot.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  /*
     فقط تلگرام باید بتواند اینجا پیام بفرستد. این رمز را خودمان
     هنگام معرفی آدرس به تلگرام داده‌ایم و تلگرام آن را پس می‌فرستد.
  */
  if (!config.webhookSecret ||
      req.headers["x-telegram-bot-api-secret-token"] !== config.webhookSecret) {
    res.status(401).send("Unauthorized");
    return;
  }

  let update = req.body;
  if (typeof update === "string") {
    try { update = JSON.parse(update); } catch { update = null; }
  } else if (Buffer.isBuffer(update)) {
    try { update = JSON.parse(update.toString("utf8")); } catch { update = null; }
  }

  if (!update || typeof update !== "object") {
    res.status(400).send("Bad Request");
    return;
  }

  /*
     مهم: اینجا برخلاف سرور معمولی، اول کار را تمام می‌کنیم و بعد
     پاسخ می‌دهیم. روی Vercel به‌محض پاسخ دادن، اجرا متوقف می‌شود و
     کاری که تمام نشده باشد نیمه‌کاره می‌ماند.
  */
  try {
    await handleUpdate(update);
  } catch (err) {
    console.error("[webhook]", err);
  }

  res.status(200).send("OK");
}
