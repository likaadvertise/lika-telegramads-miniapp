/* =========================================================
   ارتباط با API تلگرام
   ---------------------------------------------------------
   بدون کتابخانهٔ بیرونی؛ با fetch داخلی Node.js.
   ========================================================= */

import { config } from "./config.js";

/* `bot` مشخص می‌کند پیام از کدام ربات برود: "main" (پیش‌فرض) یا "crm".
   پنل مدیریت روی ربات دوم باز می‌شود، پس فایل خروجی هم باید از همان
   ربات بیاید — وگرنه در چتی می‌افتد که مدیر بازش نکرده است. */
const tokenOf = (bot) => (bot === "crm" && config.crmBotToken ? config.crmBotToken : config.botToken);
const api = (method, bot) => `${config.botApiBase}/bot${tokenOf(bot)}/${method}`;

/** فراخوانی یک متد از API تلگرام */
export async function call(method, payload = {}, { timeoutMs = 60000, bot } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(api(method, bot), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });

    const data = await res.json().catch(() => ({}));

    if (!data.ok) {
      const desc = data.description || `HTTP ${res.status}`;
      throw new Error(`Telegram API «${method}» failed: ${desc}`);
    }
    return data.result;
  } finally {
    clearTimeout(timer);
  }
}

/** مثل call ولی به‌جای پرتاب خطا، فقط لاگ می‌کند (برای اعلان‌های غیرحیاتی) */
export async function tryCall(method, payload) {
  try {
    return await call(method, payload);
  } catch (err) {
    console.error("[telegram]", err.message);
    return null;
  }
}

/** فرار دادن کاراکترهای خاص برای حالت HTML تلگرام */
export function esc(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function sendMessage(chatId, text, extra = {}) {
  return tryCall("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...extra
  });
}

/** مثل sendMessage ولی اگر نرسید، خطا می‌دهد (برای کد تأیید لازم است) */
export function sendMessageStrict(chatId, text, extra = {}) {
  return call("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...extra
  });
}

export function answerCallback(id, text = "", showAlert = false) {
  return tryCall("answerCallbackQuery", { callback_query_id: id, text, show_alert: showAlert });
}

export function editMessageText(chatId, messageId, text, extra = {}) {
  return tryCall("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...extra
  });
}

/** دکمه‌ای که زیر یک پیام می‌آید و مینی‌اپ را باز می‌کند */
export function webAppButton(text = "باز کردن پنل تبلیغات") {
  return { inline_keyboard: [[{ text, web_app: { url: config.webappUrl } }]] };
}

/** دکمه‌ای که زیر یک پیام می‌آید و یک آدرس (چت پشتیبانی، کانال و…) را باز می‌کند */
export function urlButton(text, url) {
  return { inline_keyboard: [[{ text, url }]] };
}

/* آیدی عمومی پشتیبانی و کانال — رمز یا اطلاعات حساس نیستند، همین
   آیدی پشتیبانی همان چیزی است که خود مینی‌اپ هم نشان می‌دهد */
export const SUPPORT_USERNAME = "likaadvertise_crm";
export const CHANNEL_USERNAME = "likaads_channel";

/**
 * صفحه‌کلید همیشگی زیر کادر تایپ.
 * این همان «گزینه‌های» بزرگی است که کاربر همیشه جلوی چشمش دارد.
 */
export const MENU = {
  panel: "ورود به پنل تبلیغات",
  orders: "سفارش‌های من",
  support: "ارتباط با پشتیبانی",
  channel: "کانال ما"
};

export function mainKeyboard() {
  return {
    keyboard: [
      [{ text: MENU.panel, web_app: { url: config.webappUrl } }],
      [{ text: MENU.support }, { text: MENU.channel }]
    ],
    resize_keyboard: true,
    is_persistent: true
  };
}

/** تنظیمات اولیهٔ ربات: دستورها و دکمهٔ منو */
export async function setupBot() {
  const me = await call("getMe");

  await tryCall("setMyCommands", {
    commands: [
      { command: "start", description: "شروع و باز کردن پنل تبلیغات" },
      { command: "orders", description: "سفارش‌های من" },
      { command: "help", description: "راهنما و پشتیبانی" },
      { command: "id", description: "نمایش شناسهٔ عددی این چت" }
    ],
    scope: { type: "all_private_chats" }
  });

  // دکمهٔ کنار فیلد تایپ، مستقیم مینی‌اپ را باز می‌کند
  await tryCall("setChatMenuButton", {
    menu_button: {
      type: "web_app",
      text: "پنل تبلیغات",
      web_app: { url: config.webappUrl }
    }
  });

  return me;
}

/**
 * فرستادن یک فایل به چت تلگرام.
 *
 * چرا این و نه دانلود در مرورگر؟ مینی‌اپ داخل مرورگرِ خودِ تلگرام باز
 * می‌شود و آنجا دانلود فایل معمولاً کار نمی‌کند. ولی فایلی که ربات
 * می‌فرستد، مثل هر پیوست دیگری در چت می‌نشیند و با اکسل یا گوگل‌شیت
 * باز می‌شود.
 */
export async function sendDocument(chatId, filename, content, caption = "", bot) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", caption);
  form.append("document", new Blob([content], { type: "text/csv" }), filename);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const res = await fetch(api("sendDocument", bot), {
      method: "POST", body: form, signal: ctrl.signal
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      throw new Error(`Telegram API «sendDocument» failed: ${data.description || res.status}`);
    }
    return data.result;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * فرستادن عکس به یک چت.
 * @returns شناسهٔ فایل در تلگرام (file_id) — با همین می‌شود بعداً
 *          دوباره فرستادش یا نشانش داد، بدون اینکه ما جایی ذخیره‌اش کنیم.
 */
export async function sendPhoto(chatId, bytes, caption = "", bot) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  // کپشن متن ساده است، پس parse_mode نمی‌گذاریم — وگرنه یک < در نام
  // برند می‌تواند کل درخواست را رد کند
  if (caption) form.append("caption", caption.slice(0, 1000));
  form.append("photo", new Blob([bytes], { type: "image/jpeg" }), "poster.jpg");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const res = await fetch(api("sendPhoto", bot), {
      method: "POST", body: form, signal: ctrl.signal
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      throw new Error(`Telegram API «sendPhoto» failed: ${data.description || res.status}`);
    }
    /* تلگرام چند اندازه برمی‌گرداند؛ بزرگ‌ترین را نگه می‌داریم */
    const sizes = data.result?.photo || [];
    const biggest = sizes[sizes.length - 1];
    return biggest?.file_id || "";
  } finally {
    clearTimeout(timer);
  }
}
