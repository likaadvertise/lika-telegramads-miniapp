/* =========================================================
   بررسی اطلاعات سفارش در سمت سرور
   ---------------------------------------------------------
   مینی‌اپ خودش هم اطلاعات را بررسی می‌کند، ولی هرگز نباید
   فقط به آن اعتماد کرد؛ چون کسی می‌تواند مستقیم به سرور
   درخواست بفرستد. پس همه‌چیز اینجا دوباره بررسی می‌شود.
   ========================================================= */

import { config } from "./config.js";
import { findPackage, packagesFor, finalPrice, discountOf } from "./packages.js";

/* هر نوع تبلیغ چه چیزی لازم دارد — برگرفته از فرم واقعی Telegram Ads:
     • تب Channels  متن تبلیغ دارد، هدف‌گیری‌اش فهرست کانال‌هاست
     • تب Search    کادر «متن تبلیغ» اصلاً ندارد؛ هدف‌گیری‌اش کلیدواژه است
     • تب Bots      هنوز بررسی نشده؛ فعلاً مثل کانال در نظر گرفته شده
   ⚠️ باید با همان جدول در web/assets/js/store.js یکی بماند. */
const TYPE_RULES = {
  channel: { needsText: true,  needsKeywords: false },
  search:  { needsText: false, needsKeywords: true },
  bot:     { needsText: true,  needsKeywords: false }
};
const TARGET_TYPES = Object.keys(TYPE_RULES);
const START_WHEN = ["asap", "week", "custom"];

const URL_PATTERNS = [
  /^@[A-Za-z0-9_]{4,32}$/,
  /^(https?:\/\/)?t\.me\/[A-Za-z0-9_+/]{3,64}$/i
];


/* ---------- پوستر تبلیغ ----------
   مینی‌اپ عکس را به شکل data:image/jpeg;base64,... می‌فرستد. اینجا فقط
   می‌سنجیم که واقعاً عکس باشد و از سقف حجم نگذرد؛ خودِ فایل جای دیگری
   (تلگرام) نگه داشته می‌شود، نه در دیتابیس ما. */
const MAX_POSTER_BYTES = 900 * 1024;

/**
 * عکسی که مینی‌اپ به شکل data:image/...;base64 فرستاده را می‌خواند.
 * هم برای پوستر تبلیغ است، هم برای رسید پرداخت.
 * @returns {{ok: true, bytes: Buffer|null} | {ok: false, error: string}}
 */
export function readImage(value, maxBytes = MAX_POSTER_BYTES) {
  const raw = String(value ?? "").trim();
  if (!raw) return { ok: true, bytes: null };

  const m = /^data:image\/(jpeg|jpg|png);base64,([A-Za-z0-9+/=]+)$/.exec(raw);
  if (!m) return { ok: false, error: "قالب عکس پشتیبانی نمی‌شود. فقط JPG یا PNG." };

  let bytes;
  try {
    bytes = Buffer.from(m[2], "base64");
  } catch {
    return { ok: false, error: "عکس خوانده نشد." };
  }

  if (bytes.length === 0) return { ok: false, error: "عکس خالی است." };
  if (bytes.length > maxBytes) return { ok: false, error: "حجم عکس بیش از حد مجاز است." };

  return { ok: true, bytes };
}

const readPoster = (value) => readImage(value, MAX_POSTER_BYTES);

function cleanText(value, maxLength) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

/**
 * تاریخ شروع را می‌پذیرد اگر «YYYY-MM-DD» سالمی باشد که نه دیروز است
 * نه بیش از یک سال بعد. هر چیز دیگری خالی برمی‌گردد — یعنی سفارش
 * تاریخ مشخصی ندارد و کارشناس هماهنگ می‌کند.
 */
function cleanStartDate(value) {
  const raw = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";

  const [y, m, d] = raw.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return "";   // مثل ۳۱ اسفندِ نبودنی
  }

  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (date.getTime() < todayUtc) return "";                       // گذشته
  if (date.getTime() > todayUtc + 366 * 86400000) return "";      // بیش از یک سال بعد

  return raw;
}

function cleanList(value, { max = 40, itemMax = 64 } = {}) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((x) => String(x ?? "").trim()).filter(Boolean))]
    .slice(0, max)
    .map((x) => x.slice(0, itemMax));
}

/* =========================================================
   شماره تماس و نام
   ========================================================= */

/** تبدیل ارقام فارسی و عربی به انگلیسی */
function latinDigits(value) {
  return String(value ?? "")
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}

/**
 * شمارهٔ موبایل را به شکل استاندارد بین‌المللی درمی‌آورد.
 * ورودی‌های پذیرفته‌شده: ۰۹۱۲۳۴۵۶۷۸۹ / 09123456789 / 9123456789 /
 *                        00989123456789 / +989123456789 / +49...
 * @returns {{ok: true, phone: string} | {ok: false, error: string}}
 */
export function normalizePhone(input) {
  let raw = latinDigits(input).replace(/[\s()\-._]/g, "").trim();

  if (!raw) return { ok: false, error: "شمارهٔ موبایل را وارد کنید." };

  if (raw.startsWith("00")) raw = "+" + raw.slice(2);

  // شماره‌های ایرانی
  if (/^09\d{9}$/.test(raw)) return { ok: true, phone: "+98" + raw.slice(1) };
  if (/^9\d{9}$/.test(raw)) return { ok: true, phone: "+98" + raw };
  if (/^\+989\d{9}$/.test(raw)) return { ok: true, phone: raw };

  // شماره‌های بین‌المللی
  if (/^\+\d{8,15}$/.test(raw)) return { ok: true, phone: raw };

  return { ok: false, error: "شمارهٔ موبایل درست نیست. مثال: ۰۹۱۲۳۴۵۶۷۸۹" };
}

/** نام یا نام خانوادگی */
export function validateName(input, label) {
  const name = String(input ?? "").replace(/\s+/g, " ").trim();

  if (name.length < 2) return { ok: false, error: `${label} را کامل وارد کنید.` };
  if (name.length > 40) return { ok: false, error: `${label} خیلی طولانی است.` };
  if (!/^[\p{L}\u200c\s'’-]+$/u.test(name)) {
    return { ok: false, error: `${label} فقط می‌تواند شامل حروف باشد.` };
  }
  return { ok: true, name };
}

/** ایمیل — اختیاری است؛ خالی هم قبول می‌شود */
export function validateEmail(input) {
  const email = String(input ?? "").trim();
  if (!email) return { ok: true, email: "" };
  if (email.length > 100) return { ok: false, error: "ایمیل خیلی طولانی است." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "ایمیل معتبر نیست." };
  }
  return { ok: true, email: email.toLowerCase() };
}

/** کد تأیید ۵ رقمی */
export function normalizeCode(input) {
  const code = latinDigits(input).replace(/\D/g, "");
  if (code.length !== 5) return { ok: false, error: "کد تأیید ۵ رقمی است." };
  return { ok: true, code };
}

/**
 * @returns {{ok: true, data: object} | {ok: false, error: string}}
 */
export function validateCampaign(input) {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "اطلاعات سفارش ارسال نشده است." };
  }

  const target = input.target || {};
  const creative = input.creative || {};
  const targeting = input.targeting || {};
  const budget = input.budget || {};

  /* ---------- مقصد ---------- */
  const targetType = String(target.type || "").trim();
  if (!TARGET_TYPES.includes(targetType)) {
    return { ok: false, error: "نوع مقصد تبلیغ معتبر نیست." };
  }

  const targetUrl = cleanText(target.url, 128);
  if (!URL_PATTERNS.some((re) => re.test(targetUrl))) {
    return { ok: false, error: "آدرس مقصد معتبر نیست. مثال درست: @lika_shop" };
  }

  const brand = cleanText(target.brand, 64);
  if (brand.length < 2) {
    return { ok: false, error: "نام برند را وارد کنید." };
  }

  /* ---------- عنوان تبلیغ (نامی که کمپین با آن شناخته می‌شود) ---------- */
  const adTitle = cleanText(input.adTitle, 40);
  if (adTitle.length < 2) {
    return { ok: false, error: "عنوان تبلیغ را وارد کنید." };
  }

  const rules = TYPE_RULES[targetType];

  /* ---------- متن تبلیغ ----------
     تبلیغ جستجو در تلگرام متن ندارد؛ فقط عنوان و لینک. پس برای آن
     نوع، متن نه خواسته می‌شود و نه ذخیره. */
  const adText = rules.needsText ? cleanText(creative.text, config.adTextMaxLength + 40) : "";
  if (rules.needsText) {
    if (adText.length < 10) {
      return { ok: false, error: "متن تبلیغ خیلی کوتاه است." };
    }
    if (adText.length > config.adTextMaxLength) {
      return { ok: false, error: `متن تبلیغ نباید بیشتر از ${config.adTextMaxLength} کاراکتر باشد.` };
    }
  }

  /* ---------- هدف‌گیری ----------
     کشور، زبان و موضوع دیگر از مشتری پرسیده نمی‌شوند چون تلگرام در هیچ‌کدام
     از تب‌هایش کادری برایشان ندارد. هنوز پذیرفته می‌شوند تا سفارش‌های قدیمی
     و کلاینت‌های به‌روزنشده نشکنند، ولی اجباری نیستند. */
  const countries = cleanList(targeting.countries, { max: 60, itemMax: 4 });

  const languages = cleanList(targeting.languages, { max: 20, itemMax: 32 });
  const topics = cleanList(targeting.topics, { max: 30, itemMax: 32 });
  const channels = cleanList(targeting.channels, { max: 200, itemMax: 64 });
  const keywords = cleanList(targeting.keywords, { max: 200, itemMax: 64 });

  /* تبلیغ جستجو بدون کلیدواژه در تلگرام هیچ‌جا نشان داده نمی‌شود،
     پس گرفتن چنین سفارشی یعنی گرفتن پولی که نمی‌شود خرجش کرد. */
  if (rules.needsKeywords) {
    if (keywords.length === 0) {
      return { ok: false, error: "برای تبلیغ جستجو حداقل یک کلیدواژه لازم است." };
    }
    if (keywords.length > config.maxKeywords) {
      return { ok: false, error: `حداکثر ${config.maxKeywords} کلیدواژه مجاز است.` };
    }
  }

  if (!rules.needsKeywords) {
    /* تلگرام تبلیغ کانالی را روی کمتر از این تعداد کانال اجرا نمی‌کند.
       فهرست خالی ایراد ندارد — یعنی کارشناس لیکا خودش کانال‌ها را می‌چیند. */
    if (channels.length > 0 && channels.length < config.minChannels) {
      return {
        ok: false,
        error: `تلگرام برای تبلیغ کانالی حداقل ${config.minChannels} کانال می‌خواهد.`
      };
    }
  }

  /* ---------- بسته یا بودجه ----------
     برای نوع‌هایی که بستهٔ آماده دارند (فعلاً کانال)، مشتری یکی از
     بسته‌ها را می‌زند و ما قیمت را از فهرست خودمان برمی‌داریم — نه از
     چیزی که مینی‌اپ فرستاده. نوع‌هایی که هنوز بسته ندارند، مثل قبل
     با بودجهٔ دلاری کار می‌کنند. */
  const offered = packagesFor(targetType);

  if (!offered.length) {
    return {
      ok: false,
      error: "برای این نوع تبلیغ هنوز بستهٔ آماده‌ای نداریم. با کارشناس هماهنگ کنید."
    };
  }

  const pkg = findPackage(budget.packageId, targetType);
  if (!pkg) {
    return { ok: false, error: "یکی از بسته‌ها را انتخاب کنید." };
  }

  const startWhen = START_WHEN.includes(budget.startWhen) ? budget.startWhen : "asap";

  /* ---------- تاریخ شروع ----------
     مینی‌اپ تاریخ را میلادی (YYYY-MM-DD) می‌فرستد تا بین تقویم‌ها
     ابهام نباشد؛ نمایش شمسی کار خود مینی‌اپ است.

     قانون «زودترین زمان، ۲۴ ساعت بعد» را فرم اعمال می‌کند. اینجا فقط
     می‌سنجیم که تاریخ گذشته نباشد و خیلی دور هم نباشد — چون ساعت
     سرور و ساعت گوشی مشتری یکی نیست و سخت‌گیری دقیقه‌ای، سفارش
     درست را رد می‌کند. */
  const startDate = cleanStartDate(budget.startDate);

  /* پوستر تبلیغ — اختیاری است. تبلیغ جستجو اصلاً عکس ندارد. */
  const poster = rules.needsText ? readPoster(creative.poster) : { ok: true, bytes: null };
  if (!poster.ok) return { ok: false, error: poster.error };

  return {
    ok: true,
    data: {
      adTitle,
      // خودِ بایت‌های عکس؛ در دیتابیس ذخیره نمی‌شود، فقط به تلگرام می‌رود
      posterBytes: poster.bytes,
      targetType,
      targetUrl,
      brand,
      adText,
      countries,
      languages,
      topics,
      channels,
      keywords,
      budgetUsd: 0,
      cpmUsd: 0,
      /* قیمت از فهرست خودمان آمده، نه از درخواست مشتری —
         و تخفیف هم همین‌جا اعمال می‌شود، نه در مرورگر مشتری */
      packageId: pkg ? pkg.id : "",
      packageViews: pkg ? pkg.views : 0,
      priceToman: pkg ? finalPrice(pkg) : 0,
      discountPercent: pkg ? discountOf(pkg) : 0,
      startWhen,
      startDate,
      notes: cleanText(input.notes, 1000)
    }
  };
}

/* =========================================================
   ویرایش سفارش توسط مدیر
   ---------------------------------------------------------
   مدیر دستِ بازتری از مشتری دارد (مثلاً می‌تواند وضعیت را عوض
   کند)، ولی نه دست باز مطلق: عددها و آدرس‌ها همان قواعد را دارند،
   وگرنه سفارشی می‌سازیم که در تلگرام ادز قابل ثبت نیست.
   ========================================================= */

const STATUSES = ["pending", "approved", "running", "done", "rejected"];

export function validateAdminEdit(input) {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "اطلاعاتی فرستاده نشده است." };
  }

  const adTitle = cleanText(input.adTitle, 40);
  if (adTitle.length < 2) return { ok: false, error: "عنوان تبلیغ را وارد کنید." };

  const brand = cleanText(input.brand, 64);
  if (brand.length < 2) return { ok: false, error: "نام برند را وارد کنید." };

  const targetUrl = cleanText(input.url, 128);
  if (!URL_PATTERNS.some((re) => re.test(targetUrl))) {
    return { ok: false, error: "آدرس مقصد معتبر نیست." };
  }

  const adText = cleanText(input.text, config.adTextMaxLength + 40);
  if (adText.length > config.adTextMaxLength) {
    return { ok: false, error: `متن تبلیغ نباید بیشتر از ${config.adTextMaxLength} کاراکتر باشد.` };
  }

  const channels = cleanList(input.channels, { max: 200, itemMax: 64 });
  const keywords = cleanList(input.keywords, { max: 200, itemMax: 64 });

  if (keywords.length > config.maxKeywords) {
    return { ok: false, error: `حداکثر ${config.maxKeywords} کلیدواژه مجاز است.` };
  }
  if (channels.length > 0 && channels.length < config.minChannels) {
    return { ok: false, error: `تلگرام حداقل ${config.minChannels} کانال می‌خواهد.` };
  }

  const status = STATUSES.includes(input.status) ? input.status : null;
  if (!status) return { ok: false, error: "وضعیت انتخاب‌شده معتبر نیست." };

  return {
    ok: true,
    data: {
      adTitle, brand, targetUrl, adText, channels, keywords,
      status,
      adminNote: cleanText(input.adminNote, 500)
    }
  };
}
