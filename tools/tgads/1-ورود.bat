@echo off
chcp 65001 >nul
cd /d "%~dp0"
title ورود به تلگرام ادز

echo.
echo  ====================================
echo   ورود به حساب تلگرام ادز
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

set PROXY=
if exist "proxy.txt" set /p PROXY=<proxy.txt

if "%PROXY%"=="" (
  node fill.mjs --login
) else (
  echo  با پروکسی: %PROXY%
  node fill.mjs --login --proxy %PROXY%
)
goto done

:failed
echo.
echo  ✖ نصب انجام نشد. احتمالاً اتصال اینترنت به بیرون مشکل دارد.
echo    اگر VPN دارید روشنش کنید و دوباره امتحان کنید.

:done
echo.
pause
