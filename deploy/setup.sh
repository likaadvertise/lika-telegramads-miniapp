#!/usr/bin/env bash
# =========================================================
#  Lika Ads — نصب خودکار روی سرور اوبونتو
#  ---------------------------------------------------------
#  این اسکریپت همه‌چیز را نصب و راه‌اندازی می‌کند:
#    • Node.js نسخه ۲۲
#    • وب‌سرور Caddy برای گرفتن خودکار گواهی https
#    • سرور و ربات Lika Ads به‌صورت سرویس دائمی
#
#  اجرا (روی سروری که تازه خریده‌اید، با کاربر root):
#    bash setup.sh
# =========================================================

set -euo pipefail

APP_DIR="/opt/lika-ads"
REPO="https://github.com/likaadvertise/lika-telegramads-miniapp.git"
SERVICE="lika-ads"
SVC_USER="lika"
PORT="3000"

red()  { printf "\033[31m%s\033[0m\n" "$*"; }
grn()  { printf "\033[32m%s\033[0m\n" "$*"; }
bld()  { printf "\033[1m%s\033[0m\n" "$*"; }

if [[ "${EUID}" -ne 0 ]]; then
  red "این اسکریپت باید با کاربر root اجرا شود."
  echo "دستور درست:  sudo bash setup.sh"
  exit 1
fi

if ! grep -qi ubuntu /etc/os-release 2>/dev/null; then
  red "این اسکریپت برای اوبونتو نوشته شده است."
  echo "اگر سیستم‌عامل دیگری دارید، مراحل را دستی از فایل deploy/README.md دنبال کنید."
  exit 1
fi

echo
bld "=============================================="
bld "   نصب Lika Ads"
bld "=============================================="
echo

# ---------- ۱) گرفتن اطلاعات ----------
read -rp "دامنه یا زیردامنهٔ سرور (مثلاً ads.lika.com): " DOMAIN
[[ -z "${DOMAIN}" ]] && { red "دامنه اجباری است."; exit 1; }

read -rp "توکن ربات از BotFather: " BOT_TOKEN
[[ -z "${BOT_TOKEN}" ]] && { red "توکن اجباری است."; exit 1; }

read -rp "شناسهٔ عددی شما در تلگرام (از @userinfobot): " ADMIN_ID
[[ -z "${ADMIN_ID}" ]] && { red "شناسه اجباری است."; exit 1; }

read -rp "شناسهٔ چتی که سفارش‌ها به آن برود [پیش‌فرض: خودتان]: " ADMIN_CHAT
ADMIN_CHAT="${ADMIN_CHAT:-$ADMIN_ID}"

echo
bld "خلاصه:"
echo "  دامنه:        ${DOMAIN}"
echo "  مدیر:         ${ADMIN_ID}"
echo "  چت سفارش‌ها:  ${ADMIN_CHAT}"
echo "  محل نصب:      ${APP_DIR}"
echo
read -rp "شروع کنم؟ (y/n) " OK
[[ "${OK}" != "y" ]] && { echo "لغو شد."; exit 0; }

# ---------- ۲) پیش‌نیازها ----------
echo
bld "[۱/۶] به‌روزرسانی سیستم…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https >/dev/null

# ---------- ۳) Node.js ۲۲ ----------
bld "[۲/۶] نصب Node.js نسخه ۲۲…"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs >/dev/null
fi
grn "      Node.js $(node -v)"

# ---------- ۴) Caddy ----------
bld "[۳/۶] نصب Caddy (برای گواهی https رایگان)…"
if ! command -v caddy >/dev/null 2>&1; then
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
fi
grn "      $(caddy version | head -1)"

# ---------- ۵) کد پروژه ----------
bld "[۴/۶] گرفتن کد پروژه…"
if [[ -d "${APP_DIR}/.git" ]]; then
  git -C "${APP_DIR}" -c safe.directory="${APP_DIR}" pull --ff-only
else
  rm -rf "${APP_DIR}"
  git clone --depth 1 "${REPO}" "${APP_DIR}"
fi

mkdir -p "${APP_DIR}/server/data"

# کاربر جداگانه برای سرویس (سرویس نباید با دسترسی root اجرا شود)
if ! id -u "${SVC_USER}" >/dev/null 2>&1; then
  useradd --system --home-dir "${APP_DIR}" --shell /usr/sbin/nologin "${SVC_USER}"
fi

cat > "${APP_DIR}/server/.env" <<EOF
BOT_TOKEN=${BOT_TOKEN}
WEBAPP_URL=https://${DOMAIN}
ADMIN_CHAT_ID=${ADMIN_CHAT}
ADMIN_IDS=${ADMIN_ID}
PORT=${PORT}
DB_PATH=./data/lika.db
BOT_MODE=polling
SERVE_WEBAPP=1
EOF
chmod 600 "${APP_DIR}/server/.env"
chown -R "${SVC_USER}:${SVC_USER}" "${APP_DIR}"
grn "      کد و تنظیمات آماده شد"

# ---------- ۶) سرویس دائمی ----------
bld "[۵/۶] ساخت سرویس دائمی…"
cat > "/etc/systemd/system/${SERVICE}.service" <<EOF
[Unit]
Description=Lika Ads — سرور و ربات تلگرام
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}/server
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=5
User=${SVC_USER}
Group=${SVC_USER}
Environment=NODE_ENV=production

# محدودسازی دسترسی سرویس
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${APP_DIR}/server/data

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now "${SERVICE}" >/dev/null 2>&1

# ---------- ۷) Caddy ----------
bld "[۶/۶] تنظیم https…"
cat > /etc/caddy/Caddyfile <<EOF
${DOMAIN} {
	encode gzip
	reverse_proxy 127.0.0.1:${PORT}
}
EOF

systemctl reload caddy 2>/dev/null || systemctl restart caddy

# ---------- نتیجه ----------
sleep 3
echo
if systemctl is-active --quiet "${SERVICE}"; then
  grn "=============================================="
  grn "   نصب با موفقیت انجام شد"
  grn "=============================================="
  echo
  echo "  آدرس مینی‌اپ:  https://${DOMAIN}"
  echo
  bld "  دو کار باقی مانده:"
  echo "   ۱) در BotFather دستور /setmenubutton را بزنید"
  echo "      و این آدرس را بدهید:  https://${DOMAIN}"
  echo "   ۲) در ربات خودتان /start بزنید"
  echo
  bld "  دستورهای مفید:"
  echo "   دیدن لاگ زنده:   journalctl -u ${SERVICE} -f"
  echo "   وضعیت سرویس:     systemctl status ${SERVICE}"
  echo "   راه‌اندازی مجدد:  systemctl restart ${SERVICE}"
  echo "   به‌روزرسانی کد:   bash ${APP_DIR}/deploy/update.sh"
  echo
else
  red "=============================================="
  red "   سرویس بالا نیامد"
  red "=============================================="
  echo
  echo "  برای دیدن دلیل، این دستور را بزنید:"
  echo "   journalctl -u ${SERVICE} -n 40 --no-pager"
  echo
  exit 1
fi
