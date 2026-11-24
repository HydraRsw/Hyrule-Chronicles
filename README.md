# Hyrule Chronicles · Remix Collection

Launcher para Windows al estilo de las colecciones remix. Eliges un juego y una versión, importas tu dump una sola vez y juegas con un botón. Funciona con mando (XInput) o teclado.

## Cómo funciona cada tipo de versión

| Tipo | Qué hace el launcher | Qué pones tú |
|---|---|---|
| **Emulador integrado** | Corre el juego dentro del launcher (EmulatorJS). El núcleo se descarga la primera vez y queda guardado para jugar sin conexión. Las partidas se guardan solas. | Tu dump |
| **Port descargable** | Descarga la última versión oficial desde GitHub, la instala, la actualiza y, cuando se puede, verifica tu dump y lo coloca donde lo espera el port. | Tu dump (y, en algunos, un paso dentro del propio port la primera vez) |
| **Manual** | Lanza un programa que ya tienes. | El `.exe` (y el dump si hace falta) |

## Juegos y versiones

| Juego | Versiones |
|---|---|
| The Legend of Zelda | Emulador NES |
| Zelda II | Emulador NES |
| A Link to the Past | Emulador SNES · Zelda 3 Launcher (descarga) · zelda3 (manual, con importación verificada) |
| Link's Awakening DX | Emulador GB/GBC · LAS Recomp (manual) |
| Ocarina of Time | Ship of Harkinian (descarga + importación) · Emulador N64 |
| Majora's Mask | Zelda 64: Recompiled (descarga) · 2 Ship 2 Harkinian (descarga + importación verificada) |
| The Minish Cap | Emulador GBA · auto-tmc (manual) |
| The Wind Waker | Wind Waker HD Recomp (descarga) · Dolphin (manual) |
| Four Swords | mGBA Splitscreen integrado: 2-4 jugadores en este PC o online |
| Twilight Princess | Dusklight (descarga) · Dolphin (manual) |
| Skyward Sword | SkyRecomp (descarga) · Dolphin (manual) |
| ✦ Randomizer OoT + MM | Emulador N64 integrado · emulador externo (con la seed activa) |

### Detalles de importación por port
- **Ship of Harkinian:** el launcher copia tu ROM junto a `soh.exe`. Al primer arranque, SoH muestra "No OTR Files Found": pulsa **Sí** y extrae los assets.
- **2 Ship 2 Harkinian:** verifica el SHA-1 de tu ROM contra la lista oficial de versiones compatibles y lo copia junto a `2ship.exe`.
- **Zelda 64: Recompiled:** se instala en modo portable. Tu ROM USA se elige una vez en el menú del propio juego.
- **zelda3:** verifica que sea la ROM USA (SHA-256), la copia como `zelda3.sfc` y ejecuta `extract_assets.bat`, que necesita Python y los paquetes `pillow` y `pyyaml`. Este proyecto no publica `.exe`, así que tienes que compilarlo o usar el Zelda 3 Launcher.
- **Wind Waker HD Recomp:** al primer arranque pide tu dump de Wii U (USA o EUR, sin actualización): `.wux`/`.wud` con su clave, `.wua` de Cemu o una carpeta extraída. Después compila el juego; la primera vez descarga un compilador de 190 MB.
- **Dusklight / SkyRecomp / Zelda 3 Launcher:** cada uno pide el dump en su propia pantalla la primera vez. SkyRecomp necesita los archivos de Skyward Sword HD v1.0.0 ya extraídos.

El launcher no incluye juegos, ROMs, claves ni archivos de Nintendo.

## Four Swords (2 a 4 jugadores, local u online)

Usa la ROM de *A Link to the Past & Four Swords* (GBA). El launcher ejecuta las 4 GBA enlazadas por cable dentro de un mismo emulador ([mgba-splitscreen](https://github.com/Spuds0588/mgba-splitscreen), MPL-2.0), así que el enlace nunca sale del PC.

- **Solo:** el original exige 2 GBA, así que controlas a dos Links. *Tab* o *L3* cambia de Link, y *C* o *R3* activa el modo espejo, en el que los dos te siguen (para empujar bloques juntos).
- **En este PC:** de 2 a 4 jugadores, un mando cada uno; el teclado también cuenta como jugador 1.
- **Online:** crea una sala, pasa el código de 5 cifras o búscala en *Salas abiertas*. Cuando el anfitrión pulsa *Empezar*, cada PC emula las 4 GBA y por internet solo viajan los botones (lockstep). Cada 2 segundos se compara el estado para detectar desincronizaciones. Todos necesitan la misma ROM.
- **Servidor:** usa el de Strikers Online, que tiene salas `mp_` de 2 a 4 jugadores. Se puede cambiar en *Avanzado*.
- **Controles:** flechas, X = A, Z = B, Enter = Start, Retroceso = Select, A/S = L/R. Con mando: A, B, LB/RB, Start, Back. Esc abre el menú.

## Randomizer (OoTMM)

La entrada **✦ Randomizer · OoT + MM** usa el [Ocarina of Time + Majora's Mask Combo Randomizer](https://github.com/OoTMM/OoTMM):
1. En *Configurar* pulsa **Abrir generador**. Se abre el generador oficial (ootmm.com) dentro del launcher.
2. Carga tus ROMs: Ocarina of Time (USA o JP, v1.0) y Majora's Mask (USA), en `.z64`. Elige las opciones y genera.
3. Al descargar, la seed se guarda sola en el launcher y queda activa. El spoiler log y los demás archivos se guardan junto a ella.
4. Juega con el emulador N64 integrado o con tu emulador externo. Cada seed guarda sus propias partidas.

También puedes importar una seed `.z64` generada en otro lado. Las seeds están en `%APPDATA%\hyrule-chronicles\randomizer\`.

## Descargar dependencias (todo de una vez)

En **START › Ajustes › Descargar dependencias** el launcher descarga, uno tras otro:
- todos los ports desde sus repositorios oficiales de GitHub (Zelda 3 Launcher, Ship of Harkinian, Zelda 64: Recompiled, 2 Ship 2 Harkinian, Wind Waker HD Recomp, Dusklight y SkyRecomp);
- los núcleos del emulador integrado (NES, SNES, GB/GBC, GBA y N64), que quedan en caché para jugar sin conexión.

Lo que ya está instalado se salta. Con **Descargar y actualizar todo**, además pone al día los ports que tengan una versión nueva. Si algún elemento falla, el resto sigue descargándose y el error aparece en su fila. Después solo queda importar tu dump en *Configurar* de cada juego.

## Instalar y ejecutar

Requisitos: [Node.js](https://nodejs.org) LTS (o fnm) y, para GitHub, [Git](https://git-scm.com).

| Script | Para qué |
|---|---|
| `iniciar.bat` | Abre el launcher directamente desde el código. Es lo más rápido para probar cambios, sin generar el `.exe`. |
| `build.bat` | Genera un instalador (se actualiza solo) o un `.exe` portable en `dist/`. |
| `subir-a-github.bat` | Se usa una sola vez: conecta el proyecto con un repositorio de GitHub y lo sube. |
| `publicar.bat` | Crea una versión nueva (1.4.0 → 1.4.1…), la sube, y GitHub compila y publica el instalador. |

### Versiones y actualizaciones automáticas
1. Crea un repositorio **vacío y público** en GitHub y ejecuta `subir-a-github.bat`.
2. Cada vez que quieras publicar cambios, ejecuta `publicar.bat`. GitHub Actions compila el instalador en unos minutos y lo publica en *Releases*.
3. Instala el launcher una vez con ese instalador (`HyruleChronicles-Setup-x.y.z.exe`). Desde entonces, al abrirlo detecta las versiones nuevas, las descarga y las instala al reiniciar. También puedes hacerlo a mano en *Ajustes › Actualizaciones*.

La versión portable no se actualiza sola. Tus ajustes, ports, seeds y partidas están en `%APPDATA%\hyrule-chronicles\` y se conservan al actualizar.

## Controles

| Acción | Mando | Teclado |
|---|---|---|
| Moverse | Cruceta / stick | Flechas |
| Jugar / aceptar | A | Enter |
| Cambiar versión | LB / RB | Q / E, ← → |
| Configurar juego | X | C |
| Ajustes | START | Tab |
| Atrás / título | B | Esc |
| Menú de pausa del emulador (guardar/cargar estado, reiniciar, volver) | Mantener SELECT + START | Esc |
| Pantalla completa | — | F11 |

## Portadas
Pon tus imágenes en la carpeta de portadas (botón en Configurar), nombradas con el id del juego: `zelda1`, `zelda2`, `alttp`, `la`, `oot`, `mm`, `ww`, `tmc`, `tp`, `ss`, `ootmm` (`.jpg`, `.png` o `.webp`). Se cargan al instante. Una carátula vertical se muestra en el panel del juego; una imagen horizontal se usa como fondo.

## Añadir más juegos
Edita `games.js`. Tipos: `emu` (núcleo de EmulatorJS: `nes`, `snes`, `gb`, `gba`, `n64`…), `port` (repo de GitHub + expresión para el archivo de Windows + nombre del `.exe` + modo de importación) y `manual`.
