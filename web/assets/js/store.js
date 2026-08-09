/* =========================================================
   Lika Ads — لایه داده (Data Layer)
   ---------------------------------------------------------
   این فایل تصمیم می‌گیرد سفارش‌ها کجا ذخیره شوند:

   ۱) حالت «آنلاین» — اگر سرور Lika در دسترس باشد:
      سفارش‌ها در دیتابیس واقعی ذخیره می‌شوند و برای تیم Lika
      پیام می‌رود. این حالت اصلی و درست است.

   ۲) حالت «نمایشی» — اگر سروری در دسترس نباشد:
      همه‌چیز روی گوشی خود کاربر می‌ماند تا اپ قابل نمایش باشد،
      ولی سفارش واقعاً ثبت نمی‌شود و به کاربر هشدار داده می‌شود.

   بقیهٔ اپ نمی‌داند در کدام حالت است؛ فقط از همین توابع استفاده می‌کند.
   ========================================================= */

window.Store = (function () {
  const KEY = "lika_ads_store_v1";
  const DRAFT_KEY = "lika_ads_draft_v1";

  /* ---------- وضعیت‌های ممکن یک کمپین ---------- */
  const STATUS = {
    pending:  { label: "در انتظار بررسی", cls: "pending",  order: 1 },
    review:   { label: "در حال بررسی",    cls: "review",   order: 2 },
    approved: { label: "تأیید شده",       cls: "approved", order: 3 },
    running:  { label: "در حال اجرا",     cls: "running",  order: 4 },
    done:     { label: "پایان‌یافته",      cls: "done",     order: 5 },
    rejected: { label: "نیاز به اصلاح",   cls: "rejected", order: 6 }
  };

  /* ---------- مسیر پیشرفت یک کمپین (برای تایم‌لاین) ---------- */
  const FLOW = ["pending", "review", "approved", "running", "done"];

  const TARGET_TYPES = {
    channel: { label: "کانال یا گروه", icon: "megaphone" },
    bot:     { label: "ربات تلگرام",   icon: "bot" },
    post:    { label: "پست خاص",       icon: "link" }
  };

  /* =======================================================
     وضعیت داخلی
     ======================================================= */
  const PROFILE_KEY = "lika_ads_profile_v1";
  const DEMO_CODE = "12345";   // کد ثابت حالت نمایشی

  let mode = "demo";        // "online" یا "demo"
  let cache = [];           // کمپین‌ها در حافظه، برای نمایش سریع
  let profile = emptyProfile();
  let requireCode = true;

  function emptyProfile() {
    return { phone: "", firstName: "", lastName: "", phoneVerified: false, registered: false };
  }

  const apiBase = () => (window.LIKA_CONFIG.apiBase || "").replace(/\/+$/, "");

  function initData() {
    try { return (window.Telegram?.WebApp?.initData) || ""; } catch (e) { return ""; }
  }

  async function apiFetch(path, options = {}) {
    const res = await fetch(apiBase() + path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Init-Data": initData(),
        ...(options.headers || {})
      }
    });

    let data = {};
    try { data = await res.json(); } catch (e) {}

    if (!res.ok || data.ok === false) {
      const err = new Error(data.error || "ارتباط با سرور برقرار نشد.");
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /* =======================================================
     راه‌اندازی — تصمیم‌گیری بین آنلاین و نمایشی
     ======================================================= */
  async function init() {
    // بدون امضای تلگرام سرور ما را نمی‌شناسد؛ پس حالت نمایشی
    if (!initData()) {
      startDemo();
      return mode;
    }

    try {
      const timeout = AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined;
      const health = await fetch(apiBase() + "/api/health", { signal: timeout });
      if (!health.ok) throw new Error("سرور در دسترس نیست");

      const me = await apiFetch("/api/me");
      profile = me.profile || emptyProfile();
      requireCode = me.requireCode !== false;

      const data = await apiFetch("/api/campaigns");
      cache = data.campaigns || [];
      mode = "online";
    } catch (e) {
      startDemo();
    }
    return mode;
  }

  function startDemo() {
    mode = "demo";
    requireCode = window.LIKA_CONFIG.demoRequireCode !== false;
    seedSamples();
    cache = localList();
    profile = localProfile();
  }

  /** تازه‌سازی لیست از سرور (بعد از بازگشت به اپ) */
  async function refresh() {
    if (mode !== "online") return;
    try {
      const data = await apiFetch("/api/campaigns");
      cache = data.campaigns || [];
    } catch (e) { /* لیست قبلی را نگه می‌داریم */ }
  }

  /* =======================================================
     خواندن — همیشه از حافظه، پس فوری است
     ======================================================= */
  function list() {
    return cache.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  function get(id) {
    return cache.find((c) => c.id === id) || null;
  }

  function summary() {
    const all = list();
    return {
      total: all.length,
      active: all.filter((c) => ["approved", "running"].includes(c.status)).length,
      waiting: all.filter((c) => ["pending", "review"].includes(c.status)).length,
      spend: all
        .filter((c) => ["running", "done"].includes(c.status))
        .reduce((s, c) => s + (c.budget?.amountUsd || 0), 0),
      views: all.reduce((s, c) => s + (c.stats?.views || 0), 0)
    };
  }

  /* =======================================================
     ثبت‌نام
     ======================================================= */

  /** گام ۱ — ثبت شماره. اگر کد لازم باشد، برای کاربر فرستاده می‌شود. */
  async function registerPhone(phone) {
    if (mode === "online") {
      const data = await apiFetch("/api/register/phone", {
        method: "POST",
        body: JSON.stringify({ phone })
      });
      if (data.profile) profile = data.profile;
      return {
        codeSent: Boolean(data.codeSent),
        expiresInSeconds: data.expiresInSeconds || 180,
        resendAfterSeconds: data.resendAfterSeconds || 60
      };
    }

    // حالت نمایشی
    const p = localProfile();
    p.phone = phone;
    if (!requireCode) p.phoneVerified = true;
    saveLocalProfile(p);
    profile = p;
    return {
      codeSent: requireCode,
      demoCode: requireCode ? DEMO_CODE : null,
      expiresInSeconds: 180,
      resendAfterSeconds: 60
    };
  }

  /** گام ۲ — بررسی کد تأیید */
  async function verifyCode(code) {
    if (mode === "online") {
      const data = await apiFetch("/api/register/verify", {
        method: "POST",
        body: JSON.stringify({ code })
      });
      profile = data.profile || profile;
      return profile;
    }

    if (String(code).trim() !== DEMO_CODE) {
      throw new Error(`حالت نمایشی: کد ${DEMO_CODE} را وارد کنید.`);
    }
    const p = localProfile();
    p.phoneVerified = true;
    saveLocalProfile(p);
    profile = p;
    return profile;
  }

  /** گام ۳ — نام و نام خانوادگی */
  async function saveProfile(firstName, lastName) {
    if (mode === "online") {
      const data = await apiFetch("/api/register/profile", {
        method: "POST",
        body: JSON.stringify({ firstName, lastName })
      });
      profile = data.profile || profile;
      return profile;
    }

    const p = localProfile();
    p.firstName = firstName;
    p.lastName = lastName;
    p.registered = true;
    saveLocalProfile(p);
    profile = p;
    return profile;
  }

  function localProfile() {
    try {
      const raw = localStorage.getItem(PROFILE_KEY);
      return raw ? Object.assign(emptyProfile(), JSON.parse(raw)) : emptyProfile();
    } catch (e) { return emptyProfile(); }
  }

  function saveLocalProfile(p) {
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch (e) {}
  }

  /* =======================================================
     ثبت سفارش
     ======================================================= */
  async function create(payload) {
    if (mode === "online") {
      const data = await apiFetch("/api/campaigns", {
        method: "POST",
        body: JSON.stringify({ campaign: payload })
      });
      cache.unshift(data.campaign);
      return data.campaign;
    }

    // حالت نمایشی: فقط روی همین دستگاه
    const store = localRead();
    store.counter += 1;
    const now = new Date().toISOString();

    const campaign = Object.assign(
      {
        id: "LK-" + store.counter,
        createdAt: now,
        status: "pending",
        isSample: false,
        isLocal: true,
        stats: { views: 0, clicks: 0 },
        history: [{ status: "pending", at: now }]
      },
      payload
    );

    store.campaigns.push(campaign);
    localWrite(store);
    cache = localList();
    return campaign;
  }

  /* =======================================================
     ذخیره‌سازی محلی (فقط برای حالت نمایشی)
     ======================================================= */
  function localRead() {
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

  function localWrite(data) {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
  }

  function localList() {
    return localRead().campaigns;
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

  /* ---------- داده نمونه (فقط در حالت نمایشی) ---------- */
  function seedSamples() {
    if (!window.LIKA_CONFIG.seedSampleData) return;

    const data = localRead();
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
        creative: { text: "فروش ویژه لوازم جانبی موبایل با ۳۰٪ تخفیف — همین حالا کانال ما را ببینید." },
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
        creative: { text: "مشاورهٔ رایگان سرمایه‌گذاری برای شروع‌کننده‌ها — همین حالا با ربات ما گفت‌وگو کنید." },
        targeting: { countries: ["IR"], languages: ["فارسی"], topics: ["finance", "education"], channels: ["@digikala_jobs"] },
        budget: { amountUsd: 30, cpmUsd: 1.2, startWhen: "week" },
        notes: "کسب‌وکار ما مشاوره مالی و سرمایه‌گذاری برای افراد تازه‌کار است. مخاطب هدف: افراد ۲۵ تا ۴۰ سال.",
        stats: { views: 0, clicks: 0 },
        history: [{ status: "pending", at: daysAgo(0) }]
      }
    ];
    localWrite(data);
  }

  function clearSamples() {
    const data = localRead();
    data.campaigns = data.campaigns.filter((c) => !c.isSample);
    localWrite(data);
    if (mode !== "online") cache = localList();
  }

  return {
    STATUS, FLOW, TARGET_TYPES,
    init, refresh,
    get mode() { return mode; },
    get profile() { return profile; },
    get requireCode() { return requireCode; },
    isOnline: () => mode === "online",
    isRegistered: () => Boolean(profile.registered),
    isPhoneVerified: () => Boolean(profile.phoneVerified),
    registerPhone, verifyCode, saveProfile,
    list, get, create, summary,
    saveDraft, loadDraft, clearDraft,
    clearSamples
  };
})();
