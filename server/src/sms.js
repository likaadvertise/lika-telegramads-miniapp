/* =========================================================
   ارسال پیامک
   ---------------------------------------------------------
   چرا پیامک؟

   کد تأییدی که در تلگرام فرستاده می‌شود، به همان حسابی می‌رسد که
   همین حالا داخل مینی‌اپ است. یعنی هر کسی می‌تواند شمارهٔ یک غریبه
   را وارد کند و کد را در چت خودش ببیند. آن روش شماره را «ثبت»
   می‌کند ولی «تأیید» نمی‌کند.

   با پیامک، کد به خودِ آن شماره می‌رود. اگر کاربر کد را برگرداند،
   یعنی واقعاً به آن سیم‌کارت دسترسی دارد.

   ---------------------------------------------------------
   کدام سرویس؟

   سه حالت پشتیبانی می‌شود و با SMS_PROVIDER انتخاب می‌شود:

     kavenegar  کاوه‌نگار (سرویس «لوکاپ» با الگوی از پیش تأییدشده)
     smsir      sms.ir (سرویس «ارسال تأییدیه»)
     custom     هر سرویس دیگری، با آدرسی که خودتان می‌دهید

   اگر SMS_PROVIDER خالی باشد، پیامکی فرستاده نمی‌شود و برنامه
   مثل قبل کد را در تلگرام می‌فرستد. پس تا وقتی پنل پیامکی ندارید،
   هیچ‌چیز خراب نمی‌شود.
   ========================================================= */

import { config } from "./config.js";

/** آیا پیامک تنظیم شده و آمادهٔ استفاده است؟ */
export function smsEnabled() {
  return Boolean(config.smsProvider && config.smsApiKey);
}

/** شمارهٔ ذخیره‌شده به شکل +989… است؛ سرویس‌های ایرانی 09… می‌خواهند */
function localNumber(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("98")) return "0" + digits.slice(2);
  if (digits.startsWith("0")) return digits;
  return "0" + digits;
}

async function postJson(url, { headers = {}, body } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });

    const text = await res.text();
    if (!res.ok) throw new Error(`سرویس پیامک پاسخ ${res.status} داد: ${text.slice(0, 200)}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- کاوه‌نگار ---------- */
async function sendKavenegar(phone, code) {
  const url = new URL(
    `${config.smsBaseUrl || "https://api.kavenegar.com"}/v1/${config.smsApiKey}/verify/lookup.json`
  );
  url.searchParams.set("receptor", localNumber(phone));
  url.searchParams.set("token", String(code));
  url.searchParams.set("template", config.smsTemplate);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`کاوه‌نگار پاسخ ${res.status} داد: ${text.slice(0, 200)}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- sms.ir ---------- */
async function sendSmsIr(phone, code) {
  return postJson(`${config.smsBaseUrl || "https://api.sms.ir"}/v1/send/verify`, {
    headers: { "x-api-key": config.smsApiKey, Accept: "application/json" },
    body: {
      mobile: localNumber(phone),
      templateId: Number(config.smsTemplate) || config.smsTemplate,
      parameters: [{ name: config.smsCodeParam || "CODE", value: String(code) }]
    }
  });
}

/* ---------- سرویس دلخواه ---------- */
/*
   برای هر پنل دیگری: آدرس را در SMS_BASE_URL بگذارید و در متن
   الگو، {phone} و {code} را هرجا لازم است بنویسید.
*/
async function sendCustom(phone, code) {
  const fill = (s) =>
    String(s || "")
      .replaceAll("{phone}", localNumber(phone))
      .replaceAll("{code}", String(code))
      .replaceAll("{apiKey}", config.smsApiKey);

  const url = fill(config.smsBaseUrl);
  if (!url) throw new Error("برای حالت custom باید SMS_BASE_URL را پر کنید.");

  if (!config.smsBody) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      const text = await res.text();
      if (!res.ok) throw new Error(`سرویس پیامک پاسخ ${res.status} داد: ${text.slice(0, 200)}`);
      return text;
    } finally {
      clearTimeout(timer);
    }
  }

  let body;
  try {
    body = JSON.parse(fill(config.smsBody));
  } catch {
    throw new Error("SMS_BODY باید یک JSON معتبر باشد.");
  }

  const headers = {};
  if (config.smsApiKey) headers[config.smsAuthHeader || "x-api-key"] = config.smsApiKey;

  return postJson(url, { headers, body });
}

const SENDERS = {
  kavenegar: sendKavenegar,
  smsir: sendSmsIr,
  custom: sendCustom
};

/**
 * کد تأیید را پیامک می‌کند.
 * اگر نرسد، خطا می‌دهد — چون کاربر بدون کد نمی‌تواند ادامه دهد و
 * باید بداند مشکلی پیش آمده، نه اینکه بی‌صدا منتظر پیامکی بماند که نمی‌آید.
 */
export async function sendSmsCode(phone, code) {
  const send = SENDERS[config.smsProvider];
  if (!send) throw new Error(`سرویس پیامک «${config.smsProvider}» پشتیبانی نمی‌شود.`);
  return send(phone, code);
}
