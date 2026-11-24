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

rem Abre el launcher directamente desde el codigo, sin generar el .exe.
if not exist "node_modules\electron" (
  echo  Instalando dependencias ^(solo la primera vez^)...
  call npm install || (pause & exit /b 1)
)
call npm start
