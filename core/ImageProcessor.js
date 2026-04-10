import { CONFIG } from '../config.js';

const COLS  = CONFIG.GRID_COLS;
const ROWS  = CONFIG.GRID_ROWS;
const TOTAL = COLS * ROWS;

/**
 * Captures webcam frames, downsamples to 24×13, and applies processing.
 *
 * Processing strategy:
 *   Background subtraction (default): captures an empty background frame at
 *   startup, then maps the DIFFERENCE to aperture values. This makes the
 *   person always appear bright regardless of whether they are lighter or
 *   darker than their background, and works in any ambient lighting.
 *
 *   Greyscale / edge / posterised modes operate on the raw luminance instead,
 *   useful when background subtraction is not appropriate.
 */
export class ImageProcessor {
  constructor(canvas) {
    this._canvas = canvas;
    this._ctx    = canvas.getContext('2d', { willReadFrequently: true });
    this._source = null;

    this._canvas.width  = COLS;
    this._canvas.height = ROWS;

    this._background    = null;   // Float32Array(TOTAL) — captured background
    this._bgSamples     = [];     // accumulate frames for a stable background
    this._bgReady       = false;
    this._bgCapturing   = false;
  }

  setSource(videoEl) {
    this._source = videoEl;
    // Start accumulating background frames after a brief delay
    setTimeout(() => this._startBackgroundCapture(), 1500);
  }

  // ── Background capture ─────────────────────────────────────────────────────

  _startBackgroundCapture() {
    this._bgCapturing = true;
    this._bgSamples   = [];
    console.log('[ImageProcessor] Capturing background…');
  }

  /** Call this to re-capture background (e.g. when re-entering IDLE) */
  resetBackground() {
    this._bgReady     = false;
    this._bgSamples   = [];
    this._bgCapturing = true;
    console.log('[ImageProcessor] Re-capturing background…');
  }

  _accumulateBackground(grey) {
    this._bgSamples.push(grey);
    if (this._bgSamples.length >= 8) {  // average 8 frames for stable bg
      this._background = new Float32Array(TOTAL);
      for (let i = 0; i < TOTAL; i++) {
        let sum = 0;
        for (const s of this._bgSamples) sum += s[i];
        this._background[i] = sum / this._bgSamples.length;
      }
      this._bgReady     = true;
      this._bgCapturing = false;
      console.log('[ImageProcessor] Background ready');
    }
  }

  // ── Main processing ────────────────────────────────────────────────────────

  processFrame(mode, brightness, contrast) {
    if (!this._source || this._source.readyState < 2) return null;

    const ctx = this._ctx;

    // Downsample + horizontal flip into 24×13 canvas
    ctx.save();
    ctx.translate(COLS, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(this._source, 0, 0, COLS, ROWS);
    ctx.restore();

    const imgData = ctx.getImageData(0, 0, COLS, ROWS).data;
    const grey    = this._toGreyscale(imgData);

    // Still accumulating background — return empty frame
    if (this._bgCapturing) {
      this._accumulateBackground(grey);
      return new Array(TOTAL).fill(0);
    }

    let processed;

    if (mode === 'greyscale' || mode === 'edge' || mode === 'posterised') {
      // Raw luminance modes — use auto-contrast so the full range is used
      const stretched = this._autoContrast(grey);
      if (mode === 'edge') {
        processed = this._edgeEnhanced(stretched);
      } else if (mode === 'posterised') {
        processed = this._posterised(stretched);
      } else {
        processed = stretched;
      }
    } else {
      // Default / 'bg' mode: background subtraction
      processed = this._backgroundSubtract(grey);
    }

    // Brightness / contrast sliders
    const b      = brightness / 100;
    const c      = (contrast / 100) * 2 - 1;
    const factor = (259 * (c * 255 + 255)) / (255 * (259 - c * 255));

    const out = new Array(TOTAL);
    for (let i = 0; i < TOTAL; i++) {
      let v = processed[i] * b;
      v = factor * (v - 128) + 128;
      out[i] = Math.max(0, Math.min(255, v));
    }

    this._updateDebugGrid(out);
    return out;
  }

  // ── Processing modes ───────────────────────────────────────────────────────

  _toGreyscale(imgData) {
    const out = new Array(TOTAL);
    for (let i = 0; i < TOTAL; i++) {
      out[i] = 0.299 * imgData[i*4] + 0.587 * imgData[i*4+1] + 0.114 * imgData[i*4+2];
    }
    return out;
  }

  /**
   * Background subtraction: map how much each pixel differs from the empty
   * background. Person = high difference = open aperture.
   * Amplified and stretched so subtle presence reads clearly at 24×13.
   */
  _backgroundSubtract(grey) {
    const out  = new Array(TOTAL);
    const bg   = this._background;

    if (!bg) return this._autoContrast(grey);

    let max = 0;
    for (let i = 0; i < TOTAL; i++) {
      out[i] = Math.abs(grey[i] - bg[i]);
      if (out[i] > max) max = out[i];
    }

    // Stretch so the largest difference = 255
    if (max < 8) return new Array(TOTAL).fill(0); // nothing moving
    const scale = 255 / max;

    // Apply sigmoid to push mid-differences to either open or closed cleanly
    for (let i = 0; i < TOTAL; i++) {
      const norm = (out[i] * scale) / 255;           // 0–1
      const s    = 1 / (1 + Math.exp(-10 * (norm - 0.35))); // sigmoid gate
      out[i]     = s * 255;
    }

    return out;
  }

  _autoContrast(grey) {
    let min = 255, max = 0;
    for (const v of grey) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const range = max - min;
    if (range < 10) return grey.slice();
    const scale = 255 / range;
    // Apply sigmoid after stretch to push contrast further
    return grey.map(v => {
      const norm = (v - min) * scale / 255;
      const s    = 1 / (1 + Math.exp(-8 * (norm - 0.5)));
      return s * 255;
    });
  }

  _edgeEnhanced(grey) {
    const out = new Array(TOTAL);
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const idx = row * COLS + col;
        const tl = grey[Math.max(row-1,0)    * COLS + Math.max(col-1,0)];
        const tm = grey[Math.max(row-1,0)    * COLS + col];
        const tr = grey[Math.max(row-1,0)    * COLS + Math.min(col+1,COLS-1)];
        const ml = grey[row                  * COLS + Math.max(col-1,0)];
        const mr = grey[row                  * COLS + Math.min(col+1,COLS-1)];
        const bl = grey[Math.min(row+1,ROWS-1) * COLS + Math.max(col-1,0)];
        const bm = grey[Math.min(row+1,ROWS-1) * COLS + col];
        const br = grey[Math.min(row+1,ROWS-1) * COLS + Math.min(col+1,COLS-1)];
        const gx   = -tl + tr - 2*ml + 2*mr - bl + br;
        const gy   = -tl - 2*tm - tr + bl + 2*bm + br;
        const edge = Math.min(255, Math.sqrt(gx*gx + gy*gy));
        out[idx]   = Math.min(255, grey[idx] + edge * 1.4);
      }
    }
    return out;
  }

  _posterised(grey) {
    const levels = [0, 64, 128, 192, 255];
    return grey.map(v => {
      let closest = levels[0], minDist = Math.abs(v - levels[0]);
      for (let i = 1; i < levels.length; i++) {
        const d = Math.abs(v - levels[i]);
        if (d < minDist) { minDist = d; closest = levels[i]; }
      }
      return closest;
    });
  }

  _updateDebugGrid(processed) {
    const dc = document.getElementById('debug-grid-canvas');
    if (!dc) return;
    const dctx = dc.getContext('2d');
    const id   = dctx.createImageData(COLS, ROWS);
    for (let i = 0; i < TOTAL; i++) {
      const v = processed[i];
      id.data[i*4] = id.data[i*4+1] = id.data[i*4+2] = v;
      id.data[i*4+3] = 255;
    }
    dctx.putImageData(id, 0, 0);
  }
}
