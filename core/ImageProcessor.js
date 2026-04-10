import { CONFIG } from '../config.js';

const COLS  = CONFIG.GRID_COLS;
const ROWS  = CONFIG.GRID_ROWS;
const TOTAL = COLS * ROWS;

/**
 * Captures webcam frames, downsamples to 24×13, and applies processing.
 *
 * Default mode: 'segment' — MediaPipe Selfie Segmenter identifies the person
 * and maps only them to open apertures, ignoring background entirely.
 * This solves the lighting-inversion problem: person always = bright,
 * background always = dark, regardless of ambient lighting.
 *
 * Fallback modes (greyscale / edge / posterised) operate on raw luminance.
 */
export class ImageProcessor {
  constructor(canvas) {
    this._canvas = canvas;
    this._ctx    = canvas.getContext('2d', { willReadFrequently: true });
    this._source = null;

    this._canvas.width  = COLS;
    this._canvas.height = ROWS;

    // Segmenter
    this._segmenter  = null;
    this._maskCanvas = null;
    this._maskCtx    = null;
    this._segReady   = false;

    // Background subtraction (fallback when segmenter unavailable)
    this._background  = null;
    this._bgSamples   = [];
    this._bgReady     = false;
    this._bgCapturing = false;
  }

  setSource(videoEl) {
    this._source = videoEl;
    setTimeout(() => this._startBackgroundCapture(), 1500);
  }

  // ── Segmenter ──────────────────────────────────────────────────────────────

  async loadSegmenter() {
    try {
      const { ImageSegmenter, FilesetResolver } = await import(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/vision_bundle.mjs'
      );
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm'
      );
      this._segmenter = await ImageSegmenter.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite',
          delegate: 'GPU',
        },
        runningMode:         'VIDEO',
        outputCategoryMask:  false,
        outputConfidenceMasks: true,
      });

      // Offscreen canvas for full-res mask → downsample to 24×13
      this._maskCanvas = document.createElement('canvas');
      this._maskCtx    = this._maskCanvas.getContext('2d', { willReadFrequently: true });
      this._segReady   = true;
      console.log('[ImageProcessor] Selfie segmenter loaded');
    } catch (e) {
      console.warn('[ImageProcessor] Segmenter unavailable, using background subtraction:', e.message);
    }
  }

  // ── Background capture (fallback) ─────────────────────────────────────────

  _startBackgroundCapture() {
    this._bgCapturing = true;
    this._bgSamples   = [];
    console.log('[ImageProcessor] Capturing background…');
  }

  resetBackground() {
    this._bgReady     = false;
    this._bgSamples   = [];
    this._bgCapturing = true;
    console.log('[ImageProcessor] Re-capturing background…');
  }

  _accumulateBackground(grey) {
    this._bgSamples.push(grey.slice());
    if (this._bgSamples.length >= 8) {
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

  // ── Main entry point ───────────────────────────────────────────────────────

  /**
   * @param {string} mode  'segment' | 'greyscale' | 'edge' | 'posterised'
   * @param {number} brightness  0–100
   * @param {number} contrast    0–100
   * @param {number} timestamp   performance.now() — required for segmenter
   */
  processFrame(mode, brightness, contrast, timestamp = performance.now()) {
    if (!this._source || this._source.readyState < 2) return null;

    let processed = null;

    if (mode === 'segment' && this._segReady) {
      processed = this._segmentFrame(timestamp);
    }

    // Fallback to luminance-based pipeline
    if (!processed) {
      // Draw + flip into 24×13 canvas
      const ctx = this._ctx;
      ctx.save();
      ctx.translate(COLS, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(this._source, 0, 0, COLS, ROWS);
      ctx.restore();

      const imgData = ctx.getImageData(0, 0, COLS, ROWS).data;
      const grey    = this._toGreyscale(imgData);

      if (this._bgCapturing) {
        this._accumulateBackground(grey);
        return new Array(TOTAL).fill(0);
      }

      if (mode === 'edge') {
        processed = this._edgeEnhanced(this._autoContrast(grey));
      } else if (mode === 'posterised') {
        processed = this._posterised(this._autoContrast(grey));
      } else if (this._bgReady) {
        processed = this._backgroundSubtract(grey);
      } else {
        processed = this._autoContrast(grey);
      }
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

  // ── Segmentation (primary) ────────────────────────────────────────────────

  _segmentFrame(timestamp) {
    if (!this._segmenter || !this._source) return null;
    try {
      const result = this._segmenter.segmentForVideo(this._source, timestamp);
      // confidenceMasks[0] = background probability, [1] = person probability
      const masks  = result.confidenceMasks;
      const mask   = masks?.[1] ?? masks?.[0];
      if (!mask) return null;
      const invertFallback = !masks?.[1]; // only one mask → it's background, invert it

      const vw = this._source.videoWidth  || 640;
      const vh = this._source.videoHeight || 480;

      if (this._maskCanvas.width !== vw || this._maskCanvas.height !== vh) {
        this._maskCanvas.width  = vw;
        this._maskCanvas.height = vh;
      }

      // Write confidence mask to full-res canvas (horizontally flipped = mirror)
      const maskData = mask.getAsFloat32Array();
      const imgData  = this._maskCtx.createImageData(vw, vh);
      for (let row = 0; row < vh; row++) {
        for (let col = 0; col < vw; col++) {
          const srcIdx = row * vw + (vw - 1 - col); // flip
          const dstIdx = row * vw + col;
          const raw = maskData[srcIdx];
          const v = (invertFallback ? 1 - raw : raw) * 255;
          imgData.data[dstIdx*4]   = v;
          imgData.data[dstIdx*4+1] = v;
          imgData.data[dstIdx*4+2] = v;
          imgData.data[dstIdx*4+3] = 255;
        }
      }
      this._maskCtx.putImageData(imgData, 0, 0);

      // Downsample mask to 24×13 via GPU-accelerated drawImage
      this._ctx.drawImage(this._maskCanvas, 0, 0, COLS, ROWS);
      const small = this._ctx.getImageData(0, 0, COLS, ROWS);

      // Hard threshold: person (confidence ≥ 0.35) → fully open,
      // background → fully closed. Binary output matches physical reference.
      const out = new Array(TOTAL);
      for (let i = 0; i < TOTAL; i++) {
        const norm = small.data[i * 4] / 255;            // 0–1
        const s    = 1 / (1 + Math.exp(-22 * (norm - 0.35))); // steep sigmoid at lower threshold
        out[i]     = s * 255;
      }

      masks.forEach(m => m.close()); // free GPU textures
      return out;

    } catch (e) {
      return null;
    }
  }

  // ── Luminance pipeline ────────────────────────────────────────────────────

  _toGreyscale(imgData) {
    const out = new Array(TOTAL);
    for (let i = 0; i < TOTAL; i++) {
      out[i] = 0.299 * imgData[i*4] + 0.587 * imgData[i*4+1] + 0.114 * imgData[i*4+2];
    }
    return out;
  }

  _autoContrast(grey) {
    let min = 255, max = 0;
    for (const v of grey) { if (v < min) min = v; if (v > max) max = v; }
    const range = max - min;
    if (range < 10) return grey.slice();
    const scale = 255 / range;
    return grey.map(v => {
      const norm = (v - min) * scale / 255;
      return (1 / (1 + Math.exp(-8 * (norm - 0.5)))) * 255;
    });
  }

  _backgroundSubtract(grey) {
    const bg = this._background;
    if (!bg) return this._autoContrast(grey);
    const out = new Array(TOTAL);
    let max = 0;
    for (let i = 0; i < TOTAL; i++) { out[i] = Math.abs(grey[i] - bg[i]); if (out[i] > max) max = out[i]; }
    if (max < 8) return new Array(TOTAL).fill(0);
    const scale = 255 / max;
    for (let i = 0; i < TOTAL; i++) {
      const norm = (out[i] * scale) / 255;
      out[i] = (1 / (1 + Math.exp(-10 * (norm - 0.35)))) * 255;
    }
    return out;
  }

  _edgeEnhanced(grey) {
    const out = new Array(TOTAL);
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const idx = row * COLS + col;
        const tl = grey[Math.max(row-1,0)     * COLS + Math.max(col-1,0)];
        const tm = grey[Math.max(row-1,0)     * COLS + col];
        const tr = grey[Math.max(row-1,0)     * COLS + Math.min(col+1,COLS-1)];
        const ml = grey[row                   * COLS + Math.max(col-1,0)];
        const mr = grey[row                   * COLS + Math.min(col+1,COLS-1)];
        const bl = grey[Math.min(row+1,ROWS-1)* COLS + Math.max(col-1,0)];
        const bm = grey[Math.min(row+1,ROWS-1)* COLS + col];
        const br = grey[Math.min(row+1,ROWS-1)* COLS + Math.min(col+1,COLS-1)];
        const gx = -tl + tr - 2*ml + 2*mr - bl + br;
        const gy = -tl - 2*tm - tr + bl + 2*bm + br;
        out[idx] = Math.min(255, grey[idx] + Math.sqrt(gx*gx + gy*gy) * 1.4);
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
