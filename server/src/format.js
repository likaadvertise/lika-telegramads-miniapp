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

/** مثل نسخهٔ کلاینت — بدون صفرهای اضافه («۱۵ میلیون تومان») */
export function tomanPrice(n) {
  const v = Number(n) || 0;
  if (v >= 1000000) return fa(Math.round((v / 1000000) * 100) / 100) + " میلیون تومان";
  if (v >= 1000) return fa(Math.round((v / 1000) * 10) / 10) + " هزار تومان";
  return fa(v) + " تومان";
}

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
    ...(campaign.adTitle ? [`<b>عنوان تبلیغ:</b> ${esc(campaign.adTitle)}`] : []),
    `<b>برند:</b> ${esc(campaign.target.brand)}`,
    `<b>مقصد:</b> ${esc(TARGET_LABELS[campaign.target.type])} — <code>${esc(campaign.target.url)}</code>`,
    ...(campaign.target.channelTitle
      ? [`<b>نام مقصد در تلگرام:</b> ${esc(campaign.target.channelTitle)}`]
      : []),
    ""
  ];

  /* تبلیغ جستجو در تلگرام متن ندارد؛ به‌جایش کلیدواژه دارد. */
  if (campaign.creative.text) {
    lines.push(`<b>متن تبلیغ:</b>`, `<blockquote>${esc(campaign.creative.text)}</blockquote>`);
  }

  if (t.keywords?.length) {
    lines.push(`<b>کلیدواژه‌های جستجو:</b> <code>${esc(t.keywords.join("، "))}</code>`, "");
  }

  /* کشور/زبان/موضوع فقط در سفارش‌های قدیمی هستند — دیگر پرسیده نمی‌شوند */
  if (t.countries.length) lines.push(`<b>کشورها:</b> ${esc(t.countries.map(countryName).join("، "))}`);
  if (t.languages.length) lines.push(`<b>زبان‌ها:</b> ${esc(t.languages.join("، "))}`);
  if (t.topics.length) lines.push(`<b>موضوعات:</b> ${esc(t.topics.map(topicName).join("، "))}`);

  lines.push(
    t.channels.length
      ? `<b>کانال‌های هدف:</b> <code>${esc(t.channels.join(" "))}</code>`
      : `<b>کانال‌های هدف:</b> مشتری انتخاب نکرده — کارشناس باید بچیند.`
  );

  lines.push(
    "",
    `<b>مبلغ:</b> ${tomanPrice(campaign.budget.priceToman)}`,
    `<b>بازدید بسته:</b> ${fa(campaign.budget.packageViews)}`,
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
      [btn("تأیید شده", "approved"), btn("شروع اجرا", "running")],
      [btn("نیاز به اصلاح", "rejected"), btn("پایان‌یافته", "done")]
    ]
  };
}

/* ---------- اطلاع‌رسانی تغییر وضعیت به مشتری ---------- */
export function customerStatusMessage(campaign) {
  const head = `کمپین <code>${esc(campaign.id)}</code> — <b>${esc(campaign.target.brand)}</b>`;
  const status = `وضعیت جدید: <b>${esc(STATUS_LABELS[campaign.status])}</b>`;

  const notes = {
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
      `${esc(STATUS_LABELS[c.status])} • ${tomanPrice(c.budget.priceToman)} • ${faDate(c.createdAt)}`
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
    `سلام ${esc(name)} 👋`,
    "",
    `به <b>${esc(brandName)}</b> خوش آمدید 🚀`,
    "تبلیغ در تلگرام، از ثبت سفارش تا گزارش عملکرد 📊",
    "",
    "برای شروع، دکمهٔ پایین را بزنید 👇"
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

/* ---------- خروجی اکسل (CSV) ----------
   با BOM شروع می‌شود تا اکسل، فارسی را درست نشان بدهد و حروف
   به‌هم‌ریخته نشوند. */
export function ordersCsv(campaigns, users) {
  const byId = new Map(users.map((u) => [Number(u.id), u]));
  const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

  const head = [
    "کد سفارش", "عنوان تبلیغ", "وضعیت", "نام مشتری", "شماره تماس", "ایمیل", "آیدی تلگرام",
    "برند", "نوع", "مقصد", "مبلغ (تومان)", "بازدید بسته", "عکس کانال",
    "متن تبلیغ", "کلیدواژه‌ها", "کانال‌های هدف", "بازدید", "کلیک", "اعضای جدید", "تاریخ ثبت"
  ];

  const rows = campaigns.map((c) => {
    const o = byId.get(Number(c.userId));
    const t = c.targeting || {};
    return [
      c.id,
      c.adTitle,
      STATUS_LABELS[c.status] || c.status,
      [o?.firstName, o?.lastName].filter(Boolean).join(" "),
      o?.phone,
      o?.email,
      o?.username ? "@" + o.username : "",
      c.target?.brand,
      TARGET_LABELS[c.target?.type] || c.target?.type,
      c.target?.url,
      c.budget?.priceToman,
      c.budget?.packageViews,
      c.creative?.showPicture ? "بله" : "خیر",
      c.creative?.text,
      (t.keywords || []).join(" | "),
      (t.channels || []).join(" "),
      c.stats?.views,
      c.stats?.clicks,
      c.stats?.joins || 0,
      faDate(c.createdAt)
    ].map(cell).join(",");
  });

  return "﻿" + [head.map(cell).join(","), ...rows].join("\n");
}
