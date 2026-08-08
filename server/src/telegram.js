/* =========================================================
   ارتباط با API تلگرام
   ---------------------------------------------------------
   بدون کتابخانهٔ بیرونی؛ با fetch داخلی Node.js.
   ========================================================= */

import { config } from "./config.js";

const api = (method) => `${config.botApiBase}/bot${config.botToken}/${method}`;

/** فراخوانی یک متد از API تلگرام */
export async function call(method, payload = {}, { timeoutMs = 60000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(api(method), {
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

/**
 * صفحه‌کلید همیشگی زیر کادر تایپ.
 * این همان «گزینه‌های» بزرگی است که کاربر همیشه جلوی چشمش دارد.
 */
export const MENU = {
  panel: "ورود به پنل تبلیغات",
  orders: "سفارش‌های من",
  support: "پشتیبانی"
};

export function mainKeyboard() {
  return {
    keyboard: [
      [{ text: MENU.panel, web_app: { url: config.webappUrl } }],
      [{ text: MENU.orders }, { text: MENU.support }]
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
