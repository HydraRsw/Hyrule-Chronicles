@echo off
setlocal EnableExtensions
title Hyrule Chronicles - Publicar version
cd /d "%~dp0"
if not exist "package.json" if exist "hyrule-chronicles\package.json" cd /d "hyrule-chronicles"
if not exist "scripts\usar-node.bat" (
  echo  [X] No encuentro el proyecto. Pon este .bat dentro de la carpeta hyrule-chronicles, junto a package.json.
  echo      Carpeta actual: %CD%
  pause & exit /b 1
)
call "scripts\usar-node.bat" || (pause & exit /b 1)

if not exist ".git" (
  echo  [X] El proyecto aun no esta en GitHub. Ejecuta primero subir-a-github.bat
  pause & exit /b 1
)

for /f "delims=" %%v in ('node -p "require('./package.json').version"') do set "CURRENT=%%v"
echo.
echo  Version actual: %CURRENT%
echo.
echo  Que tipo de version es?
echo    1^) Arreglo pequeno      ^(patch: 1.4.0 -^> 1.4.1^)
echo    2^) Funciones nuevas     ^(minor: 1.4.0 -^> 1.5.0^)
echo    3^) Cambio grande        ^(major: 1.4.0 -^> 2.0.0^)
choice /c 123 /n /m "  Elige 1, 2 o 3: "
if errorlevel 3 (set BUMP=major) else if errorlevel 2 (set BUMP=minor) else (set BUMP=patch)

echo.
set /p "MSG=  Describe los cambios: "
if "%MSG%"=="" set "MSG=Cambios varios"

rem Si quedo una sincronizacion a medias de otra vez, se limpia antes de seguir
if exist ".git\rebase-merge" call :limpiar-rebase
if exist ".git\rebase-apply" call :limpiar-rebase

git add -A
git diff --cached --quiet || git commit -m "%MSG%" || (pause & exit /b 1)
rem Trae lo que haya en GitHub (por ejemplo, cambios subidos por Claude) antes de publicar
git pull --rebase --autostash origin main
if errorlevel 1 (
  rem Si hay conflicto, se deshace la sincronizacion para no dejar el repositorio a medias
  git rebase --abort >nul 2>nul
  echo.
  echo  [X] No se pudo sincronizar con GitHub ^(tus cambios estan a salvo en tu PC^).
  echo      Pasale a Claude los mensajes de arriba para resolverlo.
  pause & exit /b 1
)
rem "call" expande los %% dos veces: %%%%s llega a npm como %s (la version)
call npm version %BUMP% -m "v%%%%s - %MSG%" || (pause & exit /b 1)
git push --follow-tags || (pause & exit /b 1)

for /f "delims=" %%v in ('node -p "require('./package.json').version"') do set "NEW=%%v"
echo.
echo  [OK] Version v%NEW% enviada a GitHub.
echo       GitHub esta generando el instalador ^(tarda unos 5-10 minutos^).
echo       Cuando termine, el launcher instalado se actualizara solo.
for /f "delims=" %%u in ('git remote get-url origin') do set "URL=%%u"
set "URL=%URL:.git=%"
start "" "%URL%/actions"
echo.
pause
exit /b 0

:limpiar-rebase
rem HEAD "suelto" = hay un rebase realmente en curso -> se cancela.
rem Si no, son restos de uno que termino mal -> se borran.
set "HEADREF="
for /f "delims=" %%h in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "HEADREF=%%h"
if /i "%HEADREF%"=="HEAD" (
  echo  Habia una sincronizacion a medias. Cancelandola...
  git rebase --abort
) else (
  echo  Limpiando restos de una sincronizacion anterior...
  if exist ".git\rebase-merge" rmdir /s /q ".git\rebase-merge"
  if exist ".git\rebase-apply" rmdir /s /q ".git\rebase-apply"
)
exit /b 0
