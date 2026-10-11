@echo off
rem aw: the agent-works command line (cmd and PowerShell). Finds a Python 3 (python3, then python; the
rem Windows Store stub is skipped) and runs the CLI that ships beside this launcher.
setlocal
set "AW_PY="
for /f "delims=" %%i in ('where python3 python 2^>nul') do (
  if not defined AW_PY (
    echo %%i | findstr /i /c:"WindowsApps" >nul || set "AW_PY=%%i"
  )
)
if not defined AW_PY (
  echo aw: no Python 3 on the PATH ^(tried python3 and python^) 1>&2
  exit /b 127
)
"%AW_PY%" -B "%~dp0..\cli\aw.py" %*
exit /b %ERRORLEVEL%
