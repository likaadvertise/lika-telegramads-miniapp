/* =========================================================
   Lika CRM — مینی‌اپ مدیریت
   ---------------------------------------------------------
   این اپ جدا از مینی‌اپ مشتری است و فقط برای تیم Lika باز
   می‌شود. هویت از همان امضای تلگرام می‌آید، پس رمز عبور
   جداگانه‌ای وجود ندارد که لو برود.

   ⚠️ پنهان بودن این آدرس، امنیت نیست. امنیت واقعی سمت سرور
      است: هر درخواست /api/admin/* دوباره ADMIN_IDS را بررسی
      می‌کند و به هر کس دیگری ۴۰۳ می‌دهد.
   ========================================================= */

(function () {
  const CFG = window.LIKA_CONFIG || {};
  const ICON = (window.Icons && window.Icons.icon) || (() => "");

  const $ = (s) => document.querySelector(s);
  const elBar = $("#appbar");
  const elScreen = $("#screen");
  const elTabs = $("#tabbar");
  const elToast = $("#toast");

  /* ---------- کمکی‌ها ---------- */
  const esc = (v) =>
    String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  function num(n) {
    const v = Number(n) || 0;
    try { return v.toLocaleString("fa-IR", { maximumFractionDigits: 2 }); }
    catch { return String(v); }
  }

  /** نرخ کلیک از روی بازدید/کلیکِ خامی که هنوز ذخیره نشده هم قابل محاسبه است */
  function ctrText(views, clicks) {
    const v = Number(views) || 0;
    const c = Number(clicks) || 0;
    return v > 0 ? num(Number(((c / v) * 100).toFixed(2))) + "٪" : "—";
  }

  function dateFa(iso) {
    try {
      return new Date(iso).toLocaleDateString("fa-IR",
        { year: "numeric", month: "long", day: "numeric" });
    } catch { return ""; }
  }

  /* سفارش‌ها و مشتری‌هایی که از سایت likaads.com می‌آیند، نه از داخل
     مینی‌اپ تلگرام، این برچسب کوچک را کنار اسمشان می‌گیرند. */
  function sourceTag(source) {
    if (source !== "website") return "";
    return ` <span style="display:inline-block;font-size:11px;padding:1px 7px;` +
      `border-radius:999px;border:1px solid currentColor;opacity:.7;` +
      `vertical-align:middle;margin-inline-start:4px">سایت</span>`;
  }

  let toastTimer = null;
  function toast(msg, kind) {
    elToast.textContent = msg;
    elToast.className = "toast is-on" + (kind ? " toast--" + kind : "");
    elToast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { elToast.className = "toast"; elToast.hidden = true; }, 3800);
  }

  const STATUS = {
    pending:  { label: "در انتظار بررسی", cls: "pending" },
    approved: { label: "تأیید شده",       cls: "approved" },
    running:  { label: "در حال اجرا",     cls: "running" },
    done:     { label: "پایان‌یافته",      cls: "done" },
    rejected: { label: "نیاز به اصلاح",   cls: "rejected" }
  };

  const TYPES = { channel: "کانال", search: "جستجو", bot: "ربات" };

  /* دستیار محلی (tools/tgads/agent.mjs) — روی کامپیوتر خودِ کارشناس اجرا
     می‌شود، نه روی اینترنت؛ همیشه همین آدرس است. اگر باز نباشد، درخواست
     به آن اصلاً نمی‌رسد و دکمهٔ «پر کن» همین را می‌گوید. */
  const AGENT_URL = "http://127.0.0.1:57821";

  /* ---------- ارتباط با سرور ---------- */
  const apiBase = () => (CFG.apiBase || "").replace(/\/+$/, "");
  const initData = () => {
    try { return window.Telegram?.WebApp?.initData || ""; } catch { return ""; }
  };

  /* بلیت ورود وب. وقتی پنل در مرورگر لپ‌تاپ باز می‌شود امضای تلگرامی
     در کار نیست، پس هویت از این بلیت می‌آید. */
  const TOKEN_KEY = "lika_crm_token";
  const token = {
    get() { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; } },
    set(v) { try { localStorage.setItem(TOKEN_KEY, v); } catch {} },
    clear() { try { localStorage.removeItem(TOKEN_KEY); } catch {} }
  };

  function authHeaders(extra = {}) {
    const h = { "Content-Type": "application/json", ...extra };
    const t = token.get();
    if (t) h.Authorization = "Bearer " + t;
    const id = initData();
    if (id) h["X-Telegram-Init-Data"] = id;
    return h;
  }

  async function request(path, options = {}) {
    return fetch(apiBase() + path, { ...options, headers: authHeaders(options.headers) });
  }

  async function api(path, options = {}) {
    const res = await request(path, options);
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok || data.ok === false) {
      const err = new Error(data.error || `ارتباط با سرور برقرار نشد (${res.status}).`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /* ---------- وضعیت اپ ---------- */
  const S = {
    ready: false,
    needLogin: false,   // رمز خواسته می‌شود
    busy: false,
    loginUser: "",
    loginPass: "",
    loginError: "",
    error: "",
    users: [],
    orders: [],
    tab: "orders",
    q: "",
    open: null,      // کد سفارشی که باز است
    openUser: null,  // شناسهٔ مشتری‌ای که باز است
    userEdit: null,
    edit: null       // نسخهٔ در حال ویرایش
  };

  const TABS = [
    { key: "orders", icon: "chart",  label: "سفارش‌ها" },
    { key: "users",  icon: "user",   label: "مشتری‌ها" },
    { key: "tools",  icon: "folder", label: "گزارش" }
  ];

  async function load() {
    try {
      const [u, c] = await Promise.all([api("/api/admin/users"), api("/api/admin/campaigns")]);
      S.users = u.users || [];
      S.orders = c.campaigns || [];
      S.error = "";
    } catch (e) {
      /* ۴۰۱ یعنی اصلاً شناخته نشدیم: یا بلیت منقضی شده، یا از مرورگر
         معمولی آمده‌ایم. در هر دو حالت باید رمز بخواهیم، نه اینکه
         پیام خطای گنگ نشان دهیم. */
      if (e.status === 401) {
        token.clear();
        S.needLogin = true;
        S.error = "";
      } else {
        S.error = e.status === 403
          ? "این حساب اجازهٔ ورود به پنل را ندارد."
          : (e.message || "خواندن اطلاعات ممکن نشد.");
      }
    }
    S.ready = true;
    render();
  }

  const ownerOf = (c) => S.users.find((u) => Number(u.id) === Number(c.userId)) || null;
  const fullName = (u) => [u?.firstName, u?.lastName].filter(Boolean).join(" ") || "بدون نام";

  function match(text) {
    const q = S.q.trim().toLowerCase();
    return !q || String(text).toLowerCase().includes(q);
  }

  /* =======================================================
     صفحه‌ها
     ======================================================= */

  function renderLogin() {
    elBar.className = "appbar";
    elBar.innerHTML = `
      <div class="brandmark">
        <div class="brandmark__logo">L</div>
        <div>
          <div class="brandmark__name">Lika CRM</div>
          <div class="brandmark__tag">پنل مدیریت</div>
        </div>
      </div>`;
    elTabs.innerHTML = "";
    elTabs.hidden = true;

    elScreen.innerHTML = `
      <div class="card mt-16">
        <div class="service__t">ورود به پنل</div>
        <div class="service__d mt-8">نام کاربری و رمزی که روی سرور تنظیم کرده‌اید.</div>

        <div class="field">
          <div class="label"><span>نام کاربری</span></div>
          <input class="input" id="lg-user" autocomplete="username" dir="ltr"
                 value="${esc(S.loginUser)}" />
        </div>
        <div class="field">
          <div class="label"><span>رمز</span></div>
          <input class="input" id="lg-pass" type="password" autocomplete="current-password" dir="ltr"
                 value="${esc(S.loginPass)}" />
          ${S.loginError ? `<div class="err">${esc(S.loginError)}</div>` : ""}
        </div>

        <button class="btn btn--primary btn--block mt-16" id="lg-go" ${S.busy ? "disabled" : ""}>
          ${S.busy ? "در حال بررسی…" : "ورود"}
        </button>
      </div>`;

    const go = $("#lg-go");
    const user = $("#lg-user");
    const pass = $("#lg-pass");

    /* چیزی که تایپ می‌شود در حافظه می‌ماند، وگرنه با هر بار رسم دوباره
       (مثلاً بعد از یک رمز اشتباه) کادرها خالی می‌شوند. */
    user.addEventListener("input", (e) => { S.loginUser = e.target.value; });
    pass.addEventListener("input", (e) => { S.loginPass = e.target.value; });

    go.onclick = () => doLogin();
    for (const el of [user, pass]) {
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); doLogin(); }
      });
    }
    setTimeout(() => { try { (S.loginUser ? pass : user).focus(); } catch {} }, 200);
  }

  async function doLogin() {
    const username = S.loginUser;
    const password = S.loginPass;
    if (S.busy) return;
    S.busy = true;
    S.loginError = "";
    renderLogin();

    try {
      const res = await fetch(apiBase() + "/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.token) throw new Error(data.error || "ورود ممکن نشد.");

      token.set(data.token);
      S.loginPass = "";
      S.needLogin = false;
      S.busy = false;
      S.ready = false;
      render();
      load();
    } catch (e) {
      S.loginError = e.message || "ورود ممکن نشد.";
      S.busy = false;
      renderLogin();
    }
  }

  function logout() {
    token.clear();
    S.needLogin = true;
    S.users = [];
    S.orders = [];
    S.open = null;
    S.openUser = null;
    renderLogin();
  }

  function render() {
    if (S.needLogin) { renderLogin(); return; }
    if (S.open) { renderDetail(); return; }
    if (S.openUser) { renderUser(); return; }

    elBar.className = "appbar has-border";
    elBar.innerHTML = `
      <div class="brandmark">
        <div class="brandmark__logo">L</div>
        <div>
          <div class="brandmark__name">Lika CRM</div>
          <div class="brandmark__tag">پنل مدیریت مشتریان</div>
        </div>
      </div>`;

    elTabs.hidden = false;
    elTabs.innerHTML = TABS.map((t) => `
      <button class="tab ${t.key === S.tab ? "is-on" : ""}" data-tab="${t.key}">
        <span class="tab__ico">${ICON(t.icon, 22)}</span><span>${t.label}</span>
      </button>`).join("");

    if (!S.ready) {
      elScreen.innerHTML = `<div class="card center"><div class="empty__d">در حال خواندن…</div></div>`;
      return;
    }
    if (S.error) {
      elScreen.innerHTML = `<div class="notice">${ICON("alert", 16)}<span>${esc(S.error)}</span></div>`;
      return;
    }

    elScreen.innerHTML =
      S.tab === "tools" ? viewTools() : `
      <input class="input" id="q" placeholder="جستجو: نام، شماره، برند، کد سفارش…" value="${esc(S.q)}" />
      ${S.tab === "orders" ? viewOrders() : viewUsers()}`;

    const q = $("#q");
    if (q) {
      q.addEventListener("input", (e) => {
        S.q = e.target.value;
        const list = $("#list");
        if (list) list.innerHTML = S.tab === "orders" ? listOrders() : listUsers();
      });
    }
    window.scrollTo(0, 0);
  }

  /* ---------- سفارش‌ها ---------- */
  function viewOrders() {
    const counts = {};
    for (const c of S.orders) counts[c.status] = (counts[c.status] || 0) + 1;
    const chips = Object.keys(STATUS)
      .filter((k) => counts[k])
      .map((k) => `<span class="perf__leg"><i class="perf__dot seg--${STATUS[k].cls}"></i>${STATUS[k].label} (${num(counts[k])})</span>`)
      .join("");

    return `
      <div class="perf__legend mt-12">${chips}</div>
      <div id="list">${listOrders()}</div>`;
  }

  function listOrders() {
    const rows = S.orders.filter((c) =>
      match([c.id, c.adTitle, c.target?.brand, c.target?.url, fullName(ownerOf(c)), ownerOf(c)?.phone].join(" ")));
    if (!rows.length) return `<div class="card center mt-12"><div class="empty__d">چیزی پیدا نشد.</div></div>`;

    return rows.map((c) => {
      const st = STATUS[c.status] || STATUS.pending;
      const o = ownerOf(c);
      return `
      <button class="card card--pad-sm mt-8" data-open="${esc(c.id)}" style="display:block;width:100%;text-align:right">
        <div class="row-between">
          <div style="min-width:0">
            <div class="service__t">${esc(c.adTitle || c.target?.brand || "بدون عنوان")}${sourceTag(c.source)}</div>
            <div class="service__d nums" dir="ltr">${esc(c.id)}</div>
          </div>
          <span class="badge badge--${st.cls}"><span class="badge__dot"></span>${esc(st.label)}</span>
        </div>
        <div class="row-between mt-8 tiny dim">
          <span>${esc(fullName(o))} · <span class="nums" dir="ltr">${esc(o?.phone || "—")}</span></span>
          <span class="nums">${c.budget?.priceToman ? num(c.budget.priceToman) + " ت" : "—"}</span>
        </div>
      </button>`;
    }).join("");
  }

  /* ---------- مشتری‌ها ---------- */
  function viewUsers() { return `<div id="list">${listUsers()}</div>`; }

  function listUsers() {
    const rows = S.users.filter((u) =>
      match([u.firstName, u.lastName, u.phone, u.email, u.username, u.id].join(" ")));
    if (!rows.length) return `<div class="card center mt-12"><div class="empty__d">چیزی پیدا نشد.</div></div>`;

    return rows.map((u) => `
      <button class="card card--pad-sm mt-8" data-user="${esc(u.id)}"
              style="display:block;width:100%;text-align:right">
        <div class="row-between">
          <div>
            <div class="service__t">${esc(fullName(u))}${sourceTag(u.source)}</div>
            <div class="service__d nums" dir="ltr">${esc(u.phone || "—")}</div>
          </div>
          <div class="tiny dim" style="text-align:left">
            <div>${num(u.orders)} سفارش</div>
            <div>${esc(dateFa(u.registeredAt))}</div>
          </div>
        </div>
        <div class="tiny dim mt-8" dir="ltr">
          ${u.username ? "@" + esc(u.username) + " · " : ""}<span class="nums">${esc(u.id)}</span>
        </div>
      </button>`).join("");
  }

  /* ---------- گزارش ---------- */
  function viewTools() {
    const spend = S.orders
      .filter((c) => ["running", "done"].includes(c.status))
      .reduce((s, c) => s + (c.budget?.priceToman || 0), 0);

    return `
      <div class="stats">
        <div class="stat"><div class="stat__num">${num(S.users.length)}</div><div class="stat__lbl">مشتری</div></div>
        <div class="stat"><div class="stat__num">${num(S.orders.length)}</div><div class="stat__lbl">سفارش</div></div>
        <div class="stat"><div class="stat__num">${num(Math.round(spend / 1000000))}م</div><div class="stat__lbl">تومان در اجرا</div></div>
      </div>

      <div class="section">
        <button class="btn btn--primary btn--block" id="export">
          ${ICON("doc", 17)} گرفتن خروجی اکسل
        </button>
        <div class="help mt-8">
          فایل در تلگرام خودتان فرستاده می‌شود. با اکسل یا گوگل‌شیت بازش کنید.
          هر بار که بگیرید، تازه‌ترین اطلاعات را دارد.
        </div>
      </div>

      <div class="section">
        <button class="btn btn--outline btn--block" id="reload">${ICON("pulse", 17)} تازه‌سازی اطلاعات</button>
      </div>

      ${token.get() ? `
      <div class="section">
        <button class="btn btn--ghost btn--block" id="logout">خروج از پنل</button>
      </div>` : ""}`;
  }

  /* ---------- جزئیات و ویرایش یک سفارش ---------- */
  function renderDetail() {
    const c = S.orders.find((x) => x.id === S.open);
    if (!c) { S.open = null; render(); return; }

    const o = ownerOf(c);
    const e = S.edit;

    elBar.className = "appbar has-border";
    elBar.innerHTML = `
      <button class="iconbtn" id="back">${ICON("back")}</button>
      <div class="appbar__title">${esc(c.adTitle || c.target?.brand || "سفارش")}${sourceTag(c.source)}
        <span class="appbar__sub nums" dir="ltr">${esc(c.id)}</span>
      </div>`;
    elTabs.innerHTML = "";

    elScreen.innerHTML = e ? editForm(c, e) : detailCard(c, o);

    $("#back").onclick = () => {
      if (S.edit) { S.edit = null; renderDetail(); return; }
      S.open = null; render();
    };

    loadPosters();

    if (e) bindEdit(c);
    else {
      $("#do-edit").onclick = () => {
        S.edit = {
          adTitle: c.adTitle || "",
          text: c.creative?.text || "",
          url: c.target?.url || "",
          brand: c.target?.brand || "",
          channels: (c.targeting?.channels || []).join("\n"),
          keywords: (c.targeting?.keywords || []).join("\n"),
          adminNote: c.adminNote || "",
          status: c.status,
          views: String(c.stats?.views || 0),
          clicks: String(c.stats?.clicks || 0),
          joins: String(c.stats?.joins || 0)
        };
        renderDetail();
      };

      $("#do-tgads").onclick = () => {
        const text = JSON.stringify(tgAdsPayload(c), null, 2);
        const done = () => toast("کپی شد — در فایل order.json بریزید", "ok");
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done).catch(() => toast("کپی نشد", "err"));
        } else {
          const ta = document.createElement("textarea");
          ta.value = text; document.body.appendChild(ta); ta.select();
          try { document.execCommand("copy"); done(); } catch (e) { toast("کپی نشد", "err"); }
          ta.remove();
        }
      };

      $("#do-tgads-auto").onclick = () => runTgAdsAgent(c);

      $("#do-delete").onclick = async () => {
        if (!confirm(`سفارش ${c.id} برای همیشه پاک شود؟ این کار برگشت‌ناپذیر است.`)) return;
        try {
          await api("/api/admin/campaign/" + encodeURIComponent(c.id), { method: "DELETE" });
          S.orders = S.orders.filter((x) => x.id !== c.id);
          S.open = null;
          toast("سفارش حذف شد.", "ok");
          render();
        } catch (err) {
          toast(err.message || "حذف ممکن نشد.", "err");
        }
      };
    }
  }

  /* عکس پوستر پشت احراز هویت است و <img> هدر Authorization نمی‌فرستد؛
     پس خودمان می‌گیریمش و به‌صورت blob در تگ می‌گذاریم. */
  async function loadPosters() {
    for (const img of document.querySelectorAll("img[data-poster]")) {
      const id = img.dataset.poster;
      delete img.dataset.poster;
      try {
        const res = await request("/api/admin/poster?id=" + encodeURIComponent(id));
        if (!res.ok) throw new Error("HTTP " + res.status);
        img.src = URL.createObjectURL(await res.blob());
      } catch {
        img.replaceWith(Object.assign(document.createElement("div"), {
          className: "help mt-8",
          textContent: "پوستر بارگذاری نشد."
        }));
      }
    }
  }

  function kv(k, v, ltr) {
    return `<div class="kv"><span class="kv__k">${esc(k)}</span><span class="kv__v" ${ltr ? 'dir="ltr"' : ""}>${esc(v)}</span></div>`;
  }

  function detailCard(c, o) {
    const st = STATUS[c.status] || STATUS.pending;
    const t = c.targeting || {};
    return `
      <div class="card">
        <div class="row-between">
          <span class="badge badge--${st.cls}"><span class="badge__dot"></span>${esc(st.label)}</span>
          <span class="tiny dim">${esc(dateFa(c.createdAt))}</span>
        </div>
        ${kv("مشتری", o ? fullName(o) : "—")}
        ${kv("شماره تماس", o?.phone || "—", true)}
        ${kv("تلگرام", o?.username ? "@" + o.username : String(c.userId), true)}
        ${kv("نوع تبلیغ", TYPES[c.target?.type] || c.target?.type)}
        ${kv("مقصد", c.target?.url || "—", true)}
        ${kv("برند", c.target?.brand || "—")}
        ${c.creative?.text ? kv("متن تبلیغ", c.creative.text) : ""}
        ${c.receipt?.fileId ? `
          <div class="kv">
            <span class="kv__k">رسید پرداخت</span>
            <span class="kv__v">${esc(dateFa(c.receipt.at))}</span>
          </div>
          <img class="poster__img mt-8" alt="رسید پرداخت"
               data-poster="${esc(c.receipt.fileId)}" />
        ` : (c.budget?.priceToman ? `
          <div class="kv"><span class="kv__k">رسید پرداخت</span><span class="kv__v">هنوز نفرستاده</span></div>
        ` : "")}

        ${c.creative?.posterFileId ? `
          <div class="kv"><span class="kv__k">پوستر تبلیغ</span></div>
          <img class="poster__img mt-8" alt="پوستر تبلیغ"
               data-poster="${esc(c.creative.posterFileId)}" />
        ` : ""}
        ${(t.keywords || []).length ? kv("کلیدواژه‌ها", t.keywords.join("، ")) : ""}
        ${(t.channels || []).length ? kv("کانال‌های هدف", t.channels.join(" "), true) : ""}
        ${c.budget?.priceToman ? `
          ${kv("بسته", num(c.budget.packageViews) + " بازدید")}
          ${kv("مبلغ", num(c.budget.priceToman) + " تومان" +
            (c.budget.discountPercent ? " (با " + num(c.budget.discountPercent) + "٪ تخفیف)" : ""))}
        ` : ""}
        ${c.budget?.startDate ? kv("زمان شروع", dateFa(c.budget.startDate)) : ""}
        ${kv("بازدید / کلیک", num(c.stats?.views) + " / " + num(c.stats?.clicks))}
        ${kv("نرخ کلیک", c.stats?.views
          ? num(Number(((c.stats.clicks / c.stats.views) * 100).toFixed(2))) + "٪"
          : "—")}
        ${kv("اعضای جدید کانال", num(c.stats?.joins || 0))}
        ${c.notes ? kv("توضیح مشتری", c.notes) : ""}
        ${c.adminNote ? kv("یادداشت تیم", c.adminNote) : ""}
      </div>

      <div class="section">
        <button class="btn btn--primary btn--block" id="do-edit">${ICON("doc", 17)} ویرایش سفارش</button>
        <div class="help mt-8">
          تغییرات در پنل خود مشتری هم دیده می‌شود و برایش پیام می‌رود.
        </div>
      </div>

      <div class="section">
        <button class="btn btn--primary btn--block" id="do-tgads-auto">${ICON("send", 17)} پر کن (خودکار)</button>
        <div class="help mt-8">
          روی کامپیوتر خودتان «۳-دستیار» را باز کرده باشید (از پوشهٔ <code>tools/tgads</code>)،
          فرم Telegram Ads را خودش پر می‌کند — همه‌چیز جز بودجه، CPM و دکمهٔ نهایی.
        </div>
        <div id="tgads-result"></div>
      </div>

      <div class="section">
        <button class="btn btn--outline btn--block" id="do-tgads">${ICON("copy", 17)} کپی برای تلگرام ادز</button>
        <div class="help mt-8">
          اگر دستیار در دسترس نبود، این سفارش را به شکلی کپی می‌کند که خودتان با
          <code>node fill.mjs order.json</code> پرش کنید.
        </div>
      </div>

      <div class="section">
        <button class="btn btn--danger btn--block" id="do-delete">${ICON("trash", 17)} حذف سفارش</button>
        <div class="help mt-8">
          این سفارش کامل و برای همیشه پاک می‌شود — برگشت‌ناپذیر است. فقط برای
          سفارش‌های تستی یا اشتباهی استفاده کنید.
        </div>
      </div>`;
  }

  /* سفارش را به همان شکلی درمی‌آورد که پرکنندهٔ فرم تلگرام ادز می‌خواهد.
     بودجه و CPM عمداً نمی‌آیند: واحد پنل تلگرام Gram است نه دلار، و نرخ
     تبدیل را ما نباید حدس بزنیم — کارشناس خودش عدد را می‌گذارد. */
  function tgAdsPayload(c) {
    const t = c.targeting || {};
    return {
      id: c.id,
      type: c.target?.type || "channel",
      adTitle: c.adTitle || "",
      text: c.creative?.text || "",
      hasPoster: Boolean(c.creative?.posterFileId),
      channels: t.channels || [],
      keywords: t.keywords || [],
      url: c.target?.url || "",
      cpmGram: null,
      dailyViewsLimit: null
    };
  }

  /* پوستر پشت احراز هویت است؛ برای فرستادن به دستیار محلی، به شکل
     data URL (base64) درمی‌آوریمش — همان‌طور که loadPosters برای
     نمایشش می‌کند، فقط این‌بار به‌جای <img>، برای آپلود در فرم تلگرام. */
  async function posterAsDataUrl(fileId) {
    const res = await request("/api/admin/poster?id=" + encodeURIComponent(fileId));
    if (!res.ok) throw new Error("پوستر گرفته نشد.");
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("پوستر خوانده نشد."));
      reader.readAsDataURL(blob);
    });
  }

  /* دستیار محلی (tools/tgads/agent.mjs) را صدا می‌زند تا فرم Telegram
     Ads را خودش پر کند. اول با /ping چک می‌کند دستیار باز است یا نه —
     تا خطای نامفهوم مرورگر («ارتباط برقرار نشد») را نبینید. */
  async function runTgAdsAgent(c) {
    const btn = $("#do-tgads-auto");
    if (!btn) return;
    const original = btn.textContent;
    const setLabel = (t) => { btn.textContent = t; };
    btn.disabled = true;

    try {
      setLabel("در حال بررسی دستیار…");
      const ping = await fetch(AGENT_URL + "/ping").catch(() => null);
      if (!ping || !ping.ok) {
        toast("دستیار باز نیست — اول «۳-دستیار» را روی کامپیوترتان اجرا کنید.", "err");
        return;
      }

      const payload = tgAdsPayload(c);
      let posterDataUrl = null;
      if (payload.hasPoster && c.creative?.posterFileId) {
        setLabel("در حال گرفتن پوستر…");
        try { posterDataUrl = await posterAsDataUrl(c.creative.posterFileId); }
        catch { toast("پوستر گرفته نشد؛ بدون آن ادامه می‌دهم.", "err"); }
      }

      setLabel("در حال پر کردن فرم…");
      const res = await fetch(AGENT_URL + "/fill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: payload, posterDataUrl })
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || data.ok === false) {
        toast(data.error || "دستیار نتوانست فرم را پر کند.", "err");
        showTgAdsLog(data.log);
        return;
      }

      toast(
        `فرم پر شد — ${num(data.filled)} مورد پر شد، ${num(data.failed)} مورد را خودتان چک کنید. ` +
        `مرورگر تلگرام ادز را نگاه کنید.`,
        data.failed ? "err" : "ok"
      );
      showTgAdsLog(data.log);
    } catch (err) {
      toast("ارتباط با دستیار برقرار نشد — باز است؟", "err");
    } finally {
      btn.disabled = false;
      setLabel(original);
    }
  }

  /* ریز اتفاقات هر فیلد (پر شد/دست‌نخورد/مشکل) رو زیر دکمه نگه می‌داریم —
     برخلاف toast که چند ثانیه دیگه محو می‌شه، این می‌مونه تا خودتان چک کنید. */
  function showTgAdsLog(lines) {
    const el = $("#tgads-result");
    if (!el) return;
    if (!Array.isArray(lines) || !lines.length) { el.innerHTML = ""; return; }
    el.innerHTML = `
      <div class="card card--pad-sm mt-8 tiny" style="white-space:pre-wrap; max-height:220px; overflow:auto">
        ${lines.map((l) => esc(l)).join("\n")}
      </div>`;
  }

  function editForm(c, e) {
    const field = (id, label, value, extra = "") => `
      <div class="field">
        <div class="label"><span>${esc(label)}</span></div>
        <input class="input" id="${id}" value="${esc(value)}" ${extra} />
      </div>`;

    return `
      <div class="notice notice--soft">${ICON("alert", 16)}
        <span>هر تغییری اینجا، بلافاصله در پنل خود مشتری هم دیده می‌شود
        و یک پیام برایش فرستاده می‌شود.</span>
      </div>

      ${field("f-title", "عنوان تبلیغ", e.adTitle)}
      ${field("f-brand", "برند", e.brand)}
      ${field("f-url", "مقصد", e.url, 'dir="ltr"')}

      <div class="field">
        <div class="label"><span>متن تبلیغ</span></div>
        <textarea class="textarea" id="f-text">${esc(e.text)}</textarea>
      </div>

      <div class="field">
        <div class="label"><span>کانال‌های هدف</span><span class="label__hint">هر کدام در یک خط</span></div>
        <textarea class="textarea" id="f-channels" dir="ltr">${esc(e.channels)}</textarea>
      </div>

      <div class="field">
        <div class="label"><span>کلیدواژه‌ها</span><span class="label__hint">هر کدام در یک خط</span></div>
        <textarea class="textarea" id="f-keywords">${esc(e.keywords)}</textarea>
      </div>

      <div class="field">
        <div class="label"><span>وضعیت</span></div>
        <div class="chips">
          ${Object.entries(STATUS).map(([k, v]) => `
            <button class="chip ${e.status === k ? "is-on" : ""}" data-status="${k}">${v.label}</button>`).join("")}
        </div>
      </div>

      ${field("f-views", "بازدید (از پنل تلگرام ادز)", e.views, 'inputmode="numeric" dir="ltr"')}
      ${field("f-clicks", "کلیک (از پنل تلگرام ادز)", e.clicks, 'inputmode="numeric" dir="ltr"')}
      <div class="field">
        <div class="label"><span>نرخ کلیک</span><span class="label__hint">خودکار محاسبه می‌شود</span></div>
        <div class="input dim" id="f-ctr">${ctrText(e.views, e.clicks)}</div>
      </div>
      ${field("f-joins", "اعضای جدید کانال", e.joins, 'inputmode="numeric" dir="ltr"')}

      <div class="field">
        <div class="label"><span>یادداشت تیم</span><span class="label__hint">مشتری هم می‌بیند</span></div>
        <textarea class="textarea" id="f-note">${esc(e.adminNote)}</textarea>
      </div>

      <div class="section">
        <button class="btn btn--primary btn--block" id="save">ذخیرهٔ تغییرات</button>
        <button class="btn btn--ghost btn--block mt-8" id="cancel">انصراف</button>
      </div>`;
  }

  function bindEdit(c) {
    const e = S.edit;
    const on = (id, key) => {
      const el = $("#" + id);
      if (el) el.addEventListener("input", (ev) => { e[key] = ev.target.value; });
    };
    on("f-title", "adTitle"); on("f-brand", "brand"); on("f-url", "url");
    on("f-text", "text"); on("f-channels", "channels"); on("f-keywords", "keywords");
    on("f-note", "adminNote"); on("f-joins", "joins");

    /* بازدید/کلیک علاوه بر ذخیره‌شدن، نرخ کلیک را هم زنده به‌روز می‌کنند */
    const updateCtr = () => {
      const el = $("#f-ctr");
      if (el) el.textContent = ctrText(e.views, e.clicks);
    };
    on("f-views", "views"); on("f-clicks", "clicks");
    $("#f-views")?.addEventListener("input", updateCtr);
    $("#f-clicks")?.addEventListener("input", updateCtr);

    elScreen.querySelectorAll("[data-status]").forEach((b) => {
      b.onclick = () => {
        e.status = b.dataset.status;
        elScreen.querySelectorAll("[data-status]").forEach((x) => x.classList.toggle("is-on", x === b));
      };
    });

    $("#cancel").onclick = () => { S.edit = null; renderDetail(); };
    $("#save").onclick = async (ev) => {
      const btn = ev.currentTarget;
      btn.disabled = true;
      btn.textContent = "در حال ذخیره…";
      try {
        const lines = (v) => String(v || "").split(/[\n,،]+/).map((x) => x.trim()).filter(Boolean);
        await api("/api/admin/campaign/" + encodeURIComponent(c.id), {
          method: "POST",
          body: JSON.stringify({
            adTitle: e.adTitle,
            brand: e.brand,
            url: e.url,
            text: e.text,
            channels: lines(e.channels),
            keywords: lines(e.keywords),
            status: e.status,
            adminNote: e.adminNote
          })
        });

        /* آمار عملکرد از راه یک درخواست جدا ثبت می‌شود چون DB جدا آپدیت
           می‌شود؛ نتیجهٔ همین درخواست را برای رندر بعدی نگه می‌داریم */
        const statsData = await api("/api/admin/campaign/" + encodeURIComponent(c.id) + "/stats", {
          method: "POST",
          body: JSON.stringify({
            views: Number(e.views) || 0,
            clicks: Number(e.clicks) || 0,
            joins: Number(e.joins) || 0
          })
        });

        const i = S.orders.findIndex((x) => x.id === c.id);
        if (i !== -1) S.orders[i] = statsData.campaign;
        S.edit = null;
        toast("تغییرات ذخیره شد و به مشتری اطلاع داده شد.", "ok");
        renderDetail();
      } catch (err) {
        toast(err.message || "ذخیره نشد.", "err");
        btn.disabled = false;
        btn.textContent = "ذخیرهٔ تغییرات";
      }
    };
  }

  /* ---------- جزئیات و ویرایش مشتری ---------- */
  function renderUser() {
    const u = S.users.find((x) => Number(x.id) === Number(S.openUser));
    if (!u) { S.openUser = null; render(); return; }

    const mine = S.orders.filter((c) => Number(c.userId) === Number(u.id));
    const e = S.userEdit;

    elBar.className = "appbar has-border";
    elBar.innerHTML = `
      <button class="iconbtn" id="uback">${ICON("back")}</button>
      <div class="appbar__title">${esc(fullName(u))}
        <span class="appbar__sub">${num(mine.length)} سفارش</span>
      </div>`;
    elTabs.innerHTML = "";

    elScreen.innerHTML = e ? `
      <div class="field">
        <div class="label"><span>نام</span></div>
        <input class="input" id="u-first" value="${esc(e.firstName)}" />
      </div>
      <div class="field">
        <div class="label"><span>نام خانوادگی</span></div>
        <input class="input" id="u-last" value="${esc(e.lastName)}" />
      </div>
      <div class="field">
        <div class="label"><span>شمارهٔ تماس</span></div>
        <input class="input" id="u-phone" dir="ltr" inputmode="tel" value="${esc(e.phone)}" />
      </div>
      <div class="section">
        <button class="btn btn--primary btn--block" id="u-save">ذخیرهٔ تغییرات</button>
        <button class="btn btn--ghost btn--block mt-8" id="u-cancel">انصراف</button>
      </div>` : `
      <div class="card">
        ${kv("نام", fullName(u))}
        ${kv("شمارهٔ تماس", u.phone || "—", true)}
        ${kv("ایمیل", u.email || "—", true)}
        ${kv("تلگرام", u.username ? "@" + u.username : "—", true)}
        ${kv("شناسهٔ عددی", u.id, true)}
        ${kv("تاریخ ثبت‌نام", dateFa(u.registeredAt))}
        ${kv("آخرین بازدید", dateFa(u.lastSeenAt))}
      </div>

      <div class="section">
        <button class="btn btn--primary btn--block" id="u-edit">${ICON("doc", 17)} ویرایش مشخصات</button>
      </div>

      <div class="section">
        <button class="btn btn--danger btn--block" id="u-delete" ${mine.length ? "disabled" : ""}>
          ${ICON("trash", 17)} حذف مشتری
        </button>
        <div class="help mt-8">
          ${mine.length
            ? `این مشتری ${num(mine.length)} سفارش دارد؛ اول باید سفارش‌هایش حذف شوند.`
            : "این مشتری هیچ سفارشی ندارد و برای همیشه قابل حذف است."}
        </div>
      </div>

      <div class="section">
        <div class="section__head"><h2 class="section__title">سفارش‌های این مشتری</h2></div>
        ${mine.length ? mine.map((c) => {
          const st = STATUS[c.status] || STATUS.pending;
          return `<button class="card card--pad-sm mt-8" data-open="${esc(c.id)}"
                          style="display:block;width:100%;text-align:right">
            <div class="row-between">
              <span class="service__t">${esc(c.adTitle || c.target?.brand || "بدون عنوان")}</span>
              <span class="badge badge--${st.cls}">${esc(st.label)}</span>
            </div>
          </button>`;
        }).join("") : `<div class="card center"><div class="empty__d">هنوز سفارشی ثبت نکرده.</div></div>`}
      </div>`;

    $("#uback").onclick = () => {
      if (S.userEdit) { S.userEdit = null; renderUser(); return; }
      S.openUser = null; render();
    };

    if (e) {
      const on = (id, key) => {
        const el = $("#" + id);
        if (el) el.addEventListener("input", (ev) => { e[key] = ev.target.value; });
      };
      on("u-first", "firstName"); on("u-last", "lastName"); on("u-phone", "phone");
      $("#u-cancel").onclick = () => { S.userEdit = null; renderUser(); };
      $("#u-save").onclick = async (ev) => {
        const btn = ev.currentTarget;
        btn.disabled = true; btn.textContent = "در حال ذخیره…";
        try {
          const data = await api("/api/admin/user/" + encodeURIComponent(u.id), {
            method: "POST",
            body: JSON.stringify({ firstName: e.firstName, lastName: e.lastName, phone: e.phone })
          });
          const i = S.users.findIndex((x) => Number(x.id) === Number(u.id));
          if (i !== -1) S.users[i] = { ...S.users[i], ...data.user };
          S.userEdit = null;
          toast("مشخصات مشتری ذخیره شد.", "ok");
          renderUser();
        } catch (err) {
          toast(err.message || "ذخیره نشد.", "err");
          btn.disabled = false; btn.textContent = "ذخیرهٔ تغییرات";
        }
      };
    } else {
      $("#u-edit").onclick = () => {
        S.userEdit = { firstName: u.firstName, lastName: u.lastName, phone: u.phone };
        renderUser();
      };

      const delBtn = $("#u-delete");
      if (delBtn && !delBtn.disabled) {
        delBtn.onclick = async () => {
          if (!confirm(`${fullName(u)} برای همیشه پاک شود؟ این کار برگشت‌ناپذیر است.`)) return;
          try {
            await api("/api/admin/user/" + encodeURIComponent(u.id), { method: "DELETE" });
            S.users = S.users.filter((x) => Number(x.id) !== Number(u.id));
            S.openUser = null;
            toast("مشتری حذف شد.", "ok");
            render();
          } catch (err) {
            toast(err.message || "حذف ممکن نشد.", "err");
          }
        };
      }
    }
  }

  /* ---------- رویدادها ---------- */
  document.addEventListener("click", async (ev) => {
    const tab = ev.target.closest("[data-tab]");
    if (tab) { S.tab = tab.dataset.tab; S.q = ""; render(); return; }

    const userBtn = ev.target.closest("[data-user]");
    if (userBtn) { S.openUser = userBtn.dataset.user; S.userEdit = null; renderUser(); return; }

    const open = ev.target.closest("[data-open]");
    if (open) { S.open = open.dataset.open; S.edit = null; renderDetail(); return; }

    if (ev.target.closest("#logout")) { logout(); return; }
    if (ev.target.closest("#reload")) { S.ready = false; render(); load(); return; }

    const exp = ev.target.closest("#export");
    if (exp) {
      exp.disabled = true;
      const before = exp.innerHTML;
      exp.textContent = "در حال آماده‌سازی…";
      try {
        const res = await request("/api/admin/export", { method: "POST", body: "{}" });

        /* در پنل وب، سرور خود فایل را می‌دهد؛ در تلگرام، فایل را برای
           مدیر می‌فرستد و اینجا فقط یک پیام JSON برمی‌گردد. */
        const kind = res.headers.get("content-type") || "";
        if (res.ok && kind.includes("text/csv")) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `lika-orders-${new Date().toISOString().slice(0, 10)}.csv`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 10000);
          toast("فایل دانلود شد.", "ok");
        } else {
          const data = await res.json().catch(() => ({}));
          if (!res.ok || data.ok === false) throw new Error(data.error || "گرفتن فایل ممکن نشد.");
          toast(`فایل در تلگرام برایتان فرستاده شد (${num(data.orders)} سفارش).`, "ok");
        }
      } catch (e) {
        toast(e.message || "گرفتن فایل ممکن نشد.", "err");
      }
      exp.disabled = false;
      exp.innerHTML = before;
    }
  });

  /* ---------- شروع ---------- */
  try {
    const tg = window.Telegram?.WebApp;
    if (tg) { tg.ready(); tg.expand(); }
  } catch {}

  render();
  load();

  // برای تست‌های خودکار
  window.CRM = S;
})();
