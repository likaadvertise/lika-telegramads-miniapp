/* =========================================================
   برچسب‌های فارسی
   ---------------------------------------------------------
   ⚠️ این فهرست‌ها باید با web/assets/js/config.js هماهنگ بمانند.
      اگر آنجا کشور یا موضوعی اضافه کردید، اینجا هم اضافه کنید
      (وگرنه در پیام‌های ربات فقط کد آن نمایش داده می‌شود).
   ========================================================= */

export const STATUS_LABELS = {
  pending: "در انتظار بررسی",
  approved: "تأیید شده",
  running: "در حال اجرا",
  done: "پایان‌یافته",
  rejected: "نیاز به اصلاح"
};

export const STATUS_LIST = Object.keys(STATUS_LABELS);

export const TARGET_LABELS = {
  channel: "کانال",
  search: "جستجو",
  bot: "ربات"
};

export const START_LABELS = {
  asap: "در اسرع وقت",
  week: "هفتهٔ آینده",
  custom: "هماهنگی با کارشناس"
};

export const COUNTRY_NAMES = {
  IR: "ایران", AE: "امارات", TR: "ترکیه", IQ: "عراق", AF: "افغانستان",
  SA: "عربستان", QA: "قطر", KW: "کویت", OM: "عمان", DE: "آلمان",
  US: "آمریکا", CA: "کانادا", GB: "انگلستان", RU: "روسیه", FR: "فرانسه",
  IT: "ایتالیا", NL: "هلند", SE: "سوئد", AU: "استرالیا", IN: "هند",
  PK: "پاکستان", MY: "مالزی", AZ: "آذربایجان", AM: "ارمنستان"
};

export const TOPIC_NAMES = {
  crypto: "ارز دیجیتال", finance: "مالی و اقتصاد", tech: "تکنولوژی",
  shopping: "فروشگاه و خرید", education: "آموزش", health: "سلامت و پزشکی",
  sport: "ورزش", travel: "سفر و گردشگری", auto: "خودرو", fun: "سرگرمی",
  news: "اخبار", music: "موسیقی", game: "بازی", beauty: "مد و زیبایی",
  estate: "املاک", job: "استخدام", design: "هنر و طراحی", book: "کتاب"
};

export const countryName = (code) => COUNTRY_NAMES[code] || code;
export const topicName = (id) => TOPIC_NAMES[id] || id;
