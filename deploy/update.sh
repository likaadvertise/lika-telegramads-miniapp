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

if [[ "${EUID}" -ne 0 ]]; then
  echo "این اسکریپت باید با کاربر root اجرا شود:  sudo bash update.sh"
  exit 1
fi

echo "گرفتن آخرین تغییرات…"
git -C "${APP_DIR}" -c safe.directory="${APP_DIR}" pull --ff-only

chown -R "${SVC_USER}:${SVC_USER}" "${APP_DIR}"

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
