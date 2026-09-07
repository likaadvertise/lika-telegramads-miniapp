@echo off
chcp 65001 >nul
cd /d "%~dp0"
title دستیار Lika Ads

echo.
echo  ====================================
echo   دستیار Lika Ads
echo  ====================================
echo.

if not exist "node_modules" (
  echo  اولین اجراست - ابزار را نصب می‌کنم. چند دقیقه طول می‌کشد...
  echo.
  call npm install
  if errorlevel 1 goto failed
  call npx playwright install chromium
  if errorlevel 1 goto failed
  echo.
)

if not exist "session.json" (
  echo  ✖ هنوز وارد حساب نشده‌اید. اول فایل «1-ورود» را اجرا کنید.
  echo.
  pause
  exit /b 1
)

echo  این پنجره را باز نگه دارید.
echo  حالا در پنل CRM (‎/admin) کنار هر سفارش دکمهٔ «پر کن (خودکار)» را می‌بینید.
echo  برای خاموش‌کردن دستیار، همین پنجره را ببندید.
echo.

node agent.mjs
goto done

:failed
echo.
echo  ✖ نصب انجام نشد. احتمالاً اتصال اینترنت به بیرون مشکل دارد.
echo    اگر VPN دارید روشنش کنید و دوباره امتحان کنید.

:done
echo.
pause
