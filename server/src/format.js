/* =========================================================
   ساخت متن پیام‌های فارسی ربات
   ========================================================= */

import { esc } from "./telegram.js";
import {
  STATUS_LABELS, TARGET_LABELS, START_LABELS, countryName, topicName
} from "./labels.js";

const fa = (n) => {
  try { return Number(n).toLocaleString("fa-IR", { maximumFractionDigits: 2 }); }
  catch { return String(n); }
};

const faDate = (iso) => {
  try {
    return new Date(iso).toLocaleDateString("fa-IR", { year: "numeric", month: "long", day: "numeric" });
  } catch { return ""; }
};

const estViews = (budget, cpm) => (cpm > 0 ? Math.round((budget / cpm) * 1000) : 0);

function userLine(user) {
  const name = esc([user.first_name, user.last_name].filter(Boolean).join(" ") || "بدون نام");
  const handle = user.username ? ` (@${esc(user.username)})` : "";
  return `${name}${handle} — <code>${user.id}</code>`;
}

/* ---------- پیامی که برای تیم Lika ارسال می‌شود ---------- */
export function adminOrderMessage(campaign, user) {
  const t = campaign.targeting;
  const lines = [
    `<b>سفارش جدید</b> — <code>${esc(campaign.id)}</code>`,
    "",
    `<b>مشتری:</b> ${userLine(user)}`,
    `<b>برند:</b> ${esc(campaign.target.brand)}`,
    `<b>مقصد:</b> ${esc(TARGET_LABELS[campaign.target.type])} — <code>${esc(campaign.target.url)}</code>`,
    ...(campaign.target.channelTitle
      ? [`<b>نام مقصد در تلگرام:</b> ${esc(campaign.target.channelTitle)}`]
      : []),
    "",
    `<b>متن تبلیغ:</b>`,
    `<blockquote>${esc(campaign.creative.text)}</blockquote>`,
    "",
    `<b>کشورها:</b> ${esc(t.countries.map(countryName).join("، ") || "—")}`,
    `<b>زبان‌ها:</b> ${esc(t.languages.join("، ") || "همه")}`,
    `<b>موضوعات:</b> ${esc(t.topics.map(topicName).join("، ") || "—")}`
  ];

  if (t.channels.length) {
    lines.push(`<b>کانال‌های خاص:</b> <code>${esc(t.channels.join(" "))}</code>`);
  }

  lines.push(
    "",
    `<b>بودجه:</b> ${fa(campaign.budget.amountUsd)} دلار`,
    `<b>CPM:</b> ${fa(campaign.budget.cpmUsd)} دلار`,
    `<b>بازدید تخمینی:</b> ${fa(estViews(campaign.budget.amountUsd, campaign.budget.cpmUsd))}`,
    `<b>زمان شروع:</b> ${esc(START_LABELS[campaign.budget.startWhen] || "—")}`
  );

  if (campaign.notes) {
    lines.push("", `<b>توضیح مشتری:</b>`, `<blockquote>${esc(campaign.notes)}</blockquote>`);
  }

  lines.push("", `<b>وضعیت فعلی:</b> ${esc(STATUS_LABELS[campaign.status])}`);

  return lines.join("\n");
}

/* ---------- دکمه‌های تغییر وضعیت برای تیم ---------- */
export function adminKeyboard(code) {
  const btn = (label, status) => ({ text: label, callback_data: `st|${code}|${status}` });
  return {
    inline_keyboard: [
      [btn("در حال بررسی", "review"), btn("تأیید شده", "approved")],
      [btn("شروع اجرا", "running"), btn("نیاز به اصلاح", "rejected")],
      [btn("پایان‌یافته", "done")]
    ]
  };
}

/* ---------- اطلاع‌رسانی تغییر وضعیت به مشتری ---------- */
export function customerStatusMessage(campaign) {
  const head = `کمپین <code>${esc(campaign.id)}</code> — <b>${esc(campaign.target.brand)}</b>`;
  const status = `وضعیت جدید: <b>${esc(STATUS_LABELS[campaign.status])}</b>`;

  const notes = {
    review: "کارشناس ما در حال بررسی کمپین شماست. به‌زودی نتیجه را اعلام می‌کنیم.",
    approved: "کمپین شما تأیید شد. برای هماهنگی تسویه با شما تماس می‌گیریم.",
    running: "کمپین شما شروع شد و در حال نمایش به مخاطبان است.",
    done: "اجرای کمپین به پایان رسید. گزارش عملکرد در پنل قابل مشاهده است.",
    rejected: "کمپین شما نیاز به اصلاح دارد. کارشناس ما برای راهنمایی با شما تماس می‌گیرد.",
    pending: "سفارش شما ثبت شد و در نوبت بررسی است."
  };

  return [head, "", status, "", notes[campaign.status] || ""].join("\n").trim();
}

/* ---------- لیست سفارش‌های مشتری (دستور /orders) ---------- */
export function ordersListMessage(campaigns) {
  if (campaigns.length === 0) {
    return "شما هنوز سفارشی ثبت نکرده‌اید.\n\nبرای شروع، پنل تبلیغات را باز کنید.";
  }

  const rows = campaigns.slice(0, 10).map((c) => {
    return [
      `<code>${esc(c.id)}</code> — <b>${esc(c.target.brand)}</b>`,
      `${esc(STATUS_LABELS[c.status])} • ${fa(c.budget.amountUsd)} دلار • ${faDate(c.createdAt)}`
    ].join("\n");
  });

  return [`<b>سفارش‌های شما</b> (${fa(campaigns.length)} مورد)`, "", rows.join("\n\n")].join("\n");
}

/* ---------- کد تأیید شماره ---------- */
export function verificationCodeMessage(code) {
  return [
    "کد تأیید شمارهٔ شما:",
    "",
    `<code>${esc(code)}</code>`,
    "",
    "این کد تا ۲ دقیقه معتبر است.",
    "اگر شما درخواست نداده‌اید، این پیام را نادیده بگیرید."
  ].join("\n");
}

/* ---------- اطلاع «کاربر جدید» به تیم ---------- */
export function newLeadMessage(profile, user) {
  const lines = [
    "<b>کاربر جدید ثبت‌نام کرد</b>",
    "",
    `<b>نام:</b> ${esc(profile.firstName)} ${esc(profile.lastName)}`,
    `<b>شماره:</b> <code>${esc(profile.phone)}</code>`,
    `<b>تلگرام:</b> ${userLine(user)}`,
    "",
    `<b>زمان:</b> ${faDate(new Date().toISOString())}`
  ];
  return lines.join("\n");
}

/* ---------- پیام خوش‌آمد ---------- */
export function welcomeMessage(name, brandName = "Lika Ads") {
  return [
    `سلام ${esc(name)}! به <b>${esc(brandName)}</b> خوش آمدید.`,
    "",
    "ثبت سفارش تبلیغ، انتخاب مخاطب هدف، پیگیری وضعیت کمپین و آمار عملکرد —",
    "همه‌چیز داخل پنل اختصاصی شماست.",
    "",
    "برای هر کاری، از دکمه‌های پایین صفحه استفاده کنید."
  ].join("\n");
}

export function helpMessage(supportUsername) {
  return [
    "<b>راهنما</b>",
    "",
    "/start — باز کردن پنل تبلیغات",
    "/orders — مشاهدهٔ سفارش‌های شما",
    "/id — نمایش شناسهٔ عددی این چت",
    "/help — همین راهنما",
    "",
    supportUsername ? `برای گفت‌وگو با کارشناس: @${esc(supportUsername)}` : ""
  ].join("\n").trim();
}
