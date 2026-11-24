@echo off
setlocal EnableExtensions
title Hyrule Chronicles - Subir a GitHub
cd /d "%~dp0"
if not exist "package.json" if exist "hyrule-chronicles\package.json" cd /d "hyrule-chronicles"
if not exist "scripts\usar-node.bat" (
  echo  [X] No encuentro el proyecto. Pon este .bat dentro de la carpeta hyrule-chronicles, junto a package.json.
  echo      Carpeta actual: %CD%
  pause & exit /b 1
)

echo.
echo  ==============================================
echo    Subir Hyrule Chronicles a GitHub ^(una vez^)
echo  ==============================================
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo  [X] No encontre Git. Instalalo con:   winget install Git.Git
  echo      o desde https://git-scm.com y vuelve a abrir este archivo.
  start "" "https://git-scm.com/download/win"
  pause & exit /b 1
)

if exist ".git" (
  echo  Este proyecto ya esta conectado a un repositorio:
  git remote -v
  echo.
  echo  Para publicar versiones nuevas usa publicar.bat
  pause & exit /b 0
)

echo  1^) Crea un repositorio VACIO en https://github.com/new
echo     ^(sin README ni .gitignore; publico para que funcionen las actualizaciones^)
echo  2^) Copia su direccion, por ejemplo https://github.com/tu-usuario/hyrule-chronicles.git
echo.
start "" "https://github.com/new"
set /p "REPO=  Pega aqui la direccion del repositorio: "
if "%REPO%"=="" (echo  No escribiste nada. & pause & exit /b 1)

call "scripts\usar-node.bat" >nul 2>nul
if not errorlevel 1 (
  call npm pkg set "repository.type=git" "repository.url=%REPO%" >nul
)

git init -b main || (pause & exit /b 1)
git add -A
git commit -m "Hyrule Chronicles: primera version" || (pause & exit /b 1)
git remote add origin "%REPO%"
git push -u origin main || (
  echo.
  echo  [X] No se pudo subir. Comprueba la direccion y que has iniciado sesion en GitHub.
  pause & exit /b 1
)

echo.
echo  [OK] Subido. A partir de ahora:
echo       - publicar.bat   crea una version nueva y GitHub genera el instalador
echo       - iniciar.bat    prueba tus cambios sin generar el .exe
echo.
pause
