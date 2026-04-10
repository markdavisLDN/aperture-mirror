import { CONFIG } from '../config.js';

const COLS  = CONFIG.GRID_COLS;   // 24
const ROWS  = CONFIG.GRID_ROWS;   // 13
const TOTAL = CONFIG.TOTAL_APERTURES;
const CHAR_W = 5;
const CHAR_H = 7;
const CHAR_GAP = 1;  // pixel columns between characters

/**
 * Renders text strings onto the 24×13 aperture grid using the 5×7 bitmap font.
 * Supports static (centred) and scrolling display.
 */
export class FontRenderer {
  constructor() {
    this._font = null;
  }

  async load() {
    try {
      const res = await fetch('/assets/font5x7.json');
      this._font = await res.json();
    } catch (e) {
      console.warn('[FontRenderer] Could not load font:', e.message);
      this._font = {};
    }
  }

  /**
   * Render a string to a 312-value array.
   * @param {string} text
   * @param {object} seq  sequence config — seq.scroll, seq.brightness, elapsed time
   */
  render(text, seq = {}) {
    if (!this._font) return new Float32Array(TOTAL);

    const brightness = seq.brightness ?? 255;
    const scroll     = seq.scroll ?? false;
    const duration   = seq.duration ?? 5000;
    const elapsed    = Math.max(0, performance.now() - (seq._startTime ?? 0));

    // Build the full pixel strip for the text
    const strip = this._buildStrip(text.toUpperCase(), brightness);
    const stripW = strip[0]?.length ?? 0;

    const frame = new Float32Array(TOTAL);

    if (!scroll || stripW <= COLS) {
      // Centre statically
      this._blitCentred(strip, frame);
    } else {
      // Scroll: strip moves right-to-left
      // Full cycle: enter from right (+COLS), scroll through, exit to left (-stripW)
      const totalTravel = COLS + stripW;
      const progress    = (elapsed % duration) / duration;
      const offsetX     = Math.round(COLS - progress * totalTravel);
      this._blitAt(strip, frame, offsetX);
    }

    return frame;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  _buildStrip(text, brightness) {
    const chars = text.split('').filter(c => this._font[c] !== undefined);
    if (chars.length === 0) chars.push(' ');

    const stripW = chars.length * (CHAR_W + CHAR_GAP) - CHAR_GAP;
    // Create 2D array [row][col]
    const strip = Array.from({ length: CHAR_H }, () => new Float32Array(stripW));

    for (let ci = 0; ci < chars.length; ci++) {
      const bitmap = this._font[chars[ci]] ?? this._font[' '];
      const xOff = ci * (CHAR_W + CHAR_GAP);
      for (let row = 0; row < CHAR_H; row++) {
        for (let col = 0; col < CHAR_W; col++) {
          const bit = bitmap[row * CHAR_W + col];
          strip[row][xOff + col] = bit ? brightness : 0;
        }
      }
    }
    return strip;
  }

  _blitCentred(strip, frame) {
    const stripW = strip[0]?.length ?? 0;
    const xOff = Math.round((COLS - stripW) / 2);
    const yOff = Math.round((ROWS - CHAR_H) / 2);
    this._blitAt(strip, frame, xOff, yOff);
  }

  _blitAt(strip, frame, xOff, yOff) {
    const rowOff = yOff ?? Math.round((ROWS - CHAR_H) / 2);
    for (let row = 0; row < CHAR_H; row++) {
      const gridRow = row + rowOff;
      if (gridRow < 0 || gridRow >= ROWS) continue;
      for (let col = 0; col < (strip[row]?.length ?? 0); col++) {
        const gridCol = col + xOff;
        if (gridCol < 0 || gridCol >= COLS) continue;
        frame[gridRow * COLS + gridCol] = strip[row][col];
      }
    }
  }
}
