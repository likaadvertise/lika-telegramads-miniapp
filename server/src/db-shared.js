/* =========================================================
   بخش‌های مشترک دیتابیس
   ---------------------------------------------------------
   این فایل هیچ دیتابیسی را صدا نمی‌زند. فقط چیزهایی اینجاست
   که هر دو نسخهٔ SQLite و Postgres یکسان از آن استفاده می‌کنند:
   شکل داده‌ها، تبدیل ردیف به کمپین، و ثابت‌ها.
   ========================================================= */

import crypto from "node:crypto";

/* شمارهٔ سفارش‌ها از LK-1044 شروع می‌شود (۱۰۴۳ در نسخهٔ نمایشی استفاده شده بود) */
export const CODE_OFFSET = 1043;

/* قوانین کد تأیید شماره */
export const CODE_TTL_MINUTES = 2;
export const CODE_MAX_ATTEMPTS = 5;
export const CODE_RESEND_SECONDS = 120;

export const now = () => new Date().toISOString();

export function hashCode(userId, code) {
  return crypto.createHash("sha256").update(`${userId}:${code}`).digest("hex");
}

/** آیا کد واردشده با کد ذخیره‌شده یکی است (مقایسهٔ امن در برابر حملهٔ زمانی) */
export function codeMatches(userId, given, storedHash) {
  const a = Buffer.from(hashCode(userId, String(given)), "hex");
  const b = Buffer.from(String(storedHash), "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** یک کد تصادفی ۵ رقمی (۱۰۰۰۰ تا ۹۹۹۹۹) */
export function makeCode() {
  return String(10000 + crypto.randomInt(90000));
}

/* =========================================================
   کاربرهای «سایت» (likaads.com)
   ---------------------------------------------------------
   کاربر واقعی تلگرام نیستند، پس آیدی عددی واقعی هم ندارند. برای
   این‌که در جدول users (که آیدی عددی می‌خواهد) جا بگیرند، از روی
   شماره موبایلشان یک عدد منفی و ثابت می‌سازیم — منفی، چون آیدی
   واقعی تلگرام همیشه مثبت است، پس هیچ‌وقت با کاربر واقعی برخورد
   نمی‌کند. همان شماره، همیشه همان عدد را می‌دهد.
   ========================================================= */
export function websiteUserId(phone) {
  const digits = String(phone).replace(/\D/g, "");
  return -Number(digits || "0");
}

export function safeParse(json) {
  if (Array.isArray(json)) return json;
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/* ---------- تبدیل ردیف دیتابیس به شکلی که مینی‌اپ می‌فهمد ---------- */
export function rowToCampaign(row, events = []) {
  if (!row) return null;
  return {
    id: row.code,
    adTitle: row.ad_title || "",
    userId: Number(row.user_id),
    source: row.source || "telegram",
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isSample: false,
    target: {
      type: row.target_type,
      url: row.target_url,
      brand: row.brand,
      channelTitle: row.channel_title || ""
    },
    creative: {
      text: row.ad_text,
      writtenByUs: Number(row.written_by_us) === 1,
      showPicture: Number(row.show_picture) === 1,
      /* پوستر خودش در تلگرام است؛ ما فقط شناسه‌اش را داریم */
      posterFileId: row.poster_file_id || ""
    },
    targeting: {
      countries: safeParse(row.countries),
      languages: safeParse(row.languages),
      topics: safeParse(row.topics),
      channels: safeParse(row.channels),
      keywords: safeParse(row.keywords)
    },
    budget: {
      amountUsd: Number(row.budget_usd),
      cpmUsd: Number(row.cpm_usd),
      startWhen: row.start_when,
      /* سفارش‌های قدیمی بسته ندارند و اینجا خالی می‌ماند */
      packageId: row.package_id || "",
      packageViews: Number(row.package_views) || 0,
      priceToman: Number(row.price_toman) || 0,
      discountPercent: Number(row.discount_percent) || 0,
      startDate: row.start_date || ""
    },
    /* رسید پرداخت — فایلش پیش تلگرام است، اینجا فقط شناسه و زمانش */
    receipt: {
      fileId: row.receipt_file_id || "",
      at: row.receipt_at || ""
    },
    notes: row.notes,
    adminNote: row.admin_note,
    stats: { views: Number(row.views), clicks: Number(row.clicks), joins: Number(row.joins) || 0 },
    history: events.map((e) => ({ status: e.status, at: e.at, note: e.note }))
  };
}

/** وضعیت ثبت‌نام، از روی ردیف جدول کاربران */
export function profileFromUser(u) {
  if (!u) {
    return { phone: "", firstName: "", lastName: "", email: "", registered: false, phoneVerified: false };
  }
  return {
    phone: u.phone || "",
    firstName: u.reg_first_name || "",
    lastName: u.reg_last_name || "",
    email: u.email || "",
    phoneVerified: Boolean(u.phone),
    registered: Boolean(u.phone && u.registered_at)
  };
}

/** خلاصهٔ آمار، از روی لیست کمپین‌های کاربر */
export function summaryFromCampaigns(all) {
  return {
    total: all.length,
    active: all.filter((c) => ["approved", "running"].includes(c.status)).length,
    waiting: all.filter((c) => c.status === "pending").length,
    spendToman: all
      .filter((c) => ["running", "done"].includes(c.status))
      .reduce((s, c) => s + c.budget.priceToman, 0),
    views: all.reduce((s, c) => s + c.stats.views, 0),
    clicks: all.reduce((s, c) => s + c.stats.clicks, 0),
    joins: all.reduce((s, c) => s + (c.stats.joins || 0), 0)
  };
}

/* ---------- پیام‌های خطای کد تأیید (در هر دو نسخه یکسان) ---------- */
export const CODE_ERRORS = {
  notSent: "کدی برای شما ارسال نشده است. دوباره درخواست کنید.",
  expired: "کد منقضی شده است. کد جدید بگیرید.",
  tooManyAttempts: "تعداد تلاش‌ها بیش از حد مجاز بود. کد جدید بگیرید.",
  wrong: (left) => (left > 0 ? `کد درست نیست. ${left} تلاش دیگر باقی مانده.` : "کد درست نیست.")
};

/** ردیف کاربر، آن‌طور که پنل مدیریت لازم دارد */
export function adminUserRow(row) {
  return {
    id: Number(row.id),
    firstName: row.reg_first_name || row.first_name || "",
    lastName: row.reg_last_name || row.last_name || "",
    username: row.username || "",
    phone: row.phone || "",
    email: row.email || "",
    source: row.source || "telegram",
    registeredAt: row.registered_at || "",
    lastSeenAt: row.last_seen_at || "",
    orders: Number(row.orders || 0)
  };
}
