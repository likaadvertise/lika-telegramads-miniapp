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

  function usd(n) { return num(n) + " دلار"; }

  function toman(n) {
    const t = Math.round((Number(n) || 0) * CFG.usdToToman);
    return num(t) + " تومان";
  }

  function money(n) {
    if (!CFG.showTomanEstimate) return usd(n);
    return usd(n) + " (≈ " + toman(n) + ")";
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

  // تخمین تعداد بازدید بر اساس بودجه و CPM
  function estViews(budget, cpm) {
    if (!cpm || cpm <= 0) return 0;
    return Math.round((budget / cpm) * 1000);
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
    { route: "/support",   icon: "chat",  label: "مشاوره" },
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
    if (r === "/new" && W.step > 1) { W.step--; render(); return; }
    if (r === "/new") { go("/"); return; }
    if (r.startsWith("/campaign/")) { go("/campaigns"); return; }
    if (r.startsWith("/success/")) { go("/campaigns"); return; }
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
    else if (route.startsWith("/campaign/")) view = viewCampaignDetail(route.split("/")[2]);
    else if (route.startsWith("/success/")) view = viewSuccess(route.split("/")[2]);
    else view = viewHome();

    elAppbar.className = "appbar" + (view.border === false ? "" : " has-border");
    elAppbar.innerHTML = view.bar;
    elScreen.className = "screen" + (view.sticky ? " is-full" : "");
    elScreen.innerHTML = view.body + (view.sticky || "");
    elTabbar.innerHTML = TABS.map((t) => `
      <button class="tab ${t.route === route ? "is-on" : ""}" data-act="go" data-route="${t.route}">
        <span class="tab__ico">${ICON(t.icon, 22)}</span><span>${t.label}</span>
      </button>`).join("");

    window.scrollTo(0, 0);
    if (view.after) view.after();
  }

  function bar(title, sub) {
    return `
      <button class="iconbtn" data-act="back" aria-label="بازگشت">${ICON("back")}</button>
      <div class="appbar__title">${esc(title)}${sub ? `<span class="appbar__sub">${esc(sub)}</span>` : ""}</div>`;
  }

  function barBrand() {
    return `
      <div class="brandmark">
        <div class="brandmark__logo">${esc(CFG.brandInitial)}</div>
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
          <span>حالت نمایشی — سفارش‌ها ذخیره نمی‌شوند و به تیم Lika نمی‌رسند.</span>
        </div>`}

        <section class="hero">
          <div class="hero__hi">سلام</div>
          <div class="hero__name">${esc(userName())}</div>
          <p class="hero__desc">تبلیغ خود را در تلگرام اجرا کنید و به میلیون‌ها مخاطب هدفمند برسید.</p>
          <button class="hero__cta" data-act="go" data-route="/new">
            ${ICON("plus", 18)}<span>ثبت کمپین جدید</span>
          </button>
        </section>

        <div class="stats">
          <div class="stat stat--brand"><div class="stat__num">${num(sum.total)}</div><div class="stat__lbl">کل کمپین‌ها</div></div>
          <div class="stat stat--success"><div class="stat__num">${num(sum.active)}</div><div class="stat__lbl">فعال</div></div>
          <div class="stat stat--warn"><div class="stat__num">${num(sum.waiting)}</div><div class="stat__lbl">در بررسی</div></div>
        </div>

        ${recent.length ? `
        <section class="section">
          <div class="section__head">
            <h2 class="section__title">آخرین کمپین‌ها</h2>
            <button class="section__link" data-act="go" data-route="/campaigns">همه</button>
          </div>
          ${recent.map(campCard).join("")}
        </section>` : `
        <section class="section">
          <div class="card center">
            <div class="empty__ico">${ICON("megaphone", 30)}</div>
            <div class="empty__t">هنوز کمپینی ندارید</div>
            <div class="empty__d">در سه دقیقه اولین تبلیغ خود را ثبت کنید.</div>
            <button class="btn btn--primary btn--block mt-16" data-act="go" data-route="/new">شروع کنیم</button>
          </div>
        </section>`}

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
          <span>بودجه: <span class="camp__money">${usd(c.budget?.amountUsd || 0)}</span></span>
          <span>${c.stats?.views ? "بازدید: " + num(c.stats.views) : "CPM: " + num(c.budget?.cpmUsd || 0) + "$"}</span>
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
      if (campFilter === "waiting") return ["pending", "review", "rejected"].includes(c.status);
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

    const st = S.STATUS[c.status];
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
          <div class="stats">
            <div class="stat stat--brand"><div class="stat__num">${num(c.stats.views)}</div><div class="stat__lbl">بازدید</div></div>
            <div class="stat stat--success"><div class="stat__num">${num(c.stats.clicks)}</div><div class="stat__lbl">کلیک</div></div>
            <div class="stat"><div class="stat__num">${c.stats.views ? num(((c.stats.clicks / c.stats.views) * 100).toFixed(2)) + "٪" : "—"}</div><div class="stat__lbl">نرخ کلیک</div></div>
          </div>
        </div>` : ""}

        <div class="section">
          <div class="section__head"><h2 class="section__title">متن تبلیغ</h2></div>
          ${adPreview(c.target?.brand, c.creative?.text)}
        </div>

        <div class="section">
          <div class="section__head"><h2 class="section__title">مشخصات</h2></div>
          <div class="card">
            ${kv("نوع مقصد", (S.TARGET_TYPES[c.target?.type] || {}).label || "—")}
            ${kv("آدرس مقصد", c.target?.url || "—", true)}
            ${kv("کشورها", countries.length ? countries.map((x) => x.flag + " " + x.name).join("، ") : "همه کشورها")}
            ${kv("زبان‌ها", (c.targeting?.languages || []).join("، ") || "همه زبان‌ها")}
            ${kv("موضوعات", topics.length ? topics.map((t) => t.name).join("، ") : "همه موضوعات")}
            ${(c.targeting?.channels || []).length ? kv("کانال‌های خاص", c.targeting.channels.join("، "), true) : ""}
            ${kv("بودجه", money(c.budget?.amountUsd))}
            ${kv("نرخ CPM", num(c.budget?.cpmUsd) + " دلار")}
            ${kv("بازدید تخمینی", num(estViews(c.budget?.amountUsd, c.budget?.cpmUsd)))}
            ${kv("زمان شروع", START_WHEN[c.budget?.startWhen] || START_WHEN.asap)}
            ${c.notes ? kv("توضیحات", c.notes) : ""}
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
  function adPreview(brand, text) {
    const b = (brand || "نام برند شما").trim();
    const t = (text || "").trim();
    return `
      <div class="adprev">
        <div class="adprev__label">پیش‌نمایش — این چیزی است که مخاطب در تلگرام می‌بیند</div>
        <div class="adprev__bubble">
          <div class="adprev__top">
            <div class="adprev__ava">${esc((b[0] || "L").toUpperCase())}</div>
            <div>
              <div class="adprev__name" id="prevName">${esc(b)}</div>
              <div class="adprev__spon">پیام اسپانسری • Sponsored</div>
            </div>
          </div>
          <div class="adprev__text ${t ? "" : "adprev__empty"}" id="prevText">${t ? esc(t) : "متن تبلیغ شما اینجا نمایش داده می‌شود…"}</div>
          <div class="adprev__btn">مشاهده کانال</div>
        </div>
      </div>`;
  }

  /* ---------- ۴.۶ مشاوره و پشتیبانی ---------- */
  function viewSupport() {
    return {
      bar: `<div class="appbar__title">مشاوره و پشتیبانی<span class="appbar__sub">پاسخ‌گویی در ساعات کاری</span></div>`,
      body: `
        <div class="card">
          <div class="service" style="border:none;background:transparent;padding:0">
            <div class="service__ico">${ICON("target", 20)}</div>
            <div>
              <div class="service__t">مشاورهٔ رایگان کمپین</div>
              <div class="service__d">اگر نمی‌دانید چه بودجه و مخاطبی برای کسب‌وکار شما مناسب است، با ما صحبت کنید.</div>
            </div>
          </div>
          <button class="btn btn--primary btn--block mt-16" data-act="support">${ICON("chat", 18)} گفت‌وگو با کارشناس</button>
          <button class="btn btn--outline btn--block mt-8" data-act="channel">${ICON("megaphone", 18)} کانال رسمی ${esc(CFG.brandName)}</button>
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
            <div class="stat stat--brand"><div class="stat__num">${num(sum.total)}</div><div class="stat__lbl">کمپین</div></div>
            <div class="stat stat--success"><div class="stat__num">${num(sum.views)}</div><div class="stat__lbl">بازدید</div></div>
            <div class="stat"><div class="stat__num">${num(sum.spend)}$</div><div class="stat__lbl">هزینه</div></div>
          </div>
        </div>

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
          <p class="help center mt-12">نسخهٔ آزمایشی ۰٫۱ — ${esc(CFG.brandName)}</p>
        </section>`
    };
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
        <div class="brandmark__logo">${esc(CFG.brandInitial)}</div>
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
        ${OB.step === "code" ? `<button class="btn btn--outline btn--back" data-act="ob-back" aria-label="بازگشت">${ICON("back")}</button>` : ""}
        <button class="btn btn--primary" data-act="ob-next" ${OB.busy ? "disabled" : ""}>
          ${OB.busy ? "لطفاً صبر کنید…" : labels[OB.step]}
        </button>
      </div>`;
  }

  const obError = () => (OB.error ? `<div class="err">${esc(OB.error)}</div>` : "");

  /* --- گام ۱: شمارهٔ موبایل --- */
  function obPhone() {
    return `
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
        <p class="ob__d">نام خود را وارد کنید تا پنل شخصی‌سازی شود.</p>
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
      target: { type: "channel", url: "", brand: "" },
      creative: { text: "" },
      targeting: { countries: [], languages: [], topics: [], channelsRaw: "" },
      budget: { amountUsd: CFG.minBudget, cpmUsd: CFG.defaultCpm, startWhen: "asap" },
      notes: "",
      accepted: false
    };
  }

  const W = { step: 1, data: freshData(), errors: {} };

  function startWizard() {
    const draft = S.loadDraft();
    W.step = 1;
    W.errors = {};
    if (draft && draft.target) {
      W.data = draft;
      setTimeout(() => toast("پیش‌نویس قبلی شما بازیابی شد"), 400);
    } else {
      W.data = freshData();
    }
    go("/new");
  }

  function saveDraft() { S.saveDraft(W.data); }

  function codeToCountry(code) { return CFG.countries.find((c) => c.code === code); }
  function idToTopic(id) { return CFG.topics.find((t) => t.id === id); }

  function viewWizard() {
    const titles = [
      { t: "مقصد تبلیغ", d: "مخاطب با کلیک روی تبلیغ کجا برود؟" },
      { t: "متن تبلیغ", d: "پیامی که مخاطب می‌بیند" },
      { t: "مخاطب هدف", d: "تبلیغ به چه کسانی نشان داده شود؟" },
      { t: "بودجه و نرخ", d: "چقدر می‌خواهید هزینه کنید؟" },
      { t: "بازبینی نهایی", d: "یک‌بار همه‌چیز را چک کنید" }
    ];
    const cur = titles[W.step - 1];
    const bodies = [stepTarget, stepCreative, stepAudience, stepBudget, stepReview];

    return {
      bar: bar("ثبت کمپین جدید", "مرحله " + num(W.step) + " از " + num(STEP_COUNT)),
      sticky: `
        <div class="stickybar">
          ${W.step > 1 ? `<button class="btn btn--outline btn--back" data-act="prev" aria-label="مرحله قبل">${ICON("back")}</button>` : ""}
          <button class="btn btn--primary" data-act="next">
            ${W.step === STEP_COUNT ? "ثبت نهایی سفارش" : "مرحله بعد"}
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

  /* --- مرحله ۱: مقصد --- */
  function stepTarget() {
    const d = W.data.target;
    return `
      <div class="field">
        <div class="label">نوع مقصد تبلیغ <span class="req">*</span></div>
        <div class="picks">
          ${Object.entries(S.TARGET_TYPES).map(([k, v]) => `
            <button class="pick ${d.type === k ? "is-on" : ""}" data-pick="type" data-val="${k}">
              <span class="pick__ico">${ICON(v.icon, 19)}</span>
              <span>
                <span class="pick__t">${v.label}</span>
                <span class="pick__d">${k === "channel" ? "مخاطب وارد کانال یا گروه شما می‌شود" : k === "bot" ? "مخاطب ربات شما را استارت می‌کند" : "مخاطب یک پست مشخص را می‌بیند"}</span>
              </span>
              <span class="pick__tick">✓</span>
            </button>`).join("")}
        </div>
      </div>

      <div class="field">
        <div class="label"><span>آدرس مقصد <span class="req">*</span></span><span class="label__hint">مثال <span dir="ltr">@lika_shop</span></span></div>
        <input class="input ${W.errors.url ? "is-error" : ""}" id="f-url" dir="ltr" inputmode="url"
               placeholder="@lika_shop" value="${esc(d.url)}" />
        ${errOf("url")}
        <div class="help">مقصد تبلیغ در Telegram Ads فقط می‌تواند کانال، گروه، ربات یا پست تلگرامی باشد؛ لینک سایت پذیرفته نمی‌شود.</div>
      </div>

      <div class="field">
        <div class="label">نام برند یا کسب‌وکار <span class="req">*</span></div>
        <input class="input ${W.errors.brand ? "is-error" : ""}" id="f-brand"
               placeholder="مثلاً: لیکا شاپ" value="${esc(d.brand)}" />
        ${errOf("brand")}
      </div>`;
  }

  /* --- مرحله ۲: متن --- */
  function stepCreative() {
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

      <div class="mt-16">${adPreview(W.data.target.brand, c.text)}</div>`;
  }

  /* --- مرحله ۳: مخاطب --- */
  function stepAudience() {
    const t = W.data.targeting;
    return `
      <div class="field">
        <div class="label">
          <span>کشورها <span class="req">*</span></span>
          <span class="label__hint" id="cnt-countries">${num(t.countries.length)} انتخاب</span>
        </div>
        <input class="input mt-8" id="f-country-search" placeholder="جستجوی کشور…" style="margin-bottom:9px" />
        <div class="chips" id="country-chips">
          ${CFG.countries.map((c) => `
            <button class="chip ${t.countries.includes(c.code) ? "is-on" : ""}"
                    data-chip="countries" data-val="${c.code}" data-name="${esc(c.name)}">
              ${c.flag} ${esc(c.name)}
            </button>`).join("")}
        </div>
        ${errOf("countries")}
      </div>

      <div class="field">
        <div class="label"><span>زبان مخاطب</span><span class="label__hint">اختیاری</span></div>
        <div class="chips">
          ${CFG.languages.map((l) => `
            <button class="chip ${t.languages.includes(l) ? "is-on" : ""}" data-chip="languages" data-val="${esc(l)}">${esc(l)}</button>`).join("")}
        </div>
      </div>

      <div class="field">
        <div class="label">
          <span>موضوع کانال‌ها <span class="req">*</span></span>
          <span class="label__hint" id="cnt-topics">${num(t.topics.length)} انتخاب</span>
        </div>
        <div class="chips">
          ${CFG.topics.map((tp) => `
            <button class="chip ${t.topics.includes(tp.id) ? "is-on" : ""}" data-chip="topics" data-val="${tp.id}">${tp.icon} ${esc(tp.name)}</button>`).join("")}
        </div>
        ${errOf("topics")}
        <div class="help">تبلیغ شما در کانال‌هایی با این موضوع‌ها نمایش داده می‌شود.</div>
      </div>

      <div class="field">
        <div class="label"><span>کانال‌های خاص</span><span class="label__hint">اختیاری</span></div>
        <textarea class="textarea" id="f-channels" dir="ltr" style="min-height:84px"
          placeholder="@channel_one&#10;@channel_two">${esc(t.channelsRaw)}</textarea>
        <div class="help">اگر می‌خواهید تبلیغ فقط در کانال‌های مشخصی دیده شود، هر آیدی را در یک خط بنویسید.</div>
      </div>`;
  }

  /* --- مرحله ۴: بودجه --- */
  function stepBudget() {
    const b = W.data.budget;
    return `
      <div class="field">
        <div class="label"><span>بودجه کمپین (دلار) <span class="req">*</span></span><span class="label__hint">حداقل ${num(CFG.minBudget)} دلار</span></div>
        <input class="input ${W.errors.amount ? "is-error" : ""}" id="f-amount" dir="ltr"
               type="number" inputmode="decimal" min="${CFG.minBudget}" step="1" value="${b.amountUsd}" />
        ${errOf("amount")}
        <div class="money-chips">
          ${CFG.budgetPresets.map((p) => `<button class="chip ${Number(b.amountUsd) === p ? "is-on" : ""}" data-preset="${p}">${num(p)}$</button>`).join("")}
        </div>
        ${CFG.showTomanEstimate ? `<div class="help" id="toman-hint">معادل تقریبی: ${toman(b.amountUsd)}</div>` : ""}
      </div>

      <div class="field">
        <div class="label">
          <span>نرخ CPM (هزینه هر ۱۰۰۰ بازدید)</span>
          <span class="label__hint nums" id="cpm-val">${num(b.cpmUsd)} دلار</span>
        </div>
        <input class="range" id="f-cpm" type="range"
               min="${CFG.minCpm}" max="${CFG.maxCpm}" step="${CFG.cpmStep}" value="${b.cpmUsd}" />
        <div class="row-between tiny dim">
          <span>ارزان‌تر، نمایش کمتر</span><span>گران‌تر، نمایش بیشتر</span>
        </div>
        <div class="help">نرخ بالاتر شانس نمایش تبلیغ شما را در رقابت با سایر تبلیغ‌دهنده‌ها بیشتر می‌کند.</div>
      </div>

      <div class="card mt-16" style="background:var(--brand-soft);border-color:transparent">
        <div class="row-between">
          <span class="service__t">بازدید تخمینی</span>
          <span class="service__t nums" id="est-views" style="color:var(--brand)">${num(estViews(b.amountUsd, b.cpmUsd))}</span>
        </div>
        <div class="help" style="margin-top:4px">این عدد یک برآورد تقریبی است و نتیجهٔ واقعی به رقابت و مخاطب هدف بستگی دارد.</div>
      </div>

      <div class="field">
        <div class="label"><span>زمان شروع کمپین</span></div>
        <div class="chips">
          ${Object.entries(START_WHEN).map(([k, v]) => `
            <button class="chip ${b.startWhen === k ? "is-on" : ""}" data-radio="startWhen" data-val="${k}">${v}</button>`).join("")}
        </div>
        <div class="help">زمان دقیق اجرا پس از تأیید نهایی و تسویه با شما هماهنگ می‌شود.</div>
      </div>`;
  }

  /* --- مرحله ۵: بازبینی --- */
  function stepReview() {
    const d = W.data;
    const countries = d.targeting.countries.map(codeToCountry).filter(Boolean);
    const topics = d.targeting.topics.map(idToTopic).filter(Boolean);

    return `
      ${adPreview(d.target.brand, d.creative.text)}

      <div class="section">
        <div class="section__head"><h2 class="section__title">خلاصه سفارش</h2></div>
        <div class="card">
          ${kv("نوع مقصد", S.TARGET_TYPES[d.target.type].label)}
          ${kv("آدرس مقصد", d.target.url, true)}
          ${kv("برند", d.target.brand)}
          ${kv("کشورها", countries.map((c) => c.flag + " " + c.name).join("، "))}
          ${kv("زبان‌ها", d.targeting.languages.join("، ") || "همه")}
          ${kv("موضوعات", topics.map((t) => t.name).join("، "))}
          ${parseChannels(d.targeting.channelsRaw).length ? kv("کانال‌های خاص", parseChannels(d.targeting.channelsRaw).join("، "), true) : ""}
          ${kv("بودجه", money(d.budget.amountUsd))}
          ${kv("نرخ CPM", num(d.budget.cpmUsd) + " دلار")}
          ${kv("بازدید تخمینی", num(estViews(d.budget.amountUsd, d.budget.cpmUsd)))}
          ${kv("زمان شروع", START_WHEN[d.budget.startWhen] || START_WHEN.asap)}
        </div>
      </div>

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

  function parseChannels(raw) {
    return String(raw || "")
      .split(/[\n,،\s]+/)
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => (x.startsWith("@") || x.startsWith("http") ? x : "@" + x));
  }

  /* --- اتصال رویدادهای فرم پس از رسم صفحه --- */
  function bindWizard() {
    const on = (id, ev, fn) => { const el = $("#" + id); if (el) el.addEventListener(ev, fn); };

    on("f-url", "input", (e) => { W.data.target.url = e.target.value.trim(); saveDraft(); });
    on("f-brand", "input", (e) => {
      W.data.target.brand = e.target.value;
      const p = $("#prevName"); if (p) p.textContent = e.target.value || "نام برند شما";
      const a = $(".adprev__ava"); if (a) a.textContent = (e.target.value.trim()[0] || "L").toUpperCase();
      saveDraft();
    });

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
        p.className = "adprev__text" + (e.target.value ? "" : " adprev__empty");
      }
      saveDraft();
    });

    on("f-notes", "input", (e) => { W.data.notes = e.target.value; saveDraft(); });
    on("f-channels", "input", (e) => { W.data.targeting.channelsRaw = e.target.value; saveDraft(); });

    on("f-country-search", "input", (e) => {
      const q = e.target.value.trim();
      $$("#country-chips .chip").forEach((ch) => {
        ch.hidden = q ? !(ch.dataset.name || "").includes(q) : false;
      });
    });

    on("f-amount", "input", (e) => {
      W.data.budget.amountUsd = Number(e.target.value) || 0;
      refreshBudget();
      $$("[data-preset]").forEach((b) => b.classList.toggle("is-on", Number(b.dataset.preset) === W.data.budget.amountUsd));
      saveDraft();
    });

    on("f-cpm", "input", (e) => {
      W.data.budget.cpmUsd = Number(e.target.value);
      const v = $("#cpm-val"); if (v) v.textContent = num(W.data.budget.cpmUsd) + " دلار";
      refreshBudget();
      saveDraft();
    });

  }

  function refreshBudget() {
    const b = W.data.budget;
    const ev = $("#est-views"); if (ev) ev.textContent = num(estViews(b.amountUsd, b.cpmUsd));
    const th = $("#toman-hint"); if (th) th.textContent = "معادل تقریبی: " + toman(b.amountUsd);
  }

  /* --- بررسی صحت هر مرحله --- */
  function validateStep() {
    const d = W.data;
    const e = {};

    if (W.step === 1) {
      const url = d.target.url;
      const ok = /^@[A-Za-z0-9_]{4,}$/.test(url) || /^(https?:\/\/)?t\.me\/[A-Za-z0-9_+/]{3,}$/i.test(url);
      if (!url) e.url = "آدرس مقصد را وارد کنید.";
      else if (!ok) e.url = "آدرس معتبر نیست. مثال درست: @lika_shop یا https://t.me/lika_shop";
      if (d.target.brand.trim().length < 2) e.brand = "نام برند را وارد کنید.";
    }

    if (W.step === 2) {
      const len = d.creative.text.trim().length;
      if (len < CFG.adTextMinLength) e.text = "متن تبلیغ خیلی کوتاه است.";
      else if (len > CFG.adTextMaxLength) e.text = "متن از سقف مجاز تلگرام بیشتر است (" + num(CFG.adTextMaxLength) + " کاراکتر).";
    }

    if (W.step === 3) {
      if (d.targeting.countries.length === 0) e.countries = "حداقل یک کشور را انتخاب کنید.";
      if (d.targeting.topics.length === 0 && parseChannels(d.targeting.channelsRaw).length === 0)
        e.topics = "حداقل یک موضوع انتخاب کنید یا کانال خاص وارد کنید.";
    }

    if (W.step === 4) {
      const a = Number(d.budget.amountUsd);
      if (!a || a < CFG.minBudget) e.amount = "حداقل بودجه " + num(CFG.minBudget) + " دلار است.";
      else if (a > CFG.maxBudget) e.amount = "بودجه بیش از حد مجاز است.";
    }

    if (W.step === 5) {
      if (!d.accepted) e.accepted = "برای ادامه باید قوانین را بپذیرید.";
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
    if (W.step < STEP_COUNT) { W.step++; saveDraft(); render(); return; }
    submitCampaign();
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
        target: { type: d.target.type, url: d.target.url, brand: d.target.brand.trim() },
        creative: { text: d.creative.text.trim() },
        targeting: {
          countries: d.targeting.countries,
          languages: d.targeting.languages,
          topics: d.targeting.topics,
          channels: parseChannels(d.targeting.channelsRaw)
        },
        budget: { amountUsd: Number(d.budget.amountUsd), cpmUsd: Number(d.budget.cpmUsd), startWhen: d.budget.startWhen },
        notes: d.notes.trim()
      });

      S.clearDraft();
      W.data = freshData();
      W.step = 1;
      tgSafe.notify("success");
      tgSafe.closeGuard(false);
      go("/success/" + campaign.id, true);
    } catch (err) {
      tgSafe.notify("error");
      toast(err.message || "ثبت سفارش انجام نشد. دوباره تلاش کنید.", "err");
      if (btn) { btn.disabled = false; btn.textContent = "ثبت نهایی سفارش"; }
    } finally {
      submitting = false;
    }
  }

  /* ---------- صفحه موفقیت ---------- */
  function viewSuccess(id) {
    return {
      bar: `<div class="appbar__title">سفارش ثبت شد</div>`,
      body: `
        <div class="done-hero">
          <div class="done-hero__ico">✓</div>
          <div class="done-hero__t">سفارش شما ثبت شد</div>
          <p class="done-hero__d">${S.isOnline()
            ? `کارشناسان ${esc(CFG.brandName)} درخواست شما را بررسی می‌کنند و نتیجه را از طریق همین ربات به شما اطلاع می‌دهند.`
            : "این سفارش فقط برای نمایش ثبت شد."}</p>
          <div class="done-hero__code">${esc(id)}</div>
        </div>

        <div class="card mt-16">
          <div class="timeline">
            <div class="tl is-now"><div class="tl__dot">✓</div><div><div class="tl__t">ثبت درخواست</div><div class="tl__d">انجام شد</div></div></div>
            <div class="tl"><div class="tl__dot"></div><div><div class="tl__t">بررسی توسط کارشناس</div><div class="tl__d">معمولاً کمتر از چند ساعت کاری</div></div></div>
            <div class="tl"><div class="tl__dot"></div><div><div class="tl__t">تأیید و تسویه</div><div class="tl__d">هماهنگی پرداخت با شما</div></div></div>
            <div class="tl"><div class="tl__dot"></div><div><div class="tl__t">اجرای کمپین</div><div class="tl__d">شروع نمایش تبلیغ در تلگرام</div></div></div>
          </div>
        </div>

        ${S.isOnline() ? "" : `
        <div class="card card--pad-sm center tiny dim mt-12">
          ${ICON("alert", 15)} حالت نمایشی: این سفارش فقط روی گوشی شما ذخیره شد و برای تیم ما ارسال نشد.
        </div>`}

        <div class="btn-row mt-16">
          <button class="btn btn--outline" data-act="copy" data-val="${esc(id)}">کپی خلاصه سفارش</button>
          <button class="btn btn--primary" data-act="go" data-route="/campaign/${esc(id)}">مشاهده کمپین</button>
        </div>
        <button class="btn btn--ghost btn--block mt-8" data-act="go" data-route="/">بازگشت به خانه</button>`
    };
  }

  function summaryText(id) {
    const c = S.get(id);
    if (!c) return "";
    const countries = c.targeting.countries.map(codeToCountry).filter(Boolean).map((x) => x.name).join("، ");
    const topics = c.targeting.topics.map(idToTopic).filter(Boolean).map((x) => x.name).join("، ");
    return [
      "🎯 سفارش تبلیغ Telegram Ads",
      "کد سفارش: " + c.id,
      "برند: " + c.target.brand,
      "مقصد (" + S.TARGET_TYPES[c.target.type].label + "): " + c.target.url,
      "متن: " + c.creative.text,
      "کشورها: " + (countries || "همه"),
      "زبان‌ها: " + (c.targeting.languages.join("، ") || "همه"),
      "موضوعات: " + (topics || "همه"),
      c.targeting.channels.length ? "کانال‌های خاص: " + c.targeting.channels.join("، ") : "",
      "بودجه: " + c.budget.amountUsd + " دلار",
      "CPM: " + c.budget.cpmUsd + " دلار",
      "زمان شروع: " + (START_WHEN[c.budget.startWhen] || START_WHEN.asap),
      c.notes ? "توضیحات: " + c.notes : ""
    ].filter(Boolean).join("\n");
  }

  /* =======================================================
     ۶) رویدادها
     ======================================================= */

  document.addEventListener("click", (ev) => {
    const chip = ev.target.closest("[data-chip]");
    if (chip) {
      const key = chip.dataset.chip;
      const val = chip.dataset.val;
      const arr = W.data.targeting[key];
      const i = arr.indexOf(val);
      if (i === -1) arr.push(val); else arr.splice(i, 1);
      chip.classList.toggle("is-on", i === -1);
      const label = $("#cnt-" + key);
      if (label) label.textContent = num(arr.length) + " انتخاب";
      tgSafe.tap();
      saveDraft();
      return;
    }

    const pick = ev.target.closest("[data-pick]");
    if (pick) {
      W.data.target.type = pick.dataset.val;
      $$("[data-pick]").forEach((p) => p.classList.toggle("is-on", p === pick));
      tgSafe.tap();
      saveDraft();
      return;
    }

    const sw = ev.target.closest("[data-switch]");
    if (sw) {
      const key = sw.dataset.switch;
      W.data[key] = !W.data[key];
      sw.classList.toggle("is-on", W.data[key]);
      if (W.data[key]) W.errors = {};
      tgSafe.tap();
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

    const preset = ev.target.closest("[data-preset]");
    if (preset) {
      const v = Number(preset.dataset.preset);
      W.data.budget.amountUsd = v;
      const input = $("#f-amount"); if (input) input.value = v;
      $$("[data-preset]").forEach((b) => b.classList.toggle("is-on", b === preset));
      refreshBudget();
      tgSafe.tap();
      saveDraft();
      return;
    }

    const btn = ev.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;

    if (act === "go") {
      tgSafe.tap();
      if (btn.dataset.route === "/new") { startWizard(); return; }
      go(btn.dataset.route);
      return;
    }
    if (act === "back") { tgSafe.tap(); goBack(); return; }
    if (act === "ob-next") { obNext(); return; }
    if (act === "ob-resend") { obResend(); return; }
    if (act === "ob-back") { OB.step = "phone"; OB.error = ""; OB.code = ""; renderOnboarding(); return; }
    if (act === "next") { nextStep(); return; }
    if (act === "prev") { tgSafe.tap(); W.step--; W.errors = {}; render(); return; }

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

    if (act === "copy") {
      const text = summaryText(btn.dataset.val);
      const done = () => toast("خلاصه سفارش کپی شد ✓", "ok");
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(() => toast("کپی ناموفق بود", "err"));
      } else {
        const ta = document.createElement("textarea");
        ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand("copy"); done(); } catch (e) { toast("کپی ناموفق بود", "err"); }
        ta.remove();
      }
      return;
    }
  });

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
      setTimeout(() => toast("حالت نمایشی — سفارش‌ها ذخیره نمی‌شوند", "err"), 700);
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
