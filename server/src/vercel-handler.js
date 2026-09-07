/* =========================================================
   ورودی مشترک همهٔ توابع Vercel
   ---------------------------------------------------------
   روی Vercel هر فایل داخل پوشهٔ api یک تابع جداست، ولی همهٔ
   آن‌ها همین یک کار را می‌کنند: درخواست را به handleApi بسپار.

   چرا چند فایل به‌جای یک catch-all؟ چون مسیریابی خودکار Vercel
   آدرس‌های تودرتو مثل /api/register/phone را به تابع catch-all
   نمی‌رساند و خودش ۴۰۴ می‌دهد — بدون اینکه کد ما اصلاً اجرا شود.
   با یک فایل صریح برای هر مسیر، این ابهام از بین می‌رود.
   ========================================================= */

import { handleApi } from "./api.js";

export default async function handleVercelRequest(req, res) {
  let url;
  try {
    url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
  } catch {
    res.status(400).send("Bad Request");
    return;
  }

  try {
    if (await handleApi(req, res, url)) return;

    res.status(404).json({ ok: false, error: "این آدرس وجود ندارد." });
  } catch (err) {
    console.error("[api]", err);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: "خطای داخلی سرور" });
    }
  }
}
