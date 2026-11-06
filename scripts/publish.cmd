@echo off
rem Wrapper so this works from Explorer (double-click) and from a terminal.
rem This machine runs PowerShell with ExecutionPolicy=Restricted, so .ps1 cannot be
rem launched directly; -ExecutionPolicy Bypass applies to this process only.
setlocal
set "SCRIPT=%~dp0publish.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" %*
if errorlevel 1 (
  echo.
  echo Push failed. See the messages above.
)
echo.
pause
