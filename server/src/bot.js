/* =========================================================
   منطق ربات تلگرام
   ---------------------------------------------------------
   پیام‌ها و دکمه‌هایی که کاربر یا تیم Lika در چت می‌فرستد
   اینجا پردازش می‌شود.
   ========================================================= */

import { config, isAdmin } from "./config.js";
import { sendMessage, answerCallback, editMessageText, webAppButton, mainKeyboard, MENU, esc } from "./telegram.js";
import { upsertUser, listCampaignsByUser, setCampaignStatus, getCampaignByCode, getUser } from "./db.js";
import { welcomeMessage, helpMessage, ordersListMessage, customerStatusMessage, adminOrderMessage, adminKeyboard } from "./format.js";
import { STATUS_LABELS, STATUS_LIST } from "./labels.js";

/* ---------- پیام‌های خصوصی ---------- */
async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();
  const from = msg.from;

  // فقط چت خصوصی؛ در گروه‌ها فقط دستور /id پاسخ می‌گیرد
  if (msg.chat.type !== "private") {
    if (/^\/id(@\w+)?$/.test(text)) {
      await sendMessage(chatId, `شناسهٔ این گروه:\n<code>${chatId}</code>`);
    }
    return;
  }

  if (from) upsertUser(from);

  if (/^\/start\b/.test(text)) {
    const name = from?.first_name || "دوست عزیز";
    await sendMessage(chatId, welcomeMessage(name), { reply_markup: mainKeyboard() });
    return;
  }

  if (/^\/help\b/.test(text) || text === MENU.support) {
    await sendMessage(chatId, helpMessage(""), { reply_markup: webAppButton() });
    return;
  }

  if (/^\/id\b/.test(text)) {
    await sendMessage(
      chatId,
      [
        `شناسهٔ عددی شما: <code>${from.id}</code>`,
        `شناسهٔ این چت: <code>${chatId}</code>`,
        "",
        "این عدد را در فایل .env مقابل ADMIN_CHAT_ID و ADMIN_IDS بگذارید."
      ].join("\n")
    );
    return;
  }

  if (/^\/orders\b/.test(text) || text === MENU.orders) {
    const list = listCampaignsByUser(from.id, 20);
    await sendMessage(chatId, ordersListMessage(list), { reply_markup: webAppButton("مشاهده در پنل") });
    return;
  }

  // هر پیام دیگری
  await sendMessage(
    chatId,
    "برای ثبت سفارش تبلیغ، پنل تبلیغات را باز کنید.\nراهنما: /help",
    { reply_markup: mainKeyboard() }
  );
}

/* ---------- دکمه‌های تغییر وضعیت (فقط برای تیم Lika) ---------- */
async function handleCallback(query) {
  const data = query.data || "";
  const fromId = query.from?.id;

  if (!data.startsWith("st|")) {
    await answerCallback(query.id);
    return;
  }

  if (!isAdmin(fromId)) {
    await answerCallback(query.id, "شما اجازهٔ تغییر وضعیت را ندارید.", true);
    return;
  }

  const [, code, status] = data.split("|");

  if (!STATUS_LIST.includes(status)) {
    await answerCallback(query.id, "وضعیت نامعتبر است.", true);
    return;
  }

  const before = getCampaignByCode(code);
  if (!before) {
    await answerCallback(query.id, "این کمپین پیدا نشد.", true);
    return;
  }

  if (before.status === status) {
    await answerCallback(query.id, `وضعیت از قبل «${STATUS_LABELS[status]}» است.`);
    return;
  }

  const actorName = [query.from?.first_name, query.from?.last_name].filter(Boolean).join(" ") || String(fromId);
  const campaign = setCampaignStatus(code, status, actorName);

  await answerCallback(query.id, `وضعیت به «${STATUS_LABELS[status]}» تغییر کرد.`);

  // به‌روزرسانی همان پیام در چت تیم
  const owner = getUser(campaign.userId) || { id: campaign.userId };
  const footer = `\n\n<i>آخرین تغییر توسط ${esc(actorName)}</i>`;
  await editMessageText(
    query.message.chat.id,
    query.message.message_id,
    adminOrderMessage(campaign, owner) + footer,
    { reply_markup: adminKeyboard(code) }
  );

  // اطلاع به مشتری
  await sendMessage(campaign.userId, customerStatusMessage(campaign), {
    reply_markup: webAppButton("مشاهده در پنل")
  });
}

/* ---------- ورودی اصلی ---------- */
export async function handleUpdate(update) {
  try {
    if (update.message) await handleMessage(update.message);
    else if (update.callback_query) await handleCallback(update.callback_query);
  } catch (err) {
    console.error("[bot] خطا در پردازش پیام:", err);
  }
}

/* ---------- اعلان سفارش جدید به تیم ---------- */
export async function notifyNewOrder(campaign, user) {
  if (!config.adminChatId) {
    console.warn("[bot] ADMIN_CHAT_ID تنظیم نشده؛ سفارش جدید برای کسی ارسال نشد.");
    return;
  }
  await sendMessage(config.adminChatId, adminOrderMessage(campaign, user), {
    reply_markup: adminKeyboard(campaign.id)
  });
}

/* ---------- تأیید ثبت سفارش برای مشتری ---------- */
export async function notifyOrderReceived(campaign) {
  await sendMessage(
    campaign.userId,
    [
      `سفارش شما با کد <code>${esc(campaign.id)}</code> ثبت شد ✅`,
      "",
      `برند: <b>${esc(campaign.target.brand)}</b>`,
      `بودجه: ${campaign.budget.amountUsd} دلار`,
      "",
      "کارشناسان ما درخواست شما را بررسی می‌کنند و نتیجه را از همین‌جا به شما اطلاع می‌دهند."
    ].join("\n"),
    { reply_markup: webAppButton("مشاهده در پنل") }
  );
}

/* =========================================================
   دریافت پیام‌ها به روش long polling
   ========================================================= */
export function startPolling() {
  let offset = 0;
  let stopped = false;

  async function loop() {
    while (!stopped) {
      try {
        const res = await fetch(
          `${config.botApiBase}/bot${config.botToken}/getUpdates`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              offset,
              timeout: 30,
              allowed_updates: ["message", "callback_query"]
            })
          }
        );

        const data = await res.json();
        if (!data.ok) throw new Error(data.description || "getUpdates failed");

        for (const update of data.result) {
          offset = update.update_id + 1;
          await handleUpdate(update);
        }
      } catch (err) {
        console.error("[polling]", err.message);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  loop();
  return () => { stopped = true; };
}
