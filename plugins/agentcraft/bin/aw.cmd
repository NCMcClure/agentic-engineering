@echo off
rem aw: the agent-works command line (cmd and PowerShell). Runs ..\skills\agent-works\scripts\aw.mjs under Node.
where node >nul 2>nul
if errorlevel 1 (
  echo aw: no Node.js on the PATH ^(agent-works needs Node 22 or newer^) 1>&2
  exit /b 127
)
node "%~dp0..\skills\agent-works\scripts\aw.mjs" %*
exit /b %ERRORLEVEL%
