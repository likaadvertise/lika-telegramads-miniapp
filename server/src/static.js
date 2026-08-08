/* =========================================================
   سرو کردن فایل‌های مینی‌اپ (پوشهٔ web)
   ---------------------------------------------------------
   تا همین یک سرور، هم API باشد و هم خود اپ را نمایش دهد.
   ========================================================= */

import fs from "node:fs";
import path from "node:path";
import { WEB_DIR } from "./config.js";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8"
};

/**
 * @returns {boolean} اگر فایلی سرو شد true
 */
export function serveStatic(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;

  let rel = decodeURIComponent(url.pathname);
  if (rel === "/" || rel === "") rel = "/index.html";

  // جلوگیری از خروج از پوشهٔ web
  const target = path.join(WEB_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
  if (!target.startsWith(WEB_DIR)) {
    res.writeHead(403);
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

  const ext = path.extname(target).toLowerCase();
  const isAsset = rel.startsWith("/assets/");

  res.writeHead(200, {
    "Content-Type": TYPES[ext] || "application/octet-stream",
    "Content-Length": stat.size,
    // فایل html همیشه تازه؛ بقیه یک ساعت کش می‌شوند
    "Cache-Control": isAsset ? "public, max-age=3600" : "no-cache",
    "X-Content-Type-Options": "nosniff"
  });

  if (req.method === "HEAD") {
    res.end();
    return true;
  }

  fs.createReadStream(target).pipe(res);
  return true;
}
