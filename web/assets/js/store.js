/* =========================================================
   Lika Ads — لایه داده (Data Layer)
   ---------------------------------------------------------
   در این مرحله (MVP) داده‌ها روی خودِ گوشی کاربر ذخیره می‌شوند
   (localStorage). در مرحله بعد فقط همین فایل عوض می‌شود تا
   داده‌ها به دیتابیس واقعی روی سرور برود؛ بقیه اپ دست‌نخورده می‌ماند.

   ⚠️ توجه: چون هنوز سروری نداریم، سفارش‌ها فقط روی همین دستگاه
      باقی می‌مانند و به تیم Lika ارسال نمی‌شوند.
   ========================================================= */

window.Store = (function () {
  const KEY = "lika_ads_store_v1";
  const DRAFT_KEY = "lika_ads_draft_v1";

  /* ---------- وضعیت‌های ممکن یک کمپین ---------- */
  const STATUS = {
    pending:  { label: "در انتظار بررسی", cls: "pending",  icon: "🕐", order: 1 },
    review:   { label: "در حال بررسی",    cls: "review",   icon: "🔍", order: 2 },
    approved: { label: "تأیید شده",       cls: "approved", icon: "✅", order: 3 },
    running:  { label: "در حال اجرا",     cls: "running",  icon: "📡", order: 4 },
    done:     { label: "پایان‌یافته",      cls: "done",     icon: "🏁", order: 5 },
    rejected: { label: "نیاز به اصلاح",   cls: "rejected", icon: "⚠️", order: 6 }
  };

  /* ---------- مسیر پیشرفت یک کمپین (برای تایم‌لاین) ---------- */
  const FLOW = ["pending", "review", "approved", "running", "done"];

  const TARGET_TYPES = {
    channel: { label: "کانال یا گروه", icon: "📣" },
    bot:     { label: "ربات تلگرام",   icon: "🤖" },
    post:    { label: "پست خاص",       icon: "🔗" }
  };

  /* ---------- خواندن / نوشتن ---------- */
  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return { campaigns: [], counter: 1041 };
      const data = JSON.parse(raw);
      return {
        campaigns: Array.isArray(data.campaigns) ? data.campaigns : [],
        counter: typeof data.counter === "number" ? data.counter : 1041
      };
    } catch (e) {
      return { campaigns: [], counter: 1041 };
    }
  }

  function write(data) {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
  }

  /* ---------- عملیات اصلی ---------- */
  function list() {
    return read().campaigns.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  function get(id) {
    return read().campaigns.find((c) => c.id === id) || null;
  }

  function create(payload) {
    const data = read();
    data.counter += 1;
    const now = new Date().toISOString();

    const campaign = Object.assign(
      {
        id: "LK-" + data.counter,
        createdAt: now,
        status: "pending",
        isSample: false,
        stats: { views: 0, clicks: 0 },
        history: [{ status: "pending", at: now }]
      },
      payload
    );

    data.campaigns.push(campaign);
    write(data);
    return campaign;
  }

  function summary() {
    const all = list();
    const active = all.filter((c) => ["approved", "running"].includes(c.status)).length;
    const waiting = all.filter((c) => ["pending", "review"].includes(c.status)).length;
    const spend = all
      .filter((c) => ["running", "done"].includes(c.status))
      .reduce((s, c) => s + (c.budget?.amountUsd || 0), 0);
    const views = all.reduce((s, c) => s + (c.stats?.views || 0), 0);
    return { total: all.length, active, waiting, spend, views };
  }

  /* ---------- پیش‌نویس (اگر کاربر نیمه‌کاره خارج شد) ---------- */
  function saveDraft(draft) {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (e) {}
  }
  function loadDraft() {
    try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch (e) { return null; }
  }
  function clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
  }

  /* ---------- داده نمونه (فقط برای اینکه پنل خالی نباشد) ---------- */
  function seedSamples() {
    const data = read();
    if (data.campaigns.length > 0) return;

    const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

    data.counter = 1043;
    data.campaigns = [
      {
        id: "LK-1042",
        createdAt: daysAgo(2),
        status: "running",
        isSample: true,
        target: { type: "channel", url: "@lika_shop", brand: "لیکا شاپ" },
        creative: { text: "فروش ویژه لوازم جانبی موبایل با ۳۰٪ تخفیف — همین حالا کانال ما را ببینید.", writtenByUs: false },
        targeting: { countries: ["IR", "AE"], languages: ["فارسی"], topics: ["shopping", "tech"], channels: [] },
        budget: { amountUsd: 120, cpmUsd: 1.6, startWhen: "asap" },
        notes: "",
        stats: { views: 41250, clicks: 903 },
        history: [
          { status: "pending", at: daysAgo(2) },
          { status: "review", at: daysAgo(2) },
          { status: "approved", at: daysAgo(1) },
          { status: "running", at: daysAgo(1) }
        ]
      },
      {
        id: "LK-1043",
        createdAt: daysAgo(0),
        status: "pending",
        isSample: true,
        target: { type: "bot", url: "@lika_support_bot", brand: "ربات مشاوره لیکا" },
        creative: { text: "", writtenByUs: true },
        targeting: { countries: ["IR"], languages: ["فارسی"], topics: ["finance", "education"], channels: ["@digikala_jobs"] },
        budget: { amountUsd: 30, cpmUsd: 1.2, startWhen: "week" },
        notes: "کسب‌وکار ما مشاوره مالی و سرمایه‌گذاری برای افراد تازه‌کار است. مخاطب هدف: افراد ۲۵ تا ۴۰ سال.",
        stats: { views: 0, clicks: 0 },
        history: [{ status: "pending", at: daysAgo(0) }]
      }
    ];
    write(data);
  }

  function clearSamples() {
    const data = read();
    data.campaigns = data.campaigns.filter((c) => !c.isSample);
    write(data);
  }

  function clearAll() {
    try { localStorage.removeItem(KEY); localStorage.removeItem(DRAFT_KEY); } catch (e) {}
  }

  return {
    STATUS, FLOW, TARGET_TYPES,
    list, get, create, summary,
    saveDraft, loadDraft, clearDraft,
    seedSamples, clearSamples, clearAll
  };
})();
