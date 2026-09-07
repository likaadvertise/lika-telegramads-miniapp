/* مسیرهای پنل مدیریت روی Vercel.
   چرا فایل جدا؟ مسیریابی خودکار Vercel آدرس‌های تودرتو را به تابع
   catch-all نمی‌رساند و خودش ۴۰۴ می‌دهد — همان چیزی که سر
   /api/register/phone هم پیش آمد. */
export { default } from "../../server/src/vercel-handler.js";
