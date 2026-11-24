@echo off
setlocal EnableExtensions
title Hyrule Chronicles - Modo desarrollo
cd /d "%~dp0"
if not exist "package.json" if exist "hyrule-chronicles\package.json" cd /d "hyrule-chronicles"
if not exist "scripts\usar-node.bat" (
  echo  [X] No encuentro el proyecto. Pon este .bat dentro de la carpeta hyrule-chronicles, junto a package.json.
  echo      Carpeta actual: %CD%
  pause & exit /b 1
)
call "scripts\usar-node.bat" || (pause & exit /b 1)

rem Instala lo que falte (o repara Electron) antes de abrir.
if not exist "node_modules\electron-updater" call npm install
call "scripts\reparar-electron.bat" || (pause & exit /b 1)

rem Abre el launcher directamente desde el codigo, sin generar el .exe.
echo.
echo  Abriendo Hyrule Chronicles... ^(cierra el launcher para terminar^)
call npm start
if errorlevel 1 (
  echo.
  echo  [X] El launcher se cerro con un error. Copia los mensajes de arriba para revisarlo.
  pause
  exit /b 1
)
