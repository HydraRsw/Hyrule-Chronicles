// Catálogo de la colección. Cada juego puede tener varias "versiones" (variants),
// que se eligen con ◀ ▶ / LB RB en el menú.
//
// type: 'emu'    -> emulador integrado (EmulatorJS) dentro del launcher. Solo pide el dump.
// type: 'port'   -> port/recomp que el launcher descarga de GitHub, instala y actualiza.
//                   import.mode:
//                     'copy-rom' -> el launcher verifica el dump y lo copia junto al .exe
//                     'guided'   -> el propio port pide el dump la primera vez (se muestran pasos)
// type: 'manual' -> programa que el usuario ya tiene; se elige su .exe (args admiten {rom})

module.exports = [
  {
    id: 'zelda1',
    title: 'The Legend of Zelda',
    era: 'NES · 1986',
    theme: ['#e0b23a', '#3a2a08'],
    desc: 'La aventura que lo empezó todo. Explora Hyrule a tu ritmo, reúne los ocho fragmentos de la Trifuerza de la Sabiduría y enfréntate a Ganon en la Montaña de la Muerte.',
    variants: [
      { id: 'emu', name: 'Emulador integrado · NES', type: 'emu', core: 'nes', romExt: ['nes', 'zip'] }
    ]
  },
  {
    id: 'zelda2',
    title: 'Zelda II: The Adventure of Link',
    short: 'Zelda II: Adventure of Link',
    era: 'NES · 1987',
    theme: ['#d2553a', '#2e0c06'],
    desc: 'Link regresa con combate lateral, magia y experiencia. Recorre seis palacios para despertar a la princesa Zelda y supera el reto final: tu propia sombra.',
    variants: [
      { id: 'emu', name: 'Emulador integrado · NES', type: 'emu', core: 'nes', romExt: ['nes', 'zip'] }
    ]
  },
  {
    id: 'alttp',
    title: 'A Link to the Past',
    era: 'Super Nintendo · 1991',
    theme: ['#4fbf6b', '#08240f'],
    desc: 'Viaja entre el Mundo de la Luz y el Mundo Oscuro para detener al hechicero Agahnim. La aventura que definió la fórmula clásica de la saga.',
    variants: [
      { id: 'emu', name: 'Emulador integrado · SNES', type: 'emu', core: 'snes', romExt: ['sfc', 'smc', 'zip'] },
      {
        id: 'z3launcher', name: 'Zelda 3 Launcher · port nativo con mods', type: 'port',
        repo: 'RadzPrower/Zelda-3-Launcher', asset: /\.(zip|exe)$/i, exe: /launcher.*\.exe$/i,
        import: {
          mode: 'guided',
          steps: 'Al abrirlo por primera vez, el Zelda 3 Launcher te pedirá tu ROM de A Link to the Past (versión USA) y preparará el port por ti.'
        }
      },
      {
        id: 'zelda3', name: 'zelda3 · compilado por ti', type: 'manual', exeHint: 'zelda3.exe',
        repo: 'snesrev/zelda3',
        import: {
          mode: 'copy-rom', targetName: 'zelda3.sfc', romExt: ['sfc', 'smc'],
          sha256: '66871d66be19ad2c34c927d6b14cd8eb6fc3181965b6e517cb361f7316009cfb',
          post: { run: 'extract_assets.bat', label: 'Extraer assets (requiere Python)' },
          steps: 'Requiere ROM USA. Tras importarla, el launcher ejecuta extract_assets.bat para crear zelda3_assets.dat.'
        }
      }
    ]
  },
  {
    id: 'la',
    title: "Link's Awakening DX",
    era: 'Game Boy · 1993 / 1998',
    theme: ['#57c4c9', '#062326'],
    desc: 'Naufragado en la misteriosa isla Koholint, Link debe reunir los ocho instrumentos de las Sirenas para despertar al Pez del Viento.',
    variants: [
      { id: 'emu', name: 'Emulador integrado · Game Boy Color', type: 'emu', core: 'gb', romExt: ['gbc', 'gb', 'zip'] },
      { id: 'lasrecomp', name: 'LAS Recomp · remake de Switch', type: 'manual', exeHint: 'el .exe de LAS Recomp' }
    ]
  },
  {
    id: 'oot',
    title: 'Ocarina of Time',
    era: 'Nintendo 64 · 1998',
    theme: ['#3f8fe0', '#05162b'],
    desc: 'Link viaja entre su infancia y su vida adulta para impedir que Ganondorf se apodere de la Trifuerza. El salto de la saga a las 3D.',
    variants: [
      {
        id: 'soh', name: 'Ship of Harkinian · port nativo', type: 'port',
        repo: 'HarbourMasters/Shipwright', asset: /Win64\.zip$/i, exe: /^soh\.exe$/i,
        import: {
          mode: 'copy-rom', romExt: ['z64', 'n64', 'v64'],
          steps: 'Al primer arranque, SoH dirá "No OTR Files Found": pulsa Sí y extraerá los assets de tu ROM (tarda un par de minutos).'
        }
      },
      { id: 'emu', name: 'Emulador integrado · N64', type: 'emu', core: 'n64', romExt: ['z64', 'n64', 'v64', 'zip'] }
    ]
  },
  {
    id: 'mm',
    title: "Majora's Mask",
    era: 'Nintendo 64 · 2000',
    theme: ['#b34fd6', '#1c0624'],
    desc: 'Quedan tres días antes de que la luna caiga sobre Términa. Repite el ciclo, usa las máscaras y cambia el destino de sus habitantes.',
    variants: [
      {
        id: 'z64recomp', name: 'Zelda 64: Recompiled', type: 'port',
        repo: 'Mr-Wiseguy/Zelda64Recomp', asset: /windows.*\.zip$/i, exe: /zelda64recompiled.*\.exe$/i,
        portable: true,
        import: {
          mode: 'guided',
          steps: 'En el menú principal del juego elige tu ROM USA de Majora\'s Mask (se convierte sola si no es .z64). Solo se hace una vez.'
        }
      },
      {
        id: '2s2h', name: '2 Ship 2 Harkinian · port nativo', type: 'port',
        repo: 'HarbourMasters/2ship2harkinian', asset: /Win64\.zip$/i, exe: /^2ship\.exe$/i,
        import: {
          mode: 'copy-rom', romExt: ['z64', 'n64', 'v64'],
          hashList: 'https://raw.githubusercontent.com/HarbourMasters/2ship2harkinian/HEAD/docs/supportedHashes.json',
          steps: 'Al primer arranque, 2Ship generará sus archivos de assets a partir de tu ROM.'
        }
      }
    ]
  },
  {
    id: 'ww',
    title: 'The Wind Waker',
    era: 'GameCube · 2002 / Wii U HD · 2013',
    theme: ['#3fb6e8', '#04192a'],
    desc: 'Hyrule yace bajo el mar. A bordo del Mascarón Rojo, Link navega entre islas para rescatar a su hermana y despertar el poder de la Espada Maestra.',
    variants: [
      {
        id: 'wwhd', name: 'Wind Waker HD Recomp · port nativo', type: 'port',
        repo: 'ZeldaWWHDRecomp/ZeldaWWHDRecomp', asset: /windows-x86_64\.zip$/i, exe: /^wind waker hd( setup)?\.exe$/i,
        import: {
          mode: 'guided',
          steps: 'Al primer arranque te pide tu dump de Wii U (USA o EUR, sin actualización): .wux/.wud con su clave, .wua de Cemu o una carpeta con code, content y meta. Luego extrae y compila el juego (la primera vez descarga un compilador de 190 MB). Para reparar o cambiar el dump, mantén Shift al abrirlo.'
        }
      },
      { id: 'dolphin', name: 'Dolphin · GameCube', type: 'manual', exeHint: 'Dolphin.exe', args: ['-b', '-e', '{rom}'], needsRom: true, romExt: ['iso', 'gcm', 'rvz', 'ciso'] }
    ]
  },
  {
    id: 'tmc',
    title: 'The Minish Cap',
    era: 'Game Boy Advance · 2004',
    theme: ['#8fd14f', '#172608'],
    desc: 'Con la ayuda de Ezlo, Link encoge al tamaño de los Minish para detener a Vaati y devolverle la forma a la princesa Zelda.',
    variants: [
      { id: 'emu', name: 'Emulador integrado · GBA', type: 'emu', core: 'gba', romExt: ['gba', 'zip'] },
      { id: 'autotmc', name: 'auto-tmc · port nativo', type: 'manual', exeHint: 'el .exe del port instalado con auto-tmc', repo: 'StonedModder/auto-tmc' }
    ]
  },
  {
    id: 'tp',
    title: 'Twilight Princess',
    era: 'GameCube / Wii · 2006',
    theme: ['#d68a3a', '#1f1206'],
    desc: 'Hyrule cae bajo el Crepúsculo. Como humano y como lobo, y con Midna a su lado, Link debe disipar las sombras que cubren el reino.',
    variants: [
      {
        id: 'dusk', name: 'Dusklight · port nativo', type: 'port',
        repo: 'TwilitRealm/dusk', asset: /win32-x86_64\.zip$/i, exe: /^dusklight\.exe$/i,
        import: {
          mode: 'guided',
          steps: 'Dusklight te pedirá tu imagen de disco (.iso o .rvz de GameCube o Wii) al abrirlo por primera vez.'
        }
      },
      { id: 'dolphin', name: 'Dolphin · GameCube', type: 'manual', exeHint: 'Dolphin.exe', args: ['-b', '-e', '{rom}'], needsRom: true, romExt: ['iso', 'gcm', 'rvz', 'ciso'] }
    ]
  },
  {
    id: 'ss',
    title: 'Skyward Sword',
    era: 'Wii · 2011 / Switch HD · 2021',
    theme: ['#e8e2b0', '#10182a'],
    desc: 'El origen de la Espada Maestra. Desde la isla flotante de Altárea, Link desciende a la superficie desconocida en busca de Zelda.',
    variants: [
      {
        id: 'skyrecomp', name: 'SkyRecomp · port nativo (HD)', type: 'port',
        repo: 'Apolinario-coder/SkyRecomp', asset: /windows\.zip$/i, exe: /^skyrecomp\.exe$/i,
        import: {
          mode: 'guided',
          steps: 'Necesitas los archivos de Skyward Sword HD v1.0.0 ya extraídos (sin actualizaciones). En SkyRecomp: Game Files › Game files folder › Set up game files.'
        }
      },
      { id: 'dolphin', name: 'Dolphin · Wii', type: 'manual', exeHint: 'Dolphin.exe', args: ['-b', '-e', '{rom}'], needsRom: true, romExt: ['iso', 'wbfs', 'rvz', 'ciso'] }
    ]
  },
  {
    id: 'ootmm',
    title: 'Ocarina of Time + Majora\'s Mask Randomizer',
    short: 'Randomizer · OoT + MM',
    era: 'Randomizer · OoTMM',
    theme: ['#e8607a', '#2a0710'],
    desc: 'Ocarina of Time y Majora\'s Mask fusionados en una sola aventura, con los objetos repartidos al azar entre los dos mundos. Genera una seed nueva cada vez que quieras otra partida distinta.',
    randomizer: {
      site: 'https://ootmm.com/',
      repo: 'OoTMM/OoTMM',
      needs: 'Ocarina of Time (USA o JP, v1.0) y Majora\'s Mask (USA), en formato .z64'
    },
    variants: [
      { id: 'emu', name: 'Emulador integrado · N64', type: 'emu', core: 'n64', seedRom: true },
      { id: 'ext', name: 'Emulador externo · Ares, Project64, RetroArch…', type: 'manual', exeHint: 'el .exe de tu emulador de N64', args: ['{rom}'], seedRom: true }
    ]
  }
];
