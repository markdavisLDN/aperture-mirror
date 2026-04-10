import { CONFIG } from '../config.js';

const COLS = CONFIG.GRID_COLS;
const ROWS = CONFIG.GRID_ROWS;

/**
 * Captures webcam frames, downsamples to 24×13, and applies
 * greyscale / edge-enhanced / posterised processing.
 */
export class ImageProcessor {
  constructor(canvas) {
    this._canvas  = canvas;
    this._ctx     = canvas.getContext('2d', { willReadFrequently: true });
    this._source  = null;  // HTMLVideoElement
    this._canvas.width  = COLS;
    this._canvas.height = ROWS;
  }

  setSource(videoEl) {
    this._source = videoEl;
  }

  /**
   * Process one frame.
   * @param {string} mode  'greyscale' | 'edge' | 'posterised'
   * @param {number} brightness  0–100
   * @param {number} contrast    0–100
   * @returns {number[]|null}  312-value array (0–255) or null if no source
   */
  processFrame(mode, brightness, contrast) {
    if (!this._source || this._source.readyState < 2) return null;

    const ctx = this._ctx;

    // Draw + horizontally flip into 24×13 canvas
    ctx.save();
    ctx.translate(COLS, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(this._source, 0, 0, COLS, ROWS);
    ctx.restore();

    const imgData = ctx.getImageData(0, 0, COLS, ROWS).data;
    const grey    = this._toGreyscale(imgData);

    // Auto-contrast: stretch actual min→max to fill 0–255 each frame.
    // This ensures the person always pops against the background
    // regardless of ambient lighting level.
    const autoGrey = this._autoContrast(grey);

    let processed;
    if (mode === 'edge') {
      processed = this._edgeEnhanced(autoGrey);
    } else if (mode === 'posterised') {
      processed = this._posterised(autoGrey);
    } else {
      processed = autoGrey.slice();
    }

    // Brightness / contrast adjustment (user sliders on top of auto-contrast)
    const b = brightness / 100;
    const c = (contrast / 100) * 2 - 1;
    const factor = (259 * (c * 255 + 255)) / (255 * (259 - c * 255));

    for (let i = 0; i < processed.length; i++) {
      let v = processed[i] * b;
      v = factor * (v - 128) + 128;
      processed[i] = Math.max(0, Math.min(255, v));
    }

    // Update the debug grid canvas (already drawn — just expose it)
    this._updateDebugGrid(processed);

    return processed;
  }

  _toGreyscale(imgData) {
    const out = new Array(COLS * ROWS);
    for (let i = 0; i < COLS * ROWS; i++) {
      const r = imgData[i * 4];
      const g = imgData[i * 4 + 1];
      const bl= imgData[i * 4 + 2];
      // Bright areas → open apertures (high value = open)
      out[i] = 255 - (0.299 * r + 0.587 * g + 0.114 * bl);
    }
    return out;
  }

  _autoContrast(grey) {
    let min = 255, max = 0;
    for (let i = 0; i < grey.length; i++) {
      if (grey[i] < min) min = grey[i];
      if (grey[i] > max) max = grey[i];
    }
    const range = max - min;
    if (range < 10) return grey.slice(); // flat frame — don't stretch noise
    const scale = 255 / range;
    return grey.map(v => (v - min) * scale);
  }

  _edgeEnhanced(grey) {
    const out = new Array(COLS * ROWS);
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const idx = row * COLS + col;

        // Sobel — sample neighbours (clamp at borders)
        const tl = grey[Math.max(row-1,0) * COLS + Math.max(col-1,0)];
        const tm = grey[Math.max(row-1,0) * COLS + col];
        const tr = grey[Math.max(row-1,0) * COLS + Math.min(col+1,COLS-1)];
        const ml = grey[row * COLS + Math.max(col-1,0)];
        const mr = grey[row * COLS + Math.min(col+1,COLS-1)];
        const bl = grey[Math.min(row+1,ROWS-1) * COLS + Math.max(col-1,0)];
        const bm = grey[Math.min(row+1,ROWS-1) * COLS + col];
        const br = grey[Math.min(row+1,ROWS-1) * COLS + Math.min(col+1,COLS-1)];

        const gx = (-tl + tr - 2*ml + 2*mr - bl + br);
        const gy = (-tl - 2*tm - tr + bl + 2*bm + br);
        const edge = Math.min(255, Math.sqrt(gx*gx + gy*gy));

        out[idx] = Math.min(255, grey[idx] + edge * 1.2);
      }
    }
    return out;
  }

  _posterised(grey) {
    const levels = [0, 64, 128, 192, 255];
    return grey.map(v => {
      let closest = levels[0];
      let minDist = Math.abs(v - levels[0]);
      for (let i = 1; i < levels.length; i++) {
        const d = Math.abs(v - levels[i]);
        if (d < minDist) { minDist = d; closest = levels[i]; }
      }
      return closest;
    });
  }

  _updateDebugGrid(processed) {
    const debugCanvas = document.getElementById('debug-grid-canvas');
    if (!debugCanvas) return;
    const dctx = debugCanvas.getContext('2d');
    const id   = dctx.createImageData(COLS, ROWS);
    for (let i = 0; i < COLS * ROWS; i++) {
      const v = processed[i];
      id.data[i*4]   = v;
      id.data[i*4+1] = v;
      id.data[i*4+2] = v;
      id.data[i*4+3] = 255;
    }
    dctx.putImageData(id, 0, 0);
  }
}
