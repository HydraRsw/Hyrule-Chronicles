@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Hyrule Chronicles - Generar .exe
cd /d "%~dp0"

echo.
echo  ==============================================
echo    HYRULE CHRONICLES  ·  Generar ejecutable
echo  ==============================================
echo.

if not exist "package.json" if exist "hyrule-chronicles\package.json" cd /d "hyrule-chronicles"
if not exist "scripts\usar-node.bat" (
  echo  [X] No encuentro el proyecto. Pon este .bat dentro de la carpeta hyrule-chronicles, junto a package.json.
  echo      Carpeta actual: %CD%
  pause & exit /b 1
)
call "scripts\usar-node.bat" || (pause & exit /b 1)
for /f "delims=" %%v in ('node -v') do set NODEVER=%%v
echo  [OK] Node.js %NODEVER%

echo.
echo  Que quieres generar?
echo    1^) Instalador - se actualiza solo desde GitHub ^(recomendado^)
echo    2^) Portable   - un solo .exe, sin instalar ni actualizaciones
echo.
choice /c 12 /n /m "  Elige 1 o 2: "
if errorlevel 2 (set TARGET=portable) else (set TARGET=nsis)
echo.

if not exist "node_modules\electron-updater" (
  echo  Instalando dependencias ^(solo la primera vez, puede tardar unos minutos^)...
  call npm install
  if errorlevel 1 goto :fail
) else (
  echo  [OK] Dependencias ya instaladas
)

if exist "dist" rmdir /s /q "dist"
echo.
echo  Generando el .exe ^(%TARGET%^)...
call npx electron-builder --win %TARGET% --x64 --publish never
if not errorlevel 1 goto :ok

rem Si falla por permisos de enlaces simbolicos (Windows sin modo desarrollador),
rem reintenta sin editar los metadatos del .exe.
echo.
echo  Primer intento fallido. Reintentando en modo compatible...
call npx electron-builder --win %TARGET% --x64 --publish never -c.win.signAndEditExecutable=false
if errorlevel 1 goto :fail

:ok
echo.
echo  ==============================================
echo    Listo. Tu .exe esta en la carpeta "dist".
echo  ==============================================
for %%f in ("dist\*.exe") do echo    %%~nxf
echo.
start "" explorer "%~dp0dist"
pause
exit /b 0

:fail
echo.
echo  [X] Algo fallo al generar el .exe. Revisa los mensajes de arriba.
echo      Consejo: activa el "Modo de desarrollador" de Windows
echo      ^(Configuracion ^> Sistema ^> Para programadores^) y vuelve a intentarlo.
echo.
pause
exit /b 1
