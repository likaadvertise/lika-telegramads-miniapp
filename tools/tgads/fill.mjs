/* =========================================================
   Lika Ads — پرکنندهٔ فرم Telegram Ads (خط فرمان)
   ---------------------------------------------------------
   این ابزار یک مرورگر واقعی باز می‌کند، وارد پنل ads.telegram.org
   (با حساب خودتان) می‌شود، فرم «Create Your Ad» را از روی یک سفارش
   پر می‌کند و همان‌جا می‌ایستد.

   ⛔ سه فیلد را عمداً دست نمی‌زند:
        • Initial budget in Gram
        • تیک «I have read and agree…»
        • دکمهٔ «Create Ad» — تا وقتی این اسکریپت کار می‌کند، حتی
          کلیک اشتباهی هم رویش بی‌اثر می‌شود.

   کار آخر با شماست: بودجه را می‌گذارید، همه‌چیز را چک می‌کنید،
   و اگر درست بود خودتان تیک قوانین و Create Ad را می‌زنید.

   طرز استفاده:
     node fill.mjs order.json
     node fill.mjs order.json --cpm 0.12
     node fill.mjs order.json --poster poster.jpg
     node fill.mjs --login                (فقط برای ورود اولیه)

   برای اینکه این کار با یک دکمه در پنل CRM انجام شود (بدون کپی/پیست
   دستی)، به‌جای این فایل از «agent.mjs» استفاده کنید — راهنمای کامل
   در README.md همین پوشه است.
   ========================================================= */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import {
  ADS_HOME, normalizeOrder, launchBrowser, newSessionContext, saveSession,
  isLoggedIn, openNewAdForm, fillForm, releaseGuard
} from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* =======================================================
   خواندن ورودی‌ها
   ======================================================= */

const argv = process.argv.slice(2);

/** مقدارِ بعد از یک سوئیچ؛ اگر سوئیچ بی‌مقدار بود، true */
const flag = (name) => {
  const i = argv.indexOf("--" + name);
  if (i === -1) return null;
  const next = argv[i + 1];
  return next === undefined || next.startsWith("--") ? true : next;
};

/* فایل سفارش = تنها آرگومان آزاد. مقداری که بعد از یک سوئیچ آمده
   آرگومان آزاد نیست — وگرنه «--session lika.json» به‌اشتباه فایل
   سفارش حساب می‌شد و اسکریپت نشست را به‌جای سفارش می‌خواند. */
function freeArgs() {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) i++;   // مقدارِ همین سوئیچ
      continue;
    }
    out.push(argv[i]);
  }
  return out;
}

const wantLogin = argv.includes("--login");
const sessionValue = flag("session");
const sessionPath = typeof sessionValue === "string" ? sessionValue : path.join(HERE, "session.json");
const orderFile = freeArgs()[0];
const posterValue = flag("poster");
const posterFile = typeof posterValue === "string" ? posterValue : null;

/* پروکسی — پنل تبلیغات تلگرام از داخل ایران باز نمی‌شود */
const proxyServer = flag("proxy") || process.env.TGADS_PROXY || "";

function die(msg) {
  console.error("\n✖ " + msg + "\n");
  process.exit(1);
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a); }));
}

/* =======================================================
   سفارش
   ======================================================= */

function readOrder() {
  if (!orderFile) die("فایل سفارش را بدهید. مثال:  node fill.mjs order.json");
  const full = path.resolve(orderFile);
  if (!fs.existsSync(full)) die("فایل پیدا نشد: " + full);

  let data;
  try {
    // ویندوز گاهی سه بایت نامرئی اول فایل می‌گذارد (BOM) که JSON را خراب می‌کند
    data = JSON.parse(fs.readFileSync(full, "utf8").replace(/^﻿/, ""));
  } catch (e) {
    die("فایل JSON سالم نیست: " + e.message);
  }

  try {
    return normalizeOrder(data, { cliCpm: flag("cpm") });
  } catch (e) {
    die(e.message);
  }
}

function readPoster() {
  if (!posterFile) return null;
  const full = path.resolve(posterFile);
  if (!fs.existsSync(full)) die("فایل عکس پیدا نشد: " + full);
  const ext = path.extname(full).toLowerCase();
  const mimeType = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" }[ext]
                 || "application/octet-stream";
  return { name: path.basename(full), mimeType, buffer: fs.readFileSync(full) };
}

/* =======================================================
   ورود به پنل
   ======================================================= */

async function openPanel() {
  const browser = await launchBrowser({ proxyServer: proxyServer && proxyServer !== true ? proxyServer : "" });
  const { context, hasSession } = await newSessionContext(browser, { sessionPath, fresh: wantLogin });
  const page = await context.newPage();
  await page.goto(ADS_HOME, { waitUntil: "domcontentloaded" });

  if (!hasSession || wantLogin) {
    console.log("\n── ورود به حساب ──");
    console.log("مرورگر باز شد. با شمارهٔ خودتان وارد ads.telegram.org شوید");
    console.log("(کد تأیید در خود تلگرام می‌آید).");
    await ask("\nوقتی وارد پنل شدید، همین‌جا Enter بزنید… ");
    await saveSession(context, sessionPath);
    console.log("✓ نشست ذخیره شد:", sessionPath);
    console.log("  دفعهٔ بعد دیگر لازم نیست وارد شوید (تا وقتی تلگرام منقضی‌اش کند).");
  }

  return { browser, context, page };
}

/* =======================================================
   اجرا
   ======================================================= */

(async function main() {
  if (wantLogin && !orderFile) {
    const { browser } = await openPanel();
    await ask("\nEnter بزنید تا مرورگر بسته شود… ");
    await browser.close();
    return;
  }

  const order = readOrder();
  const poster = readPoster();
  console.log("\n══ سفارش", order.id, "══");
  console.log("نوع:", order.type, "| عنوان:", order.adTitle || "—");

  const { browser, context, page } = await openPanel();

  if (!(await isLoggedIn(page))) {
    die("انگار وارد حساب نیستید یا نشست منقضی شده.\n  یک‌بار این را اجرا کنید:  node fill.mjs --login");
  }

  const formResult = await openNewAdForm(page);
  if (!formResult.ok) {
    await ask(formResult.error + "\nوقتی خودتان صفحهٔ New Ad را باز کردید، Enter بزنید… ");
  }

  const report = await fillForm(page, order, { poster, log: (line) => console.log(line) });

  /* عکس یادگاری از فرم پرشده — هم برای بایگانی، هم اگر بعداً سؤالی پیش آمد */
  const shotDir = path.join(HERE, "out");
  fs.mkdirSync(shotDir, { recursive: true });
  const shot = path.join(shotDir, `${order.id}-${Date.now()}.png`);
  await page.screenshot({ path: shot, fullPage: true }).catch(() => {});

  console.log("\n══ خلاصه ══");
  console.log("پر شد:", report.filled.length, "| دست نخورد:", report.skipped.length, "| مشکل:", report.failed.length);
  report.skipped.forEach((s) => console.log("  ‣", s));
  if (report.failed.length) {
    console.log("\n⚠ این‌ها را خودتان پر کنید:");
    report.failed.forEach((s) => console.log("  ✖", s));
  }
  console.log("عکس فرم:", shot);

  /* نگهبان کنار می‌رود — از این لحظه دکمهٔ Create Ad دست شماست. */
  await releaseGuard(page);

  console.log("\n──────────────────────────────────────────");
  console.log("فرم آماده است. حالا خودتان:");
  console.log("  ۱. بودجهٔ اولیه را بگذارید (و CPM را اگر پر نشده)");
  console.log("  ۲. یک‌بار همه‌چیز را چک کنید — مخصوصاً کانال‌های هدف و عکس");
  console.log("  ۳. تیک قوانین و بعد Create Ad را بزنید");
  console.log("──────────────────────────────────────────");

  await ask("\nوقتی کارتان تمام شد، Enter بزنید تا مرورگر بسته شود… ");
  await saveSession(context, sessionPath).catch(() => {});
  await browser.close();
  process.exit(report.failed.length ? 1 : 0);
})().catch((err) => {
  console.error("\n✖ خطای پیش‌بینی‌نشده:", err.message);
  console.error("  مرورگر باز مانده تا خودتان ببینید چه شد.");
  process.exit(1);
});
