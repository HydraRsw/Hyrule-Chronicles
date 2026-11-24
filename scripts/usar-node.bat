@echo off
rem Deja Node.js disponible en esta consola. Si no esta en el PATH, lo activa con fnm.
rem Uso: call scripts\usar-node.bat   (errorlevel 1 si no hay Node)

where node >nul 2>nul
if not errorlevel 1 exit /b 0

where fnm >nul 2>nul
if errorlevel 1 goto :nonode
echo  Activando Node.js con fnm...
for /f "tokens=*" %%i in ('fnm env --shell cmd') do call %%i
fnm use default >nul 2>nul
where node >nul 2>nul
if not errorlevel 1 exit /b 0
set "FNMVER="
for /f "tokens=2" %%v in ('fnm list ^| findstr /r "v[0-9]"') do set "FNMVER=%%v"
if defined FNMVER fnm use %FNMVER% >nul 2>nul
where node >nul 2>nul
if not errorlevel 1 exit /b 0

:nonode
echo.
echo  [X] No encontre Node.js.
echo      Instala la version LTS desde https://nodejs.org y vuelve a intentarlo.
echo.
start "" "https://nodejs.org"
exit /b 1
