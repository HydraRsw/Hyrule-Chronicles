/*
 * Lockstep para Four Swords online (2 a 4 jugadores).
 *
 * Cada PC ejecuta las 4 GBA completas (el cable link va dentro del emulador), así que por
 * la red solo viajan los botones: cada jugador manda los suyos y todos avanzan el mismo
 * frame con los mismos botones de todos. Como el emulador es determinista, todos ven lo mismo.
 *
 *  - Retardo de entrada: lo que pulsas ahora cuenta "delay" frames después; ese margen
 *    tapa la latencia de la red sin tener que esperar.
 *  - Redundancia: cada paquete repite los últimos REDUNDANCY frames propios, así que un
 *    paquete perdido se recupera con el siguiente, sin reenvíos.
 *  - Verificación: cada CHECK_EVERY frames se compara una huella del estado de la partida;
 *    si difiere entre jugadores se avisa (desync).
 *
 * No depende del navegador: el transporte (send/receive) y el emulador los pone quien lo usa.
 */
(function (root) {
  'use strict';

  const MAGIC0 = 0x48, MAGIC1 = 0x46;      // "HF"
  const PROTOCOL = 1;
  const TYPE_INPUT = 1;
  const REDUNDANCY = 24;                   // frames propios repetidos en cada paquete
  const CHECK_EVERY = 120;                 // huella de estado cada 2 s
  const HEADER = 20;

  /* Paquete (little-endian):
       0  u8  'H'      1 u8 'F'     2 u8 protocolo   3 u8 tipo
       4  u8  asiento  5 u8 cuántos frames (n)       6 u16 reservado
       8  u32 primer frame de la lista
      12  u32 frame de la última huella    16 u32 huella
      20  u16 x n   botones                                        */
  function encode(slot, first, keys, checkFrame, checkHash) {
    const n = keys.length;
    const buf = new ArrayBuffer(HEADER + n * 2);
    const v = new DataView(buf);
    v.setUint8(0, MAGIC0); v.setUint8(1, MAGIC1); v.setUint8(2, PROTOCOL); v.setUint8(3, TYPE_INPUT);
    v.setUint8(4, slot); v.setUint8(5, n);
    v.setUint32(8, first, true);
    v.setUint32(12, checkFrame >>> 0, true); v.setUint32(16, checkHash >>> 0, true);
    for (let i = 0; i < n; i++) v.setUint16(HEADER + i * 2, keys[i] & 0x3ff, true);
    return new Uint8Array(buf);
  }

  function decode(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (u8.length < HEADER || u8[0] !== MAGIC0 || u8[1] !== MAGIC1) return null;
    const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (v.getUint8(2) !== PROTOCOL || v.getUint8(3) !== TYPE_INPUT) return null;
    const n = v.getUint8(5);
    if (u8.length < HEADER + n * 2) return null;
    const keys = new Array(n);
    for (let i = 0; i < n; i++) keys[i] = v.getUint16(HEADER + i * 2, true);
    return { slot: v.getUint8(4), first: v.getUint32(8, true), keys,
             checkFrame: v.getUint32(12, true), checkHash: v.getUint32(16, true) };
  }

  class Lockstep {
    /**
     * @param {object} o
     * @param {number}   o.slot     mi asiento (0..3)
     * @param {number[]} o.slots    asientos que juegan, p. ej. [0,1,2,3]
     * @param {number}   o.delay    retardo de entrada en frames (2..10)
     * @param {function} o.send     (Uint8Array) => void : manda a los demás (vía servidor)
     */
    constructor({ slot, slots, delay = 4, send }) {
      this.slot = slot;
      this.slots = slots.slice().sort((a, b) => a - b);
      this.delay = Math.max(1, Math.min(15, delay | 0));
      this.send = send;
      this.frame = 0;                      // siguiente frame a emular
      this.inputs = new Map();             // asiento -> Map(frame -> botones)
      this.lastHeard = new Map();          // asiento -> ms del último paquete
      this.checks = new Map();             // asiento -> Map(frameHuella -> huella)
      this.myChecks = new Map();           // frameHuella -> huella propia
      this.lastCheck = { frame: 0, hash: 0 };
      this.desync = null;
      for (const s of this.slots) {
        const m = new Map();
        for (let f = 0; f < this.delay; f++) m.set(f, 0);   // los primeros frames, sin botones
        this.inputs.set(s, m);
        this.checks.set(s, new Map());
        this.lastHeard.set(s, Date.now());
      }
      this.nextLocal = this.delay;         // frame al que va la próxima pulsación propia
      this.stats = { stalls: 0, packetsIn: 0, packetsOut: 0, late: 0 };
    }

    /** Registra mis botones de este momento (se aplican dentro de "delay" frames) y los envía. */
    pushLocal(keys) {
      // Nunca adelantarse más de "delay" frames a lo emulado: si estoy esperando, no acumulo.
      if (this.nextLocal - this.frame >= this.delay) { this.flush(); return false; }
      this.inputs.get(this.slot).set(this.nextLocal, keys & 0x3ff);
      this.nextLocal++;
      this.flush();
      return true;
    }

    /** Envía los últimos frames propios (también sirve de reenvío mientras se espera). */
    flush() {
      const mine = this.inputs.get(this.slot);
      const last = this.nextLocal - 1;
      const first = Math.max(0, last - REDUNDANCY + 1);
      const keys = [];
      for (let f = first; f <= last; f++) keys.push(mine.get(f) || 0);
      if (!keys.length) return;
      this.send(encode(this.slot, first, keys, this.lastCheck.frame, this.lastCheck.hash));
      this.stats.packetsOut++;
    }

    /** Procesa un paquete recibido de otro jugador. */
    receive(bytes) {
      const p = decode(bytes);
      if (!p || p.slot === this.slot || !this.inputs.has(p.slot)) return false;
      this.stats.packetsIn++;
      this.lastHeard.set(p.slot, Date.now());
      const m = this.inputs.get(p.slot);
      for (let i = 0; i < p.keys.length; i++) {
        const f = p.first + i;
        if (f >= this.frame && !m.has(f)) m.set(f, p.keys[i]);
      }
      if (p.checkFrame) {
        this.checks.get(p.slot).set(p.checkFrame, p.checkHash);
        this.compare(p.checkFrame);
      }
      return true;
    }

    /** ¿Están los botones de todos para el siguiente frame? */
    ready() {
      for (const s of this.slots) if (!this.inputs.get(s).has(this.frame)) return false;
      return true;
    }

    /** Botones de todos para el frame actual (array de 4) y avanza. Llamar solo si ready(). */
    advance() {
      const out = [0, 0, 0, 0];
      for (const s of this.slots) {
        const m = this.inputs.get(s);
        out[s] = m.get(this.frame);
        m.delete(this.frame - 120);          // limpieza de lo viejo
      }
      this.frame++;
      return out;
    }

    /** Debe llamarse tras emular un frame: si toca, guarda la huella del estado. */
    shouldCheck() { return this.frame > 0 && this.frame % CHECK_EVERY === 0; }
    recordCheck(hash) {
      this.lastCheck = { frame: this.frame, hash: hash >>> 0 };
      this.myChecks.set(this.frame, hash >>> 0);
      for (const f of this.myChecks.keys()) if (f < this.frame - CHECK_EVERY * 10) this.myChecks.delete(f);
      this.compare(this.frame);
    }
    compare(frame) {
      const mine = this.myChecks.get(frame);
      if (mine === undefined || this.desync) return;
      for (const [s, m] of this.checks) {
        if (s === this.slot) continue;
        const theirs = m.get(frame);
        if (theirs !== undefined && theirs !== mine) {
          this.desync = { frame, slot: s, mine, theirs };
        }
      }
    }

    /** Asientos de los que no se sabe nada hace más de ms milisegundos. */
    silent(ms) {
      const now = Date.now();
      return this.slots.filter(s => s !== this.slot && now - this.lastHeard.get(s) > ms);
    }

    /** Frames que voy por delante del jugador más lento conocido (para ajustar el ritmo). */
    lead() {
      let min = Infinity;
      for (const s of this.slots) {
        if (s === this.slot) continue;
        const m = this.inputs.get(s);
        let f = this.frame;
        while (m.has(f)) f++;
        min = Math.min(min, f - this.frame);
      }
      return min === Infinity ? 0 : min;
    }
  }

  /** FNV-1a de 32 bits: huella rápida de un bloque de bytes (el estado del emulador). */
  function fnv1a(bytes, h = 0x811c9dc5) {
    for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }

  const api = { Lockstep, encode, decode, fnv1a, PROTOCOL, CHECK_EVERY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HCLockstep = api;
})(typeof self !== 'undefined' ? self : this);
