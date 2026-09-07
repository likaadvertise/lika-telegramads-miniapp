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

import crypto from "node:crypto";
import { config, isAdmin } from "./config.js";
import { publicPackages } from "./packages.js";
import { login as adminLogin, verifyToken, bearerOf, webLoginEnabled } from "./adminauth.js";
import { verifyInitData, rateLimit } from "./auth.js";
import {
  validateCampaign, normalizePhone, validateName, validateEmail, normalizeCode, validateAdminEdit
} from "./validate.js";
import {
  upsertUser, createCampaign, createWebsiteCampaign, listCampaignsByUser,
  getCampaignByCode, summaryForUser, countOrdersToday,
  issuePhoneCode, checkPhoneCode, completeRegistration, profileOf, setPhoneDirect,
  findUserByPhone, listRegisteredUsers, listAllCampaigns, editCampaign, editUser,
  setCampaignReceipt, setCampaignStats, deleteCampaign, deleteUser
} from "./db.js";
import {
  notifyNewOrder, notifyOrderReceived, sendVerificationCode, notifyNewLead, notifyPhoneReused,
  notifyCampaignEdited
} from "./bot.js";
import { call, sendDocument, sendPhoto } from "./telegram.js";
import { ordersCsv } from "./format.js";
import { smsEnabled, sendSmsCode } from "./sms.js";
import { getChatInfo, getChatPhoto, getTelegramFile } from "./chatinfo.js";
import { readImage } from "./validate.js";

/* پوستر تبلیغ داخل همان درخواست ثبت سفارش می‌آید (base64)، پس سقف
   قبلیِ ۶۴ کیلوبایت کافی نیست. مینی‌اپ عکس را قبل از فرستادن کوچک
   می‌کند، ولی سقف سرور باید جا داشته باشد. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Telegram-Init-Data, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function readBody(req) {
  /*
     روی Vercel بدنهٔ درخواست قبل از رسیدن به ما خوانده و در req.body
     گذاشته می‌شود. در آن حالت خواندن دوبارهٔ جریان هیچ‌وقت تمام نمی‌شود،
     پس همان مقدار آماده را برمی‌گردانیم.
  */
  if (req.body !== undefined && req.body !== null && req.body !== "") {
    if (typeof req.body === "string") {
      try {
        return Promise.resolve(JSON.parse(req.body));
      } catch {
        return Promise.reject(new Error("قالب داده‌های ارسالی درست نیست."));
      }
    }
    if (Buffer.isBuffer(req.body)) {
      const raw = req.body.toString("utf8");
      if (!raw) return Promise.resolve({});
      try {
        return Promise.resolve(JSON.parse(raw));
      } catch {
        return Promise.reject(new Error("قالب داده‌های ارسالی درست نیست."));
      }
    }
    return Promise.resolve(req.body);
  }

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

/*
   نام رباتی که توکنش روی این سرور نشسته است.
   وقتی امضا رد می‌شود، تقریباً همیشه دلیلش این است که مینی‌اپ را
   ربات دیگری باز کرده — چون تلگرام امضا را با توکن همان ربات می‌سازد.
   بدون گفتن این نام، کاربر هیچ راهی برای فهمیدنش ندارد.
   یک بار می‌پرسیم و نگه می‌داریم؛ نام کاربری ربات عمومی است.
*/
let cachedBotName;

async function configuredBotName() {
  if (cachedBotName !== undefined) return cachedBotName;
  try {
    const me = await call("getMe", {}, { timeoutMs: 5000 });
    cachedBotName = me?.username ? "@" + me.username : "";
  } catch {
    cachedBotName = "";
  }
  return cachedBotName;
}

/** کاربر را از روی initData پیدا می‌کند */
async function authenticate(req, body) {
  const initData = req.headers["x-telegram-init-data"] || body?.initData || "";
  const result = verifyInitData(String(initData));
  if (!result.ok) {
    const bot = await configuredBotName();
    return {
      ok: false,
      status: 401,
      error: bot ? `${result.reason} سرور برای ربات ${bot} تنظیم شده است.` : result.reason
    };
  }

  const limit = rateLimit(`u:${result.user.id}`, { max: 120, windowMs: 60000 });
  if (!limit.allowed) {
    return { ok: false, status: 429, error: "درخواست‌های شما بیش از حد مجاز است. کمی صبر کنید." };
  }

  const user = await upsertUser(result.user);
  if (user?.is_blocked) {
    return { ok: false, status: 403, error: "دسترسی شما مسدود شده است." };
  }

  return { ok: true, user: result.user, bot: result.bot };
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
    /* webLogin می‌گوید ADMIN_USER و ADMIN_PASSWORD روی سرور تنظیم شده‌اند
       یا نه. فقط همین — نه نام کاربری لو می‌رود نه رمز. بدون این، وقتی
       ورود کار نمی‌کند هیچ راهی نیست بفهمیم مشکل از رمز است یا از
       تنظیم‌نشدن متغیرها. */
    json(res, 200, {
      ok: true,
      time: new Date().toISOString(),
      webLogin: webLoginEnabled()
    });
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

  /* ---------- عکس پروفایل کانال ----------
     این یکی عمداً پیش از احراز هویت است. مرورگر عکس را با تگ <img>
     می‌گیرد و روی چنین درخواستی نمی‌تواند هدر X-Telegram-Init-Data
     بگذارد؛ پس اگر پشت احراز هویت بماند، همیشه ۴۰۱ می‌گیرد و
     عکس هیچ‌وقت نمی‌آید.

     امن است چون چیزی که برمی‌گرداند عکس پروفایل یک کانال عمومی است —
     همان چیزی که هر کسی در تلگرام می‌بیند. ورودی هم از فیلتر
     normalizeUsername رد می‌شود و نتیجه یک ساعت کش می‌شود، پس
     نمی‌شود با آن به تلگرام فشار آورد. */
  if (req.method === "GET" && url.pathname === "/api/chat-photo") {
    const photo = await getChatPhoto(url.searchParams.get("u"));
    if (!photo.ok) {
      json(res, 404, { ok: false });
      return true;
    }
    res.writeHead(200, {
      "Content-Type": photo.contentType,
      "Content-Length": photo.body.length,
      "Cache-Control": "public, max-age=3600"
    });
    res.end(photo.body);
    return true;
  }

  /* ---------- ورود به پنل از راه وب ----------
     این یکی عمداً پیش از احراز هویت تلگرام است: کسی که در مرورگر
     لپ‌تاپ پنل را باز می‌کند اصلاً امضای تلگرام ندارد. */
  if (req.method === "POST" && url.pathname === "/api/admin/login") {
    // چند بار غلط زدن پشت سر هم را می‌بندیم تا رمز را نشود حدس زد
    const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "?").split(",")[0].trim();
    const limit = rateLimit("login:" + ip, {
      max: config.adminLoginMaxAttempts,
      windowMs: 10 * 60000
    });
    if (!limit.allowed) {
      json(res, 429, { ok: false, error: "تلاش‌های ناموفق زیاد بود. ده دقیقه دیگر دوباره امتحان کنید." });
      return true;
    }

    const result = adminLogin(body.username, body.password);
    if (!result.ok) {
      /* به کاربر نمی‌گوییم کدام‌یک غلط بوده — وگرنه نام کاربری با
         آزمون‌وخطا پیدا می‌شود. ولی در لاگ سرور (که فقط خودتان
         می‌بینید) می‌نویسیم، چون بدون آن عیب‌یابی حدس زدن است. */
      console.warn("[admin login]", result.detail || result.error);
      json(res, 401, { ok: false, error: result.error });
      return true;
    }
    json(res, 200, { ok: true, token: result.token, expiresAt: result.expiresAt });
    return true;
  }

  /* ---------- سفارش تلگرام‌ادز از سایت likaads.com ----------
     این یکی هم عمداً پیش از احراز هویت تلگرام است: درخواست از سرور
     وردپرسی می‌آید، نه از داخل مینی‌اپ تلگرام، پس امضای initData
     ندارد. به‌جایش رمز مشترک در هدر X-Website-Secret بررسی می‌شود. */
  if (req.method === "POST" && url.pathname === "/api/website-lead") {
    if (!config.websiteApiSecret) {
      json(res, 503, { ok: false, error: "WEBSITE_API_SECRET روی سرور تنظیم نشده است." });
      return true;
    }
    const given = String(req.headers["x-website-secret"] || "");
    const expected = Buffer.from(config.websiteApiSecret);
    const givenBuf = Buffer.from(given);
    const secretOk =
      givenBuf.length === expected.length && crypto.timingSafeEqual(givenBuf, expected);
    if (!secretOk) {
      json(res, 401, { ok: false, error: "رمز نامعتبر است." });
      return true;
    }

    const phoneResult = normalizePhone(body.phone);
    const firstName = validateName(body.firstName, "نام");
    const lastName = validateName(body.lastName, "نام خانوادگی");
    if (!phoneResult.ok || !firstName.ok || !lastName.ok) {
      json(res, 400, {
        ok: false,
        error: phoneResult.error || firstName.error || lastName.error || "شماره موبایل یا نام معتبر نیست."
      });
      return true;
    }
    if (!["channel", "search", "bot"].includes(body.targetType)) {
      json(res, 400, { ok: false, error: "نوع تبلیغ معتبر نیست." });
      return true;
    }
    if (!String(body.targetUrl || "").trim() || !String(body.brand || "").trim()) {
      json(res, 400, { ok: false, error: "آدرس مقصد و نام برند اجباری است." });
      return true;
    }

    const emailResult = validateEmail(body.email);
    if (!emailResult.ok) {
      json(res, 400, { ok: false, error: emailResult.error });
      return true;
    }

    const result = await createWebsiteCampaign({
      phone: phoneResult.phone,
      firstName: firstName.name,
      lastName: lastName.name,
      email: emailResult.email,
      targetType: body.targetType,
      targetUrl: String(body.targetUrl).trim(),
      brand: String(body.brand).trim(),
      adTitle: String(body.adTitle || "").trim(),
      adText: String(body.adText || "").trim(),
      channels: Array.isArray(body.channels) ? body.channels : [],
      keywords: Array.isArray(body.keywords) ? body.keywords : [],
      startWhen: body.startWhen || "asap",
      startDate: body.startDate || "",
      notes: String(body.notes || "").trim(),
      packageId: body.packageId || "",
      packageViews: body.packageViews || 0,
      priceToman: body.priceToman || 0
    });

    notifyNewOrder(result.campaign, {
      id: phoneResult.phone,
      first_name: firstName.name,
      last_name: lastName.name,
      username: "سایت likaads.com"
    }).catch((e) => console.error("[notify admin / website lead]", e.message));

    json(res, 201, { ok: true, code: result.campaign.id });
    return true;
  }

  /* پنل وب: هویت از بلیت ورود می‌آید، نه از تلگرام */
  const webAdmin = url.pathname.startsWith("/api/admin/") ? verifyToken(bearerOf(req)) : { ok: false };

  let auth;
  if (webAdmin.ok) {
    // مدیرِ وارد‌شده با رمز؛ کاربر تلگرامی‌ای در کار نیست
    auth = { ok: true, user: { id: 0, first_name: webAdmin.user }, bot: "main", web: true };
  } else {
    auth = await authenticate(req, body);
    if (!auth.ok) {
      /* اگر پنل وب صدا زده و بلیتی نداشته، همان دلیل را می‌گوییم —
         وگرنه کاربر پیام «امضای تلگرام» می‌گیرد که ربطی به او ندارد. */
      const reason = bearerOf(req) ? verifyToken(bearerOf(req)).reason : null;
      json(res, auth.status, { ok: false, error: reason || auth.error });
      return true;
    }
  }

  const userId = auth.user.id;

  /* ---------- رسید پرداخت ----------
     مشتری بعد از واریز، عکس رسید را می‌فرستد. مثل پوستر، فایل را
     نگه نمی‌داریم: به چت تیم می‌رود و شناسه‌اش روی سفارش می‌نشیند. */
  if (req.method === "POST" && url.pathname === "/api/receipt") {
    const code = String(body.code || "").trim();
    const campaign = await getCampaignByCode(code);

    if (!campaign || Number(campaign.userId) !== Number(userId)) {
      json(res, 404, { ok: false, error: "این سفارش پیدا نشد." });
      return true;
    }

    const image = readImage(body.image, 1024 * 1024);
    if (!image.ok) {
      json(res, 400, { ok: false, error: image.error });
      return true;
    }

    if (!config.adminChatId) {
      json(res, 503, { ok: false, error: "ارسال رسید فعلاً ممکن نیست. با پشتیبانی تماس بگیرید." });
      return true;
    }

    let fileId = "";
    try {
      fileId = await sendPhoto(
        config.adminChatId,
        image.bytes,
        `🧾 رسید پرداخت — سفارش ${campaign.id} — ${campaign.target?.brand || ""}`
      );
    } catch (err) {
      console.error("[receipt]", err.message);
      json(res, 502, { ok: false, error: "فرستادن رسید ممکن نشد. دوباره تلاش کنید." });
      return true;
    }

    /* بدون شناسه، رسید بعداً در پنل قابل دیدن نیست — پس «ثبت شد» گفتن
       به مشتری دروغ است. */
    if (!fileId) {
      json(res, 502, { ok: false, error: "رسید ثبت نشد. دوباره تلاش کنید." });
      return true;
    }

    const updated = await setCampaignReceipt(code, fileId);
    json(res, 200, { ok: true, campaign: updated });
    return true;
  }

  /* ---------- پنل مدیریت ----------
     فقط کسانی که شناسه‌شان در ADMIN_IDS است. هویت از همان امضای
     تلگرام می‌آید که بالاتر بررسی شد، پس رمز جداگانه‌ای لازم نیست
     و چیزی هم نیست که لو برود. */
  if (url.pathname.startsWith("/api/admin/")) {
    if (!auth.web && !isAdmin(userId)) {
      json(res, 403, { ok: false, error: "این بخش فقط برای مدیران است." });
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/admin/users") {
      const users = await listRegisteredUsers(500);
      json(res, 200, { ok: true, users });
      return true;
    }

    /* پوستر سفارش — از تلگرام گرفته و به پنل داده می‌شود.
       فقط برای مدیر، چون فایل مشتری است. */
    if (req.method === "GET" && url.pathname === "/api/admin/poster") {
      const photo = await getTelegramFile(url.searchParams.get("id"));
      if (!photo.ok) {
        json(res, 404, { ok: false, error: "عکس پیدا نشد." });
        return true;
      }
      res.writeHead(200, {
        "Content-Type": photo.contentType,
        "Content-Length": photo.body.length,
        "Cache-Control": "private, max-age=3600"
      });
      res.end(photo.body);
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/admin/campaigns") {
      const campaigns = await listAllCampaigns(500);
      json(res, 200, { ok: true, campaigns });
      return true;
    }

    /* خروجی اکسل — فایل را در تلگرام خودِ مدیر می‌فرستیم، چون داخل
       مرورگر تلگرام دانلود فایل معمولاً کار نمی‌کند. */
    if (req.method === "POST" && url.pathname === "/api/admin/export") {
      const [users, campaigns] = await Promise.all([
        listRegisteredUsers(2000),
        listAllCampaigns(2000)
      ]);
      const csv = ordersCsv(campaigns, users);
      const stamp = new Date().toISOString().slice(0, 10);

      /* در پنل وب، فایل را همان‌جا در مرورگر می‌دهیم. فرستادن به تلگرام
         فقط وقتی معنا دارد که مدیر از داخل تلگرام آمده باشد. */
      if (auth.web) {
        const body = Buffer.from("﻿" + csv, "utf8");   // BOM تا اکسل فارسی را درست بخواند
        res.writeHead(200, {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Length": body.length,
          "Content-Disposition": `attachment; filename="lika-orders-${stamp}.csv"`,
          "Cache-Control": "no-store"
        });
        res.end(body);
        return true;
      }

      try {
        await sendDocument(userId, `lika-orders-${stamp}.csv`, csv,
          `سفارش‌های Lika تا ${stamp} — ${campaigns.length} سفارش، ${users.length} مشتری`,
          auth.bot);
      } catch (err) {
        console.error("[admin export]", err.message);
        json(res, 502, { ok: false, error: "فرستادن فایل در تلگرام ممکن نشد: " + err.message });
        return true;
      }

      json(res, 200, { ok: true, orders: campaigns.length, users: users.length });
      return true;
    }

    /* ---------- ثبت آمار عملکرد (بازدید/کلیک/عضو جدید) ----------
       تلگرام ادز این عددها را در پنل خودش نشان می‌دهد؛ تیم دستی از
       آنجا می‌خواند و اینجا ثبت می‌کند تا مشتری هم در پنل خودش ببیند.
       باید قبل از مسیر عمومی‌تر «ویرایش سفارش» چک شود. */
    const statsMatch = url.pathname.match(/^\/api\/admin\/campaign\/([^/]+)\/stats$/);
    if (req.method === "POST" && statsMatch) {
      const code = decodeURIComponent(statsMatch[1]);
      const views = Number(body?.views);
      const clicks = Number(body?.clicks);
      const joins = Number(body?.joins);

      if (!Number.isInteger(views) || views < 0 || !Number.isInteger(clicks) || clicks < 0 ||
          !Number.isInteger(joins) || joins < 0) {
        json(res, 400, { ok: false, error: "بازدید، کلیک و اعضای جدید باید عدد صحیح و نامنفی باشند." });
        return true;
      }

      const updated = await setCampaignStats(code, views, clicks, joins);
      if (!updated) {
        json(res, 404, { ok: false, error: "سفارشی با این کد پیدا نشد." });
        return true;
      }

      json(res, 200, { ok: true, campaign: updated });
      return true;
    }

    /* ---------- حذف سفارش ----------
       برگشت‌ناپذیر است — فقط برای وقتی سفارش تستی یا اشتباهی ثبت شده. */
    const deleteMatch = url.pathname.match(/^\/api\/admin\/campaign\/([^/]+)$/);
    if (req.method === "DELETE" && deleteMatch) {
      const code = decodeURIComponent(deleteMatch[1]);
      const removed = await deleteCampaign(code);
      if (!removed) {
        json(res, 404, { ok: false, error: "سفارشی با این کد پیدا نشد." });
        return true;
      }
      json(res, 200, { ok: true });
      return true;
    }

    /* ---------- ویرایش سفارش مشتری ----------
       تغییر در همان رکوردی است که خود مشتری می‌بیند، پس بعد از ذخیره
       بلافاصله در پنل او هم عوض می‌شود. برایش پیام هم می‌رود، چون
       تغییر بی‌خبرِ سفارشِ کسی که پول داده، درست نیست. */
    if (req.method === "POST" && url.pathname.startsWith("/api/admin/campaign/")) {
      const code = decodeURIComponent(url.pathname.split("/").pop() || "");
      const patch = validateAdminEdit(body);
      if (!patch.ok) {
        json(res, 400, { ok: false, error: patch.error });
        return true;
      }

      const updated = await editCampaign(code, patch.data, `مدیر ${userId}`);
      if (!updated) {
        json(res, 404, { ok: false, error: "سفارشی با این کد پیدا نشد." });
        return true;
      }

      notifyCampaignEdited(updated).catch((e) => console.error("[notify edit]", e.message));
      json(res, 200, { ok: true, campaign: updated });
      return true;
    }

    /* ---------- ویرایش مشخصات مشتری ---------- */
    if (req.method === "POST" && url.pathname.startsWith("/api/admin/user/")) {
      const id = Number(decodeURIComponent(url.pathname.split("/").pop() || ""));
      if (!Number.isFinite(id) || id <= 0) {
        json(res, 400, { ok: false, error: "شناسهٔ مشتری معتبر نیست." });
        return true;
      }

      const first = validateName(body?.firstName, "نام");
      if (!first.ok) { json(res, 400, { ok: false, error: first.error }); return true; }

      const last = validateName(body?.lastName, "نام خانوادگی");
      if (!last.ok) { json(res, 400, { ok: false, error: last.error }); return true; }

      const phone = normalizePhone(body?.phone);
      if (!phone.ok) { json(res, 400, { ok: false, error: phone.error }); return true; }

      const saved = await editUser(id, {
        firstName: first.name, lastName: last.name, phone: phone.phone
      });
      if (!saved) { json(res, 404, { ok: false, error: "مشتری پیدا نشد." }); return true; }

      json(res, 200, { ok: true, user: saved });
      return true;
    }

    /* ---------- حذف مشتری ----------
       فقط اگر هیچ سفارشی نداشته باشد — وگرنه سفارش‌ها یتیم می‌مانند. */
    if (req.method === "DELETE" && url.pathname.startsWith("/api/admin/user/")) {
      const id = Number(decodeURIComponent(url.pathname.split("/").pop() || ""));
      if (!Number.isFinite(id) || id <= 0) {
        json(res, 400, { ok: false, error: "شناسهٔ مشتری معتبر نیست." });
        return true;
      }

      const result = await deleteUser(id);
      if (!result.ok) {
        json(res, result.error === "مشتری پیدا نشد." ? 404 : 400, result);
        return true;
      }

      json(res, 200, { ok: true });
      return true;
    }

    json(res, 404, { ok: false, error: "این آدرس وجود ندارد." });
    return true;
  }

  /* ---------- اطلاعات کاربر ---------- */
  if (req.method === "GET" && url.pathname === "/api/me") {
    json(res, 200, {
      ok: true,
      user: auth.user,
      profile: await profileOf(userId),
      requireCode: config.requirePhoneCode,
      isAdmin: isAdmin(userId),
      summary: await summaryForUser(userId),

      /* بسته‌ها و شمارهٔ کارت از سرور می‌آیند، نه از فایل مینی‌اپ —
         تا با عوض کردن قیمت روی سرور، همه‌جا همان لحظه عوض شود */
      packages: publicPackages(),
      payment: {
        cardNumber: config.payCardNumber,
        cardHolder: config.payCardHolder,
        bank: config.payCardBank,
        shebaNumber: config.payShebaNumber,
        shebaHolder: config.payShebaHolder,
        shebaBank: config.payShebaBank,
        shebaMinToman: config.payShebaMinToman
      }
    });
    return true;
  }

  /* =======================================================
     ثبت‌نام
     ======================================================= */

  /* گام ۱ — شمارهٔ موبایل */
  if (req.method === "POST" && url.pathname === "/api/register/phone") {
    const phone = normalizePhone(body.phone);
    if (!phone.ok) {
      json(res, 400, { ok: false, error: phone.error });
      return true;
    }

    /*
       اگر این شماره قبلاً زیر حساب تلگرام دیگری ثبت شده باشد چه؟

       قبلاً اینجا کاربر مسدود می‌شد و به پشتیبانی ارجاع داده می‌شد. ولی
       این محدودیت چیزی را محافظت نمی‌کرد — کمپین‌ها به شناسهٔ تلگرام
       گره خورده‌اند، نه به شماره — و در عوض آدم‌های واقعی را به بن‌بست
       می‌برد: کسی که حساب تلگرامش را عوض کرده یا دو حساب دارد، دیگر
       نمی‌توانست ثبت‌نام کند و لیدش از دست می‌رفت.

       پس اجازه می‌دهیم و فقط تیم را باخبر می‌کنیم تا اگر لازم بود
       خودشان پیگیری کنند.
    */
    const owner = await findUserByPhone(phone.phone);
    if (owner && Number(owner.id) !== Number(userId)) {
      notifyPhoneReused(phone.phone, owner, auth.user)
        .catch((e) => console.error("[notify reuse]", e.message));
    }

    // اگر کد تأیید خاموش است، شماره همین‌جا ثبت می‌شود
    if (!config.requirePhoneCode) {
      const profile = await setPhoneDirect(userId, phone.phone);
      json(res, 200, { ok: true, codeSent: false, profile });
      return true;
    }

    const issued = await issuePhoneCode(userId, phone.phone);
    if (!issued.ok) {
      json(res, 429, {
        ok: false,
        error: `کد قبلی هنوز معتبر است. ${issued.retryAfter} ثانیه دیگر دوباره تلاش کنید.`,
        retryAfter: issued.retryAfter
      });
      return true;
    }

    /*
       کد کجا فرستاده شود؟

       پیامک بهتر است چون به خودِ آن شماره می‌رود و واقعاً تأیید می‌کند.
       تلگرام فقط شماره را ثبت می‌کند: کد به همان حسابی می‌رسد که در
       مینی‌اپ است، پس هر کسی می‌تواند شمارهٔ دیگری وارد کند.

       تا وقتی پنل پیامکی تنظیم نشده، همان تلگرام به کار می‌رود.
    */
    const bySms = smsEnabled();

    try {
      if (bySms) await sendSmsCode(phone.phone, issued.code);
      else await sendVerificationCode(userId, issued.code);
    } catch (err) {
      console.error(`[register] ارسال کد ناموفق (${bySms ? "پیامک" : "تلگرام"}):`, err.message);
      json(res, 502, {
        ok: false,
        error: bySms
          ? "ارسال پیامک ممکن نشد. چند لحظه دیگر دوباره تلاش کنید."
          : "ارسال کد به تلگرام ممکن نشد. مینی‌اپ را ببندید، در چت ربات دستور /start را بزنید و دوباره تلاش کنید."
      });
      return true;
    }

    json(res, 200, {
      ok: true,
      codeSent: true,
      sentBy: bySms ? "sms" : "telegram",
      expiresInSeconds: issued.expiresInSeconds,
      resendAfterSeconds: issued.resendAfterSeconds
    });
    return true;
  }

  /* گام ۲ — کد تأیید */
  if (req.method === "POST" && url.pathname === "/api/register/verify") {
    const code = normalizeCode(body.code);
    if (!code.ok) {
      json(res, 400, { ok: false, error: code.error });
      return true;
    }

    const result = await checkPhoneCode(userId, code.code);
    if (!result.ok) {
      json(res, 400, { ok: false, error: result.error });
      return true;
    }

    json(res, 200, { ok: true, profile: await profileOf(userId) });
    return true;
  }

  /* گام ۳ — نام و نام خانوادگی */
  if (req.method === "POST" && url.pathname === "/api/register/profile") {
    const current = await profileOf(userId);
    if (!current.phoneVerified) {
      json(res, 400, { ok: false, error: "اول شمارهٔ موبایل خود را ثبت کنید." });
      return true;
    }

    const first = validateName(body.firstName, "نام");
    if (!first.ok) {
      json(res, 400, { ok: false, error: first.error });
      return true;
    }

    const last = validateName(body.lastName, "نام خانوادگی");
    if (!last.ok) {
      json(res, 400, { ok: false, error: last.error });
      return true;
    }

    const email = validateEmail(body.email);
    if (!email.ok) {
      json(res, 400, { ok: false, error: email.error });
      return true;
    }

    const wasRegistered = current.registered;
    const profile = await completeRegistration(userId, first.name, last.name, email.email);

    // لید جدید را به تیم اطلاع بده (فقط بار اول)
    if (!wasRegistered) {
      notifyNewLead(profile, auth.user).catch((e) => console.error("[notify lead]", e.message));
    }

    json(res, 200, { ok: true, profile });
    return true;
  }

  /* ---------- نام و عکس مقصد، برای پیش‌نمایش تبلیغ ---------- */
  if (req.method === "GET" && url.pathname === "/api/chat") {
    const info = await getChatInfo(url.searchParams.get("u"));
    json(res, info.ok ? 200 : 404, info);
    return true;
  }

  /* ---------- لیست کمپین‌ها ---------- */
  if (req.method === "GET" && url.pathname === "/api/campaigns") {
    json(res, 200, { ok: true, campaigns: await listCampaignsByUser(userId, 100) });
    return true;
  }

  /* ---------- یک کمپین ---------- */
  const one = url.pathname.match(/^\/api\/campaigns\/([A-Za-z0-9-]{3,32})$/);
  if (req.method === "GET" && one) {
    const campaign = await getCampaignByCode(one[1]);
    if (!campaign || campaign.userId !== userId) {
      json(res, 404, { ok: false, error: "کمپین پیدا نشد." });
      return true;
    }
    json(res, 200, { ok: true, campaign });
    return true;
  }

  /* ---------- ثبت کمپین جدید ---------- */
  if (req.method === "POST" && url.pathname === "/api/campaigns") {
    if (!(await profileOf(userId)).registered) {
      json(res, 403, { ok: false, error: "برای ثبت سفارش، اول ثبت‌نام را کامل کنید." });
      return true;
    }

    if ((await countOrdersToday(userId)) >= config.maxOrdersPerDay) {
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

    // نام واقعی مقصد را از تلگرام می‌گیریم تا در پنل و پیام تیم درست نشان داده شود
    let channelTitle = "";
    try {
      const info = await getChatInfo(check.data.targetUrl);
      if (info.ok) channelTitle = info.title;
    } catch (e) { /* اگر نشد، اشکالی ندارد */ }

    /* پوستر را در تلگرام نگه می‌داریم، نه در دیتابیس خودمان: عکس را به
       چت تیم می‌فرستیم و فقط شناسه‌اش را ذخیره می‌کنیم. اگر فرستادن
       نشد، سفارش را به‌خاطرش رد نمی‌کنیم — سفارش مهم‌تر از پوستر است
       و کارشناس می‌تواند بعداً از مشتری بخواهد. */
    let posterFileId = "";
    if (check.data.posterBytes && config.adminChatId) {
      try {
        posterFileId = await sendPhoto(
          config.adminChatId,
          check.data.posterBytes,
          "🖼 پوستر سفارش تازه — " + check.data.brand
        );
      } catch (err) {
        console.error("[poster]", err.message);
      }
    }

    const campaign = await createCampaign(userId, { ...check.data, channelTitle, posterFileId });

    // اعلان‌ها نباید پاسخ به مشتری را معطل کنند
    notifyNewOrder(campaign, auth.user).catch((e) => console.error("[notify admin]", e.message));
    notifyOrderReceived(campaign).catch((e) => console.error("[notify user]", e.message));

    json(res, 201, { ok: true, campaign });
    return true;
  }

  json(res, 404, { ok: false, error: "این آدرس وجود ندارد." });
  return true;
}
