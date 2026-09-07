/* =========================================================
   Lika Ads — دستیار محلی برای دکمهٔ «پر کن» در پنل CRM
   ---------------------------------------------------------
   این برنامه روی همین کامپیوتر، فقط برای همین کامپیوتر، گوش
   می‌دهد (127.0.0.1) — از بیرون هیچ‌کس بهش دسترسی ندارد.

   وقتی روی «۳-دستیار.bat» دابل‌کلیک می‌کنید (یا node agent.mjs را
   اجرا می‌کنید)، این برنامه تا وقتی پنجره‌اش باز باشد گوش می‌دهد.
   بعد در پنل CRM (‎/admin) کنار هر سفارش دکمهٔ «پر کن (خودکار)» را
   می‌بینید؛ با زدنش، همان کاری که fill.mjs با یک فایل order.json
   انجام می‌داد، خودش انجام می‌شود — دیگر لازم نیست کپی/پیست کنید.

   همان قوانین fill.mjs اینجا هم برقرار است: بودجه، CPM و دکمهٔ
   نهایی Create Ad را این برنامه هرگز لمس نمی‌کند — کار آخر با شماست.

   طرز استفاده:
     node agent.mjs
     node agent.mjs --proxy http://127.0.0.1:10809

   راهنمای کامل در README.md همین پوشه است.
   ========================================================= */

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import {
  ADS_HOME, normalizeOrder, launchBrowser, newSessionContext, saveSession,
  isLoggedIn, openNewAdForm, fillForm, releaseGuard
} from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const sessionPath = path.join(HERE, "session.json");

const PORT = Number(process.env.AGENT_PORT) || 57821;

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf("--" + name);
  if (i === -1) return "";
  const next = argv[i + 1];
  return next && !next.startsWith("--") ? next : "";
};
let proxyFile = "";
try { proxyFile = fs.readFileSync(path.join(HERE, "proxy.txt"), "utf8").trim(); } catch (e) {}
const proxyServer = flag("proxy") || process.env.TGADS_PROXY || proxyFile;

/* =======================================================
   امنیت سبک: فقط از خود مرورگرِ روی همین کامپیوتر جواب می‌دهیم.
   ---------------------------------------------------------
   این سرور فقط روی 127.0.0.1 گوش می‌دهد، پس از بیرونِ همین کامپیوتر
   اصلاً قابل دسترس نیست. با این حال — طبق یک نکتهٔ صادقانه —
   هر صفحهٔ وبی که همین مرورگر روی همین کامپیوتر باز کرده باشد،
   فنی می‌تواند به این آدرس درخواست بفرستد. چون این ابزار هرگز
   بودجه/پرداخت را لمس نمی‌کند و دکمهٔ نهایی هم دست شماست، بدترین
   حالتش باز شدن یک تب مرورگر با فرم نیمه‌پرشده است، نه خرج پول.
   ======================================================= */
function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res, status, data) {
  const body = Buffer.from(JSON.stringify(data), "utf8");
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length });
  res.end(body);
}

function readBody(req, maxBytes = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > maxBytes) { reject(new Error("درخواست خیلی بزرگ بود.")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** "data:image/jpeg;base64,/9j/4AAQ..." → {name, mimeType, buffer} */
function decodePoster(dataUrl, orderId) {
  if (!dataUrl) return null;
  const m = /^data:([^;]+);base64,(.+)$/s.exec(String(dataUrl));
  if (!m) return null;
  const mimeType = m[1];
  const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[mimeType] || "bin";
  return { name: `${orderId}.${ext}`, mimeType, buffer: Buffer.from(m[2], "base64") };
}

/* =======================================================
   مرورگر — یک نمونه، بین درخواست‌های مختلف مشترک است
   ---------------------------------------------------------
   هر سفارش یک تب تازه در همان مرورگر باز می‌کند؛ نیازی نیست هر بار
   کروم را از نو باز کند. مرورگر تا وقتی این برنامه باز است زنده
   می‌ماند؛ خودتان تب‌های تمام‌شده را می‌بندید.
   ======================================================= */
let browserPromise = null;
let contextPromise = null;
let busy = false;

async function getContext() {
  if (!browserPromise) browserPromise = launchBrowser({ proxyServer });
  const browser = await browserPromise;
  if (!contextPromise) {
    contextPromise = newSessionContext(browser, { sessionPath }).then((r) => r.context);
  }
  return contextPromise;
}

async function handleFill(req, res) {
  if (busy) { json(res, 409, { ok: false, error: "یک سفارش دیگر همین الان در حال پر شدن است — چند لحظه صبر کنید." }); return; }

  if (!fs.existsSync(sessionPath)) {
    json(res, 400, {
      ok: false,
      error: "هنوز وارد حساب تلگرام ادز نشده‌اید. یک‌بار در همین پوشه اجرا کنید: npm run login"
    });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (e) {
    json(res, 400, { ok: false, error: "دادهٔ ارسالی خراب بود: " + e.message });
    return;
  }

  let order;
  try {
    order = normalizeOrder(payload.order || {});
  } catch (e) {
    json(res, 400, { ok: false, error: e.message });
    return;
  }

  const poster = decodePoster(payload.posterDataUrl, order.id);

  busy = true;
  const log = [];
  console.log("\n══ سفارش", order.id, "══");
  try {
    const context = await getContext();
    const page = await context.newPage();
    await page.goto(ADS_HOME, { waitUntil: "domcontentloaded" });

    if (!(await isLoggedIn(page))) {
      json(res, 400, {
        ok: false,
        error: "نشست تلگرام ادز منقضی شده. یک‌بار در همین پوشه اجرا کنید: npm run login"
      });
      return;
    }

    const formResult = await openNewAdForm(page);
    if (!formResult.ok) {
      json(res, 502, { ok: false, error: formResult.error });
      return;
    }

    const report = await fillForm(page, order, {
      poster,
      log: (line) => { log.push(line); console.log(line); }
    });

    const shotDir = path.join(HERE, "out");
    fs.mkdirSync(shotDir, { recursive: true });
    await page.screenshot({ path: path.join(shotDir, `${order.id}-${Date.now()}.png`), fullPage: true }).catch(() => {});

    await releaseGuard(page);
    await saveSession(context, sessionPath).catch(() => {});

    console.log(
      "خلاصه — پر شد:", report.filled.length,
      "| دست نخورد:", report.skipped.length,
      "| مشکل:", report.failed.length
    );

    json(res, 200, {
      ok: true,
      orderId: order.id,
      filled: report.filled.length,
      skipped: report.skipped.length,
      failed: report.failed.length,
      failedList: report.failed,
      log
    });
  } catch (e) {
    json(res, 500, { ok: false, error: "خطای پیش‌بینی‌نشده: " + e.message });
  } finally {
    busy = false;
  }
}

const server = http.createServer(async (req, res) => {
  setCors(req, res);

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (req.method === "GET" && (req.url === "/" || req.url === "/ping")) {
    json(res, 200, { ok: true, service: "lika-tgads-agent", busy });
    return;
  }

  if (req.method === "POST" && req.url === "/fill") {
    await handleFill(req, res);
    return;
  }

  json(res, 404, { ok: false, error: "این آدرس وجود ندارد." });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("\n  ====================================");
  console.log("   دستیار Lika Ads روشن شد");
  console.log("  ====================================\n");
  console.log(`  گوش می‌دهد روی: http://127.0.0.1:${PORT}`);
  console.log("  این پنجره را باز نگه دارید — تا وقتی بازه، دکمهٔ «پر کن» در پنل CRM کار می‌کند.\n");
  if (proxyServer) console.log("  با پروکسی:", proxyServer, "\n");
  if (!fs.existsSync(sessionPath)) {
    console.log("  ⚠ هنوز وارد حساب تلگرام ادز نشده‌اید — یک‌بار اجرا کنید: npm run login\n");
  }
});
