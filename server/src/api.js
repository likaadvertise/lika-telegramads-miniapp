/* =========================================================
   API مینی‌اپ
   ---------------------------------------------------------
   مینی‌اپ از این آدرس‌ها استفاده می‌کند:
     GET  /api/health          بررسی سلامت سرور
     GET  /api/me              اطلاعات کاربر + خلاصهٔ آمار
     GET  /api/campaigns       لیست کمپین‌های کاربر
     GET  /api/campaigns/:code یک کمپین مشخص
     POST /api/campaigns       ثبت کمپین جدید
   ========================================================= */

import { config } from "./config.js";
import { verifyInitData, rateLimit } from "./auth.js";
import { validateCampaign } from "./validate.js";
import {
  upsertUser, createCampaign, listCampaignsByUser,
  getCampaignByCode, summaryForUser, countOrdersToday
} from "./db.js";
import { notifyNewOrder, notifyOrderReceived } from "./bot.js";

const MAX_BODY_BYTES = 64 * 1024;

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Telegram-Init-Data");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("حجم درخواست بیش از حد مجاز است."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { reject(new Error("قالب داده‌های ارسالی درست نیست.")); }
    });

    req.on("error", reject);
  });
}

/** کاربر را از روی initData پیدا می‌کند */
function authenticate(req, body) {
  const initData = req.headers["x-telegram-init-data"] || body?.initData || "";
  const result = verifyInitData(String(initData));
  if (!result.ok) return { ok: false, status: 401, error: result.reason };

  const limit = rateLimit(`u:${result.user.id}`, { max: 120, windowMs: 60000 });
  if (!limit.allowed) {
    return { ok: false, status: 429, error: "درخواست‌های شما بیش از حد مجاز است. کمی صبر کنید." };
  }

  const user = upsertUser(result.user);
  if (user?.is_blocked) {
    return { ok: false, status: 403, error: "دسترسی شما مسدود شده است." };
  }

  return { ok: true, user: result.user };
}

/**
 * @returns {Promise<boolean>} اگر مسیر مربوط به API بود true برمی‌گرداند
 */
export async function handleApi(req, res, url) {
  if (!url.pathname.startsWith("/api/")) return false;

  cors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return true;
  }

  /* ---------- سلامت سرور (بدون احراز هویت) ---------- */
  if (url.pathname === "/api/health") {
    json(res, 200, { ok: true, time: new Date().toISOString() });
    return true;
  }

  let body = {};
  if (req.method === "POST") {
    try {
      body = await readBody(req);
    } catch (err) {
      json(res, 400, { ok: false, error: err.message });
      return true;
    }
  }

  const auth = authenticate(req, body);
  if (!auth.ok) {
    json(res, auth.status, { ok: false, error: auth.error });
    return true;
  }

  const userId = auth.user.id;

  /* ---------- اطلاعات کاربر ---------- */
  if (req.method === "GET" && url.pathname === "/api/me") {
    json(res, 200, { ok: true, user: auth.user, summary: summaryForUser(userId) });
    return true;
  }

  /* ---------- لیست کمپین‌ها ---------- */
  if (req.method === "GET" && url.pathname === "/api/campaigns") {
    json(res, 200, { ok: true, campaigns: listCampaignsByUser(userId, 100) });
    return true;
  }

  /* ---------- یک کمپین ---------- */
  const one = url.pathname.match(/^\/api\/campaigns\/([A-Za-z0-9-]{3,32})$/);
  if (req.method === "GET" && one) {
    const campaign = getCampaignByCode(one[1]);
    if (!campaign || campaign.userId !== userId) {
      json(res, 404, { ok: false, error: "کمپین پیدا نشد." });
      return true;
    }
    json(res, 200, { ok: true, campaign });
    return true;
  }

  /* ---------- ثبت کمپین جدید ---------- */
  if (req.method === "POST" && url.pathname === "/api/campaigns") {
    if (countOrdersToday(userId) >= config.maxOrdersPerDay) {
      json(res, 429, {
        ok: false,
        error: "تعداد سفارش‌های امروز شما به حد مجاز رسیده است. لطفاً فردا دوباره تلاش کنید."
      });
      return true;
    }

    const check = validateCampaign(body.campaign || body);
    if (!check.ok) {
      json(res, 400, { ok: false, error: check.error });
      return true;
    }

    const campaign = createCampaign(userId, check.data);

    // اعلان‌ها نباید پاسخ به مشتری را معطل کنند
    notifyNewOrder(campaign, auth.user).catch((e) => console.error("[notify admin]", e.message));
    notifyOrderReceived(campaign).catch((e) => console.error("[notify user]", e.message));

    json(res, 201, { ok: true, campaign });
    return true;
  }

  json(res, 404, { ok: false, error: "این آدرس وجود ندارد." });
  return true;
}
