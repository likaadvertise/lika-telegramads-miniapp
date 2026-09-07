/* =========================================================
   بسته‌های آماده (قیمت به تومان)
   ---------------------------------------------------------
   ⚠️ این فایل «منبع حقیقت» قیمت‌هاست.

   قیمت هرگز از روی چیزی که مینی‌اپ می‌فرستد حساب نمی‌شود — مینی‌اپ
   فقط می‌گوید مشتری کدام بسته را زده، و قیمت از همین‌جا برداشته
   می‌شود. وگرنه هر کسی می‌توانست با دست‌کاری درخواست، بستهٔ ۲۸
   میلیونی را ۱۰ تومان ثبت کند.

   ---------- تخفیف ----------
   برای گذاشتن تخفیف روی یک بسته، فقط `off` را اضافه کنید:

       { id: "ch50", ..., priceToman: 7500000, off: 20 }

   یعنی ۲۰٪ تخفیف. آن‌وقت مشتری قیمت قبلی را خط‌خورده و قیمت تازه
   را کنارش می‌بیند. برای برداشتن تخفیف، همان `off` را پاک کنید یا
   صفر بگذارید. جای دیگری لازم نیست دست بزنید.
   ========================================================= */

/* پله‌های قیمت — همین‌ها را عوض کنید و بس. */
const TIERS = [
  { key: "20",  views: 20000,  priceToman: 5000000 },
  { key: "50",  views: 50000,  priceToman: 7500000 },
  { key: "100", views: 100000, priceToman: 15000000 },
  { key: "200", views: 200000, priceToman: 28000000 }
];

/* فعلاً فقط تبلیغ کانال فروخته می‌شود. تمرکز روی همین است.

   ⚠️ همین فهرست تعیین می‌کند مشتری چه نوع تبلیغی می‌تواند سفارش دهد:
   نوعی که بستهٔ فعال نداشته باشد، در مینی‌اپ اصلاً نشان داده نمی‌شود.
   برای باز کردن تبلیغ ربات یا جستجو، کافی است نامش را به همین آرایه
   اضافه کنید (و اگر قیمتش فرق دارد، بسته‌هایش را دستی بنویسید). */
const TYPES = ["channel"];
const PREFIX = { channel: "ch", bot: "bot", search: "sr" };

export const PACKAGES = TYPES.flatMap((type) =>
  TIERS.map((t) => ({
    id: PREFIX[type] + t.key,
    type,
    views: t.views,
    priceToman: t.priceToman
  }))
);

/** درصد تخفیف سالمِ یک بسته — بین ۰ تا ۹۰ */
export function discountOf(pkg) {
  const off = Math.round(Number(pkg && pkg.off) || 0);
  return off > 0 && off <= 90 ? off : 0;
}

/**
 * مبلغی که مشتری واقعاً می‌پردازد.
 * به نزدیک‌ترین هزار تومان گرد می‌شود تا عددهای زشت درنیاید.
 */
export function finalPrice(pkg) {
  const base = Number(pkg.priceToman) || 0;
  const off = discountOf(pkg);
  if (!off) return base;
  return Math.round((base * (100 - off)) / 100 / 1000) * 1000;
}

/** بسته‌ها به شکلی که مینی‌اپ نشان می‌دهد (قیمت نهایی هم حساب‌شده) */
export function publicPackages() {
  return PACKAGES.map((p) => ({
    id: p.id,
    type: p.type,
    views: p.views,
    priceToman: finalPrice(p),
    // اگر تخفیف باشد، قیمت قبلی برای خط خوردن روی آن
    wasToman: discountOf(p) ? Number(p.priceToman) || 0 : 0,
    off: discountOf(p)
  }));
}

/** بسته‌های یک نوع تبلیغ. اگر خالی برگردد، آن نوع هنوز بسته ندارد. */
export function packagesFor(type) {
  return PACKAGES.filter((p) => p.type === type);
}

/** بسته را با شناسه پیدا می‌کند — و فقط اگر با نوع تبلیغ هم بخواند */
export function findPackage(id, type) {
  const pkg = PACKAGES.find((p) => p.id === String(id || ""));
  if (!pkg) return null;
  if (type && pkg.type !== type) return null;
  return pkg;
}
