/* =========================================================
   بررسی اطلاعات سفارش در سمت سرور
   ---------------------------------------------------------
   مینی‌اپ خودش هم اطلاعات را بررسی می‌کند، ولی هرگز نباید
   فقط به آن اعتماد کرد؛ چون کسی می‌تواند مستقیم به سرور
   درخواست بفرستد. پس همه‌چیز اینجا دوباره بررسی می‌شود.
   ========================================================= */

import { config } from "./config.js";

const TARGET_TYPES = ["channel", "bot", "post"];
const START_WHEN = ["asap", "week", "custom"];

const URL_PATTERNS = [
  /^@[A-Za-z0-9_]{4,32}$/,
  /^(https?:\/\/)?t\.me\/[A-Za-z0-9_+/]{3,64}$/i
];

function cleanText(value, maxLength) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanList(value, { max = 40, itemMax = 64 } = {}) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((x) => String(x ?? "").trim()).filter(Boolean))]
    .slice(0, max)
    .map((x) => x.slice(0, itemMax));
}

/**
 * @returns {{ok: true, data: object} | {ok: false, error: string}}
 */
export function validateCampaign(input) {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "اطلاعات سفارش ارسال نشده است." };
  }

  const target = input.target || {};
  const creative = input.creative || {};
  const targeting = input.targeting || {};
  const budget = input.budget || {};

  /* ---------- مقصد ---------- */
  const targetType = String(target.type || "").trim();
  if (!TARGET_TYPES.includes(targetType)) {
    return { ok: false, error: "نوع مقصد تبلیغ معتبر نیست." };
  }

  const targetUrl = cleanText(target.url, 128);
  if (!URL_PATTERNS.some((re) => re.test(targetUrl))) {
    return { ok: false, error: "آدرس مقصد معتبر نیست. مثال درست: @lika_shop" };
  }

  const brand = cleanText(target.brand, 64);
  if (brand.length < 2) {
    return { ok: false, error: "نام برند را وارد کنید." };
  }

  /* ---------- متن تبلیغ ---------- */
  const adText = cleanText(creative.text, config.adTextMaxLength + 40);
  if (adText.length < 10) {
    return { ok: false, error: "متن تبلیغ خیلی کوتاه است." };
  }
  if (adText.length > config.adTextMaxLength) {
    return { ok: false, error: `متن تبلیغ نباید بیشتر از ${config.adTextMaxLength} کاراکتر باشد.` };
  }

  /* ---------- هدف‌گیری ---------- */
  const countries = cleanList(targeting.countries, { max: 60, itemMax: 4 });
  if (countries.length === 0) {
    return { ok: false, error: "حداقل یک کشور را انتخاب کنید." };
  }

  const languages = cleanList(targeting.languages, { max: 20, itemMax: 32 });
  const topics = cleanList(targeting.topics, { max: 30, itemMax: 32 });
  const channels = cleanList(targeting.channels, { max: 50, itemMax: 64 });

  if (topics.length === 0 && channels.length === 0) {
    return { ok: false, error: "حداقل یک موضوع انتخاب کنید یا کانال خاص وارد کنید." };
  }

  /* ---------- بودجه ---------- */
  const budgetUsd = Number(budget.amountUsd);
  if (!Number.isFinite(budgetUsd) || budgetUsd < config.minBudgetUsd) {
    return { ok: false, error: `حداقل بودجه ${config.minBudgetUsd} دلار است.` };
  }
  if (budgetUsd > config.maxBudgetUsd) {
    return { ok: false, error: "بودجه بیش از حد مجاز است." };
  }

  const cpmUsd = Number(budget.cpmUsd);
  if (!Number.isFinite(cpmUsd) || cpmUsd < config.minCpmUsd || cpmUsd > config.maxCpmUsd) {
    return { ok: false, error: "نرخ CPM خارج از بازهٔ مجاز است." };
  }

  const startWhen = START_WHEN.includes(budget.startWhen) ? budget.startWhen : "asap";

  return {
    ok: true,
    data: {
      targetType,
      targetUrl,
      brand,
      adText,
      countries,
      languages,
      topics,
      channels,
      budgetUsd: Math.round(budgetUsd * 100) / 100,
      cpmUsd: Math.round(cpmUsd * 100) / 100,
      startWhen,
      notes: cleanText(input.notes, 1000)
    }
  };
}
