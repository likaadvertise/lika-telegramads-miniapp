#!/usr/bin/env bash
# =========================================================
#  Lika Ads — به‌روزرسانی سرور
#  ---------------------------------------------------------
#  آخرین تغییرات را از گیت‌هاب می‌گیرد و سرویس را دوباره
#  راه‌اندازی می‌کند. تنظیمات (.env) و دیتابیس دست‌نخورده می‌مانند.
#
#  اجرا:  bash /opt/lika-ads/deploy/update.sh
# =========================================================

set -euo pipefail

APP_DIR="/opt/lika-ads"
SERVICE="lika-ads"
SVC_USER="lika"
CRED_FILE="/etc/lika-ads/git-credentials"

if [[ "${EUID}" -ne 0 ]]; then
  echo "این اسکریپت باید با کاربر root اجرا شود:  sudo bash update.sh"
  exit 1
fi

if [[ ! -f "${CRED_FILE}" ]]; then
  echo "✖ توکن گیت‌هاب پیدا نشد (${CRED_FILE})."
  echo "  یعنی نصب اولیه ناقص بوده. دوباره setup.sh را اجرا کنید."
  exit 1
fi

echo "گرفتن آخرین تغییرات…"
git -C "${APP_DIR}" -c safe.directory="${APP_DIR}" \
    -c credential.helper="store --file=${CRED_FILE}" pull --ff-only

chown -R "${SVC_USER}:${SVC_USER}" "${APP_DIR}"
chown -R root:root "${APP_DIR}/.git"
chmod -R go-rwx "${APP_DIR}/.git"

echo "راه‌اندازی مجدد سرویس…"
systemctl restart "${SERVICE}"

sleep 3
if systemctl is-active --quiet "${SERVICE}"; then
  echo "✔ به‌روزرسانی انجام شد و سرویس در حال اجراست."
else
  echo "✖ سرویس بالا نیامد. برای دیدن دلیل:"
  echo "   journalctl -u ${SERVICE} -n 40 --no-pager"
  exit 1
fi
