/* =========================================================
   Lika Ads — نقطهٔ شروع سرور
   ---------------------------------------------------------
   اجرا:  npm start   (یا: node src/index.js)
   ========================================================= */

import http from "node:http";
import { config, checkConfig } from "./config.js";
import { handleApi } from "./api.js";
import { serveStatic } from "./static.js";
import { handleUpdate, startPolling } from "./bot.js";
import { setupBot, tryCall } from "./telegram.js";

/* ---------- ۱) بررسی نسخهٔ Node ---------- */
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(
    `\n✖ نسخهٔ Node.js شما ${process.versions.node} است.\n` +
    "  این پروژه به Node.js نسخهٔ ۲۲٫۵ یا بالاتر نیاز دارد (به‌خاطر دیتابیس داخلی).\n" +
    "  از nodejs.org آخرین نسخهٔ LTS را نصب کنید.\n"
  );
  process.exit(1);
}

/* ---------- ۲) بررسی تنظیمات ---------- */
const { errors, warnings } = checkConfig();

for (const w of warnings) console.warn("⚠  " + w);

if (errors.length) {
  console.error("\n✖ سرور بالا نیامد. مشکلات فایل .env :\n");
  for (const e of errors) console.error("   • " + e);
  console.error("\n  راهنما: فایل .env.example را کپی کنید، اسمش را .env بگذارید و پرش کنید.\n");
  process.exit(1);
}

/* ---------- ۳) سرور HTTP ---------- */
const webhookPath = config.botMode === "webhook" ? `/tg/${config.webhookSecret}` : null;

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  } catch {
    res.writeHead(400);
    res.end("Bad Request");
    return;
  }

  try {
    // پیام‌های تلگرام (فقط در حالت webhook)
    if (webhookPath && req.method === "POST" && url.pathname === webhookPath) {
      if (req.headers["x-telegram-bot-api-secret-token"] !== config.webhookSecret) {
        res.writeHead(401);
        res.end();
        return;
      }

      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);

      res.writeHead(200);
      res.end(); // اول پاسخ می‌دهیم تا تلگرام منتظر نماند

      try {
        await handleUpdate(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (err) {
        console.error("[webhook]", err.message);
      }
      return;
    }

    if (await handleApi(req, res, url)) return;

    if (config.serveWebapp && serveStatic(req, res, url)) return;

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("صفحه پیدا نشد");
  } catch (err) {
    console.error("[http]", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: "خطای داخلی سرور" }));
    }
  }
});

/* ---------- ۴) بالا آوردن ---------- */
let stopPolling = null;

server.listen(config.port, async () => {
  console.log(`\n✔ سرور روی پورت ${config.port} بالا آمد`);
  console.log(`  مینی‌اپ: ${config.webappUrl}`);

  try {
    const me = await setupBot();
    console.log(`✔ ربات متصل شد: @${me.username}`);

    if (config.botMode === "webhook") {
      await tryCall("setWebhook", {
        url: `${config.webappUrl}${webhookPath}`,
        secret_token: config.webhookSecret,
        allowed_updates: ["message", "callback_query"]
      });
      console.log("✔ حالت دریافت پیام: webhook");
    } else {
      await tryCall("deleteWebhook", { drop_pending_updates: false });
      stopPolling = startPolling();
      console.log("✔ حالت دریافت پیام: polling");
    }

    console.log(`\n  حالا در تلگرام به @${me.username} پیام /start بدهید.\n`);
  } catch (err) {
    console.error("\n✖ اتصال به تلگرام ناموفق بود:", err.message);
    console.error("  معمولاً یعنی BOT_TOKEN اشتباه است یا سرور به اینترنت دسترسی ندارد.\n");
  }
});

/* ---------- ۵) خاموش شدن تمیز ---------- */
function shutdown(signal) {
  console.log(`\n${signal} — در حال خاموش کردن…`);
  if (stopPolling) stopPolling();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
