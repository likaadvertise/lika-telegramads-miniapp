@echo off
chcp 65001 >nul
cd /d "%~dp0"
title پر کردن فرم تلگرام ادز

echo.
echo  ====================================
echo   پر کردن فرم تلگرام ادز
echo  ====================================
echo.

if not exist "node_modules" (
  echo  ✖ اول فایل «1-ورود» را اجرا کنید.
  echo.
  pause
  exit /b 1
)

if not exist "session.json" (
  echo  ✖ هنوز وارد حساب نشده‌اید. اول فایل «1-ورود» را اجرا کنید.
  echo.
  pause
  exit /b 1
)

rem ---- سفارش را از حافظه (کلیپ‌بورد) برمی‌داریم ----
rem دکمهٔ «کپی برای تلگرام ادز» در پنل CRM آن را آنجا گذاشته است.
rem بدون BOM می‌نویسیم، وگرنه JSON خراب می‌شود.
powershell -NoProfile -Command "$t = Get-Clipboard -Raw; if ([string]::IsNullOrWhiteSpace($t)) { exit 1 }; [System.IO.File]::WriteAllText((Join-Path $PWD 'order.json'), $t, (New-Object System.Text.UTF8Encoding($false)))"

if errorlevel 1 (
  echo  ✖ چیزی در حافظه پیدا نشد.
  echo.
  echo    در پنل CRM سفارش را باز کنید و دکمهٔ
  echo    «کپی برای تلگرام ادز» را بزنید، بعد این فایل را اجرا کنید.
  echo.
  pause
  exit /b 1
)

echo  ✓ سفارش از حافظه برداشته شد.
echo.

set /p CPM=  CPM به واحد Gram (اگر می‌خواهید خودتان در پنل بنویسید، خالی بگذارید و Enter بزنید):

set PROXY=
if exist "proxy.txt" set /p PROXY=<proxy.txt

set ARGS=order.json
if not "%CPM%"=="" set ARGS=%ARGS% --cpm %CPM%
if not "%PROXY%"=="" set ARGS=%ARGS% --proxy %PROXY%

echo.
node fill.mjs %ARGS%

echo.
pause
