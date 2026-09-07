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
    approved: { label: "تأیید شده",       cls: "approved", order: 2 },
    running:  { label: "در حال اجرا",     cls: "running",  order: 3 },
    done:     { label: "پایان‌یافته",      cls: "done",     order: 4 },
    rejected: { label: "نیاز به اصلاح",   cls: "rejected", order: 5 }
  };

  /* ---------- مسیر پیشرفت یک کمپین (برای تایم‌لاین) ---------- */
  const FLOW = ["pending", "approved", "running", "done"];

  // ترتیب همین‌جا تعیین می‌شود؛ به همین ترتیب در فرم نمایش داده می‌شود
  /* هر نوع تبلیغ چه چیزهایی لازم دارد.
     این از روی فرم واقعی Telegram Ads درآمده، نه از حدس:
       • تب Channels  → عنوان + متن + لینک + کانال‌های هدف
       • تب Search    → عنوان + لینک + کلیدواژه‌ها   (کادر «متن تبلیغ» اصلاً ندارد)
       • تب Bots      → هنوز ندیده‌ایم؛ فعلاً مثل کانال فرض شده
  */
  const TARGET_TYPES = {
    channel: { label: "کانال",  icon: "megaphone", desc: "مخاطب وارد کانال شما می‌شود",
               needsText: true,  needsKeywords: false },
    search:  { label: "جستجو",  icon: "search",    desc: "تبلیغ شما در نتایج جستجوی تلگرام دیده می‌شود",
               needsText: false, needsKeywords: true },
    bot:     { label: "ربات",   icon: "bot",       desc: "مخاطب ربات شما را استارت می‌کند",
               needsText: true,  needsKeywords: false }
  };

  /* =======================================================
     وضعیت داخلی
     ======================================================= */
  const PROFILE_KEY = "lika_ads_profile_v1";
  const DEMO_CODE = "12345";   // کد ثابت حالت نمایشی

  let mode = "demo";        // "online" یا "demo"
  let demoReason = "";      // اگر نمایشی شد، چرا؟ (برای عیب‌یابی)
  let step = "health";      // آخرین مرحله‌ای که تلاش شد
  let cache = [];           // کمپین‌ها در حافظه، برای نمایش سریع
  let profile = emptyProfile();
  let requireCode = true;
  let admin = false;

  /* بسته‌ها و شمارهٔ کارت را سرور می‌گوید. مقدار داخل config.js فقط
     برای حالت نمایشی است؛ قیمت واقعی همیشه از سرور می‌آید. */
  let packages = null;
  let payment = null;

  function emptyProfile() {
    return { phone: "", firstName: "", lastName: "", email: "", phoneVerified: false, registered: false };
  }

  const apiBase = () => (window.LIKA_CONFIG.apiBase || "").replace(/\/+$/, "");

  function initData() {
    try { return (window.Telegram?.WebApp?.initData) || ""; } catch (e) { return ""; }
  }

  /*
     وقتی امضا خالی است، «حالت نمایشی» تنها چیزی است که کاربر می‌بیند —
     برای عیب‌یابی از راه دور (بدون دسترسی به گوشی کاربر) باید همان یک
     خط، تا حد ممکن دقیق بگوید مشکل کجاست:

       ۱) window.Telegram.WebApp اصلاً نساخته شده  → خود tg-webapp.js
          بارگذاری نشده (کش خیلی قدیمی، یا مشکل شبکه در گرفتن فایل).
       ۲) ساخته شده ولی حتی پلتفرم/نسخه هم ندارد     → تلگرام اصلاً چیزی
          به آدرس اضافه نکرده؛ یعنی این بار از یک لینک معمولی باز شده
          (نه از دکمهٔ Web App رسمی ربات).
       ۳) ساخته شده و پلتفرم/نسخه دارد ولی initData خالی است → تلگرام
          واقعاً یک Web App باز کرده ولی امضا را نفرستاده — نادر است،
          معمولاً یعنی نسخهٔ تلگرام خیلی قدیمی یا یک کش عجیب داخل اپ تلگرام.
  */
  function diagnoseNoSignature() {
    const w = window.Telegram && window.Telegram.WebApp;
    if (!w) return "پل تلگرام بارگذاری نشد";

    const hasLaunchInfo = Boolean(w.platform && w.platform !== "unknown");
    if (!hasLaunchInfo) {
      return "این بار به‌جای دکمهٔ رسمی «Web App» تلگرام، از یک لینک معمولی باز شده (آدرس هیچ اطلاعاتی از تلگرام نداشت).";
    }
    return `امضای تلگرام خالی است (پلتفرم: ${w.platform}، نسخه: ${w.version || "?"})`;
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
      // اگر سرور خودش دلیلی نگفت، دست‌کم کد وضعیت را نشان بده —
      // وگرنه «ارتباط برقرار نشد» هیچ سرنخی برای عیب‌یابی نمی‌دهد
      const err = new Error(data.error || `ارتباط با سرور برقرار نشد (${res.status}).`);
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
      demoReason = diagnoseNoSignature();
      startDemo();
      return mode;
    }

    try {
      const timeout = AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined;
      const health = await fetch(apiBase() + "/api/health", { signal: timeout });
      if (!health.ok) throw new Error(`سلامت سرور ${health.status}`);

      step = "me";
      const me = await apiFetch("/api/me");
      profile = me.profile || emptyProfile();
      requireCode = me.requireCode !== false;
      admin = me.isAdmin === true;
      if (Array.isArray(me.packages)) packages = me.packages;
      if (me.payment) payment = me.payment;

      // یک نسخه محلی نگه می‌داریم تا اگر سرور لحظه‌ای در دسترس نبود،
      // از کاربری که قبلاً ثبت‌نام کرده دوباره ثبت‌نام نخواهیم
      saveLocalProfile(profile);

      step = "campaigns";
      const data = await apiFetch("/api/campaigns");
      cache = data.campaigns || [];
      mode = "online";
      demoReason = "";
    } catch (e) {
      // پیام خود سرور را هم می‌آوریم؛ کد وضعیت به‌تنهایی نمی‌گوید کدام بررسی رد شده
      demoReason = [step, e.status ? "خطای " + e.status : "", e.message || ""]
        .filter(Boolean).join(" — ");
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
      waiting: all.filter((c) => c.status === "pending").length,
      spendToman: all
        .filter((c) => ["running", "done"].includes(c.status))
        .reduce((s, c) => s + (c.budget?.priceToman || 0), 0),
      views: all.reduce((s, c) => s + (c.stats?.views || 0), 0),
      clicks: all.reduce((s, c) => s + (c.stats?.clicks || 0), 0),
      joins: all.reduce((s, c) => s + (c.stats?.joins || 0), 0)
    };
  }

  /* =======================================================
     نام و عکس مقصد (برای پیش‌نمایش تبلیغ)
     ======================================================= */

  const chatCache = new Map();

  /**
   * از سرور می‌پرسد این آدرس در تلگرام چه نام و عکسی دارد.
   * @returns {Promise<{found:boolean, title:string, photo:string}>}
   */
  async function lookupChat(username) {
    const key = String(username || "").trim().toLowerCase();
    if (!key) return { found: false, title: "", photo: "" };
    if (chatCache.has(key)) return chatCache.get(key);

    let value = { found: false, title: "", photo: "" };

    if (mode === "online") {
      try {
        const data = await apiFetch("/api/chat?u=" + encodeURIComponent(key));
        if (data.ok) {
          value = {
            found: true,
            title: data.title,
            photo: data.hasPhoto ? apiBase() + "/api/chat-photo?u=" + encodeURIComponent(key) : ""
          };
        }
      } catch (e) { /* پیدا نشد؛ همان مقدار پیش‌فرض */ }
    }

    chatCache.set(key, value);
    return value;
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
        expiresInSeconds: data.expiresInSeconds || 120,
        resendAfterSeconds: data.resendAfterSeconds || 120
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
      expiresInSeconds: 120,
      resendAfterSeconds: 120
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
      saveLocalProfile(profile);
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

  /** گام ۳ — نام، نام خانوادگی و ایمیل (اختیاری) */
  async function saveProfile(firstName, lastName, email) {
    if (mode === "online") {
      const data = await apiFetch("/api/register/profile", {
        method: "POST",
        body: JSON.stringify({ firstName, lastName, email })
      });
      profile = data.profile || profile;
      saveLocalProfile(profile);
      return profile;
    }

    const p = localProfile();
    p.firstName = firstName;
    p.lastName = lastName;
    p.email = email || "";
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

  /* ---------- پیش‌نویس (اگر کاربر نیمه‌کاره خارج شد) ----------
     کنار خودِ دادهٔ فرم، دو چیز دیگر هم نگه می‌داریم:
       • step    — کاربر تا کدام مرحله رفته بود
       • savedAt — آخرین بار کِی چیزی نوشت
     صفحهٔ خانه با همین دو تا می‌گوید «پیش‌نویس مرحلهٔ ۲، ۳ ساعت پیش».
     پیش‌نویس‌های نسخهٔ قبلی که فقط خود داده بودند هم خوانده می‌شوند. */
  function saveDraft(data, meta) {
    const payload = Object.assign({ step: 1 }, meta || {}, {
      data,
      savedAt: new Date().toISOString()
    });

    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
      return;
    } catch (e) { /* پایین دوباره تلاش می‌کنیم */ }

    /* معمولاً یعنی حافظهٔ مرورگر پر شده و مقصر پوستر است (عکس‌ها بزرگ‌اند).
       متن سفارش را از دست نمی‌دهیم؛ فقط عکس را از پیش‌نویس درمی‌آوریم.
       خودِ فرمِ باز هنوز عکس را دارد — این فقط نسخهٔ ذخیره‌شده است. */
    try {
      const light = JSON.parse(JSON.stringify(payload));
      if (light.data && light.data.creative) light.data.creative.poster = "";
      localStorage.setItem(DRAFT_KEY, JSON.stringify(light));
    } catch (e) {}
  }

  function loadDraft() {
    try {
      const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      if (!raw || typeof raw !== "object") return null;
      // نسخهٔ قدیمی: خودِ دادهٔ فرم، بدون پوشش
      if (!raw.data) return { data: raw, step: 1, savedAt: "" };
      return { data: raw.data, step: Number(raw.step) || 1, savedAt: raw.savedAt || "" };
    } catch (e) { return null; }
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
        adTitle: "کمپین فروش پاییز",
        target: { type: "channel", url: "@lika_shop", brand: "لیکا شاپ" },
        creative: { text: "فروش ویژه لوازم جانبی موبایل با ۳۰٪ تخفیف — همین حالا کانال ما را ببینید." },
        targeting: { countries: ["IR", "AE"], languages: ["فارسی"], topics: ["shopping", "tech"], channels: [] },
        budget: { amountUsd: 120, cpmUsd: 1.6, startWhen: "asap" },
        notes: "",
        stats: { views: 41250, clicks: 903 },
        history: [
          { status: "pending", at: daysAgo(2) },
          { status: "approved", at: daysAgo(1) },
          { status: "running", at: daysAgo(1) }
        ]
      },
      {
        id: "LK-1043",
        createdAt: daysAgo(0),
        status: "pending",
        isSample: true,
        adTitle: "جذب مخاطب ربات مشاوره",
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
    isAdmin: () => admin,
    adminUsers: () => apiFetch("/api/admin/users"),
    adminCampaigns: () => apiFetch("/api/admin/campaigns"),
    adminExport: () => apiFetch("/api/admin/export", { method: "POST", body: "{}" }),
    isOnline: () => mode === "online",

    /** بسته‌های یک نوع تبلیغ — اگر خالی برگردد یعنی آن نوع بسته ندارد */
    packagesFor(type) {
      const list = packages || window.LIKA_CONFIG.packages || [];
      return list.filter((p) => p.type === type);
    },
    findPackage(id) {
      const list = packages || window.LIKA_CONFIG.packages || [];
      return list.find((p) => p.id === id) || null;
    },
    payment: () => payment || window.LIKA_CONFIG.payment || { cardNumber: "", cardHolder: "", bank: "" },

    /** رسید پرداخت را برای تیم می‌فرستد و سفارش به‌روزشده را برمی‌گرداند */
    async sendReceipt(code, dataUrl) {
      if (mode !== "online") {
        throw new Error("در حالت نمایشی رسید فرستاده نمی‌شود.");
      }
      const data = await apiFetch("/api/receipt", {
        method: "POST",
        body: JSON.stringify({ code, image: dataUrl })
      });
      // نسخهٔ حافظه را هم تازه می‌کنیم تا صفحه بدون رفرش درست شود
      const i = cache.findIndex((c) => c.id === code);
      if (i !== -1 && data.campaign) cache[i] = data.campaign;
      return data.campaign;
    },


    demoReason: () => demoReason,
    isRegistered: () => Boolean(profile.registered),
    isPhoneVerified: () => Boolean(profile.phoneVerified),
    registerPhone, verifyCode, saveProfile, lookupChat,
    list, get, create, summary,
    saveDraft, loadDraft, clearDraft,
    clearSamples
  };
})();
