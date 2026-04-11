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

    // Temporal smoothing for face crop — prevents flicker on still image
    this._faceGreyAvg = null;
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
   * @param {object|null} faceBbox  { x, y, w, h } raw video px — crops to face when present
   */
  processFrame(mode, brightness, contrast, timestamp = performance.now(), faceBbox = null) {
    if (!this._source || this._source.readyState < 2) return null;

    let processed = null;

    // Face-zoom mode: crop to detected face and show portrait luminance detail
    if (faceBbox) {
      processed = this._processFaceCrop(faceBbox);
    } else if (mode === 'segment' && this._segReady) {
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

      // Threshold: person (confidence ≥ 0.20) → fully open,
      // background → fully closed. Lower threshold captures hands/arms.
      const raw = new Array(TOTAL);
      for (let i = 0; i < TOTAL; i++) {
        const norm = small.data[i * 4] / 255;
        raw[i] = (1 / (1 + Math.exp(-16 * (norm - 0.20)))) * 255;
      }

      // Morphological dilation: expand detected regions by 1 cell
      // so fingers/edges aren't clipped at the 24×13 resolution
      const out = new Array(TOTAL);
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const idx = r * COLS + c;
          let best = raw[idx];
          if (r > 0)          best = Math.max(best, raw[(r-1)*COLS + c]);
          if (r < ROWS-1)     best = Math.max(best, raw[(r+1)*COLS + c]);
          if (c > 0)          best = Math.max(best, raw[r*COLS + (c-1)]);
          if (c < COLS-1)     best = Math.max(best, raw[r*COLS + (c+1)]);
          out[idx] = best;
        }
      }

      masks.forEach(m => m.close()); // free GPU textures
      return out;

    } catch (e) {
      return null;
    }
  }

  // ── Face crop (portrait detail) ───────────────────────────────────────────

  /**
   * Crop the raw video frame to the face bbox (with generous padding),
   * downsample to the aperture grid, and return continuous luminance values
   * so that forehead highlights, eye sockets, cheekbones all drive different
   * aperture opening levels — giving a halftone-portrait effect.
   *
   * @param {{ x, y, w, h }} rawBbox  Face bbox in raw (unmirrored) video pixels
   */
  _processFaceCrop(rawBbox) {
    if (!this._source) return null;
    const vw = this._source.videoWidth  || 640;
    const vh = this._source.videoHeight || 480;

    // Tight padding so face fills ~80% of grid: 20% sides, 30% top, 15% bottom
    const padX  = rawBbox.w * 0.2;
    const padYt = rawBbox.h * 0.3;
    const padYb = rawBbox.h * 0.15;
    const sx = Math.max(0, rawBbox.x - padX);
    const sy = Math.max(0, rawBbox.y - padYt);
    const sw = Math.min(vw - sx, rawBbox.w + padX * 2);
    const sh = Math.min(vh - sy, rawBbox.h + padYt + padYb);

    // Draw the crop into the 24×16 canvas, horizontally flipped (mirror view)
    const ctx = this._ctx;
    ctx.save();
    ctx.translate(COLS, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(this._source, sx, sy, sw, sh, 0, 0, COLS, ROWS);
    ctx.restore();

    const imgData = ctx.getImageData(0, 0, COLS, ROWS).data;
    const greyRaw = this._toGreyscale(imgData);

    // Temporal smoothing: blend each new frame into a running average.
    // ALPHA=0.25 → ~4 frames to converge, ~0.7s at 6fps.
    // Reduces flicker while still tracking real face movement.
    const ALPHA = 0.25;
    if (!this._faceGreyAvg || this._faceGreyAvg.length !== TOTAL) {
      this._faceGreyAvg = greyRaw.slice();
    } else {
      for (let i = 0; i < TOTAL; i++)
        this._faceGreyAvg[i] = this._faceGreyAvg[i] * (1 - ALPHA) + greyRaw[i] * ALPHA;
    }
    const grey   = this._faceGreyAvg;
    const detail = this._faceContrast(grey);

    // Outside face ellipse → BG_OPEN (slightly open, like the grey circles
    // in the reference image — background is NOT fully closed).
    // Inside face → portrait values, blending to BG_OPEN at the edge.
    const BG_OPEN = 0; // fully closed outside face — black surround
    const cx = (COLS - 1) / 2, cy = (ROWS - 1) / 2;
    const rx = COLS * 0.44,    ry = ROWS * 0.44;
    const out = new Array(TOTAL);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const idx = r * COLS + c;
        const dx = (c - cx) / rx, dy = (r - cy) / ry;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist >= 1) {
          out[idx] = BG_OPEN;
        } else {
          const blend = dist < 0.80 ? 1 : (1 - dist) / 0.20;
          out[idx] = detail[idx] * blend + BG_OPEN * (1 - blend);
        }
      }
    }
    return out;
  }

  /**
   * Face portrait — median-anchored, 5-level posterized.
   *
   * Uses the MEDIAN of the central face pixels as the skin-tone reference.
   * Pixels brighter than skin → more open; darker → more closed.
   * 5 levels give visible gradation: highlights / light-skin / mid-skin / shadow / deep-shadow.
   * This is lighting-direction agnostic — works whether the wall behind
   * is brighter or darker than the face.
   *
   * Level mapping (aperture value → visual result):
   *   255 = fully open  (forehead highlight, nose bridge catch-light)
   *   192 = mostly open (lighter cheek, lit skin)
   *   110 = half open   (average skin tone)
   *    50 = mostly closed (cheek shadow, beard, under-chin)
   *     0 = fully closed (eye sockets, hair, nostrils)
   */
  _faceContrast(grey) {
    const cx = (COLS - 1) / 2, cy = (ROWS - 1) / 2;
    const coreRx = COLS * 0.25, coreRy = ROWS * 0.25;
    const core = [];
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const dx = (c - cx) / coreRx, dy = (r - cy) / coreRy;
        if (dx * dx + dy * dy <= 1) core.push(grey[r * COLS + c]);
      }

    if (core.length < 8) return grey.map(() => 0);
    core.sort((a, b) => a - b);

    // Median = skin tone. Spread = local contrast around that tone.
    const median = core[Math.floor(core.length * 0.50)];
    const spread = Math.max(
      core[Math.floor(core.length * 0.85)] - median,
      median - core[Math.floor(core.length * 0.15)],
      12
    );

    // 5-level posterize relative to skin tone
    return grey.map(v => {
      const delta = (v - median) / spread;
      if (delta >  0.50) return 255; // bright highlight → fully open
      if (delta >  0.10) return 192; // lighter than skin → mostly open
      if (delta > -0.25) return 110; // near skin tone → mid
      if (delta > -0.65) return  50; // shadow → mostly closed
      return 0;                       // deep shadow → fully closed
    });
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
