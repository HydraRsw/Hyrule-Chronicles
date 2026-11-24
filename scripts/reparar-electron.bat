@echo off
rem Comprueba que Electron este bien instalado (electron.exe) y lo repara si falta.
rem Uso: call scripts\reparar-electron.bat   (errorlevel 1 si no se pudo)
rem
rem Con algunas versiones de Node el instalador de Electron descarga el zip pero
rem deja la extraccion a medias sin dar error. Aqui se extrae con tar de Windows.

set "EDIR=node_modules\electron"
if exist "%EDIR%\dist\electron.exe" exit /b 0

if not exist "%EDIR%\package.json" (
  echo  Instalando dependencias ^(solo la primera vez, puede tardar unos minutos^)...
  call npm install
  if exist "%EDIR%\dist\electron.exe" exit /b 0
  if not exist "%EDIR%\package.json" goto :fail
)

for /f "delims=" %%v in ('node -p "require('./%EDIR:\=/%/package.json').version"') do set "EV=%%v"
echo.
echo  Electron %EV% no esta completo ^(falta electron.exe^). Reparando...

call :findzip
if not defined ZIP (
  echo  Descargando Electron %EV% ^(unos 100 MB^)...
  node "%EDIR%\install.js"
  if exist "%EDIR%\dist\electron.exe" goto :ok
  call :findzip
)
if not defined ZIP goto :fail

echo  Extrayendo %ZIP%
if exist "%EDIR%\dist" rmdir /s /q "%EDIR%\dist"
mkdir "%EDIR%\dist"
tar -xf "%ZIP%" -C "%EDIR%\dist"
if not exist "%EDIR%\dist\electron.exe" goto :fail
if exist "%EDIR%\dist\electron.d.ts" move /y "%EDIR%\dist\electron.d.ts" "%EDIR%\electron.d.ts" >nul
rem path.txt sin salto de linea: indica a Electron cual es su ejecutable
<nul set /p "=electron.exe" > "%EDIR%\path.txt"
goto :ok

:findzip
set "ZIP="
set "CACHE=%ELECTRON_CONFIG_CACHE%"
if not defined CACHE set "CACHE=%LOCALAPPDATA%\electron\Cache"
if not exist "%CACHE%" exit /b 0
for /r "%CACHE%" %%f in (electron-v%EV%-win32-x64.zip) do if exist "%%f" set "ZIP=%%f"
exit /b 0

:fail
echo.
echo  [X] No se pudo instalar Electron.
echo      - Revisa tu conexion a internet.
echo      - Revisa si el antivirus puso electron.exe en cuarentena
echo        ^(Seguridad de Windows ^> Proteccion contra virus ^> Historial de proteccion^).
exit /b 1

:ok
echo  [OK] Electron listo.
exit /b 0
