/* =========================================================
   Lika Ads — منطق اپلیکیشن
   ---------------------------------------------------------
   بخش‌ها:
   ۱) ابزارهای کمکی        ۲) اتصال به تلگرام
   ۳) مسیریابی صفحات       ۴) صفحه‌ها
   ۵) فرم ثبت کمپین        ۶) رویدادها
   ========================================================= */

(function () {
  "use strict";

  const CFG = window.LIKA_CONFIG;
  const S = window.Store;
  const ICON = window.Icons.icon;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const elAppbar = $("#appbar");
  const elScreen = $("#screen");
  const elTabbar = $("#tabbar");
  const elToast = $("#toast");

  /* =======================================================
     ۱) ابزارهای کمکی
     ======================================================= */

  // جلوگیری از خرابی صفحه با متن‌های کاربر
  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // عدد فارسی با جداکننده هزارگان
  function num(n) {
    const v = Number(n) || 0;
    try { return v.toLocaleString("fa-IR", { maximumFractionDigits: 2 }); }
    catch (e) { return String(v); }
  }

  function dateFa(iso) {
    try {
      return new Date(iso).toLocaleDateString("fa-IR", { year: "numeric", month: "long", day: "numeric" });
    } catch (e) { return ""; }
  }

  function timeAgo(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const h = Math.floor(diff / 3600000);
    if (h < 1) return "چند دقیقه پیش";
    if (h < 24) return num(h) + " ساعت پیش";
    const d = Math.floor(h / 24);
    if (d < 30) return num(d) + " روز پیش";
    return dateFa(iso);
  }

  let toastTimer = null;
  function toast(msg, kind) {
    elToast.textContent = msg;
    elToast.className = "toast is-on" + (kind ? " is-" + kind : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { elToast.className = "toast"; }, 2600);
  }

  /* =======================================================
     ۲) اتصال به تلگرام
     ======================================================= */

  const TG = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;

  const tgSafe = {
    init() {
      if (!TG) return;
      try { TG.ready(); TG.expand(); } catch (e) {}
      try { if (TG.disableVerticalSwipes) TG.disableVerticalSwipes(); } catch (e) {}
      this.applyTheme();
      try { TG.onEvent("themeChanged", () => tgSafe.applyTheme()); } catch (e) {}
      try {
        TG.BackButton.onClick(() => goBack());
      } catch (e) {}
    },
    applyTheme() {
      const dark = TG ? TG.colorScheme === "dark"
        : window.matchMedia("(prefers-color-scheme: dark)").matches;
      document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
      const bg = dark ? "#0e1320" : "#f4f6fb";
      try { if (TG && TG.setHeaderColor) TG.setHeaderColor(bg); } catch (e) {}
      try { if (TG && TG.setBackgroundColor) TG.setBackgroundColor(bg); } catch (e) {}
    },
    back(show) {
      if (!TG || !TG.BackButton) return;
      try { show ? TG.BackButton.show() : TG.BackButton.hide(); } catch (e) {}
    },
    tap(style) {
      if (!TG || !TG.HapticFeedback) return;
      try { TG.HapticFeedback.impactOccurred(style || "light"); } catch (e) {}
    },
    notify(type) {
      if (!TG || !TG.HapticFeedback) return;
      try { TG.HapticFeedback.notificationOccurred(type || "success"); } catch (e) {}
    },
    closeGuard(on) {
      if (!TG) return;
      try { on ? TG.enableClosingConfirmation() : TG.disableClosingConfirmation(); } catch (e) {}
    },
    user() {
      try { return (TG && TG.initDataUnsafe && TG.initDataUnsafe.user) || null; } catch (e) { return null; }
    },
    openLink(url) {
      try {
        if (TG && TG.openTelegramLink && /^https:\/\/t\.me\//.test(url)) return TG.openTelegramLink(url);
        if (TG && TG.openLink) return TG.openLink(url);
      } catch (e) {}
      window.open(url, "_blank");
    }
  };

  /* شمارهٔ نسخهٔ فایل‌ها — همان ?v= که در index.html است.
     وقتی به‌روزرسانی می‌فرستیم و کسی می‌گوید «نیامده»، این عدد فوری
     می‌گوید مرورگرش نسخهٔ تازه را گرفته یا نسخهٔ کش‌شدهٔ قدیمی را. */
  function buildVersion() {
    try {
      const src = document.querySelector('script[src*="app.js"]')?.getAttribute("src") || "";
      return (src.split("v=")[1] || "?").trim();
    } catch (e) { return "?"; }
  }

  function userName() {
    const p = S.profile;
    if (p && p.firstName) return [p.firstName, p.lastName].filter(Boolean).join(" ");

    const u = tgSafe.user();
    if (!u) return "کاربر مهمان";
    return [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username || "کاربر تلگرام";
  }

  /* =======================================================
     ۳) مسیریابی صفحات
     ======================================================= */

  const TABS = [
    { route: "/",          icon: "home",  label: "خانه" },
    { route: "/campaigns", icon: "chart", label: "کمپین‌ها" },
    { route: "/support",   icon: "chat",  label: "پشتیبانی" },
    { route: "/account",   icon: "user",  label: "حساب من" }
  ];

  function currentRoute() {
    const h = (location.hash || "#/").replace(/^#/, "");
    return h.startsWith("/") ? h : "/";
  }

  function go(route, replace) {
    if (replace) location.replace("#" + route);
    else location.hash = route;
  }

  function goBack() {
    const r = currentRoute();
    if (r === "/new" && W.step === STEP_COUNT) { go("/campaigns"); return; }
    if (r === "/new" && W.step > 1) { W.step--; render(); return; }
    if (r === "/new") { go("/"); return; }
    if (r.startsWith("/campaign/")) { go("/campaigns"); return; }
    if (r === "/profile") { go("/account"); return; }
    if (r === "/rules") {
      // اگر از فرم آمده بود، به همان مرحله برگردد
      if (history.length > 1) history.back(); else go("/support");
      return;
    }
    go("/");
  }

  function render() {
    // تا وقتی ثبت‌نام کامل نشده، هیچ صفحهٔ دیگری باز نمی‌شود
    if (!S.isRegistered()) {
      renderOnboarding();
      return;
    }

    stopObTimer();

    const route = currentRoute();
    const isTab = TABS.some((t) => t.route === route);

    // نوار پایین فقط در صفحه‌های اصلی
    elTabbar.hidden = !isTab;
    tgSafe.back(!isTab);
    tgSafe.closeGuard(route === "/new");

    let view;
    if (route === "/") view = viewHome();
    else if (route === "/campaigns") view = viewCampaigns();
    else if (route === "/support") view = viewSupport();
    else if (route === "/account") view = viewAccount();
    else if (route === "/new") view = viewWizard();
    else if (route === "/rules") view = viewRules();
    else if (route === "/profile") view = viewProfile();
    else if (route.startsWith("/campaign/")) view = viewCampaignDetail(route.split("/")[2]);
    else view = viewHome();

    elAppbar.className = "appbar" + (view.border === false ? "" : " has-border");
    elAppbar.innerHTML = view.bar;
    elScreen.className = "screen" + (view.sticky ? " is-full" : "");
    elScreen.innerHTML = view.body + (view.sticky || "");
    elTabbar.innerHTML = TABS.map((t) => `
      <button class="tab ${t.route === route ? "is-on" : ""}" data-act="go" data-route="${t.route}">
        <span class="tab__ico">${ICON(t.icon, 22)}</span><span>${t.label}</span>
      </button>`).join("");

    bindReceipt();
    window.scrollTo(0, 0);
    if (view.after) view.after();
  }

  /* کادر رسید در چند صفحه ظاهر می‌شود (بازبینی، موفقیت، جزئیات سفارش)،
     پس اتصالش را یک‌جا بعد از هر رسم انجام می‌دهیم. */
  function bindReceipt() {
    const input = $("#f-receipt");
    if (!input) return;

    input.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      const route = currentRoute();
      const code = route.startsWith("/campaign/")
        ? route.split("/")[2]
        : (route === "/new" ? W.createdId : "");
      if (!code) {
        toast("اول سفارش را ثبت کنید، بعد رسید را بفرستید.", "err");
        return;
      }
      sendReceipt(file, code);
    });
  }

  /**
   * نوار بالای صفحه‌های داخلی.
   * @param {{support?: boolean}} opts اگر support بدهید، دکمهٔ پشتیبانی
   *        هم گوشهٔ نوار می‌آید — برای جایی که مشتری وسط کار ممکن است
   *        سؤالی پیدا کند و نباید مجبور شود فرم را رها کند.
   */
  function bar(title, sub, opts = {}) {
    return `
      <button class="iconbtn" data-act="back" aria-label="بازگشت">${ICON("back")}</button>
      <div class="appbar__title">${esc(title)}${sub ? `<span class="appbar__sub">${esc(sub)}</span>` : ""}</div>
      ${opts.support
        ? `<button class="iconbtn iconbtn--label" data-act="support">${ICON("chat", 16)}<span>پشتیبانی</span></button>`
        : ""}`;
  }

  /** لوگوی شرکت؛ اگر تصویری تنظیم نشده باشد، حرف اول برند نمایش داده می‌شود */
  function brandLogo(cls) {
    if (CFG.brandLogo) {
      return `<img class="${cls} ${cls}--img" src="${esc(CFG.brandLogo)}" alt="${esc(CFG.brandName)}" />`;
    }
    return `<div class="${cls}">${esc(CFG.brandInitial)}</div>`;
  }

  function barBrand() {
    return `
      <div class="brandmark">
        ${brandLogo("brandmark__logo")}
        <div>
          <div class="brandmark__name">${esc(CFG.brandName)}</div>
          <div class="brandmark__tag">${esc(CFG.brandTag)}</div>
        </div>
      </div>
      <button class="iconbtn" data-act="go" data-route="/support" aria-label="پشتیبانی">${ICON("chat")}</button>`;
  }

  /* =======================================================
     ۴) صفحه‌ها
     ======================================================= */

  /* ---------- ۴.۱ خانه ---------- */
  function viewHome() {
    const sum = S.summary();
    const recent = S.list().slice(0, 2);

    return {
      border: false,
      bar: barBrand(),
      body: `
        ${S.isOnline() ? "" : `
        <div class="notice">
          ${ICON("alert", 16)}
          <span>حالت نمایشی — سفارش‌ها ذخیره نمی‌شوند و به تیم Lika نمی‌رسند.${
            S.demoReason && S.demoReason()
              ? `<br /><small style="opacity:.75">دلیل: ${esc(S.demoReason())}</small>`
              : ""
          }</span>
        </div>`}

        <section class="hero">
          <div class="hero__greet">
            <span class="hero__hi">سلام</span>
            <span class="hero__name">${esc(userName())}</span>
          </div>
          <p class="hero__desc">کمپینت رو فعال کن و هدفمند دیده شو.</p>
          <button class="hero__cta" data-act="go" data-route="/new">
            ${ICON("plus", 18)}<span>ثبت کمپین جدید</span>
          </button>
        </section>

        ${draftPanel()}

        <div class="stats">
          <div class="stat"><div class="stat__num">${num(sum.total)}</div><div class="stat__lbl">کل کمپین‌ها</div></div>
          <div class="stat"><div class="stat__num">${num(sum.active)}</div><div class="stat__lbl">فعال</div></div>
          <div class="stat"><div class="stat__num">${num(sum.waiting)}</div><div class="stat__lbl">در بررسی</div></div>
        </div>

        ${recent.length ? `
        ${perfPanel(sum)}
        <section class="section">
          <div class="section__head">
            <h2 class="section__title">آخرین کمپین‌ها</h2>
            <button class="section__link" data-act="go" data-route="/campaigns">همه</button>
          </div>
          ${recent.map(campCard).join("")}
        </section>` : howItWorks()}

        <section class="section">
          <div class="section__head"><h2 class="section__title">خدمات ما</h2></div>
          <div class="services">
            ${CFG.services.map((s) => `
              <div class="service">
                <div class="service__ico">${ICON(s.icon, 20)}</div>
                <div>
                  <div class="service__t">${esc(s.title)}</div>
                  <div class="service__d">${esc(s.desc)}</div>
                </div>
              </div>`).join("")}
          </div>
        </section>

        <section class="section">
          <div class="card card--pad-sm row-between">
            <div>
              <div class="service__t">قوانین تبلیغات تلگرام</div>
              <div class="service__d">قبل از ثبت سفارش یک‌بار بخوانید</div>
            </div>
            <button class="btn btn--sm btn--outline" data-act="go" data-route="/rules">مشاهده</button>
          </div>
        </section>`
    };
  }

  /* ---------- ۴.۱.۰ یادآوری پیش‌نویس نیمه‌تمام ----------
     فرم ثبت کمپین با هر چیزی که نوشته می‌شود خودش را ذخیره می‌کند، ولی تا
     امروز هیچ‌جا به کاربر گفته نمی‌شد چنین چیزی مانده — فقط اگر دوباره فرم
     را باز می‌کرد، پیامی می‌دید. این کارت همان پیش‌نویس را جلوی چشم می‌آورد:
     چه کمپینی بود، تا کجا رفته، و کِی رهایش کرده. */

  // برای حذف یک‌بار تأیید می‌گیریم — همان‌جا داخل کارت، بدون پنجرهٔ تلگرام
  let draftAskDelete = false;

  function draftPanel() {
    const draft = S.loadDraft();
    if (!draft || !draftFilled(draft.data)) return "";

    const d = draft.data;
    const step = Math.min(Math.max(1, draft.step), STEP_COUNT);
    const type = S.TARGET_TYPES[d.target.type];

    const name =
      String(d.adTitle || "").trim() ||
      String(d.target.brand || "").trim() ||
      String(d.target.url || "").trim() ||
      (type ? "تبلیغ " + type.label : "کمپین بی‌نام");

    const when = draft.savedAt ? timeAgo(draft.savedAt) : "";

    return `
      <section class="section">
        <div class="card draft">
          <div class="draft__top">
            <div class="draft__ico">${ICON("draft", 18)}</div>
            <div style="min-width:0">
              <div class="draft__t">کمپین نیمه‌تمام دارید</div>
              <div class="draft__name">${esc(name)}</div>
            </div>
          </div>

          <div class="steps draft__steps">
            <div class="steps__bar"><div class="steps__fill" style="width:${(step / STEP_COUNT) * 100}%"></div></div>
            <div class="steps__txt">مرحلهٔ ${num(step)} از ${num(STEP_COUNT)}</div>
          </div>

          ${when ? `<div class="draft__when">${ICON("clock", 13)}<span>آخرین تغییر: ${esc(when)}</span></div>` : ""}

          ${draftAskDelete ? `
          <div class="draft__ask">
            <span>پیش‌نویس پاک شود؟ برگشتی ندارد.</span>
            <div class="btn-row mt-8">
              <button class="btn btn--outline btn--sm" data-act="draft-keep">نه، بماند</button>
              <button class="btn btn--sm draft__del" data-act="draft-delete">بله، پاک کن</button>
            </div>
          </div>` : `
          <div class="btn-row mt-12">
            <button class="btn btn--ghost btn--sm" data-act="draft-discard">کنسل</button>
            <button class="btn btn--primary btn--sm" data-act="go" data-route="/new" data-resume="1">ادامهٔ فرم</button>
          </div>`}
        </div>
      </section>`;
  }

  /* ---------- ۴.۱.۱ داشبورد عملکرد ----------
     پیش‌تر این جای صفحه فقط دکمهٔ «ثبت کمپین جدید» بالای صفحه را
     تکرار می‌کرد. حالا نشان می‌دهد کمپین‌های قبلی چه وضعی دارند.
  */
  function perfPanel(sum) {
    const ctr = sum.views > 0 ? (sum.clicks / sum.views) * 100 : 0;

    const cells = [
      { icon: "chart",  value: num(sum.views),           label: "بازدید" },
      { icon: "user",   value: num(sum.joins),           label: "عضو جدید" },
      { icon: "target", value: sum.views > 0 ? num(Number(ctr.toFixed(2))) + "٪" : "—", label: "نرخ کلیک" },
      { icon: "pulse",  value: num(sum.clicks),          label: "کلیک" }
    ];

    // تفکیک کمپین‌ها بر اساس وضعیت، به همان ترتیبی که در store تعریف شده
    const counts = {};
    for (const c of S.list()) counts[c.status] = (counts[c.status] || 0) + 1;
    const parts = Object.keys(S.STATUS)
      .filter((key) => counts[key])
      .map((key) => ({ n: counts[key], cls: S.STATUS[key].cls, label: S.STATUS[key].label }));

    return `
      <section class="section">
        <div class="section__head">
          <h2 class="section__title">عملکرد کمپین‌ها</h2>
          <button class="section__link" data-act="go" data-route="/campaigns">جزئیات</button>
        </div>
        <div class="card perf">
          <div class="perf__grid">
            ${cells.map((c) => `
              <div class="perf__cell">
                <div class="perf__ico">${ICON(c.icon, 15)}</div>
                <div class="perf__num">${c.value}</div>
                <div class="perf__lbl">${esc(c.label)}</div>
              </div>`).join("")}
          </div>
          ${parts.length ? `
          <div class="perf__bar">
            ${parts.map((p) => `<span class="perf__seg seg--${p.cls}" style="flex:${p.n}"></span>`).join("")}
          </div>
          <div class="perf__legend">
            ${parts.map((p) => `
              <span class="perf__leg">
                <i class="perf__dot seg--${p.cls}"></i>${esc(p.label)} (${num(p.n)})
              </span>`).join("")}
          </div>` : ""}
        </div>
      </section>`;
  }

  /* ---------- ۴.۱.۲ «چطور کار می‌کند» (وقتی هنوز کمپینی نیست) ---------- */
  function howItWorks() {
    const steps = [
      { icon: "plus",  t: "سفارش می‌دهید",      d: "متن تبلیغ، مقصد و مخاطب هدف را انتخاب می‌کنید — حدود سه دقیقه." },
      { icon: "check", t: "ما بررسی می‌کنیم",   d: "تیم لیکا متن را با قوانین تلگرام تطبیق می‌دهد و کمپین را راه می‌اندازد." },
      { icon: "chart", t: "گزارش می‌گیرید",     d: "بازدید و کلیک هر کمپین را همین‌جا دنبال می‌کنید." }
    ];

    return `
      <section class="section">
        <div class="section__head"><h2 class="section__title">چطور کار می‌کند</h2></div>
        <div class="card howto">
          ${steps.map((s, i) => `
            <div class="howto__row">
              <div class="howto__ico">${ICON(s.icon, 17)}</div>
              <div class="howto__body">
                <div class="howto__t"><span class="howto__n">${num(i + 1)}</span>${esc(s.t)}</div>
                <div class="howto__d">${esc(s.d)}</div>
              </div>
            </div>`).join("")}
        </div>
      </section>`;
  }

  /* ---------- ۴.۲ کارت کمپین ---------- */
  function campCard(c) {
    const st = S.STATUS[c.status] || S.STATUS.pending;
    const brand = c.target?.brand || c.target?.url || "بدون نام";
    return `
      <button class="camp" data-act="go" data-route="/campaign/${esc(c.id)}">
        <div class="camp__top">
          <div class="camp__ava">${esc((brand.trim()[0] || "L").toUpperCase())}</div>
          <div style="flex:1;min-width:0">
            <div class="camp__name">${esc(brand)}</div>
            <div class="camp__meta">${esc(c.id)} • ${timeAgo(c.createdAt)}</div>
          </div>
          <span class="badge badge--${st.cls}"><span class="badge__dot"></span>${st.label}</span>
        </div>
        <div class="camp__foot">
          <span>${c.budget?.priceToman
            ? `مبلغ: <span class="camp__money">${tomanPrice(c.budget.priceToman)}</span>`
            : ""}</span>
          <span>${c.stats?.views
            ? "بازدید: " + num(c.stats.views)
            : c.budget?.packageViews
              ? "بستهٔ " + viewsShort(c.budget.packageViews) + " بازدید"
              : ""}</span>
        </div>
      </button>`;
  }

  /* ---------- ۴.۳ لیست کمپین‌ها ---------- */
  let campFilter = "all";
  function viewCampaigns() {
    const all = S.list();
    const groups = [
      { id: "all", label: "همه" },
      { id: "waiting", label: "در بررسی" },
      { id: "active", label: "فعال" },
      { id: "done", label: "پایان‌یافته" }
    ];
    const match = (c) => {
      if (campFilter === "waiting") return ["pending", "rejected"].includes(c.status);
      if (campFilter === "active") return ["approved", "running"].includes(c.status);
      if (campFilter === "done") return c.status === "done";
      return true;
    };
    const items = all.filter(match);

    return {
      bar: `<div class="appbar__title">کمپین‌های من<span class="appbar__sub">${num(all.length)} کمپین ثبت شده</span></div>
            <button class="iconbtn" data-act="go" data-route="/new" aria-label="کمپین جدید">${ICON("plus")}</button>`,
      body: `
        <div class="tabs">
          ${groups.map((g) => `<button class="chip ${campFilter === g.id ? "is-on" : ""}" data-act="filter" data-val="${g.id}">${g.label}</button>`).join("")}
        </div>
        ${items.length ? items.map(campCard).join("") : `
          <div class="empty">
            <div class="empty__ico">${ICON("folder", 30)}</div>
            <div class="empty__t">کمپینی در این بخش نیست</div>
            <div class="empty__d">با ثبت کمپین جدید شروع کنید.</div>
            <button class="btn btn--primary" data-act="go" data-route="/new">ثبت کمپین جدید</button>
          </div>`}`
    };
  }

  /* ---------- ۴.۴ جزئیات کمپین ---------- */
  function viewCampaignDetail(id) {
    const c = S.get(id);
    if (!c) {
      return { bar: bar("کمپین"), body: `<div class="empty"><div class="empty__ico">${ICON("help", 30)}</div><div class="empty__t">کمپین پیدا نشد</div></div>` };
    }

    const st = S.STATUS[c.status] || S.STATUS.pending;
    const cur = S.FLOW.indexOf(c.status);
    const countries = (c.targeting?.countries || []).map(codeToCountry).filter(Boolean);
    const topics = (c.targeting?.topics || []).map(idToTopic).filter(Boolean);

    const timeline = c.status === "rejected"
      ? `<div class="tl is-now"><div class="tl__dot">!</div><div><div class="tl__t">نیاز به اصلاح</div><div class="tl__d">کارشناس ما با شما تماس می‌گیرد.</div></div></div>`
      : S.FLOW.map((s, i) => {
          const h = (c.history || []).find((x) => x.status === s);
          const cls = i < cur ? "is-done" : i === cur ? "is-now" : "";
          return `
            <div class="tl ${cls}">
              <div class="tl__dot">${i <= cur ? "✓" : ""}</div>
              <div>
                <div class="tl__t">${S.STATUS[s].label}</div>
                <div class="tl__d">${h ? dateFa(h.at) : "در انتظار"}</div>
              </div>
            </div>`;
        }).join("");

    return {
      bar: bar(c.target?.brand || c.id, c.id),
      body: `
        ${c.isSample ? `<div class="card card--pad-sm center tiny dim mt-8">این یک کمپین <b>نمونه</b> برای نمایش ظاهر پنل است.</div>` : ""}

        <div class="card mt-12">
          <div class="row-between">
            <div>
              <div class="service__t">وضعیت کمپین</div>
              <div class="service__d">${timeAgo(c.createdAt)} ثبت شده</div>
            </div>
            <span class="badge badge--${st.cls}"><span class="badge__dot"></span>${st.label}</span>
          </div>
          <div class="mt-16 timeline">${timeline}</div>
        </div>

        ${["running", "done"].includes(c.status) ? `
        <div class="section">
          <div class="section__head"><h2 class="section__title">عملکرد</h2></div>
          <div class="stats" style="grid-template-columns:repeat(4, 1fr)">
            <div class="stat"><div class="stat__num">${num(c.stats.views)}</div><div class="stat__lbl">بازدید</div></div>
            <div class="stat"><div class="stat__num">${num(c.stats.clicks)}</div><div class="stat__lbl">کلیک</div></div>
            <div class="stat"><div class="stat__num">${c.stats.views ? num(((c.stats.clicks / c.stats.views) * 100).toFixed(2)) + "٪" : "—"}</div><div class="stat__lbl">نرخ کلیک</div></div>
            <div class="stat"><div class="stat__num">${num(c.stats.joins || 0)}</div><div class="stat__lbl">عضو جدید</div></div>
          </div>
        </div>` : ""}

        ${c.creative?.text ? `
        <div class="section">
          <div class="section__head"><h2 class="section__title">متن تبلیغ</h2></div>
          ${adPreview({
            title: c.target?.channelTitle || String(c.target?.url || "").replace(/^@/, ""),
            text: c.creative.text,
            poster: "",
            action: adAction(c.target?.type)
          })}
        </div>` : ""}

        <div class="section">
          <div class="section__head"><h2 class="section__title">مشخصات</h2></div>
          <div class="card">
            ${kv("نوع مقصد", (S.TARGET_TYPES[c.target?.type] || {}).label || "—")}
            ${kv("آدرس مقصد", c.target?.url || "—", true)}
            ${(c.targeting?.keywords || []).length ? kv("کلیدواژه‌ها", c.targeting.keywords.join("، ")) : ""}
            ${countries.length ? kv("کشورها", countries.map((x) => x.name).join("، ")) : ""}
            ${(c.targeting?.languages || []).length ? kv("زبان‌ها", c.targeting.languages.join("، ")) : ""}
            ${topics.length ? kv("موضوعات", topics.map((t) => t.name).join("، ")) : ""}
            ${(c.targeting?.channels || []).length ? kv("کانال‌های هدف", c.targeting.channels.join("، "), true) : ""}
            ${c.creative?.posterFileId ? kv("پوستر تبلیغ", "دارد") : ""}
            ${c.budget?.priceToman ? `
              ${kv("بسته", viewsShort(c.budget.packageViews) + " بازدید")}
              ${kv("مبلغ", tomanPrice(c.budget.priceToman))}
            ` : ""}
            ${kv("زمان شروع", c.budget?.startDate ? jalaliLabel(c.budget.startDate) : (START_WHEN[c.budget?.startWhen] || START_WHEN.asap))}
            ${c.notes ? kv("توضیحات", c.notes) : ""}
          </div>
        </div>

        ${c.budget?.priceToman ? payBox(null, c) : ""}

        <div class="section">
          <div class="section__head"><h2 class="section__title">دوباره همین کمپین</h2></div>
          <div class="card">
            <button class="btn btn--primary btn--block" data-act="repeat" data-val="${esc(c.id)}">
              ${ICON("repeat", 18)} تکرار این کمپین
            </button>
            <div class="help mt-8">
              یک سفارش تازه با همین متن، مقصد و بودجه باز می‌شود؛ پیش از ثبت می‌توانید
              هر کدام را تغییر دهید. سفارش فعلی دست‌نخورده می‌ماند.
            </div>
          </div>
        </div>

        <div class="section">
          <button class="btn btn--outline btn--block" data-act="support">${ICON("chat", 18)} گفت‌وگو با کارشناس دربارهٔ این کمپین</button>
        </div>`
    };
  }

  function kv(k, v, ltr) {
    return `<div class="kv"><span class="kv__k">${esc(k)}</span><span class="kv__v" ${ltr ? 'dir="ltr"' : ""}>${esc(v)}</span></div>`;
  }

  /* ---------- ۴.۵ پیش‌نمایش تبلیغ ---------- */

  /**
   * شبیه‌سازی پیام اسپانسری تلگرام، داخل پس‌زمینهٔ چت.
   * رنگ‌ها اینجا عمداً ثابت‌اند (نه از تم اپ) چون باید همان چیزی
   * دیده شود که مخاطب در تلگرام می‌بیند.
   */
  function adPreview(ad) {
    const title = String(ad.title || "").trim() || "نام کانال شما";
    const text = String(ad.text || "").trim();
    const action = ad.action || "VIEW CHANNEL";

    /* پوستر، اگر مشتری آپلود کرده باشد. تلگرام آن را بالای متن،
       با نسبت ۱۶:۹، نشان می‌دهد. */
    const poster = ad.poster
      ? `<img class="tgad__poster" src="${esc(ad.poster)}" alt="" />`
      : "";

    return `
      <div class="adprev">
        <div class="adprev__label">پیش‌نمایش — این چیزی است که مخاطب در تلگرام می‌بیند</div>
        <div class="tgchat">
          <div class="tgbubble">
            <div class="tgad">
              <div class="tgad__head">
                <span class="tgad__ad">Ad</span>
                <span class="tgad__what">what's this?</span>
              </div>
              ${poster}
              <div class="tgad__title" id="prevName">${esc(title)}</div>
              <div class="tgad__text ${text ? "" : "is-empty"}" id="prevText">${
                text ? esc(text) : "متن تبلیغ شما اینجا نمایش داده می‌شود…"
              }</div>
              <div class="tgad__btn">${esc(action)}</div>
            </div>
          </div>
        </div>
      </div>`;
  }

  /* =======================================================
     پوستر تبلیغ
     ---------------------------------------------------------
     اختیاری است. تلگرام برای عکس تبلیغ نسبت ۱۶:۹ می‌خواهد، پس
     همان‌جا در گوشی مشتری می‌سنجیم — نه اینکه بگذاریم سفارش ثبت شود
     و بعد کارشناس مجبور شود از او عکس تازه بخواهد.

     عکس قبل از فرستادن کوچک می‌شود (حداکثر ۱۲۸۰×۷۲۰): هم سریع‌تر
     می‌رسد، هم در پیش‌نویس جا می‌شود، و کیفیتش برای تبلیغ تلگرام
     بیش از کافی است.
     ======================================================= */

  const POSTER_RATIO = 16 / 9;
  const POSTER_TOLERANCE = 0.04;      // ۴٪ خطا، برای عکس‌هایی مثل ۱۹۲۰×۱۰۸۱
  const POSTER_MAX_W = 1280;
  const POSTER_MAX_H = 720;

  function posterField() {
    const has = Boolean(W.data.creative.poster);

    return `
      <div class="field">
        <div class="label">
          <span>پوستر تبلیغ</span>
          <span class="label__hint">اختیاری — نسبت ۱۶:۹</span>
        </div>

        <div id="posterbox">${posterBoxHtml()}</div>
        ${errOf("poster")}
        <input type="file" id="f-poster" accept="image/jpeg,image/png" hidden />

        <div class="help">
          عکسی که بالای تبلیغ دیده می‌شود. باید افقی و با نسبت ۱۶:۹ باشد
          (مثلاً ۱۲۸۰×۷۲۰). ${has ? "" : "اگر نگذارید، تبلیغ فقط متنی خواهد بود."}
        </div>
      </div>`;
  }

  function posterBoxHtml() {
    const src = W.data.creative.poster;
    if (!src) {
      return `
        <button class="poster poster--empty" data-act="poster-pick">
          <span class="poster__ico">${ICON("plus", 20)}</span>
          <span class="poster__t">انتخاب عکس</span>
          <span class="poster__d">JPG یا PNG، نسبت ۱۶:۹</span>
        </button>`;
    }
    return `
      <div class="poster poster--has">
        <img class="poster__img" src="${esc(src)}" alt="پوستر تبلیغ" />
        <div class="btn-row mt-8">
          <button class="btn btn--outline btn--sm" data-act="poster-pick">تغییر عکس</button>
          <button class="btn btn--ghost btn--sm" data-act="poster-clear">حذف عکس</button>
        </div>
      </div>`;
  }

  /**
   * عکس انتخاب‌شده را می‌سنجد و کوچک می‌کند.
   * @returns {Promise<{ok: true, dataUrl: string} | {ok: false, error: string}>}
   */
  function readPosterFile(file) {
    return new Promise((resolve) => {
      if (!file) return resolve({ ok: false, error: "عکسی انتخاب نشد." });
      if (!/^image\/(jpeg|png)$/.test(file.type)) {
        return resolve({ ok: false, error: "فقط عکس JPG یا PNG." });
      }
      // ۱۵ مگابایت سقفِ خواندن؛ خروجی خیلی کوچک‌تر می‌شود
      if (file.size > 15 * 1024 * 1024) {
        return resolve({ ok: false, error: "حجم عکس خیلی زیاد است (بیشتر از ۱۵ مگابایت)." });
      }

      const url = URL.createObjectURL(file);
      const img = new Image();

      img.onload = () => {
        URL.revokeObjectURL(url);
        const ratio = img.width / img.height;

        if (Math.abs(ratio - POSTER_RATIO) / POSTER_RATIO > POSTER_TOLERANCE) {
          resolve({
            ok: false,
            error: `عکس باید نسبت ۱۶:۹ داشته باشد. عکس شما ${num(img.width)}×${num(img.height)} است.`
          });
          return;
        }

        // کوچک کردن با حفظ همان نسبت
        const scale = Math.min(1, POSTER_MAX_W / img.width, POSTER_MAX_H / img.height);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);

        try {
          resolve({ ok: true, dataUrl: canvas.toDataURL("image/jpeg", 0.85) });
        } catch (e) {
          resolve({ ok: false, error: "این عکس خوانده نشد. عکس دیگری امتحان کنید." });
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({ ok: false, error: "این فایل عکس نیست." });
      };

      img.src = url;
    });
  }

  async function onPosterChosen(file) {
    const result = await readPosterFile(file);

    if (!result.ok) {
      W.errors.poster = result.error;
      tgSafe.notify("error");
      toast(result.error, "err");
      render();
      return;
    }

    W.data.creative.poster = result.dataUrl;
    delete W.errors.poster;
    tgSafe.tap();
    saveDraft();
    render();
  }

  /** متن دکمهٔ پایین تبلیغ — تلگرام آن را انگلیسی و با حروف بزرگ نشان می‌دهد */
  function adAction(type) {
    return type === "bot" ? "OPEN BOT" : "VIEW CHANNEL";
  }

  /** اطلاعاتی که در پیش‌نمایش نشان داده می‌شود */
  function previewOf(target, text) {
    return {
      title: W.chat.title || String(target.url || "").replace(/^@/, ""),
      photo: W.chat.photo,
      poster: W.data.creative.poster,
      text,
      action: adAction(target.type)
    };
  }


  /* ---------- ۴.۶ مشاوره و پشتیبانی ---------- */
  function viewSupport() {
    return {
      bar: `<div class="appbar__title">پشتیبانی<span class="appbar__sub">پاسخ‌گویی در ساعات کاری</span></div>`,
      body: `
        <div class="card">
          <div class="service" style="border:none;background:transparent;padding:0">
            <div class="service__ico">${ICON("target", 20)}</div>
            <div>
              <div class="service__t">کمک می‌خواهید؟</div>
              <div class="service__d">اگر نمی‌دانید چه بودجه و مخاطبی برای کسب‌وکار شما مناسب است، بپرسید.</div>
            </div>
          </div>
          <button class="btn btn--primary btn--block mt-16" data-act="support">${ICON("chat", 18)} ارتباط با پشتیبانی</button>
        </div>

        <section class="section">
          <div class="section__head"><h2 class="section__title">سوالات متداول</h2></div>
          ${CFG.faq.map((f, i) => `
            <div class="faq" data-faq="${i}">
              <button class="faq__q" data-act="faq" data-val="${i}">
                <span>${esc(f.q)}</span><span class="ar">▾</span>
              </button>
              <div class="faq__a">${esc(f.a)}</div>
            </div>`).join("")}
        </section>

        <section class="section">
          <div class="card card--pad-sm row-between">
            <div>
              <div class="service__t">قوانین تبلیغات تلگرام</div>
              <div class="service__d">چه چیزی را نمی‌توان تبلیغ کرد</div>
            </div>
            <button class="btn btn--sm btn--outline" data-act="go" data-route="/rules">مشاهده</button>
          </div>
        </section>`
    };
  }

  /* ---------- ۴.۷ قوانین ---------- */
  function viewRules() {
    return {
      bar: bar("قوانین تبلیغات", "خلاصهٔ سیاست‌های Telegram Ads"),
      body: `
        <div class="card">
          <div class="service__t">موارد غیرمجاز</div>
          <div class="rules mt-12">
            ${CFG.adRules.map((r) => `<div class="rule"><span class="rule__x">✕</span><span>${esc(r)}</span></div>`).join("")}
          </div>
        </div>
        <div class="card">
          <div class="service__t">نکات مهم برای تأیید سریع‌تر</div>
          <div class="rules mt-12">
            <div class="rule"><span style="color:var(--success)">✓</span><span>متن تبلیغ حداکثر ${num(CFG.adTextMaxLength)} کاراکتر باشد.</span></div>
            <div class="rule"><span style="color:var(--success)">✓</span><span>مقصد تبلیغ باید عمومی و قابل دسترس باشد.</span></div>
            <div class="rule"><span style="color:var(--success)">✓</span><span>یک پیشنهاد روشن بدهید؛ متن‌های کلی بازدهی ندارند.</span></div>
            <div class="rule"><span style="color:var(--success)">✓</span><span>کانال مقصد پیش از اجرای تبلیغ محتوای کافی داشته باشد.</span></div>
          </div>
        </div>
        <div class="card card--pad-sm center tiny dim">
          این متن خلاصه‌ای برای راهنمایی است؛ تصمیم نهایی دربارهٔ تأیید تبلیغ بر عهدهٔ تلگرام است.
        </div>`
    };
  }

  /* ---------- ۴.۸ حساب من ---------- */
  function viewAccount() {
    const u = tgSafe.user();
    const p = S.profile;
    const sum = S.summary();
    const dark = document.documentElement.getAttribute("data-theme") === "dark";

    return {
      bar: `<div class="appbar__title">حساب من</div>`,
      body: `
        <div class="card">
          <div class="profile">
            ${u && u.photo_url
              ? `<img class="profile__ava" src="${esc(u.photo_url)}" alt="" />`
              : `<div class="profile__ava">${esc((userName()[0] || "L").toUpperCase())}</div>`}
            <div style="min-width:0">
              <div class="profile__n">${esc(userName())}</div>
              <div class="profile__u">${u && u.username ? "@" + esc(u.username) : (u ? "ID: " + esc(u.id) : "خارج از تلگرام")}</div>
            </div>
          </div>
          <div class="stats" style="margin-top:14px">
            <div class="stat"><div class="stat__num">${num(sum.total)}</div><div class="stat__lbl">کمپین</div></div>
            <div class="stat"><div class="stat__num">${num(sum.views)}</div><div class="stat__lbl">بازدید</div></div>
            <div class="stat"><div class="stat__num">${esc(tomanShort(sum.spendToman))}</div><div class="stat__lbl">هزینه</div></div>
          </div>
        </div>

        <section class="section">
          <div class="section__head">
            <h2 class="section__title">اطلاعات من</h2>
            <button class="section__link" data-act="go" data-route="/profile">ویرایش</button>
          </div>
          <div class="card">
            ${kv("نام", p.firstName || "—")}
            ${kv("نام خانوادگی", p.lastName || "—")}
            ${kv("شمارهٔ همراه", p.phone || "—", true)}
            ${kv("ایمیل", p.email || "—", true)}
          </div>
        </section>

        <section class="section">
          <div class="menu">
            <button class="menu__i" data-act="go" data-route="/campaigns">
              <span class="menu__ico">${ICON("chart", 17)}</span><span>کمپین‌های من</span><span class="menu__ar">${ICON("next", 15)}</span>
            </button>
            <button class="menu__i" data-act="go" data-route="/rules">
              <span class="menu__ico">${ICON("doc", 17)}</span><span>قوانین تبلیغات</span><span class="menu__ar">${ICON("next", 15)}</span>
            </button>
            <button class="menu__i" data-act="support">
              <span class="menu__ico">${ICON("chat", 17)}</span><span>پشتیبانی</span><span class="menu__ar">${ICON("next", 15)}</span>
            </button>
            <button class="menu__i" data-act="theme">
              <span class="menu__ico">${ICON(dark ? "sun" : "moon", 17)}</span><span>حالت ${dark ? "روشن" : "تیره"}</span><span class="menu__ar">${ICON("next", 15)}</span>
            </button>
          </div>
        </section>

        <section class="section">
          <div class="menu">
            <button class="menu__i menu__i--danger" data-act="clear-samples">
              <span class="menu__ico">${ICON("trash", 17)}</span><span>پاک کردن کمپین‌های نمونه</span><span class="menu__ar">${ICON("next", 15)}</span>
            </button>
          </div>
          <p class="help center mt-12">
            نسخهٔ آزمایشی ۰٫۱ — ${esc(CFG.brandName)}<br />
            <span class="nums" dir="ltr">build ${esc(buildVersion())}</span>
            ${S.packagesFor("channel").length ? "" : " • بسته‌ها بارگذاری نشدند"}
          </p>
        </section>`
    };
  }

  /* =======================================================
     ۴.۸) ویرایش اطلاعات کاربر
     ======================================================= */

  const PR = { step: "view", firstName: "", lastName: "", email: "", phone: "", code: "", error: "", busy: false, hint: "" };

  function openProfile() {
    const p = S.profile;
    PR.step = "view";
    PR.firstName = p.firstName || "";
    PR.lastName = p.lastName || "";
    PR.email = p.email || "";
    PR.phone = "";
    PR.code = "";
    PR.error = "";
    PR.hint = "";
  }

  const prError = () => (PR.error ? `<div class="err">${esc(PR.error)}</div>` : "");

  function viewProfile() {
    const body = PR.step === "phone" ? prPhone() : PR.step === "code" ? prCode() : prView();

    return {
      bar: bar("اطلاعات من", "نام و شمارهٔ تماس شما"),
      body,
      after: () => {
        stopObTimer();
        if (PR.step === "code") { obTick(); obTimer = setInterval(obTick, 1000); }

        const on = (id, fn) => { const el = $("#" + id); if (el) el.addEventListener("input", fn); };
        on("pr-first", (e) => { PR.firstName = e.target.value; });
        on("pr-last", (e) => { PR.lastName = e.target.value; });
        on("pr-email", (e) => { PR.email = e.target.value; });
        on("pr-phone", (e) => { PR.phone = e.target.value; });
        on("pr-code", (e) => { PR.code = e.target.value; });
      }
    };
  }

  function prView() {
    return `
      <div class="card">
        <div class="field">
          <div class="label">نام <span class="req">*</span></div>
          <input class="input" id="pr-first" autocomplete="given-name" value="${esc(PR.firstName)}" />
        </div>
        <div class="field">
          <div class="label">نام خانوادگی <span class="req">*</span></div>
          <input class="input" id="pr-last" autocomplete="family-name" value="${esc(PR.lastName)}" />
        </div>
        <div class="field">
          <div class="label">ایمیل <span class="tiny dim">(اختیاری)</span></div>
          <input class="input" id="pr-email" type="email" dir="ltr" autocomplete="email"
                 placeholder="example@mail.com" value="${esc(PR.email)}" />
          ${prError()}
        </div>
        <button class="btn btn--primary btn--block mt-16" data-act="pr-save" ${PR.busy ? "disabled" : ""}>
          ${PR.busy ? "در حال ذخیره…" : "ذخیره تغییرات"}
        </button>
      </div>

      <section class="section">
        <div class="section__head"><h2 class="section__title">شمارهٔ همراه</h2></div>
        <div class="card">
          <div class="row-between">
            <span class="kv__v nums" dir="ltr">${esc(S.profile.phone || "—")}</span>
            <button class="btn btn--sm btn--outline" data-act="pr-phone-start">تغییر شماره</button>
          </div>
          <div class="help mt-8">برای تغییر شماره، کد تأیید به تلگرام شما فرستاده می‌شود.</div>
        </div>
      </section>`;
  }

  function prPhone() {
    return `
      <div class="card">
        <div class="field">
          <div class="label">شمارهٔ همراه جدید <span class="req">*</span></div>
          <input class="input ob__input" id="pr-phone" type="tel" inputmode="numeric" dir="ltr"
                 placeholder="09123456789" value="${esc(PR.phone)}" />
          ${prError()}
        </div>
        <div class="btn-row mt-16">
          <button class="btn btn--outline" data-act="pr-cancel">انصراف</button>
          <button class="btn btn--primary" data-act="pr-phone-send" ${PR.busy ? "disabled" : ""}>
            ${PR.busy ? "لطفاً صبر کنید…" : "ارسال کد"}
          </button>
        </div>
      </div>`;
  }

  function prCode() {
    return `
      <div class="card">
        <div class="field">
          <div class="label">کد تأیید <span class="req">*</span></div>
          <input class="input ob__input ob__code" id="pr-code" type="text" inputmode="numeric"
                 dir="ltr" maxlength="5" placeholder="- - - - -" value="${esc(PR.code)}" />
          ${prError()}
          ${PR.hint ? `<div class="help">${esc(PR.hint)}</div>` : ""}
        </div>

        <div class="ob__timer" id="ob-timer"></div>
        <button class="btn btn--ghost btn--block mt-8" id="ob-resend" data-act="pr-resend" disabled>کد را دوباره بفرست</button>

        <div class="btn-row mt-16">
          <button class="btn btn--outline" data-act="pr-cancel">انصراف</button>
          <button class="btn btn--primary" data-act="pr-code-verify" ${PR.busy ? "disabled" : ""}>
            ${PR.busy ? "در حال بررسی…" : "تأیید شماره"}
          </button>
        </div>
        <p class="ob__note">شمارهٔ جدید: <span dir="ltr">${esc(PR.phone)}</span></p>
      </div>`;
  }

  async function prRun(fn, onDone) {
    if (PR.busy) return;
    PR.busy = true;
    PR.error = "";
    render();
    try {
      await fn();
      if (onDone) onDone();
    } catch (err) {
      PR.error = err.message || "مشکلی پیش آمد.";
      tgSafe.notify("error");
    } finally {
      PR.busy = false;
      render();
    }
  }

  /* =======================================================
     ۴.۹) ثبت‌نام (اولین چیزی که مخاطب می‌بیند)
     ======================================================= */

  const OB = {
    step: "phone", phone: "", code: "", firstName: "", lastName: "",
    error: "", busy: false, hint: "",
    sentAt: 0,          // زمان ارسال کد
    expiresIn: 120,     // اعتبار کد (ثانیه)
    resendIn: 120,      // فاصلهٔ مجاز تا ارسال دوباره (ثانیه)
    expired: false
  };

  let obTimer = null;

  function stopObTimer() {
    if (obTimer) { clearInterval(obTimer); obTimer = null; }
  }

  /**
   * ثانیه را به شکل ۰۲:۳۵ نشان می‌دهد.
   * دو کاراکتر نامرئی ابتدا و انتها (LRI و PDI) جلوی به‌هم‌ریختن
   * ترتیب عددها را در متن راست‌به‌چپ می‌گیرند.
   */
  function clockFa(totalSeconds) {
    const s = Math.max(0, Math.round(totalSeconds));
    const mm = num(Math.floor(s / 60)).padStart(2, "۰");
    const ss = num(s % 60).padStart(2, "۰");
    return "\u2066" + mm + ":" + ss + "\u2069";
  }

  function obSecondsLeft() {
    return OB.expiresIn - (Date.now() - OB.sentAt) / 1000;
  }

  function obResendLeft() {
    return OB.resendIn - (Date.now() - OB.sentAt) / 1000;
  }

  /** هر ثانیه فقط همان چند تکهٔ کوچک صفحه را به‌روز می‌کند */
  function obTick() {
    const left = obSecondsLeft();
    const timer = $("#ob-timer");
    const resend = $("#ob-resend");

    if (timer) {
      if (left > 0) {
        timer.innerHTML = `${ICON("clock", 15)}<span>اعتبار کد: <b class="nums">${clockFa(left)}</b></span>`;
        timer.className = "ob__timer" + (left <= 30 ? " is-low" : "");
      } else {
        timer.innerHTML = `${ICON("alert", 15)}<span>کد منقضی شد — کد تازه بگیرید</span>`;
        timer.className = "ob__timer is-out";
      }
    }

    if (resend) {
      const wait = obResendLeft();
      if (wait > 0) {
        resend.disabled = true;
        resend.textContent = `ارسال دوباره تا ${clockFa(wait)} دیگر`;
      } else {
        resend.disabled = false;
        resend.textContent = "کد را دوباره بفرست";
      }
    }

    if (left <= 0 && !OB.expired) {
      OB.expired = true;
      tgSafe.notify("warning");
    }
  }

  function onboardingSteps() {
    return S.requireCode ? ["phone", "code", "profile"] : ["phone", "profile"];
  }

  function renderOnboarding() {
    const steps = onboardingSteps();
    const index = Math.max(0, steps.indexOf(OB.step));

    elTabbar.hidden = true;
    tgSafe.back(false);
    tgSafe.closeGuard(false);

    const bodies = { phone: obPhone, code: obCode, profile: obProfile };

    elAppbar.className = "appbar";
    elAppbar.innerHTML = `
      <div class="brandmark">
        ${brandLogo("brandmark__logo")}
        <div>
          <div class="brandmark__name">${esc(CFG.brandName)}</div>
          <div class="brandmark__tag">${esc(CFG.brandTag)}</div>
        </div>
      </div>`;

    elScreen.className = "screen is-full";
    elScreen.innerHTML = `
      <div class="ob">
        <div class="ob__dots">
          ${steps.map((_, i) => `<span class="ob__dot ${i <= index ? "is-on" : ""}"></span>`).join("")}
        </div>
        ${bodies[OB.step]()}
      </div>
      ${obBar()}`;

    bindOnboarding();
    window.scrollTo(0, 0);
  }

  function obBar() {
    const labels = { phone: "ادامه", code: "تأیید و ادامه", profile: "ورود به پنل" };
    return `
      <div class="stickybar">
        ${OB.step === "code" ? `<button class="btn btn--outline btn--back" data-act="ob-back">${ICON("back")}<span>تغییر شماره</span></button>` : ""}
        <button class="btn btn--primary" data-act="ob-next" ${OB.busy ? "disabled" : ""}>
          ${OB.busy ? "لطفاً صبر کنید…" : labels[OB.step]}
        </button>
      </div>`;
  }

  const obError = () => (OB.error ? `<div class="err">${esc(OB.error)}</div>` : "");

  /* --- گام ۱: شمارهٔ موبایل --- */
  function obPhone() {
    return `
      ${S.isOnline() ? "" : `
      <div class="notice">
        ${ICON("alert", 16)}
        <span>حالت نمایشی — سفارش‌ها ذخیره نمی‌شوند.${
          S.demoReason && S.demoReason()
            ? `<br /><small style="opacity:.75">دلیل: ${esc(S.demoReason())}</small>`
            : ""
        }</span>
      </div>`}

      <div class="ob__head">
        <div class="ob__ico">${ICON("user", 26)}</div>
        <h1 class="ob__t">خوش آمدید</h1>
        <p class="ob__d">برای شروع، شمارهٔ موبایل خود را وارد کنید.</p>
      </div>

      <div class="field">
        <div class="label">شمارهٔ موبایل <span class="req">*</span></div>
        <input class="input ob__input ${OB.error ? "is-error" : ""}" id="ob-phone" type="tel"
               inputmode="numeric" dir="ltr" autocomplete="tel"
               placeholder="09123456789" value="${esc(OB.phone)}" />
        ${obError()}
      </div>

      <p class="ob__note">با ادامه دادن، ${esc(CFG.brandName)} شمارهٔ شما را فقط برای پیگیری سفارش‌ها استفاده می‌کند.</p>`;
  }

  /* --- گام ۲: کد تأیید --- */
  function obCode() {
    return `
      <div class="ob__head">
        <div class="ob__ico">${ICON("chat", 26)}</div>
        <h1 class="ob__t">کد تأیید</h1>
        <p class="ob__d">کد ۵ رقمی را در تلگرام برایتان فرستادیم.<br />همین چت را بالا ببرید تا آن را ببینید.</p>
      </div>

      <div class="field">
        <div class="label">کد تأیید <span class="req">*</span></div>
        <input class="input ob__input ob__code ${OB.error ? "is-error" : ""}" id="ob-code" type="text"
               inputmode="numeric" dir="ltr" maxlength="5" autocomplete="one-time-code"
               placeholder="- - - - -" value="${esc(OB.code)}" />
        ${obError()}
        <button class="btn btn--ghost btn--sm mt-8" data-act="ob-paste" id="ob-paste">
          ${ICON("copy", 15)}<span>چسباندن کد از حافظه</span>
        </button>
        ${OB.hint ? `<div class="help">${esc(OB.hint)}</div>` : ""}
      </div>

      <div class="ob__timer" id="ob-timer"></div>

      <button class="btn btn--ghost btn--block mt-8" id="ob-resend" data-act="ob-resend" disabled>کد را دوباره بفرست</button>
      <p class="ob__note">شماره: <span dir="ltr">${esc(OB.phone)}</span></p>`;
  }

  /* --- گام ۳: نام --- */
  function obProfile() {
    return `
      <div class="ob__head">
        <div class="ob__ico">${ICON("check", 26)}</div>
        <h1 class="ob__t">آخرین قدم</h1>
        <p class="ob__d">نام و نام خانوادگی خود را لطفاً وارد کنید.</p>
      </div>

      <div class="field">
        <div class="label">نام <span class="req">*</span></div>
        <input class="input ob__input ${OB.error ? "is-error" : ""}" id="ob-first"
               autocomplete="given-name" placeholder="مثلاً: علی" value="${esc(OB.firstName)}" />
      </div>

      <div class="field">
        <div class="label">نام خانوادگی <span class="req">*</span></div>
        <input class="input ob__input ${OB.error ? "is-error" : ""}" id="ob-last"
               autocomplete="family-name" placeholder="مثلاً: رضایی" value="${esc(OB.lastName)}" />
        ${obError()}
      </div>`;
  }

  function bindOnboarding() {
    stopObTimer();
    if (OB.step === "code") {
      obTick();
      obTimer = setInterval(obTick, 1000);
    }

    const on = (id, fn) => { const el = $("#" + id); if (el) el.addEventListener("input", fn); };
    on("ob-phone", (e) => { OB.phone = e.target.value; });
    on("ob-code", (e) => { OB.code = e.target.value; });
    on("ob-first", (e) => { OB.firstName = e.target.value; });
    on("ob-last", (e) => { OB.lastName = e.target.value; });

    const first = $(".ob__input");
    if (first && !OB.busy) setTimeout(() => { try { first.focus(); } catch (e) {} }, 250);
  }

  async function obNext() {
    if (OB.busy) return;
    OB.error = "";
    OB.busy = true;
    renderOnboarding();

    try {
      if (OB.step === "phone") {
        const res = await S.registerPhone(OB.phone);
        if (res.codeSent) {
          OB.step = "code";
          OB.hint = res.demoCode ? `حالت نمایشی: کد ${res.demoCode} است.` : "";
          OB.sentAt = Date.now();
          OB.expiresIn = res.expiresInSeconds || 120;
          OB.resendIn = res.resendAfterSeconds || 120;
          OB.expired = false;
        } else {
          OB.step = "profile";
        }
      } else if (OB.step === "code") {
        await S.verifyCode(OB.code);
        OB.step = "profile";
      } else {
        await S.saveProfile(OB.firstName, OB.lastName);
        tgSafe.notify("success");
        OB.busy = false;
        go("/", true);
        render();
        return;
      }
      tgSafe.tap();
    } catch (err) {
      OB.error = err.message || "مشکلی پیش آمد. دوباره تلاش کنید.";
      tgSafe.notify("error");
    } finally {
      OB.busy = false;
      renderOnboarding();
    }
  }

  /*
     چسباندن کد از حافظهٔ دستگاه.

     مینی‌اپ اجازهٔ خواندن پیام‌های تلگرام را ندارد، پس پرکردن واقعاً
     خودکار ممکن نیست. ولی کد در تلگرام به شکلی فرستاده می‌شود که با
     یک لمس کپی شود؛ این دکمه همان را می‌چسباند تا کاربر تایپ نکند.
  */
  async function pasteCode() {
    try {
      const text = await navigator.clipboard.readText();
      const digits = String(text || "").replace(/\D/g, "").slice(0, 5);

      if (digits.length !== 5) {
        toast("کدی در حافظه پیدا نشد. در تلگرام روی کد بزنید تا کپی شود.", "err");
        return;
      }

      OB.code = digits;
      OB.error = "";
      renderOnboarding();
      tgSafe.tap();
    } catch (e) {
      // بعضی مرورگرها بدون اجازهٔ کاربر حافظه را نمی‌دهند
      toast("دسترسی به حافظه ممکن نشد. کد را دستی وارد کنید.", "err");
    }
  }

  async function obResend() {
    if (OB.busy) return;
    OB.busy = true;
    OB.error = "";
    renderOnboarding();
    try {
      const res = await S.registerPhone(OB.phone);
      OB.hint = res.demoCode ? `حالت نمایشی: کد ${res.demoCode} است.` : "کد دوباره فرستاده شد.";
      OB.sentAt = Date.now();
      OB.expiresIn = res.expiresInSeconds || 120;
      OB.resendIn = res.resendAfterSeconds || 120;
      OB.expired = false;
      OB.code = "";
      toast("کد دوباره فرستاده شد", "ok");
    } catch (err) {
      OB.error = err.message || "ارسال دوباره ممکن نشد.";
    } finally {
      OB.busy = false;
      renderOnboarding();
    }
  }

  /* =======================================================
     ۵) فرم ثبت کمپین (۵ مرحله)
     ======================================================= */

  const STEP_COUNT = 5;

  // گزینه‌های زمان شروع کمپین
  const START_WHEN = {
    asap: "در اسرع وقت",
    week: "هفتهٔ آینده",
    custom: "با کارشناس هماهنگ می‌کنم"
  };

  function freshData() {
    return {
      adTitle: "",
      target: { type: "", url: "", brand: "" },
      creative: { text: "", poster: "" },
      // کشور/زبان/موضوع را دیگر نمی‌پرسیم — تلگرام در هیچ‌کدام از تب‌هایش
      // کادری برایشان ندارد. سفارش‌های قدیمی هنوز این داده را دارند.
      targeting: { channelsRaw: "", keywordsRaw: "" },
      budget: { startWhen: "asap", packageId: "", startDate: "" },
      notes: "",
      accepted: false
    };
  }

  /** بسته‌های نوع تبلیغی که مشتری انتخاب کرده (ممکن است خالی باشد) */
  function packagesNow() {
    return S.packagesFor(W.data.target.type);
  }

  /** بستهٔ انتخاب‌شده در فرم */
  function chosenPackage() {
    return W.data.budget.packageId ? S.findPackage(W.data.budget.packageId) : null;
  }

  /* «۵ میلیون تومان» به‌جای «۵٬۰۰۰٬۰۰۰ تومان» — خواندنش برای مشتری
     راحت‌تر است و عدد بزرگ با صفرهای زیاد ترسناک به نظر می‌رسد.
     عددهای غیررُند هم درست درمی‌آیند: ۷٬۵۰۰٬۰۰۰ → «۷٫۵ میلیون». */
  function tomanPrice(n) {
    const v = Number(n) || 0;
    if (v >= 1000000) return num(Math.round((v / 1000000) * 100) / 100) + " میلیون تومان";
    if (v >= 1000) return num(Math.round((v / 1000) * 10) / 10) + " هزار تومان";
    return num(v) + " تومان";
  }

  /** مثل tomanPrice ولی بدون کلمهٔ «تومان» — برای کادرهای تنگ آمار */
  function tomanShort(n) {
    const v = Number(n) || 0;
    if (v >= 1000000) return num(Math.round((v / 1000000) * 10) / 10) + "م";
    if (v >= 1000) return num(Math.round(v / 1000)) + "ه";
    return num(v);
  }

  /** «۲۰ هزار» / «۱۰۰ هزار» — کوتاه‌تر از نوشتن کل عدد */
  function viewsShort(n) {
    const v = Number(n) || 0;
    return v >= 1000 ? num(v / 1000) + " هزار" : num(v);
  }

  /* =======================================================
     تقویم شمسی
     ---------------------------------------------------------
     بدون هیچ کتابخانه‌ای. تبدیل تاریخ را خودمان حساب نمی‌کنیم —
     همان موتور تقویم مرورگر (Intl) را با تقویم فارسی صدا می‌زنیم و
     می‌پرسیم «این تاریخ میلادی، شمسی‌اش چه می‌شود؟». پس ریاضیِ
     کبیسه و طول ماه‌ها هیچ‌وقت اشتباه نمی‌شود.

     تاریخ همیشه میلادی (YYYY-MM-DD) ذخیره و به سرور فرستاده می‌شود؛
     شمسی فقط چیزی است که مشتری می‌بیند.
     ======================================================= */

  const J_MONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
                    "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
  // هفتهٔ ایرانی از شنبه شروع می‌شود
  const J_WEEK = ["ش", "ی", "د", "س", "چ", "پ", "ج"];

  // ارقام لاتین می‌گیریم تا خواندنشان ساده باشد؛ نمایش را خودمان فارسی می‌کنیم
  const jFmt = new Intl.DateTimeFormat("en-US-u-ca-persian-nu-latn", {
    year: "numeric", month: "numeric", day: "numeric"
  });

  /** تاریخ میلادی → {y, m, d} شمسی */
  function toJalali(date) {
    const p = {};
    for (const part of jFmt.formatToParts(date)) p[part.type] = part.value;
    return { y: Number(p.year), m: Number(p.month), d: Number(p.day) };
  }

  /** «۲۰۲۶-۰۸-۱۷» از روی یک Date، با ساعت محلی (نه UTC، وگرنه یک روز جابه‌جا می‌شود) */
  function toYmd(date) {
    const p = (n) => String(n).padStart(2, "0");
    return date.getFullYear() + "-" + p(date.getMonth() + 1) + "-" + p(date.getDate());
  }

  function fromYmd(ymd) {
    const [y, m, d] = String(ymd || "").split("-").map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  }

  /** «۲۶ مرداد ۱۴۰۵» */
  function jalaliLabel(ymd) {
    const date = fromYmd(ymd);
    if (!date) return "";
    const j = toJalali(date);
    return num(j.d) + " " + J_MONTHS[j.m - 1] + " " + num(j.y).replace(/٬/g, "");
  }

  /**
   * زودترین روزی که کمپین می‌تواند شروع شود.
   * قرار ما: دست‌کم ۲۴ ساعت بعد — یعنی روزِ «الان + ۲۴ ساعت».
   */
  function earliestStart() {
    const d = new Date(Date.now() + 24 * 3600 * 1000);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /** روزهای یک ماه شمسی، از روی هر تاریخی که داخل آن ماه باشد */
  function jalaliMonthDays(anchor) {
    const first = new Date(anchor);
    first.setHours(12, 0, 0, 0);            // ظهر، تا تغییر ساعت تابستانی روز را نلغزاند
    while (toJalali(first).d !== 1) first.setDate(first.getDate() - 1);

    const month = toJalali(first).m;
    const days = [];
    const cur = new Date(first);
    while (toJalali(cur).m === month) {
      days.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return days;
  }

  /* ماهی که تقویم الان نشان می‌دهد — با دکمه‌های قبل/بعد جابه‌جا می‌شود */
  let calAnchor = null;

  function calendarHtml() {
    const min = earliestStart();
    if (!calAnchor) calAnchor = fromYmd(W.data.budget.startDate) || new Date(min);

    const days = jalaliMonthDays(calAnchor);
    const head = toJalali(days[0]);
    const chosen = W.data.budget.startDate;

    // ستون اول شنبه است: شنبه ۶ → ۰، یکشنبه ۰ → ۱ …
    const pad = (days[0].getDay() + 1) % 7;

    // اگر کل ماه قبلی گذشته است، دکمهٔ «ماه قبل» بی‌معنی است
    const prevEnd = new Date(days[0]);
    prevEnd.setDate(prevEnd.getDate() - 1);
    const canPrev = prevEnd >= min;

    return `
      <div class="cal">
        <div class="cal__bar">
          <!-- در راست‌به‌چپ، «ماه قبل» سمت راست است و فلشش به راست -->
          <button class="cal__nav" data-cal="prev" ${canPrev ? "" : "disabled"} aria-label="ماه قبل">${ICON("back", 16)}</button>
          <div class="cal__title">${esc(J_MONTHS[head.m - 1])} ${esc(num(head.y).replace(/٬/g, ""))}</div>
          <button class="cal__nav" data-cal="next" aria-label="ماه بعد">${ICON("next", 16)}</button>
        </div>

        <div class="cal__grid cal__grid--head">
          ${J_WEEK.map((d) => `<span class="cal__wd">${d}</span>`).join("")}
        </div>

        <div class="cal__grid">
          ${Array.from({ length: pad }, () => `<span></span>`).join("")}
          ${days.map((date) => {
            const ymd = toYmd(date);
            const off = date < min;
            const on = ymd === chosen;
            return `<button class="cal__day ${on ? "is-on" : ""}" data-day="${ymd}" ${off ? "disabled" : ""}>
                      ${num(toJalali(date).d)}
                    </button>`;
          }).join("")}
        </div>

        <div class="cal__note">
          ${ICON("clock", 14)}
          <span>زودترین زمان ممکن: ${esc(jalaliLabel(toYmd(min)))}</span>
        </div>
      </div>`;
  }

  /** فقط تقویم را دوباره می‌کشد، نه کل صفحه */
  function paintCalendar() {
    const box = $("#calbox");
    if (box) box.innerHTML = calendarHtml();
  }

  function startDateField() {
    const chosen = W.data.budget.startDate;
    return `
      <div class="field">
        <div class="label">
          <span>زمان شروع کمپین <span class="req">*</span></span>
          ${chosen ? `<span class="label__hint">${esc(jalaliLabel(chosen))}</span>` : ""}
        </div>
        <div id="calbox">${calendarHtml()}</div>
        ${errOf("startDate")}
        <div class="help">
          کمپین زودتر از ۲۴ ساعت آینده شروع نمی‌شود، چون تبلیغ باید اول
          بررسی و در تلگرام تأیید شود.
        </div>
      </div>`;
  }

  const W = {
    step: 1, data: freshData(), errors: {},
    chat: { title: "", photo: "" },
    // وضعیت شناسایی کانال کنار فیلد آدرس: idle | loading | found | notfound
    chatState: "idle",
    // کد سفارشی که همین حالا ثبت شد (برای مرحلهٔ پرداخت)
    createdId: "",
    // همان شناسایی، این‌بار برای تک‌تک کانال‌های هدف:
    // { "@name": { state, title, photo } }
    chanInfo: {}
  };

  /**
   * باز کردن فرم ثبت کمپین.
   * @param {{resume?: boolean}} opts
   *   resume=true فقط از دکمهٔ «ادامهٔ فرم» روی کارت پیش‌نویس می‌آید.
   *   بقیهٔ دکمه‌ها («ثبت کمپین جدید» و دکمهٔ + ) همیشه فرم خالی باز
   *   می‌کنند — چون کاربر روی دکمه‌ای زده که رویش نوشته «جدید».
   */
  function startWizard(opts = {}) {
    const draft = S.loadDraft();
    resetWizard();

    if (opts.resume && draft && draftFilled(draft.data)) {
      W.data = draft.data;
      // از همان مرحله‌ای ادامه می‌دهد که رهایش کرده بود، نه از اول
      W.step = Math.min(Math.max(1, draft.step), STEP_COUNT);
      setTimeout(() => toast("پیش‌نویس قبلی شما بازیابی شد"), 400);
      // نام و عکس مقصد دوباره از تلگرام پرسیده می‌شود تا پیش‌نمایش کامل باشد
      if (W.data.target.url) scheduleChatLookup();
    } else {
      W.data = freshData();
    }
    go("/new");
  }

  /** فرم را به حالت خالی برمی‌گرداند — بدون دست زدن به W.data */
  function resetWizard() {
    W.step = 1;
    W.errors = {};
    W.chat = { title: "", photo: "" };
    W.chatState = "idle";
    W.chanInfo = {};
    calAnchor = null;      // تقویم دوباره روی زودترین روز ممکن باز شود
    W.createdId = "";
  }

  /* پیش‌نویس با هر حرفی که تایپ می‌شود ذخیره می‌شود. حالا که ممکن است
     یک پوستر چند صد کیلوبایتی هم داخلش باشد، نوشتن را کمی عقب می‌اندازیم
     تا تایپ کردن کند نشود. */
  let draftTimer = null;
  function saveDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => S.saveDraft(W.data, { step: W.step }), 350);
  }

  /** ذخیرهٔ فوری — وقتی نمی‌شود منتظر ماند (مثلاً پیش از رفتن به صفحهٔ دیگر) */
  function saveDraftNow() {
    clearTimeout(draftTimer);
    S.saveDraft(W.data, { step: W.step });
  }

  /** آیا این پیش‌نویس آن‌قدری پر شده که یادآوری‌اش ارزش داشته باشد؟ */
  function draftFilled(d) {
    if (!d || !d.target) return false;
    const t = d.targeting || {};
    return Boolean(
      d.target.type ||
      String(d.adTitle || "").trim() ||
      String(d.target.url || "").trim() ||
      String(d.target.brand || "").trim() ||
      String(d.creative?.text || "").trim() ||
      String(t.keywordsRaw || "").trim() ||
      String(t.channelsRaw || "").trim() ||
      String(d.notes || "").trim()
    );
  }

  /* =======================================================
     تکرار یک کمپین قبلی
     ---------------------------------------------------------
     سفارش ثبت‌شده را به دادهٔ فرم برمی‌گرداند تا مشتری همان کمپین
     را با یکی دو تغییر دوباره بدهد. عمداً دو چیز کپی نمی‌شود:
       • پذیرش قوانین — باید دوباره و آگاهانه تیک بخورد
       • وضعیت و آمار — سفارش تازه از صفر شروع می‌کند
     ======================================================= */
  function dataFromCampaign(c) {
    const d = freshData();
    const t = c.targeting || {};

    d.adTitle = c.adTitle || "";
    d.target = {
      type: c.target?.type || "",
      url: c.target?.url || "",
      brand: c.target?.brand || ""
    };
    d.creative = {
      text: c.creative?.text || "",
      // پوستر سفارش قبلی پیش تلگرام است، نه در مرورگر؛ دوباره باید انتخاب شود
      poster: ""
    };
    // در سفارش ثبت‌شده این‌ها فهرست‌اند، ولی فرم متن چندخطی می‌خواهد
    d.targeting = {
      channelsRaw: (t.channels || []).join("\n"),
      keywordsRaw: (t.keywords || []).join("\n")
    };
    d.budget = {
      startWhen: c.budget?.startWhen || "asap",
      // تاریخ سفارش قبلی گذشته است؛ باید دوباره انتخاب شود
      startDate: "",
      // بسته را هم می‌آوریم، ولی فقط اگر هنوز در فهرست امروز باشد —
      // قیمت‌ها عوض می‌شوند و بستهٔ حذف‌شده نباید دوباره فروخته شود
      packageId: S.findPackage(c.budget?.packageId) ? c.budget.packageId : ""
    };
    d.notes = c.notes || "";
    d.accepted = false;
    return d;
  }

  function repeatCampaign(id) {
    const c = S.get(id);
    if (!c) { toast("این کمپین پیدا نشد", "err"); return; }

    resetWizard();
    W.data = dataFromCampaign(c);
    saveDraftNow();
    go("/new");
    if (W.data.target.url) scheduleChatLookup();
    tgSafe.tap();
    setTimeout(() => toast("فرم با اطلاعات «" + (c.adTitle || c.id) + "» پر شد"), 400);
  }

  function codeToCountry(code) { return CFG.countries.find((c) => c.code === code); }
  function idToTopic(id) { return CFG.topics.find((t) => t.id === id); }

  /**
   * نوع‌هایی که واقعاً می‌شود سفارش داد — یعنی بستهٔ فعال دارند.
   * فهرست بسته‌ها روی سرور تعیین می‌کند چه می‌فروشیم؛ اگر نوعی بسته
   * نداشته باشد، اصلاً به مشتری نشان داده نمی‌شود تا وقتش را برای
   * پر کردن فرمی که آخرش رد می‌شود تلف نکند.
   */
  function sellableTypes() {
    const all = Object.entries(S.TARGET_TYPES);
    const open = all.filter(([k]) => S.packagesFor(k).length);
    // اگر هیچ بسته‌ای تنظیم نشده باشد، دست‌کم چیزی نشان بده
    return open.length ? open : all;
  }

  /** قواعد نوع تبلیغِ انتخاب‌شده: متن دارد؟ کلیدواژه می‌خواهد؟ */
  function rules() {
    return S.TARGET_TYPES[W.data.target.type] || { needsText: true, needsKeywords: false };
  }

  function viewWizard() {
    const r = rules();
    const titles = [
      { t: "نوع تبلیغ", d: "می‌خواهید چه چیزی را تبلیغ کنید؟" },
      r.needsKeywords
        ? { t: "کلیدواژه‌ها", d: "مردم با جستجوی چه چیزی تبلیغ شما را ببینند؟" }
        : { t: "متن تبلیغ", d: "پیامی که مخاطب می‌بیند" },
      { t: "انتخاب بسته", d: "کدام بسته برای کسب‌وکار شما مناسب است؟" },
      { t: "بازبینی نهایی", d: "یک‌بار همه‌چیز را چک کنید" },
      { t: "پرداخت", d: "سفارش ثبت شد؛ حالا مبلغ را واریز کنید" }
    ];
    const cur = titles[W.step - 1];
    const bodies = [stepTarget, stepCreative, stepBudget, stepReview, stepPay];

    return {
      bar: bar("ثبت کمپین جدید", "مرحله " + num(W.step) + " از " + num(STEP_COUNT), { support: true }),
      sticky: `
        <div class="stickybar">
          ${W.step > 1 && W.step < STEP_COUNT
            ? `<button class="btn btn--outline btn--back" data-act="prev" aria-label="مرحله قبل">${ICON("back")}</button>`
            : ""}
          <button class="btn btn--primary" data-act="next">
            ${W.step === STEP_COUNT ? "پایان" : W.step === STEP_COUNT - 1 ? "ثبت سفارش و پرداخت" : "مرحله بعد"}
          </button>
        </div>`,
      body: `
        <div class="steps">
          <div class="steps__bar"><div class="steps__fill" style="width:${(W.step / STEP_COUNT) * 100}%"></div></div>
          <div class="steps__txt">${num(W.step)}/${num(STEP_COUNT)}</div>
        </div>
        <div class="step-head">
          <div class="step-head__t">${cur.t}</div>
          <div class="step-head__d">${cur.d}</div>
        </div>
        ${bodies[W.step - 1]()}`,
      after: bindWizard
    };
  }

  function errOf(name) {
    return W.errors[name] ? `<div class="err">${esc(W.errors[name])}</div>` : "";
  }

  /** متن‌های فیلد آدرس، بسته به نوع تبلیغ */
  const TARGET_FIELD = {
    bot: {
      label: "آدرس ربات",
      placeholder: "@my_bot",
      help: "آیدی رباتی که می‌خواهید مخاطب واردش شود."
    },
    search: {
      label: "مقصد تبلیغ",
      placeholder: "@my_channel",
      help: "تبلیغ در نتایج جستجوی تلگرام دیده می‌شود و مخاطب با کلیک به این مقصد می‌رسد."
    },
    channel: {
      label: "آدرس کانال",
      placeholder: "@my_channel",
      help: "آیدی کانالی که می‌خواهید مخاطب واردش شود."
    }
  };

  function stepTarget() {
    const d = W.data.target;
    const f = TARGET_FIELD[d.type];

    return `
      <div class="field">
        <div class="label">نوع تبلیغ <span class="req">*</span></div>
        <div class="picks">
          ${sellableTypes().map(([k, v]) => `
            <button class="pick ${d.type === k ? "is-on" : ""}" data-pick="type" data-val="${k}">
              <span class="pick__ico">${ICON(v.icon, 19)}</span>
              <span>
                <span class="pick__t">${esc(v.label)}</span>
                <span class="pick__d">${esc(v.desc)}</span>
              </span>
              <span class="pick__tick">✓</span>
            </button>`).join("")}
        </div>
        ${errOf("type")}
      </div>

      ${f ? `
        <div class="field reveal">
          <div class="label">عنوان تبلیغ <span class="req">*</span></div>
          <!-- عنوان کنار target نیست، خودش بالای data نشسته -->
          <input class="input ${W.errors.adTitle ? "is-error" : ""}" id="f-adtitle"
                 maxlength="40" placeholder="مثلاً: کمپین پاییز — کانال آموزش"
                 value="${esc(W.data.adTitle || "")}" />
          ${errOf("adTitle")}
          <div class="help">اسمی برای شناختن این کمپین. در تلگرام هم با همین نام ثبت می‌شود.</div>
        </div>

        <div class="field reveal">
          <div class="label">${esc(f.label)} <span class="req">*</span></div>
          <input class="input ${W.errors.url ? "is-error" : ""}" id="f-url" dir="ltr" inputmode="url"
                 placeholder="${esc(f.placeholder)}" value="${esc(d.url)}" />
          ${errOf("url")}
          <div class="chatchip" id="chatchip">${chatChipHtml()}</div>
          <div class="help">${esc(f.help)}</div>
        </div>

        <div class="field reveal">
          <div class="label">نام برند یا کسب‌وکار <span class="req">*</span></div>
          <input class="input ${W.errors.brand ? "is-error" : ""}" id="f-brand"
                 placeholder="مثلاً: لیکا شاپ" value="${esc(d.brand)}" />
          ${errOf("brand")}
        </div>` : `
        <p class="ob__note">برای ادامه، یکی از سه گزینهٔ بالا را انتخاب کنید.</p>`}`;
  }

  /* --- مرحله ۲: متن تبلیغ، یا برای تبلیغ جستجو: کلیدواژه‌ها ---
     در Telegram Ads تب Search اصلاً کادر «متن تبلیغ» ندارد؛
     آنچه دارد «Target search queries» است. پس همان را می‌پرسیم. */
  function stepCreative() {
    if (rules().needsKeywords) return stepKeywords();

    const c = W.data.creative;
    const len = c.text.length;
    const max = CFG.adTextMaxLength;
    return `
      <div class="field">
        <div class="label">
          <span>متن تبلیغ <span class="req">*</span></span>
          <span class="counter ${len > max ? "is-over" : len > max - 30 ? "is-near" : ""}" id="f-count">${num(len)}/${num(max)}</span>
        </div>
        <textarea class="textarea ${W.errors.text ? "is-error" : ""}" id="f-text" maxlength="${max + 40}"
          placeholder="پیشنهاد خود را در یک جملهٔ کوتاه و جذاب بنویسید…">${esc(c.text)}</textarea>
        ${errOf("text")}
        <div class="help">سقف مجاز تلگرام ${num(max)} کاراکتر است. متن کوتاه‌تر معمولاً کلیک بیشتری می‌گیرد.</div>
      </div>

      <div class="field">
        <div class="label"><span>توضیح برای کارشناس</span><span class="label__hint">اختیاری</span></div>
        <textarea class="textarea" id="f-notes" style="min-height:84px"
          placeholder="اگر نکته‌ای دربارهٔ کسب‌وکار یا مخاطب هدفتان هست، اینجا بنویسید.">${esc(W.data.notes)}</textarea>
      </div>

      ${posterField()}

      <div class="mt-16">${adPreview(previewOf(W.data.target, c.text))}</div>

      <div class="field">
        <div class="label">
          <span>کانال‌های هدف</span>
          <span class="label__hint" id="cnt-channels">${
            parseChannels(W.data.targeting.channelsRaw).length
              ? num(parseChannels(W.data.targeting.channelsRaw).length) + " کانال"
              : "اختیاری"}</span>
        </div>
        <textarea class="textarea ${W.errors.channels ? "is-error" : ""}" id="f-channels" dir="ltr" style="min-height:84px"
          placeholder="@channel_one&#10;@channel_two">${esc(W.data.targeting.channelsRaw)}</textarea>
        ${errOf("channels")}
        <div class="chanlist" id="chanlist">${chanListHtml()}</div>
        <div class="help">
          اگر کانال مشخصی مدنظرتان است، هر آیدی را در یک خط بنویسید — حداقل ${num(CFG.minChannels)} کانال.
          اگر نمی‌شناسید، خالی بگذارید تا کارشناس ما انتخاب کند، یا از دکمهٔ «پشتیبانی» کمک بگیرید.
        </div>
      </div>
`;
  }

  /* نشان دادن اینکه متن نوشته‌شده به چند کلیدواژه تبدیل شده —
     تا مشتری ببیند «خرید لپ تاپ» یک کلیدواژه ماند، نه سه تا */
  function keywordChips(list) {
    return list.map((k) => `<span class="chip is-on is-static">${esc(k)}</span>`).join("");
  }

  /* --- مرحله ۲ (نوع جستجو): کلیدواژه‌ها --- */
  function stepKeywords() {
    const t = W.data.targeting;
    const list = parseKeywords(t.keywordsRaw);

    return `
      <div class="field">
        <div class="label">
          <span>کلیدواژه‌ها <span class="req">*</span></span>
          <span class="label__hint" id="cnt-keywords">${num(list.length)} از ${num(CFG.maxKeywords)}</span>
        </div>
        <textarea class="textarea ${W.errors.keywords ? "is-error" : ""}" id="f-keywords" style="min-height:110px"
          placeholder="خرید لپ تاپ&#10;لپ تاپ گیمینگ&#10;نوت بوک ارزان">${esc(t.keywordsRaw)}</textarea>
        ${errOf("keywords")}
        <div class="help">
          هر کلیدواژه را در یک خط بنویسید. وقتی کسی در تلگرام یکی از این‌ها را
          جستجو کند، تبلیغ شما بالای نتایج دیده می‌شود.
          حداکثر ${num(CFG.maxKeywords)} کلیدواژه مجاز است.
        </div>
        <div class="chips mt-12" id="kw-chips">${keywordChips(list)}</div>
      </div>

      <div class="notice notice--soft">
        ${ICON("alert", 16)}
        <span>تبلیغ جستجو متن ندارد — مخاطب فقط عنوان و نام مقصد شما را می‌بیند.
        پس عنوانی که در مرحلهٔ قبل نوشتید، تنها چیزی است که او می‌خواند.</span>
      </div>

      <div class="field mt-16">
        <div class="label"><span>توضیح برای کارشناس</span><span class="label__hint">اختیاری</span></div>
        <textarea class="textarea" id="f-notes" style="min-height:84px"
          placeholder="اگر نکته‌ای دربارهٔ کسب‌وکار یا مخاطب هدفتان هست، اینجا بنویسید.">${esc(W.data.notes)}</textarea>
      </div>`;
  }

  /* --- مرحله ۳: بسته یا بودجه ----------
     نوع‌هایی که بستهٔ آماده دارند (فعلاً کانال) به‌جای اسلایدر CPM و
     کادر بودجه، چهار بستهٔ روشن با قیمت تومانی می‌بینند. */
  function stepBudget() {
    const list = packagesNow();
    if (list.length) return stepPackages(list);

    /* نوعی که هنوز بستهٔ تعریف‌شده ندارد. قبلاً اینجا بودجهٔ دلاری
       گرفته می‌شد، ولی ما دلاری نمی‌فروشیم — پس به‌جای گرفتن سفارشی
       که نمی‌شود قیمتش را حساب کرد، مشتری را به کارشناس می‌فرستیم. */
    return `
      <div class="card center">
        <div class="empty__ico">${ICON("chat", 28)}</div>
        <div class="empty__t">برای این نوع تبلیغ، قیمت را کارشناس می‌دهد</div>
        <div class="empty__d">
          بستهٔ آماده فقط برای تبلیغ کانال است. برای تبلیغ ربات و جستجو،
          کارشناس ما بر اساس کسب‌وکار شما قیمت می‌دهد.
        </div>
        <button class="btn btn--primary btn--block mt-16" data-act="support">
          ${ICON("chat", 17)} گفت‌وگو با کارشناس
        </button>
      </div>`;
  }

  function stepPackages(list) {
    const chosen = W.data.budget.packageId;

    return `
      <div class="field">
        <div class="label">بستهٔ تبلیغاتی <span class="req">*</span></div>
        <div class="packs">
          ${list.map((p) => `
            <button class="pack ${chosen === p.id ? "is-on" : ""}" data-pack="${esc(p.id)}">
              ${p.off ? `<span class="pack__off">${num(p.off)}٪ تخفیف</span>` : ""}
              <div class="pack__views">
                <span class="pack__n">${esc(viewsShort(p.views))}</span>
                <span class="pack__u">بازدید</span>
              </div>
              ${p.wasToman ? `<div class="pack__was">${esc(tomanPrice(p.wasToman))}</div>` : ""}
              <div class="pack__price">${esc(tomanPrice(p.priceToman))}</div>
              <span class="pack__tick">✓</span>
            </button>`).join("")}
        </div>
        ${errOf("package")}
      </div>

      <div class="notice notice--soft mt-16">
        ${ICON("alert", 16)}
        <span>تعداد بازدید تخمینی است و به رقابت تبلیغاتی در تلگرام بستگی دارد.
        زمان اجرا پس از تأیید و پرداخت با شما هماهنگ می‌شود.</span>
      </div>

      ${startDateField()}`;
  }

  /* --- مرحله ۵: بازبینی --- */
  function stepReview() {
    const d = W.data;
    const keywords = parseKeywords(d.targeting.keywordsRaw);
    const forSearch = rules().needsKeywords;
    const pkg = chosenPackage();

    return `
      ${forSearch ? "" : adPreview(previewOf(d.target, d.creative.text))}

      <div class="section">
        <div class="section__head"><h2 class="section__title">خلاصه سفارش</h2></div>
        <div class="card">
          ${d.adTitle ? kv("عنوان تبلیغ", d.adTitle) : ""}
          ${kv("نوع مقصد", S.TARGET_TYPES[d.target.type].label)}
          ${kv("آدرس مقصد", d.target.url, true)}
          ${kv("برند", d.target.brand)}
          ${forSearch ? kv("کلیدواژه‌ها", keywords.join("، ")) : ""}
          ${!forSearch && parseChannels(d.targeting.channelsRaw).length
            ? kv("کانال‌های هدف", parseChannels(d.targeting.channelsRaw).join("، "), true)
            : ""}
          ${forSearch ? "" : kv("پوستر تبلیغ", d.creative.poster ? "دارد" : "ندارد")}
          ${pkg ? `
            ${kv("بسته", viewsShort(pkg.views) + " بازدید")}
            ${kv("مبلغ", tomanPrice(pkg.priceToman))}
          ` : ""}
          ${kv("زمان شروع", d.budget.startDate ? jalaliLabel(d.budget.startDate) : (START_WHEN[d.budget.startWhen] || START_WHEN.asap))}
        </div>
      </div>

      ${pkg ? `
      <div class="notice notice--soft mt-12">
        ${ICON("alert", 15)}<span>در مرحلهٔ بعد سفارش ثبت می‌شود، شمارهٔ کارت/شبا نشان داده می‌شود و
        با آپلود عکس رسید همان‌جا، سفارش نهایی می‌شود.</span>
      </div>` : ""}

      <div class="section">
        <div class="section__head"><h2 class="section__title">قوانین</h2></div>
        <div class="card">
          <div class="rules">
            ${CFG.adRules.slice(0, 4).map((r) => `<div class="rule"><span class="rule__x">✕</span><span>${esc(r)}</span></div>`).join("")}
          </div>
          <button class="section__link mt-8" data-act="go" data-route="/rules">مشاهده همه قوانین</button>
        </div>
        <button class="switch mt-12 ${d.accepted ? "is-on" : ""}" data-switch="accepted">
          <span class="switch__box">✓</span>
          <span>
            <span class="switch__t">قوانین تبلیغات تلگرام را می‌پذیرم</span>
            <span class="switch__d">تأیید می‌کنم اطلاعات وارد شده درست است</span>
          </span>
        </button>
        ${errOf("accepted")}
      </div>`;
  }

  /* ---------- کادر پرداخت ----------
     تا وقتی درگاه پرداخت نداریم، مشتری مبلغ را کارت‌به‌کارت می‌کند و
     رسیدش را برای پشتیبانی می‌فرستد. اگر شمارهٔ کارت تنظیم نشده باشد،
     به‌جای نشان دادن کادر خالی، مشتری را به پشتیبانی می‌فرستیم. */
  /**
   * کدام حساب باید نشان داده شود؟
   * بانک‌ها مبالغ بزرگ را کارت‌به‌کارت قبول نمی‌کنند، پس از یک مبلغ
   * به بالا شبا می‌دهیم. اگر شبا تنظیم نشده باشد، همان کارت می‌ماند —
   * بهتر از نشان دادن کادر خالی به مشتری.
   */
  function payAccount(priceToman) {
    const pay = S.payment();
    const card = String(pay.cardNumber || "").replace(/\s+/g, "");
    const sheba = String(pay.shebaNumber || "").replace(/\s+/g, "").toUpperCase();
    const threshold = Number(pay.shebaMinToman) || 10000000;

    if (sheba && Number(priceToman) >= threshold) {
      return {
        kind: "sheba",
        label: "شمارهٔ شبا",
        number: sheba.startsWith("IR") ? sheba : "IR" + sheba,
        pretty: (sheba.startsWith("IR") ? sheba : "IR" + sheba).replace(/(.{4})/g, "$1 ").trim(),
        holder: pay.shebaHolder || "",
        bank: pay.shebaBank || "",
        note: "این مبلغ با کارت‌به‌کارت منتقل نمی‌شود؛ از اینترنت‌بانک یا اپ بانکی پایا بزنید."
      };
    }

    if (!card) return null;

    return {
      kind: "card",
      label: "شمارهٔ کارت",
      number: card,
      pretty: card.replace(/(\d{4})(?=\d)/g, "$1 "),
      holder: pay.cardHolder || "",
      bank: pay.cardBank || "",
      note: ""
    };
  }

  /* ---------- کادر پرداخت ----------
     یک کارت بانکی، مبلغ، و راه فرستادن رسید. همه‌چیز قابل کپی است،
     چون مشتری باید این عددها را در اپ بانکش بزند و تایپ دستی
     شمارهٔ ۱۶ رقمی یعنی اشتباه. */
  function payBox(pkg, campaign) {
    const price = pkg ? pkg.priceToman : (campaign?.budget?.priceToman || 0);
    const account = payAccount(price);
    const receiptSent = Boolean(campaign?.receipt?.fileId);

    if (!account) {
      return `
        <div class="section">
          <div class="section__head"><h2 class="section__title">پرداخت</h2></div>
          <div class="card">
            <div class="pay__row">
              <span class="pay__lbl">مبلغ قابل پرداخت</span>
              <span class="pay__amount">${esc(tomanPrice(price))}</span>
            </div>
            <div class="help mt-12">برای هماهنگی پرداخت با پشتیبانی تماس بگیرید.</div>
            <button class="btn btn--outline btn--block mt-12" data-act="support">
              ${ICON("chat", 17)} ارتباط با پشتیبانی
            </button>
          </div>
        </div>`;
    }

    return `
      <div class="section">
        <div class="section__head"><h2 class="section__title">پرداخت</h2></div>

        <div class="bankcard">
          <div class="bankcard__top">
            <span class="bankcard__bank">${esc(account.bank || "انتقال بانکی")}</span>
            <span class="bankcard__chip"></span>
          </div>

          <button class="bankcard__num" data-act="copy-pay" data-val="${esc(account.number)}">
            <span class="bankcard__digits ${account.kind === "sheba" ? "bankcard__digits--long" : ""}"
                  dir="ltr">${esc(account.pretty)}</span>
            <span class="bankcard__copy">${ICON("copy", 15)}</span>
          </button>

          <div class="bankcard__foot">
            <div class="bankcard__cell">
              <div class="bankcard__cap">${esc(account.kind === "sheba" ? "صاحب حساب" : "دارندهٔ کارت")}</div>
              <div class="bankcard__val">${esc(account.holder || "—")}</div>
            </div>
            <button class="bankcard__cell bankcard__cell--btn" data-act="copy-pay" data-val="${esc(String(price))}">
              <div class="bankcard__cap">مبلغ ${ICON("copy", 12)}</div>
              <div class="bankcard__val nums">${esc(tomanPrice(price))}</div>
            </button>
          </div>
        </div>

        ${account.note ? `
        <div class="notice notice--soft mt-12">${ICON("alert", 15)}<span>${esc(account.note)}</span></div>` : ""}

        <div class="card mt-12">
          <div class="pay__steps">
            <div class="pay__step"><span class="pay__n">۱</span>مبلغ دقیق بالا را به این ${esc(account.kind === "sheba" ? "شبا" : "کارت")} واریز کنید.</div>
            <div class="pay__step"><span class="pay__n">۲</span>عکس رسید را همین‌جا آپلود کنید.</div>
            <div class="pay__step"><span class="pay__n">۳</span>بعد از تأیید رسید، کمپین شما شروع می‌شود.</div>
          </div>

          <div id="receiptbox" class="mt-12">${receiptBoxHtml(receiptSent, campaign)}</div>
          <input type="file" id="f-receipt" accept="image/jpeg,image/png" hidden />
        </div>
      </div>`;
  }

  function receiptBoxHtml(sent, campaign) {
    if (sent) {
      return `
        <div class="receipt-done">
          ${ICON("check", 16)}
          <span>رسید شما دریافت شد${campaign?.receipt?.at ? " — " + esc(timeAgo(campaign.receipt.at)) : ""}.
          بعد از تأیید، کمپین شروع می‌شود.</span>
        </div>
        <button class="btn btn--ghost btn--sm btn--block mt-8" data-act="receipt-pick">
          فرستادن رسید دیگر
        </button>`;
    }

    if (RC.busy) {
      return `<div class="poster poster--empty"><span class="poster__t">در حال فرستادن رسید…</span></div>`;
    }

    return `
      <button class="poster poster--empty poster--slim" data-act="receipt-pick">
        <span class="poster__ico">${ICON("send", 18)}</span>
        <span class="poster__t">انتخاب تصویر رسید</span>
        <span class="poster__d">JPG یا PNG، حداکثر ۱ مگابایت</span>
      </button>
      ${RC.error ? `<div class="err">${esc(RC.error)}</div>` : ""}`;
  }

  /* وضعیت فرستادن رسید */
  const RC = { busy: false, error: "" };

  /**
   * رسید را کوچک می‌کند و برای تیم می‌فرستد.
   * برخلاف پوستر، نسبت تصویر اهمیتی ندارد — رسید هر شکلی می‌تواند باشد.
   */
  async function sendReceipt(file, code) {
    if (!file) return;
    RC.error = "";

    if (!/^image\/(jpeg|png)$/.test(file.type)) {
      RC.error = "فقط عکس JPG یا PNG.";
      render();
      return;
    }

    RC.busy = true;
    render();

    try {
      const dataUrl = await shrinkImage(file, 1400, 1400);
      const updated = await S.sendReceipt(code, dataUrl);
      RC.busy = false;
      tgSafe.notify("success");
      toast("رسید فرستاده شد ✓", "ok");
      render();
      return updated;
    } catch (err) {
      RC.busy = false;
      RC.error = err.message || "فرستادن رسید ممکن نشد.";
      tgSafe.notify("error");
      render();
    }
  }

  /** عکس را در همان مرورگر کوچک می‌کند تا سبک برسد */
  function shrinkImage(file, maxW, maxH) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();

      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, maxW / img.width, maxH / img.height);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        try { resolve(canvas.toDataURL("image/jpeg", 0.8)); }
        catch (e) { reject(new Error("این عکس خوانده نشد.")); }
      };

      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("این فایل عکس نیست.")); };
      img.src = url;
    });
  }

  /* --- مرحله ۵: پرداخت ----------
     سفارش همین‌جا ثبت شده و منتظر تأیید کسی نمی‌ماند؛ مشتری بلافاصله
     مبلغ را می‌بیند و می‌پردازد. */
  function stepPay() {
    const c = W.createdId ? S.get(W.createdId) : null;

    if (!c) {
      return `
        <div class="card center">
          <div class="empty__t">سفارش پیدا نشد</div>
          <div class="empty__d">از بخش «کمپین‌ها» سفارشتان را باز کنید.</div>
          <button class="btn btn--primary btn--block mt-16" data-act="go" data-route="/campaigns">
            کمپین‌های من
          </button>
        </div>`;
    }

    return `
      <div class="done-hero">
        <div class="done-hero__ico">✓</div>
        <div class="done-hero__t">سفارش شما ثبت شد</div>
        <p class="done-hero__d">${S.isOnline()
          ? "کد سفارش را نگه دارید. حالا مبلغ را واریز کنید تا کمپین شروع شود."
          : "این سفارش فقط برای نمایش ثبت شد."}</p>
        <div class="done-hero__code">${esc(c.id)}</div>
      </div>

      ${S.isOnline() ? payBox(null, c) : `
      <div class="card card--pad-sm center tiny dim mt-12">
        ${ICON("alert", 15)} حالت نمایشی: این سفارش فقط روی گوشی شما ذخیره شد و برای تیم ما ارسال نشد.
      </div>`}`;
  }

  /* کلیدواژه‌ها فقط با خط جدید یا کاما جدا می‌شوند — نه با فاصله،
     چون یک کلیدواژه می‌تواند چند کلمه باشد («خرید لپ تاپ»). */
  function parseKeywords(raw) {
    return [...new Set(
      String(raw || "")
        .split(/[\n,،]+/)
        .map((x) => x.replace(/\s+/g, " ").trim())
        .filter(Boolean)
    )];
  }

  /**
   * کادر کانال‌های هدف: هر جداکننده‌ای (فاصله، کاما) را به خط تازه
   * تبدیل می‌کند، تا هر کانال روی خط خودش بنشیند.
   *
   * چرا؟ آدرس کانال هیچ‌وقت فاصله ندارد، پس فاصله فقط یک معنا دارد:
   * «این یکی تمام شد، بعدی». قبلاً کاربر باید خودش Enter می‌زد و
   * وقتی نمی‌زد، همه در یک خط شلوغ می‌شدند.
   *
   * جای مکان‌نما هم حساب می‌شود، وگرنه با هر تایپ می‌پرد آخر متن.
   */
  function channelsToLines(value, caret) {
    let out = "";
    let pos = caret;

    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      const isSeparator = ch === " " || ch === "\t" || ch === "," || ch === "،";

      if (!isSeparator) { out += ch; continue; }

      // سر خط یا اول متن؟ پس جداکننده اضافی است و حذف می‌شود
      if (out === "" || out.endsWith("\n")) {
        if (i < caret) pos--;
        continue;
      }
      out += "\n";
    }

    return { value: out, caret: Math.max(0, Math.min(pos, out.length)) };
  }

  function parseChannels(raw) {
    return String(raw || "")
      .split(/[\n,،\s]+/)
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => (x.startsWith("@") || x.startsWith("http") ? x : "@" + x));
  }

  /* --- اتصال رویدادهای فرم پس از رسم صفحه --- */
  function bindWizard() {
    const poster = $("#f-poster");
    if (poster) {
      poster.addEventListener("change", (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = "";          // تا انتخاب دوبارهٔ همان فایل هم کار کند
        onPosterChosen(file);
      });
    }

    // با برگشتن به این مرحله، کانال‌هایی که هنوز شناسایی نشده‌اند را می‌پرسیم
    if ($("#chanlist")) lookupChannels();

    const on = (id, ev, fn) => { const el = $("#" + id); if (el) el.addEventListener(ev, fn); };

    on("f-adtitle", "input", (e) => { W.data.adTitle = e.target.value; saveDraft(); });
    on("f-url", "input", (e) => {
      W.data.target.url = e.target.value.trim();
      saveDraft();
      scheduleChatLookup();
    });
    on("f-brand", "input", (e) => { W.data.target.brand = e.target.value; saveDraft(); });

    on("f-text", "input", (e) => {
      const max = CFG.adTextMaxLength;
      W.data.creative.text = e.target.value;
      const len = e.target.value.length;
      const c = $("#f-count");
      if (c) {
        c.textContent = num(len) + "/" + num(max);
        c.className = "counter" + (len > max ? " is-over" : len > max - 30 ? " is-near" : "");
      }
      const p = $("#prevText");
      if (p) {
        p.textContent = e.target.value || "متن تبلیغ شما اینجا نمایش داده می‌شود…";
        p.className = "tgad__text" + (e.target.value ? "" : " is-empty");
      }
      saveDraft();
    });

    on("f-notes", "input", (e) => { W.data.notes = e.target.value; saveDraft(); });
    on("f-channels", "input", (e) => {
      const tidy = channelsToLines(e.target.value, e.target.selectionStart);
      if (tidy.value !== e.target.value) {
        e.target.value = tidy.value;
        e.target.setSelectionRange(tidy.caret, tidy.caret);
      }

      W.data.targeting.channelsRaw = e.target.value;
      const n = parseChannels(e.target.value).length;
      const c = $("#cnt-channels");
      if (c) c.textContent = n ? num(n) + " کانال" : "اختیاری";
      if (n >= CFG.minChannels && W.errors.channels) {
        delete W.errors.channels;
        e.target.classList.remove("is-error");
        e.target.closest(".field")?.querySelector(".err")?.remove();
      }
      scheduleChannelLookup();
      saveDraft();
    });

    on("f-keywords", "input", (e) => {
      W.data.targeting.keywordsRaw = e.target.value;
      const words = parseKeywords(e.target.value);

      const c = $("#cnt-keywords");
      if (c) c.textContent = num(words.length) + " از " + num(CFG.maxKeywords);

      const box = $("#kw-chips");
      if (box) box.innerHTML = keywordChips(words);

      // خطای «کلیدواژه بنویسید» باید همان لحظه‌ای که کاربر درستش کرد برداشته شود،
      // نه اینکه تا رفتن به مرحلهٔ بعد قرمز بماند
      if (words.length && W.errors.keywords) {
        delete W.errors.keywords;
        e.target.classList.remove("is-error");
        e.target.closest(".field")?.querySelector(".err")?.remove();
      }
      saveDraft();
    });

  }

  /* --- بررسی صحت هر مرحله --- */
  function validateStep() {
    const d = W.data;
    const e = {};

    if (W.step === 1) {
      if (!d.target.type) {
        W.errors = { type: "یکی از سه گزینه را انتخاب کنید." };
        return false;
      }
      const url = d.target.url;
      const ok = /^@[A-Za-z0-9_]{4,}$/.test(url) || /^(https?:\/\/)?t\.me\/[A-Za-z0-9_+/]{3,}$/i.test(url);
      if (!url) e.url = "آدرس مقصد را وارد کنید.";
      else if (!ok) e.url = "آدرس معتبر نیست. مثال درست: @lika_shop یا https://t.me/lika_shop";
      else if (S.isOnline() && W.chatState === "loading") e.url = "چند لحظه صبر کنید تا آدرس بررسی شود.";
      else if (S.isOnline() && W.chatState === "notfound") e.url = "این آدرس در تلگرام پیدا نشد. لطفاً درستش کنید.";
      if (d.adTitle.trim().length < 2) e.adTitle = "یک عنوان برای این تبلیغ بنویسید.";
      if (d.target.brand.trim().length < 2) e.brand = "نام برند را وارد کنید.";
    }

    if (W.step === 2) {
      if (rules().needsKeywords) {
        const words = parseKeywords(d.targeting.keywordsRaw);
        if (words.length === 0) e.keywords = "حداقل یک کلیدواژه بنویسید.";
        else if (words.length > CFG.maxKeywords)
          e.keywords = "حداکثر " + num(CFG.maxKeywords) + " کلیدواژه مجاز است (الان " + num(words.length) + " تا نوشته‌اید).";
      } else {
        const len = d.creative.text.trim().length;
        if (len < CFG.adTextMinLength) e.text = "متن تبلیغ خیلی کوتاه است.";
        else if (len > CFG.adTextMaxLength) e.text = "متن از سقف مجاز تلگرام بیشتر است (" + num(CFG.adTextMaxLength) + " کاراکتر).";
      }
    }

    if (W.step === 2 && !rules().needsKeywords) {
      // تلگرام تبلیغ را روی کمتر از این تعداد کانال اجرا نمی‌کند.
      // فهرست خالی ایراد ندارد — یعنی کارشناس لیکا خودش انتخاب می‌کند.
      const chans = parseChannels(d.targeting.channelsRaw);
      if (chans.length > 0 && chans.length < CFG.minChannels) {
        e.channels = "تلگرام حداقل " + num(CFG.minChannels) + " کانال می‌خواهد (الان " +
                     num(chans.length) + " تا نوشته‌اید). یا بقیه را اضافه کنید، یا کادر را خالی بگذارید تا کارشناس ما بچیند.";
      } else if (chans.length > 0 && S.isOnline()) {
        // آدرس جعلی/غلط نباید رد شود — هر کانال باید واقعاً در تلگرام
        // پیدا شده باشد؛ فهرست بعد از ثبت قابل تغییر نیست. در حالت
        // نمایشی این بررسی ممکن نیست (به تلگرام وصل نیستیم)، پس رد می‌شویم.
        const stillChecking = chans.some((n) => !W.chanInfo[n] || W.chanInfo[n].state === "loading");
        const notFound = chans.filter((n) => W.chanInfo[n]?.state === "notfound");
        if (stillChecking) {
          e.channels = "چند لحظه صبر کنید تا آدرس کانال‌ها بررسی شود.";
        } else if (notFound.length) {
          e.channels = "این آدرس‌ها در تلگرام پیدا نشدند: " + notFound.join("، ") +
                       " — آدرس را درست کنید یا از فهرست حذفشان کنید.";
        }
      }
    }

    if (W.step === 3) {
      if (!d.budget.startDate) e.startDate = "تاریخ شروع کمپین را از تقویم انتخاب کنید.";
      else if (fromYmd(d.budget.startDate) < earliestStart())
        e.startDate = "کمپین زودتر از ۲۴ ساعت آینده شروع نمی‌شود.";

      if (!chosenPackage()) {
        e.package = packagesNow().length
          ? "یکی از بسته‌ها را انتخاب کنید."
          : "برای این نوع تبلیغ باید با کارشناس هماهنگ کنید.";
      }
    }

    if (W.step === STEP_COUNT - 1 && !d.accepted) {
      e.accepted = "برای ادامه باید قوانین را بپذیرید.";
    }

    W.errors = e;
    return Object.keys(e).length === 0;
  }

  function nextStep() {
    if (!validateStep()) {
      tgSafe.notify("error");
      toast(Object.values(W.errors)[0], "err");
      render();
      return;
    }
    tgSafe.tap();

    // نام و عکس واقعی مقصد را از تلگرام می‌گیریم
    if (W.step === 1) fetchChatInfo(W.data.target.url);

    // از بازبینی به پرداخت = ثبت سفارش
    if (W.step === STEP_COUNT - 1) { submitCampaign(); return; }

    // مرحلهٔ پرداخت، دکمهٔ «پایان» — تا رسید واریزی آپلود نشده، سفارش را
    // نمی‌توان نیمه‌کاره رها کرد (وگرنه هیچ مدرکی از پرداخت نمی‌ماند)
    if (W.step === STEP_COUNT) {
      const c = W.createdId ? S.get(W.createdId) : null;
      const account = c ? payAccount(c.budget?.priceToman || 0) : null;
      const receiptSent = Boolean(c?.receipt?.fileId);

      if (S.isOnline() && account && !receiptSent) {
        tgSafe.notify("error");
        toast("لطفاً قبل از پایان، تصویر رسید واریزی را آپلود کنید.", "err");
        return;
      }

      const id = W.createdId;
      resetWizard();
      W.data = freshData();
      W.createdId = "";
      go(id ? "/campaign/" + id : "/campaigns");
      return;
    }

    W.step++;
    saveDraftNow();
    render();
  }

  /* =======================================================
     شناسایی زندهٔ کانال کنار فیلد آدرس
     ---------------------------------------------------------
     وقتی مشتری آدرس را می‌نویسد، نام و عکس واقعی کانال را از
     تلگرام می‌گیریم و همان‌جا نشان می‌دهیم. دیدن عکس و نام درست،
     خودش تأییدی است که آدرس اشتباه وارد نشده.
     ======================================================= */

  /** آیا این رشته شکل یک آدرس تلگرامی کامل را دارد؟ */
  function looksLikeTgUrl(url) {
    return /^@[A-Za-z0-9_]{4,}$/.test(url) ||
           /^(https?:\/\/)?t\.me\/[A-Za-z0-9_+/]{3,}$/i.test(url);
  }

  function chatChipHtml() {
    if (W.chatState === "loading") {
      return `<span class="chatchip__dim">${ICON("search", 14)} در حال بررسی…</span>`;
    }
    if (W.chatState === "found") {
      // حرف اول همیشه زیر عکس هست؛ اگر عکس نیامد، همان دیده می‌شود
      const ava = `<span class="chatchip__ava">${esc((W.chat.title[0] || "?").toUpperCase())}${
        W.chat.photo ? `<img class="chatchip__ava-img" src="${esc(W.chat.photo)}" alt="" />` : ""
      }</span>`;
      return `${ava}<span class="chatchip__name">${esc(W.chat.title)}</span>
              <span class="chatchip__ok">${ICON("check", 14)} تأیید شد</span>`;
    }
    if (W.chatState === "notfound") {
      return `<span class="chatchip__miss">${ICON("alert", 14)} این آدرس در تلگرام پیدا نشد</span>`;
    }
    return "";
  }

  /** فقط کادر شناسایی را تازه می‌کند؛ render کامل تمرکز را از کادر تایپ می‌گیرد */
  function paintChatChip() {
    const el = $("#chatchip");
    if (!el) return;
    el.innerHTML = chatChipHtml();

    // اگر عکس کانال نیامد، حذفش می‌کنیم تا آیکون «تصویر خراب» دیده نشود
    const img = el.querySelector(".chatchip__ava-img");
    if (img) img.addEventListener("error", () => img.remove(), { once: true });
  }

  /* ---------- تأیید کانال‌های هدف ----------
     همان کاری که برای آدرس مقصد می‌کنیم: عکس و نام واقعی هر کانال را از
     تلگرام می‌گیریم و کنارش نشان می‌دهیم. دیدن عکس درست، تنها راهی است که
     مشتری مطمئن شود آیدی را اشتباه ننوشته — و چون فهرست کانال‌ها بعد از
     ثبت در تلگرام قابل تغییر نیست، اشتباه اینجا برگشت‌ناپذیر است. */
  function chanListHtml() {
    const list = parseChannels(W.data.targeting.channelsRaw);
    if (!list.length) return "";

    return list.map((name) => {
      const info = W.chanInfo[name] || { state: "loading" };

      if (info.state === "found") {
        const letter = esc((info.title[0] || "?").toUpperCase());
        return `<span class="chanpill is-ok" title="${esc(name)}">
            <span class="chatchip__ava">${letter}${
              info.photo ? `<img class="chatchip__ava-img" src="${esc(info.photo)}" alt="" />` : ""
            }</span>
            <span class="chanpill__name">${esc(info.title)}</span>
            <span class="chanpill__tick">${ICON("check", 12)}</span>
          </span>`;
      }
      if (info.state === "notfound") {
        return `<span class="chanpill is-miss">
            <span class="chanpill__name" dir="ltr">${esc(name)}</span>
            <span class="chanpill__tick">${ICON("alert", 12)}</span>
          </span>`;
      }
      return `<span class="chanpill is-wait"><span class="chanpill__name" dir="ltr">${esc(name)}</span></span>`;
    }).join("");
  }

  function paintChanList() {
    const el = $("#chanlist");
    if (!el) return;
    el.innerHTML = chanListHtml();
    el.querySelectorAll(".chatchip__ava-img").forEach((img) => {
      img.addEventListener("error", () => img.remove(), { once: true });
    });
  }

  /* کانال‌های تازه را از تلگرام می‌پرسد. چندتایی و پشت سر هم، نه همه با هم،
     تا با ۱۰ تا آدرس، ۱۰ درخواست هم‌زمان به سرور نرود. */
  let chanLookupToken = 0;
  async function lookupChannels() {
    const mine = ++chanLookupToken;
    const list = parseChannels(W.data.targeting.channelsRaw);

    // آدرس‌هایی که دیگر در متن نیستند را فراموش کن
    for (const key of Object.keys(W.chanInfo)) {
      if (!list.includes(key)) delete W.chanInfo[key];
    }

    const unknown = list.filter((n) => !W.chanInfo[n]);
    for (const name of unknown) W.chanInfo[name] = { state: "loading" };
    paintChanList();

    for (const name of unknown) {
      const info = await S.lookupChat(name);
      if (mine !== chanLookupToken) return;      // کاربر ادامه داده؛ این نتیجه کهنه است
      W.chanInfo[name] = info.found
        ? { state: "found", title: info.title, photo: info.photo }
        : { state: "notfound" };
      paintChanList();
    }
  }

  let chanLookupTimer = null;
  function scheduleChannelLookup() {
    clearTimeout(chanLookupTimer);
    chanLookupTimer = setTimeout(lookupChannels, 700);
  }

  let chatLookupTimer = null;

  function scheduleChatLookup() {
    clearTimeout(chatLookupTimer);
    const url = W.data.target.url;

    // در حالت نمایشی سروری نیست که بپرسیم
    if (!S.isOnline() || !looksLikeTgUrl(url)) {
      W.chatState = "idle";
      W.chat = { title: "", photo: "" };
      paintChatChip();
      return;
    }

    W.chatState = "loading";
    paintChatChip();

    chatLookupTimer = setTimeout(async () => {
      const asked = url;
      const info = await S.lookupChat(url).catch(() => ({ found: false }));

      // اگر کاربر در این فاصله آدرس را عوض کرده، جواب قدیمی را دور می‌ریزیم
      if (W.data.target.url !== asked) return;

      if (info.found) {
        W.chat = { title: info.title, photo: info.photo };
        W.chatState = "found";
      } else {
        W.chat = { title: "", photo: "" };
        W.chatState = "notfound";
      }
      paintChatChip();
    }, 650);
  }

  /** نام و عکس مقصد را از تلگرام می‌گیرد و پیش‌نمایش را تازه می‌کند */
  async function fetchChatInfo(url) {
    const info = await S.lookupChat(url);
    if (!info.found) return;

    W.chat = { title: info.title, photo: info.photo };
    if (currentRoute() === "/new" && (W.step === 2 || W.step === 4)) render();
  }

  let submitting = false;

  async function submitCampaign() {
    if (submitting) return;
    submitting = true;

    const btn = $('[data-act="next"]');
    if (btn) { btn.disabled = true; btn.textContent = "در حال ثبت…"; }

    const d = W.data;

    try {
      const campaign = await S.create({
        adTitle: d.adTitle.trim(),
        target: { type: d.target.type, url: d.target.url, brand: d.target.brand.trim() },
        // تبلیغ جستجو متن ندارد؛ اگر چیزی از پیش‌نویس مانده باشد فرستاده نمی‌شود
        creative: {
          text: rules().needsText ? d.creative.text.trim() : "",
          // تبلیغ جستجو اصلاً عکس ندارد
          poster: rules().needsText ? (d.creative.poster || "") : ""
        },
        targeting: {
          channels: parseChannels(d.targeting.channelsRaw),
          keywords: parseKeywords(d.targeting.keywordsRaw)
        },
        budget: {
          startWhen: d.budget.startWhen,
          startDate: d.budget.startDate || "",
          // فقط شناسهٔ بسته می‌رود؛ قیمت را سرور از فهرست خودش برمی‌دارد
          packageId: d.budget.packageId || ""
        },
        notes: d.notes.trim()
      });

      S.clearDraft();
      tgSafe.notify("success");
      tgSafe.closeGuard(false);

      /* فرم را همین‌جا نگه می‌داریم و می‌رویم مرحلهٔ پرداخت؛ مشتری
         برای دیدن مبلغ لازم نیست جایی برود یا منتظر تأیید بماند. */
      W.createdId = campaign.id;
      W.step = STEP_COUNT;
      render();
    } catch (err) {
      tgSafe.notify("error");
      toast(err.message || "ثبت سفارش انجام نشد. دوباره تلاش کنید.", "err");
      if (btn) { btn.disabled = false; btn.textContent = "ثبت نهایی سفارش"; }
    } finally {
      submitting = false;
    }
  }

  function summaryText(id) {
    const c = S.get(id);
    if (!c) return "";
    const t = c.targeting || {};
    /* کشور/زبان/موضوع فقط در سفارش‌های قدیمی وجود دارند */
    const countries = (t.countries || []).map(codeToCountry).filter(Boolean).map((x) => x.name).join("، ");
    const topics = (t.topics || []).map(idToTopic).filter(Boolean).map((x) => x.name).join("، ");
    return [
      "🎯 سفارش تبلیغ Telegram Ads",
      "کد سفارش: " + c.id,
      "برند: " + c.target.brand,
      "مقصد (" + S.TARGET_TYPES[c.target.type].label + "): " + c.target.url,
      c.creative.text ? "متن: " + c.creative.text : "",
      (t.keywords || []).length ? "کلیدواژه‌ها: " + t.keywords.join("، ") : "",
      countries ? "کشورها: " + countries : "",
      (t.languages || []).length ? "زبان‌ها: " + t.languages.join("، ") : "",
      topics ? "موضوعات: " + topics : "",
      (t.channels || []).length ? "کانال‌های هدف: " + t.channels.join("، ") : "",
      c.budget.priceToman ? "مبلغ: " + tomanPrice(c.budget.priceToman) : "",
      c.budget.packageViews ? "بسته: " + viewsShort(c.budget.packageViews) + " بازدید" : "",
      "زمان شروع: " + (START_WHEN[c.budget.startWhen] || START_WHEN.asap),
      c.notes ? "توضیحات: " + c.notes : ""
    ].filter(Boolean).join("\n");
  }

  /* =======================================================
     ۶) رویدادها
     ======================================================= */

  document.addEventListener("click", (ev) => {
    const pick = ev.target.closest("[data-pick]");
    if (pick) {
      const same = W.data.target.type === pick.dataset.val;
      W.data.target.type = pick.dataset.val;
      W.errors = {};
      tgSafe.tap();
      saveDraft();
      // با اولین انتخاب، فیلدهای بعدی ظاهر می‌شوند
      if (same) $$("[data-pick]").forEach((p) => p.classList.toggle("is-on", p === pick));
      else render();
      return;
    }

    const sw = ev.target.closest("[data-switch]");
    if (sw) {
      // کلید می‌تواند تودرتو باشد، مثل "budget.startWhen"
      const path = sw.dataset.switch.split(".");
      const last = path.pop();
      const box = path.reduce((o, k) => o[k], W.data);

      box[last] = !box[last];
      sw.classList.toggle("is-on", box[last]);
      if (box[last]) W.errors = {};
      tgSafe.tap();
      saveDraft();

      // نمایش عکس کانال هم پیش‌نمایش را عوض می‌کند هم نرخ را، پس باید دوباره رسم شود
      if (sw.dataset.rerender) render();
      return;
    }

    const radio = ev.target.closest("[data-radio]");
    if (radio) {
      W.data.budget[radio.dataset.radio] = radio.dataset.val;
      radio.parentElement.querySelectorAll("[data-radio]").forEach((r) => r.classList.toggle("is-on", r === radio));
      tgSafe.tap();
      saveDraft();
      return;
    }

    const cal = ev.target.closest("[data-cal]");
    if (cal) {
      const step = cal.dataset.cal === "next" ? 1 : -1;
      // وسط ماه می‌ایستیم تا با ماه‌های ۲۹ و ۳۱ روزه نپریم
      const mid = new Date(calAnchor);
      mid.setDate(15);
      mid.setMonth(mid.getMonth() + step);
      calAnchor = mid;
      tgSafe.tap();
      paintCalendar();
      return;
    }

    const day = ev.target.closest("[data-day]");
    if (day) {
      W.data.budget.startDate = day.dataset.day;
      W.data.budget.startWhen = "date";
      delete W.errors.startDate;
      calAnchor = fromYmd(day.dataset.day);
      tgSafe.tap();
      saveDraft();
      render();
      return;
    }

    const pack = ev.target.closest("[data-pack]");
    if (pack) {
      W.data.budget.packageId = pack.dataset.pack;
      delete W.errors.package;
      $$("[data-pack]").forEach((b) => b.classList.toggle("is-on", b === pack));
      tgSafe.tap();
      saveDraft();
      return;
    }

    const btn = ev.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;

    if (act === "go") {
      tgSafe.tap();
      // با رفتن به هر صفحه‌ای، پرسش «پاک شود؟» روی کارت پیش‌نویس بسته می‌شود
      draftAskDelete = false;
      if (btn.dataset.route === "/new") { startWizard({ resume: btn.dataset.resume === "1" }); return; }
      if (btn.dataset.route === "/profile") openProfile();
      go(btn.dataset.route);
      return;
    }
    if (act === "back") { tgSafe.tap(); goBack(); return; }
    if (act === "ob-next") { obNext(); return; }

    if (act === "pr-save") {
      prRun(
        () => S.saveProfile(PR.firstName, PR.lastName, PR.email),
        () => { tgSafe.notify("success"); toast("اطلاعات ذخیره شد", "ok"); }
      );
      return;
    }
    if (act === "pr-phone-start") { PR.step = "phone"; PR.error = ""; PR.phone = ""; render(); return; }
    if (act === "pr-cancel") { openProfile(); stopObTimer(); render(); return; }
    if (act === "pr-phone-send") {
      prRun(async () => {
        const res = await S.registerPhone(PR.phone);
        PR.step = "code";
        PR.code = "";
        PR.hint = res.demoCode ? `حالت نمایشی: کد ${res.demoCode} است.` : "";
        startCodeTimer(res);
      });
      return;
    }
    if (act === "pr-resend") {
      prRun(async () => {
        const res = await S.registerPhone(PR.phone);
        PR.hint = res.demoCode ? `حالت نمایشی: کد ${res.demoCode} است.` : "کد دوباره فرستاده شد.";
        PR.code = "";
        startCodeTimer(res);
      });
      return;
    }
    if (act === "pr-code-verify") {
      prRun(
        () => S.verifyCode(PR.code),
        () => {
          stopObTimer();
          openProfile();
          tgSafe.notify("success");
          toast("شمارهٔ همراه به‌روز شد", "ok");
        }
      );
      return;
    }
    if (act === "ob-resend") { obResend(); return; }
    if (act === "ob-paste") { pasteCode(); return; }
    if (act === "ob-back") { OB.step = "phone"; OB.error = ""; OB.code = ""; renderOnboarding(); return; }
    if (act === "next") { nextStep(); return; }
    if (act === "prev") { tgSafe.tap(); W.step--; W.errors = {}; render(); return; }

    if (act === "copy-pay") { copyText(btn.dataset.val, "کپی شد ✓"); return; }

    if (act === "receipt-pick") {
      const input = $("#f-receipt");
      if (input) input.click();
      return;
    }

    if (act === "poster-pick") {
      const input = $("#f-poster");
      if (input) input.click();
      return;
    }
    if (act === "poster-clear") {
      W.data.creative.poster = "";
      delete W.errors.poster;
      tgSafe.tap();
      saveDraft();
      render();
      return;
    }

    if (act === "repeat") { repeatCampaign(btn.dataset.val); return; }

    if (act === "draft-discard") { draftAskDelete = true; tgSafe.tap(); render(); return; }
    if (act === "draft-keep") { draftAskDelete = false; tgSafe.tap(); render(); return; }
    if (act === "draft-delete") {
      S.clearDraft();
      draftAskDelete = false;
      // فرم باز در حافظه هم باید خالی شود، وگرنه با اولین حرفی که
      // کاربر بنویسد همان پیش‌نویس پاک‌شده دوباره ذخیره می‌شود
      resetWizard();
      W.data = freshData();
      tgSafe.tap();
      toast("پیش‌نویس پاک شد", "ok");
      render();
      return;
    }

    if (act === "filter") { campFilter = btn.dataset.val; render(); return; }

    if (act === "faq") {
      const box = btn.closest(".faq");
      const open = box.classList.contains("is-open");
      $$(".faq").forEach((f) => f.classList.remove("is-open"));
      if (!open) box.classList.add("is-open");
      return;
    }

    if (act === "support") { tgSafe.openLink("https://t.me/" + CFG.supportUsername); return; }
    if (act === "channel") { tgSafe.openLink("https://t.me/" + CFG.channelUsername); return; }


    if (act === "theme") {
      const dark = document.documentElement.getAttribute("data-theme") === "dark";
      document.documentElement.setAttribute("data-theme", dark ? "light" : "dark");
      render();
      return;
    }

    if (act === "clear-samples") {
      S.clearSamples();
      toast("کمپین‌های نمونه پاک شدند", "ok");
      render();
      return;
    }

    if (act === "copy-card") {
      copyText(btn.dataset.val, "شمارهٔ کارت کپی شد ✓");
      return;
    }

    if (act === "copy") {
      copyText(summaryText(btn.dataset.val), "خلاصه سفارش کپی شد ✓");
      return;
    }
  });

  /** کپی در حافظه — با راه دوم برای مرورگرهایی که اجازهٔ مستقیم نمی‌دهند */
  function copyText(text, okMessage) {
    const done = () => toast(okMessage, "ok");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
      return;
    }
    fallback();

    function fallback() {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { toast("کپی ناموفق بود", "err"); }
      ta.remove();
    }
  }

  window.addEventListener("hashchange", render);

  /* ---------- شروع ---------- */
  tgSafe.init();

  (async function boot() {
    elScreen.innerHTML = `<div class="empty"><div class="empty__ico">${ICON("send", 30)}</div><div class="empty__t">در حال اتصال…</div></div>`;
    await S.init();

    // اگر ثبت‌نام نیمه‌کاره مانده، از همان مرحله ادامه می‌دهیم
    if (!S.isRegistered() && S.isPhoneVerified()) {
      OB.step = "profile";
      OB.phone = S.profile.phone || "";
    }

    render();
    if (!S.isOnline()) {
      // دلیل را همراه پیام می‌آوریم؛ وگرنه عیب‌یابی از راه دور ناممکن است
      const why = S.demoReason && S.demoReason() ? ` (${S.demoReason()})` : "";
      setTimeout(() => toast("حالت نمایشی — سفارش‌ها ذخیره نمی‌شوند" + why, "err"), 700);
    }
  })();

  // وقتی کاربر به اپ برمی‌گردد، لیست را تازه کن
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !S.isOnline()) return;
    S.refresh().then(() => {
      const r = currentRoute();
      if (r === "/" || r === "/campaigns" || r.startsWith("/campaign/")) render();
    });
  });
})();
