/* =========================================================
   پل ارتباطی با تلگرام — نسخهٔ محلی
   ---------------------------------------------------------
   چرا این فایل وجود دارد؟

   مینی‌اپ‌های تلگرام معمولاً کتابخانهٔ رسمی را از آدرس
   https://telegram.org/js/telegram-web-app.js می‌گیرند.
   ولی آن دامنه در ایران در دسترس نیست، و مخاطبان ما ایرانی‌اند.
   وقتی آن فایل بارگذاری نشود، اپ نمی‌فهمد داخل تلگرام است و
   به «حالت نمایشی» می‌افتد — یعنی هیچ سفارشی ثبت نمی‌شود.

   خوشبختانه چیزی که واقعاً لازم داریم ساده است: تلگرام هنگام
   باز کردن مینی‌اپ، اطلاعات کاربر را با امضای خودش در انتهای
   آدرس صفحه می‌گذارد (بعد از علامت #). این فایل همان را
   می‌خواند و در اختیار اپ می‌گذارد — بدون هیچ درخواست شبکه‌ای.

   بقیهٔ کارها (باز شدن کامل صفحه، دکمهٔ بازگشت، لرزش، رنگ نوار
   بالا) از راه همان پلی انجام می‌شود که خود تلگرام در اختیار
   صفحه می‌گذارد.

   اگر روزی کتابخانهٔ رسمی در دسترس بود و بارگذاری شده بود،
   این فایل هیچ کاری نمی‌کند و کنار می‌ایستد.
   ========================================================= */

(function () {
  "use strict";

  /* اگر کتابخانهٔ رسمی از قبل هست و امضا را دارد، دست نمی‌زنیم */
  var current = window.Telegram && window.Telegram.WebApp;
  if (current && current.initData) return;

  /* ---------- خواندن پارامترها از آدرس صفحه ---------- */
  function readParams(raw) {
    try {
      return new URLSearchParams(String(raw || "").replace(/^[#?]/, ""));
    } catch (e) {
      return new URLSearchParams();
    }
  }

  var hashParams = readParams(window.location.hash);
  var queryParams = readParams(window.location.search);

  function param(name) {
    return hashParams.get(name) || queryParams.get(name) || "";
  }

  /* امضای تلگرام و همراهانش؛ همان چیزی که سرور باید بررسی کند */
  var launch = {
    initData: param("tgWebAppData"),
    theme: param("tgWebAppThemeParams"),
    version: param("tgWebAppVersion"),
    platform: param("tgWebAppPlatform")
  };

  /*
     چرا نگهش می‌داریم؟

     اپ برای جابه‌جایی بین صفحه‌ها از همین قطعهٔ آدرس استفاده می‌کند
     (‎#/campaigns و مانند آن). یعنی چند لحظه بعد از باز شدن، آدرس از
     ‎#tgWebAppData=... می‌شود ‎#/ و امضای تلگرام از آدرس پاک می‌شود.

     تا وقتی صفحه دوباره بارگذاری نشود مشکلی نیست. ولی اگر کاربر صفحه را
     Reload کند — یا تلگرام خودش صفحه را از نو بسازد — دیگر امضایی در
     آدرس نیست و اپ فکر می‌کند بیرون از تلگرام است و به حالت نمایشی
     می‌افتد، یعنی سفارش‌ها ثبت نمی‌شوند.

     پس همان بار اول یک نسخه برای همین نشست نگه می‌داریم.
  */
  var STORE_KEY = "lika_tg_launch_v1";

  /*
     کجا ذخیره می‌کنیم و چرا localStorage؟

     تلگرام وقتی مینی‌اپ را کوچک می‌کند و دوباره برمی‌گرداند، ممکن است
     پنجره را از نو بسازد. با sessionStorage آن نسخه پاک می‌شد و اپ
     دوباره فکر می‌کرد بیرون از تلگرام است. localStorage باقی می‌ماند.

     ولی برای همیشه هم نگهش نمی‌داریم: امضا با توکن ربات ساخته می‌شود،
     پس اگر توکن عوض شود امضاهای قدیمی دیگر معتبر نیستند. سرور هم
     امضای کهنه‌تر از ۲۴ ساعت را نمی‌پذیرد. شش ساعت حد میانهٔ معقولی است.
  */
  var MAX_SAVED_AGE_MS = 6 * 60 * 60 * 1000;

  function readStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (e) { return null; }
  }

  if (launch.initData) {
    launch.savedAt = Date.now();
    try { localStorage.setItem(STORE_KEY, JSON.stringify(launch)); } catch (e) { /* اهمیتی ندارد */ }
  } else {
    var saved = readStore();
    var fresh = saved && saved.savedAt && (Date.now() - saved.savedAt) < MAX_SAVED_AGE_MS;
    if (saved && saved.initData && fresh) {
      launch = saved;
    } else if (saved) {
      try { localStorage.removeItem(STORE_KEY); } catch (e) { /* اهمیتی ندارد */ }
    }
  }

  var initData = launch.initData || "";

  /* ---------- تبدیل امضا به شیء قابل استفاده ---------- */
  var initDataUnsafe = {};
  if (initData) {
    var fields = readParams(initData);
    fields.forEach(function (value, key) {
      if (key === "user" || key === "receiver" || key === "chat") {
        try { initDataUnsafe[key] = JSON.parse(value); } catch (e) { /* نادیده */ }
      } else {
        initDataUnsafe[key] = value;
      }
    });
  }

  /* ---------- رنگ‌های پوسته ---------- */
  var themeParams = {};
  try { themeParams = JSON.parse(launch.theme || "{}") || {}; } catch (e) {}

  /** آیا این رنگ تیره است؟ (برای تشخیص پوستهٔ روشن یا تیره) */
  function isDark(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
    if (!m) return null;
    var n = parseInt(m[1], 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    // فرمول روشنایی ادراکی
    return (0.299 * r + 0.587 * g + 0.114 * b) < 128;
  }

  var darkByTheme = isDark(themeParams.bg_color);
  var colorScheme =
    darkByTheme === null
      ? (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : (darkByTheme ? "dark" : "light");

  /* =========================================================
     پل پیام‌رسانی با اپ تلگرام
     ---------------------------------------------------------
     تلگرام بسته به سکو یکی از این سه راه را در اختیار می‌گذارد.
     اگر هیچ‌کدام نبود، بی‌سروصدا رد می‌شویم — هیچ‌کدام از این
     کارها حیاتی نیستند و نبودشان اپ را از کار نمی‌اندازد.
     ========================================================= */
  function postEvent(type, data) {
    var payload = data || {};
    try {
      if (window.TelegramWebviewProxy && window.TelegramWebviewProxy.postEvent) {
        window.TelegramWebviewProxy.postEvent(type, JSON.stringify(payload));
        return;
      }
      if (window.external && typeof window.external.notify === "function") {
        window.external.notify(JSON.stringify({ eventType: type, eventData: payload }));
        return;
      }
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(JSON.stringify({ eventType: type, eventData: payload }), "*");
      }
    } catch (e) { /* نبودِ پل، خطا نیست */ }
  }

  /* ---------- دریافت رویداد از تلگرام ---------- */
  var handlers = {};

  function on(type, cb) {
    if (typeof cb !== "function") return;
    (handlers[type] = handlers[type] || []).push(cb);
  }

  function off(type, cb) {
    var list = handlers[type];
    if (!list) return;
    var i = list.indexOf(cb);
    if (i !== -1) list.splice(i, 1);
  }

  function emit(type, data) {
    var list = handlers[type] || [];
    for (var i = 0; i < list.length; i++) {
      try { list[i](data); } catch (e) { /* یک شنونده نباید بقیه را بخواباند */ }
    }
  }

  /* نام‌هایی که تلگرام می‌فرستد، و نامی که اپ‌ها انتظار دارند */
  var EVENT_ALIASES = {
    theme_changed: "themeChanged",
    viewport_changed: "viewportChanged",
    back_button_pressed: "backButtonClicked",
    main_button_pressed: "mainButtonClicked",
    settings_button_pressed: "settingsButtonClicked",
    popup_closed: "popupClosed",
    invoice_closed: "invoiceClosed"
  };

  function receiveEvent(eventType, eventData) {
    var data = eventData;
    if (typeof data === "string") {
      try { data = JSON.parse(data); } catch (e) { /* همان رشته می‌ماند */ }
    }

    if (eventType === "theme_changed" && data && data.theme_params) {
      themeParams = data.theme_params;
      var d = isDark(themeParams.bg_color);
      if (d !== null) webApp.colorScheme = d ? "dark" : "light";
      webApp.themeParams = themeParams;
    }

    if (eventType === "viewport_changed" && data) {
      if (typeof data.height === "number") webApp.viewportHeight = data.height;
      if (typeof data.is_expanded === "boolean") webApp.isExpanded = data.is_expanded;
    }

    emit(eventType, data);
    if (EVENT_ALIASES[eventType]) emit(EVENT_ALIASES[eventType], data);
  }

  /* تلگرام روی اندروید و آی‌اواس این تابع را صدا می‌زند */
  window.Telegram = window.Telegram || {};
  window.Telegram.WebView = window.Telegram.WebView || {};
  window.Telegram.WebView.receiveEvent = receiveEvent;
  window.Telegram.WebView.postEvent = postEvent;

  /* روی نسخهٔ وب و دسکتاپ، رویدادها با postMessage می‌آیند */
  try {
    window.addEventListener("message", function (event) {
      var msg = event.data;
      if (typeof msg !== "string") return;
      try {
        var parsed = JSON.parse(msg);
        if (parsed && parsed.eventType) receiveEvent(parsed.eventType, parsed.eventData);
      } catch (e) { /* پیام مربوط به ما نبود */ }
    });
  } catch (e) {}

  /* ---------- دکمهٔ بازگشت ---------- */
  var backButton = {
    isVisible: false,
    onClick: function (cb) { on("backButtonClicked", cb); return backButton; },
    offClick: function (cb) { off("backButtonClicked", cb); return backButton; },
    show: function () {
      backButton.isVisible = true;
      postEvent("web_app_setup_back_button", { is_visible: true });
      return backButton;
    },
    hide: function () {
      backButton.isVisible = false;
      postEvent("web_app_setup_back_button", { is_visible: false });
      return backButton;
    }
  };

  /* ---------- لرزش ---------- */
  var hapticFeedback = {
    impactOccurred: function (style) {
      postEvent("web_app_trigger_haptic_feedback", { type: "impact", impact_style: style || "light" });
      return hapticFeedback;
    },
    notificationOccurred: function (type) {
      postEvent("web_app_trigger_haptic_feedback", { type: "notification", notification_type: type || "success" });
      return hapticFeedback;
    },
    selectionChanged: function () {
      postEvent("web_app_trigger_haptic_feedback", { type: "selection_change" });
      return hapticFeedback;
    }
  };

  /* ---------- خود شیء WebApp ---------- */
  var webApp = {
    initData: initData,
    initDataUnsafe: initDataUnsafe,
    version: launch.version || "6.0",
    platform: launch.platform || "unknown",
    colorScheme: colorScheme,
    themeParams: themeParams,
    isExpanded: false,
    viewportHeight: window.innerHeight,
    viewportStableHeight: window.innerHeight,

    BackButton: backButton,
    HapticFeedback: hapticFeedback,

    ready: function () { postEvent("web_app_ready"); },
    expand: function () {
      webApp.isExpanded = true;
      postEvent("web_app_expand");
    },
    close: function () { postEvent("web_app_close"); },

    onEvent: on,
    offEvent: off,

    setHeaderColor: function (color) {
      postEvent("web_app_set_header_color", { color: color });
    },
    setBackgroundColor: function (color) {
      postEvent("web_app_set_background_color", { color: color });
    },
    enableClosingConfirmation: function () {
      postEvent("web_app_setup_closing_behavior", { need_confirmation: true });
    },
    disableClosingConfirmation: function () {
      postEvent("web_app_setup_closing_behavior", { need_confirmation: false });
    },
    disableVerticalSwipes: function () {
      postEvent("web_app_setup_swipe_behavior", { allow_vertical_swipe: false });
    },
    enableVerticalSwipes: function () {
      postEvent("web_app_setup_swipe_behavior", { allow_vertical_swipe: true });
    },

    openLink: function (url) {
      postEvent("web_app_open_link", { url: String(url) });
    },
    openTelegramLink: function (url) {
      var path = String(url).replace(/^https:\/\/t\.me/, "");
      postEvent("web_app_open_tg_link", { path_full: path });
    },

    sendData: function (data) {
      postEvent("web_app_data_send", { data: String(data) });
    }
  };

  window.Telegram.WebApp = webApp;
})();
