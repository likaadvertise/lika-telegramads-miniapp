/* =========================================================
   شبیه‌ساز محیط Vercel — فقط برای تست
   ---------------------------------------------------------
   روی Vercel هر فایل داخل پوشهٔ api یک تابع جداست و Vercel
   قبل از صدا زدنش دو کار می‌کند که سرور معمولی نمی‌کند:

     ۱) بدنهٔ درخواست را می‌خواند و در req.body می‌گذارد
     ۲) به res توابع status/json/send اضافه می‌کند

   این فایل همان دو کار را انجام می‌دهد تا بتوانیم کد Vercel را
   روی همین ماشین و بدون دیپلوی واقعی تست کنیم.

   این فایل روی Vercel اجرا نمی‌شود؛ فقط ابزار تست است.
   ========================================================= */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const WEB = path.join(ROOT, "web");

const PORT = Number(process.env.PORT || 3000);

/* ---------- بارگذاری توابع، دقیقاً مثل Vercel ---------- */
/*
   Vercel هر فایل داخل api را یک تابع جدا می‌سازد و آدرس‌ها را بر اساس
   ساختار پوشه‌ها به آن‌ها می‌رساند. اینجا همان ساختار را بازسازی می‌کنیم
   تا اگر فایلی برای مسیری وجود نداشته باشد، تست‌ها بگیرندش نه کاربر.
*/
const exact = new Map([
  ["/api/telegram", (await import("../api/telegram.js")).default],
  ["/api/setup", (await import("../api/setup.js")).default]
]);

const nested = [
  [/^\/api\/register\/[^/]+$/, (await import("../api/register/[step].js")).default],
  [/^\/api\/campaigns\/[^/]+$/, (await import("../api/campaigns/[code].js")).default]
];

const catchAll = (await import("../api/[...path].js")).default;

function routeFor(pathname) {
  const hit = exact.get(pathname);
  if (hit) return hit;

  for (const [pattern, fn] of nested) {
    if (pattern.test(pathname)) return fn;
  }

  // Vercel آدرس‌های تودرتوی بدون فایل را به catch-all نمی‌رساند
  const depth = pathname.split("/").filter(Boolean).length;
  return depth <= 2 ? catchAll : null;
}

/* ---------- توابعی که Vercel به res اضافه می‌کند ---------- */
function decorate(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    const body = JSON.stringify(payload);
    if (!res.headersSent) res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(body);
    return res;
  };
  res.send = (payload) => {
    if (Buffer.isBuffer(payload)) res.end(payload);
    else if (typeof payload === "object" && payload !== null) res.json(payload);
    else {
      if (!res.headersSent) res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(String(payload ?? ""));
    }
    return res;
  };
  return res;
}

/* ---------- خواندن بدنه، دقیقاً مثل Vercel ---------- */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".txt": "text/plain; charset=utf-8"
};

/* ---------- فایل‌های ثابت، مثل بخش static خود Vercel ---------- */
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === "/" || rel === "") rel = "/index.html";

  const target = path.join(WEB, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
  if (!target.startsWith(WEB)) {
    res.statusCode = 403;
    res.end("Forbidden");
    return true;
  }

  let stat;
  try {
    stat = fs.statSync(target);
    if (stat.isDirectory()) return false;
  } catch {
    return false;
  }

  res.writeHead(200, {
    "Content-Type": TYPES[path.extname(target).toLowerCase()] || "application/octet-stream",
    "Content-Length": stat.size,
    "X-Content-Type-Options": "nosniff"
  });
  fs.createReadStream(target).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  decorate(res);

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  try {
    if (url.pathname.startsWith("/api/")) {
      // Vercel بدنه را از قبل می‌خواند و در req.body می‌گذارد
      const raw = await readBody(req);
      if (raw.length) {
        const type = String(req.headers["content-type"] || "");
        if (type.includes("application/json")) {
          try { req.body = JSON.parse(raw.toString("utf8")); }
          catch { req.body = raw.toString("utf8"); }
        } else {
          req.body = raw.toString("utf8");
        }
      }

      const handler = routeFor(url.pathname);
      if (!handler) {
        // همان ۴۰۴ خام Vercel، بدون رسیدن به کد ما
        res.statusCode = 404;
        res.end("NOT_FOUND");
        return;
      }
      await handler(req, res);
      if (!res.writableEnded) res.end();
      return;
    }

    if (serveStatic(req, res, url.pathname)) return;

    res.statusCode = 404;
    res.end("صفحه پیدا نشد");
  } catch (err) {
    console.error("[shim]", err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: "خطای داخلی سرور" }));
    }
  }
});

server.listen(PORT, () => {
  console.log(`✔ شبیه‌ساز Vercel روی پورت ${PORT} بالا آمد`);
});
