/* =========================================================
   Lika Ads — هستهٔ مشترک پرکنندهٔ فرم Telegram Ads
   ---------------------------------------------------------
   این فایل کاری را که قبلاً فقط fill.mjs (خط‌فرمان) انجام می‌داد،
   به شکلی درآورده که هم از خط‌فرمان و هم از agent.mjs (سرور محلی
   که پنل CRM با یک دکمه صدایش می‌زند) قابل استفاده باشد.

   ⛔ همچنان سه چیز را عمداً دست نمی‌زند:
        • Initial budget in Gram
        • تیک «I have read and agree…»
        • دکمهٔ «Create Ad»
   (از این نسخه به بعد URL و عکس/پوستر هم پر می‌شوند — طبق خواستهٔ
   خودتان — ولی همان سه مورد بالا همیشه دست‌نخورده می‌مانند.)
   ========================================================= */

import fs from "node:fs";
import { chromium } from "playwright";

export const ADS_HOME = "https://ads.telegram.org/account";

/* =======================================================
   سفارش — تبدیل دادهٔ خام (از فایل JSON یا از CRM) به شکل یکسان
   ======================================================= */

/** «@lika_shop» و «lika_shop» هر دو به آدرس کاملی که پنل می‌خواهد تبدیل می‌شوند */
export function toTmeUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("t.me/")) return "https://" + s;
  return "https://t.me/" + s.replace(/^@/, "");
}

/**
 * @param {object} data دادهٔ خام سفارش (همان شکلی که tgAdsPayload در CRM می‌سازد)
 * @param {object} [opts]
 * @param {number|string} [opts.cliCpm] عددی که کاربر روی خط فرمان داده (اگر باشد، می‌چربد)
 */
export function normalizeOrder(data, opts = {}) {
  const type = String(data.type || "channel").toLowerCase();
  if (!["channel", "bot", "search"].includes(type)) {
    throw new Error(`نوع تبلیغ «${type}» را نمی‌شناسم. یکی از این‌ها باشد: channel / bot / search`);
  }

  const cliCpm = opts.cliCpm;
  const cpm = cliCpm !== undefined && cliCpm !== null && cliCpm !== true ? Number(cliCpm)
            : data.cpmGram != null ? Number(data.cpmGram)
            : null;
  if (cpm !== null && !(cpm > 0)) {
    throw new Error("مقدار CPM باید عددی بزرگ‌تر از صفر باشد.");
  }

  return {
    id: String(data.id || "بدون کد"),
    type,
    adTitle: String(data.adTitle || "").trim(),
    text: String(data.text || "").trim(),
    hasPoster: data.hasPoster === true,
    channels: (data.channels || []).map(toTmeUrl).filter(Boolean),
    keywords: (data.keywords || []).map((k) => String(k).trim()).filter(Boolean),
    url: String(data.url || "").trim(),
    cpmGram: cpm,
    dailyViewsLimit: data.dailyViewsLimit ? Number(data.dailyViewsLimit) : null
  };
}

/* =======================================================
   گزارش‌گیری — هر بار که یک پر کردن انجام می‌شود، یک نمونهٔ تازه بسازید
   ======================================================= */

export function makeReport(log = () => {}) {
  const report = { filled: [], skipped: [], failed: [] };
  return {
    report,
    ok: (what, how) => { report.filled.push(what + (how ? " — " + how : "")); log("  ✓ " + what + (how ? " — " + how : "")); },
    skip: (what, why) => { report.skipped.push(what + " — " + why); log("  ‣ " + what + " → " + why); },
    bad: (what, why) => { report.failed.push(what + " — " + why); log("  ✖ " + what + " → " + why); }
  };
}

/* =======================================================
   ابزارهای کوچک برای پیدا کردن فیلدها
   ======================================================= */

/** رشته را برای XPath امن می‌کند (XPath نقل‌قول تودرتو ندارد) */
function quote(s) {
  if (!s.includes('"')) return `"${s}"`;
  return "concat(" + s.split('"').map((p) => `"${p}"`).join(', \'"\', ') + ")";
}

/**
 * پیدا کردن یک فیلد — اول با placeholder (که از روی خود پنل برداشته‌ایم)
 * و اگر نبود، با متن برچسبِ بالای آن.
 *
 * چرا دو راه؟ چون HTML پنل تلگرام مال ما نیست و ممکن است عوض شود.
 * اگر یکی از کار افتاد، دیگری معمولاً هنوز کار می‌کند.
 */
async function findField(page, { placeholder, label, tag = "input" }) {
  if (placeholder) {
    const byPlaceholder = page.getByPlaceholder(placeholder, { exact: false });
    if (await waitCount(byPlaceholder)) return byPlaceholder.first();
  }
  if (label) {
    const xp = `xpath=//*[contains(normalize-space(.), ${quote(label)})]/following::${tag}[1]`;
    const byLabel = page.locator(xp);
    if (await waitCount(byLabel)) return byLabel.first();
  }
  return null;
}

/**
 * مثل locator.count() ولی چند لحظه صبر می‌کند تا عنصر واقعاً بنشیند —
 * چون این فرم React است و بخش‌هایی از آن (مثل کادر کانال‌های هدف یا
 * دکمهٔ آپلود عکس) کمی دیرتر از بقیه رندر می‌شوند؛ count() ساده همان
 * لحظهٔ اول را می‌بیند و بی‌جهت می‌گوید «پیدا نشد».
 */
async function waitCount(locator, timeout = 5000) {
  try {
    await locator.first().waitFor({ state: "attached", timeout });
  } catch (e) { /* واقعاً نیامد؛ count زیر صفر برمی‌گرداند */ }
  return locator.count();
}

/* =======================================================
   نگهبان دکمهٔ Create Ad
   ---------------------------------------------------------
   خواستهٔ اصلی شما همین است: این دکمه زده نشود. فقط به «نزدنش»
   بسنده نمی‌کنیم — تا وقتی این کد مشغول پر کردن است، هر کلیکی
   روی این دکمه (از هر جایی، حتی اشتباهی) بی‌اثر می‌شود.
   وقتی کار تمام شد و نوبت شما رسید، نگهبان کنار می‌رود.
   ======================================================= */
const GUARD = `
  document.addEventListener("click", function (e) {
    try { if (sessionStorage.getItem("likaGuard") === "off") return; } catch (err) {}
    var el = e.target && e.target.closest ? e.target.closest("button, a, input[type=submit], .button") : null;
    if (!el) return;
    var label = (el.innerText || el.value || "");
    if (/create\\s*ad/i.test(label)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      console.warn("[lika] جلوی کلیک روی Create Ad گرفته شد");
    }
  }, true);
`;

/* =======================================================
   ورود به پنل
   ======================================================= */

/**
 * یک مرورگر تازه باز می‌کند و اگر نشست ذخیره‌شده باشد، همان را
 * بارگذاری می‌کند. برای ورود اولیه (بدون نشست)، caller باید خودش
 * صفحه را نشان بدهد و منتظر بماند — این تابع فقط مرورگر را بالا می‌آورد.
 */
export async function launchBrowser({ proxyServer, headless = false } = {}) {
  const launch = { headless, args: headless ? [] : ["--start-maximized"] };
  if (proxyServer) launch.proxy = { server: String(proxyServer) };
  return chromium.launch(launch);
}

export async function newSessionContext(browser, { sessionPath, fresh = false } = {}) {
  const hasSession = sessionPath && fs.existsSync(sessionPath) && !fresh;
  const context = await browser.newContext({
    viewport: null,
    storageState: hasSession ? sessionPath : undefined
  });
  await context.addInitScript(GUARD);
  return { context, hasSession };
}

export async function saveSession(context, sessionPath) {
  await context.storageState({ path: sessionPath });
  fs.chmodSync(sessionPath, 0o600);
}

/** آیا واقعاً داخل حساب هستیم؟ */
export async function isLoggedIn(page) {
  await page.waitForTimeout(1200);
  const body = (await page.textContent("body").catch(() => "")) || "";
  return !(/log\s*in|sign\s*in|phone number/i.test(body) && !/create/i.test(body));
}

/** رفتن به فرم «Create Your Ad» — اگر پیدا نشد، پیغام خطا برمی‌گرداند (استثنا نمی‌اندازد) */
export async function openNewAdForm(page) {
  const heading = page.getByText("Create Your Ad", { exact: false });
  if (await heading.count()) return { ok: true };

  const entry = page.getByText(/create a new ad|new ad|create ad/i).first();
  if (!(await entry.count())) {
    return { ok: false, error: "دکمهٔ «Create a new ad» را در پنل پیدا نکردم — خودتان صفحهٔ New Ad را باز کنید." };
  }
  await entry.click();
  await page.waitForTimeout(1500);

  if (!(await page.getByText("Create Your Ad", { exact: false }).count())) {
    return { ok: false, error: "فرم «Create Your Ad» را پیدا نکردم — خودتان صفحهٔ New Ad را باز کنید." };
  }
  return { ok: true };
}

/* =======================================================
   پر کردن فرم
   ======================================================= */

/**
 * @param {import("playwright").Page} page
 * @param {object} order خروجی normalizeOrder
 * @param {object} [opts]
 * @param {{name:string, mimeType:string, buffer:Buffer}} [opts.poster] عکس پوستر — اگر نبود، دست نمی‌خورد
 * @param {(what:string, how?:string)=>void} [opts.log]
 */
export async function fillForm(page, order, opts = {}) {
  const { ok, skip, bad, report } = makeReport(opts.log || (() => {}));

  // پیش‌فرض Playwright برای هر کلیک/چک ۳۰ ثانیه صبر می‌کند؛ وقتی چیزی
  // واقعاً پیدا نمی‌شود، این یعنی ۳۰ ثانیه بی‌دلیل معطلی. با waitCount
  // خودمان جای صبر لازم را جبران می‌کنیم، پس این عدد را کوتاه‌تر می‌کنیم.
  page.setDefaultTimeout(8000);

  /* --- نوع تبلیغ: Channels / Bots / Search --- */
  const tab = { channel: "Channels", bot: "Bots", search: "Search" }[order.type];
  try {
    const btn = page.getByText(tab, { exact: true }).first();
    if (await btn.count()) { await btn.click(); await page.waitForTimeout(600); ok("نوع تبلیغ", tab); }
    else bad("نوع تبلیغ", `دکمهٔ «${tab}» پیدا نشد`);
  } catch (e) { bad("نوع تبلیغ", e.message); }

  /* --- عنوان تبلیغ --- */
  if (order.adTitle) {
    const el = await findField(page, { placeholder: "My first ad", label: "Ad title" });
    if (el) { await el.fill(order.adTitle); ok("Ad title", order.adTitle); }
    else bad("Ad title", "فیلد پیدا نشد");
  } else skip("Ad title", "در سفارش خالی بود");

  /* --- متن تبلیغ (تبلیغ نوع Search اصلاً متن ندارد) --- */
  if (order.type === "search") {
    skip("Ad text", "تبلیغ جستجو متن ندارد");
  } else if (order.text) {
    const el = await findField(page, { placeholder: "Enter your ad text", label: "Ad text", tag: "textarea" });
    if (el) { await el.fill(order.text); ok("Ad text", order.text.length + " کاراکتر"); }
    else bad("Ad text", "فیلد پیدا نشد");
  } else skip("Ad text", "در سفارش خالی بود");

  /* --- URL --- */
  if (order.url) {
    const el = await findField(page, { label: "URL you want to promote" })
            || await findField(page, { placeholder: "https://" });
    if (el) { await el.fill(order.url); ok("URL you want to promote", order.url); }
    else bad("URL you want to promote", "فیلد پیدا نشد — خودتان بگذارید: " + order.url);
  } else skip("URL you want to promote", "سفارش آدرس مقصد نداشت");

  /* --- عکس/ویدئوی تبلیغ ---
     دکمهٔ «Upload Photo or Video» یک <a class="js-add-media-btn">
     است (با Inspect Element روی خود پنل پیدا شد) — نه یک <input>
     که از اول تو صفحه باشد. کلیک روی آن یک انتخاب‌گر فایل واقعی
     تلگرام باز می‌کند؛ باید قبل از کلیک منتظر آن رویداد بمانیم،
     وگرنه Playwright قبل از باز شدنش رد می‌شود. */
  if (opts.poster) {
    try {
      const trigger = page.locator(".js-add-media-btn").first();
      const hasTrigger = await waitCount(trigger);
      const clickTarget = hasTrigger ? trigger : page.getByText(/upload photo|photo or video/i).first();

      if (await waitCount(clickTarget)) {
        const [chooser] = await Promise.all([
          page.waitForEvent("filechooser", { timeout: 8000 }),
          clickTarget.click()
        ]);
        await chooser.setFiles(opts.poster);
        await page.waitForTimeout(1000);
        ok("Ad photo or video", "آپلود شد");
      } else {
        // چارهٔ آخر: شاید یک <input type=file> معمولی هم باشد
        const input = page.locator('input[type="file"]');
        if (await waitCount(input)) {
          await input.first().setInputFiles(opts.poster, { timeout: 8000 });
          await page.waitForTimeout(1000);
          ok("Ad photo or video", "آپلود شد");
        } else {
          bad("Ad photo or video", "دکمهٔ آپلود پیدا نشد — خودتان آپلود کنید");
        }
      }
    } catch (e) {
      bad("Ad photo or video", e.message + " — خودتان آپلود کنید");
    }
  } else {
    skip("Ad photo or video", order.hasPoster
      ? "پوستر گرفته نشد — خودتان از CRM بردارید و آپلود کنید"
      : "این سفارش پوستر ندارد");
  }

  /* --- کانال‌های هدف / کلیدواژه --- */
  if (order.type === "search") {
    await fillKeywords(page, order.keywords, { ok, skip, bad });
  } else if (order.channels.length) {
    await fillChannels(page, order.channels, { ok, skip, bad });
  } else {
    skip("Target specific channels", "سفارش کانال هدف نداشت");
  }

  /* --- CPM --- */
  if (order.cpmGram !== null) {
    const el = await findField(page, { label: "CPM in Gram" });
    if (el) { await el.fill(String(order.cpmGram)); ok("CPM in Gram", String(order.cpmGram)); }
    else bad("CPM in Gram", "فیلد پیدا نشد");
  } else {
    skip("CPM in Gram", "عددی داده نشد — خودتان بنویسید");
  }

  /* --- بودجهٔ اولیه: عمداً دست نمی‌خورد --- */
  skip("Initial budget in Gram", "طبق خواستهٔ شما دست نخورد");

  /* --- سقف بازدید روزانه --- */
  if (order.dailyViewsLimit) {
    try {
      const el = page.getByText(String(order.dailyViewsLimit), { exact: true }).last();
      await el.click();
      ok("Daily views limit", String(order.dailyViewsLimit));
    } catch (e) { bad("Daily views limit", e.message); }
  } else skip("Daily views limit", "دست‌نخورده (پیش‌فرض پنل)");

  /* --- وضعیت اولیه: حتماً On Hold --- */
  await setRadio(page, "On Hold", { ok, skip, bad });

  /* --- چیزهایی که هرگز دست نمی‌زنیم --- */
  skip("تیک قوانین", "باید خودتان بزنید");
  skip("دکمهٔ Create Ad", "زده نشد — با خود شماست");

  return report;
}

/**
 * انتخاب یک گزینهٔ رادیویی با متن کنارش.
 *
 * اول رو متن قابل‌دیدن کلیک می‌کنیم — چون در بیشتر فرم‌های شیک، خودِ
 * <input type=radio> نامرئی است و پشت یک ظاهر سفارشی قایم شده؛ کلیک
 * مستقیم رویش (حتی force) قابل اعتماد نیست. اگر متن پیدا نشد، به‌عنوان
 * چارهٔ آخر خودِ رادیو را با force امتحان می‌کنیم (بدون صبر ۳۰ ثانیه‌ای
 * پیش‌فرض برای نامرئی بودن).
 */
async function setRadio(page, labelText, { ok, skip, bad }) {
  try {
    const byText = page.getByText(labelText, { exact: true }).first();
    if (await waitCount(byText)) {
      await byText.click({ timeout: 5000 });
      ok("Initial status", labelText);
      return;
    }

    const radio = page.locator(
      `xpath=//*[contains(normalize-space(.), ${quote(labelText)})]/preceding::input[@type="radio"][1]`
    ).first();
    if (await waitCount(radio)) {
      await radio.click({ force: true, timeout: 5000 });
      ok("Initial status", labelText + " (رادیو مخفی)");
      return;
    }

    skip("Initial status", "پیدا نشد — خودتان مطمئن شوید روی On Hold باشد");
  } catch (e) {
    bad("Initial status", e.message + " — خودتان مطمئن شوید روی On Hold باشد");
  }
}

/**
 * کانال‌های هدف را یکی‌یکی وارد می‌کند.
 *
 * این کادر یک <input> معمولی نیست — یک <div contenteditable> با
 * ویژگی سفارشی data-placeholder است (نه placeholder معمولی HTML)،
 * برای همین getByPlaceholder پیدایش نمی‌کرد. با Inspect Element روی
 * خود پنل واقعی پیدا شد. پنل بعد از هر آدرس آن را به یک برچسب تبدیل
 * می‌کند و همان کادر را برای بعدی خالی می‌کند؛ پس همیشه سراغ همان یک
 * عنصر می‌رویم، نه اینکه دنبال کادر تازه بگردیم.
 */
async function fillChannels(page, channels, { ok, bad }) {
  const box = page
    .locator('[contenteditable="true"][data-placeholder="t.me channel URL"]')
    .first();

  if (!(await waitCount(box))) {
    bad("Target specific channels", "کادر کانال هدف پیدا نشد");
    return;
  }

  let done = 0;
  for (const url of channels) {
    try {
      await box.click();
      await box.fill(url);
      await box.press("Enter");
      await page.waitForTimeout(500);
      done++;
    } catch (e) {
      bad("Target specific channels", e.message + ` — ${channels.length - done} کانال باقی‌مانده را خودتان اضافه کنید`);
      return;
    }
  }

  ok("Target specific channels", done + " کانال — بار اول خودتان نگاه کنید همه‌شان درست ثبت شده باشند");
}

/** کلیدواژه‌های تبلیغ جستجو */
async function fillKeywords(page, keywords, { ok, skip, bad }) {
  if (!keywords.length) { skip("کلیدواژه‌ها", "سفارش کلیدواژه نداشت"); return; }

  const box = await findField(page, { placeholder: "search quer" })
           || await findField(page, { label: "Target search queries" });

  if (!box) {
    bad("کلیدواژه‌ها", "کادرش را پیدا نکردم — این‌ها را دستی وارد کنید: " + keywords.join(" ، "));
    return;
  }

  for (const word of keywords) {
    await box.fill(word);
    await box.press("Enter");
    await page.waitForTimeout(400);
  }
  ok("کلیدواژه‌ها", keywords.length + " کلیدواژه");
}

/** نگهبان Create Ad را کنار می‌زند — از این لحظه دکمه دست خود کاربر است */
export async function releaseGuard(page) {
  await page.evaluate(() => {
    try { sessionStorage.setItem("likaGuard", "off"); } catch (e) {}
  }).catch(() => {});
}
