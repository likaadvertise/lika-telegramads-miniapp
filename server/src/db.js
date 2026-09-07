/* =========================================================
   دیتابیس — انتخاب‌گر
   ---------------------------------------------------------
   پروژه با دو دیتابیس کار می‌کند و خودش تشخیص می‌دهد کدام:

     • اگر POSTGRES_URL تنظیم شده باشد  →  Postgres
       (روی Vercel، چون آنجا دیسک ماندگار وجود ندارد)

     • در غیر این صورت                   →  SQLite
       (روی کامپیوتر خودتان، در تست‌ها، و روی سرور اوبونتو)

   بقیهٔ برنامه فقط همین فایل را می‌شناسد و نمی‌داند پشت صحنه
   کدام دیتابیس کار می‌کند.

   همهٔ توابع async هستند چون Postgres ناچار async است.
   ========================================================= */

export const usingPostgres = Boolean(
  process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL
);

/* ماژول دیتابیس فقط یک‌بار بارگذاری و آماده می‌شود */
let backendPromise = null;

function backend() {
  if (!backendPromise) {
    backendPromise = (async () => {
      const mod = usingPostgres
        ? await import("./db-postgres.js")
        : await import("./db-sqlite.js");
      await mod.init();
      return mod;
    })().catch((err) => {
      backendPromise = null; // تا درخواست بعدی دوباره تلاش شود
      throw err;
    });
  }
  return backendPromise;
}

/** آماده‌سازی دیتابیس (ساخت جدول‌ها). صدا زدنش اجباری نیست ولی خطا را زودتر نشان می‌دهد. */
export async function initDb() {
  await backend();
  return usingPostgres ? "postgres" : "sqlite";
}

/* ---------- کاربران ---------- */
export async function upsertUser(u) {
  return (await backend()).upsertUser(u);
}

export async function getUser(id) {
  return (await backend()).getUser(id);
}

/* ---------- ثبت‌نام ---------- */
export async function findUserByPhone(phone) {
  return (await backend()).findUserByPhone(phone);
}

export async function issuePhoneCode(userId, phone) {
  return (await backend()).issuePhoneCode(userId, phone);
}

export async function checkPhoneCode(userId, code) {
  return (await backend()).checkPhoneCode(userId, code);
}

export async function setPhoneDirect(userId, phone) {
  return (await backend()).setPhoneDirect(userId, phone);
}

export async function completeRegistration(userId, firstName, lastName, email = "") {
  return (await backend()).completeRegistration(userId, firstName, lastName, email);
}

export async function profileOf(userId) {
  return (await backend()).profileOf(userId);
}

/* ---------- کمپین‌ها ---------- */
export async function countOrdersToday(userId) {
  return (await backend()).countOrdersToday(userId);
}

export async function createCampaign(userId, data) {
  return (await backend()).createCampaign(userId, data);
}

/** ثبت سفارش تلگرام‌ادز که از سایت likaads.com می‌آید، نه از داخل مینی‌اپ */
export async function createWebsiteCampaign(input) {
  return (await backend()).createWebsiteCampaign(input);
}

export async function getCampaignByCode(code) {
  return (await backend()).getCampaignByCode(code);
}

export async function listCampaignsByUser(userId, limit = 50) {
  return (await backend()).listCampaignsByUser(userId, limit);
}

export async function setCampaignStatus(code, status, actor, note = "") {
  return (await backend()).setCampaignStatus(code, status, actor, note);
}

export async function setCampaignStats(code, views, clicks, joins) {
  return (await backend()).setCampaignStats(code, views, clicks, joins);
}

export async function summaryForUser(userId) {
  return (await backend()).summaryForUser(userId);
}

/** بستن اتصال‌ها (فقط Postgres لازم دارد) */
export async function closeDb() {
  if (!backendPromise) return;
  const mod = await backendPromise;
  if (typeof mod.close === "function") await mod.close();
  backendPromise = null;
}

/* ---------- پنل مدیریت ---------- */

export async function listRegisteredUsers(limit = 500) {
  return (await backend()).listRegisteredUsers(limit);
}

export async function listAllCampaigns(limit = 500) {
  return (await backend()).listAllCampaigns(limit);
}

export async function editCampaign(code, data, actor) {
  return (await backend()).editCampaign(code, data, actor);
}

/** حذف کامل یک سفارش — فقط برای مدیر؛ برگشت‌ناپذیر است */
export async function deleteCampaign(code) {
  return (await backend()).deleteCampaign(code);
}

/** ثبت رسید پرداخت روی یک سفارش */
export async function setCampaignReceipt(code, fileId) {
  return (await backend()).setCampaignReceipt(code, fileId);
}

export async function editUser(id, data) {
  return (await backend()).editUser(id, data);
}

/** حذف مشتری — فقط اگر هیچ سفارشی نداشته باشد */
export async function deleteUser(id) {
  return (await backend()).deleteUser(id);
}
