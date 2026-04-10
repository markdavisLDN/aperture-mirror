import { CONFIG } from '../config.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const COLS = CONFIG.GRID_COLS;
const ROWS = CONFIG.GRID_ROWS;
const TOTAL = CONFIG.TOTAL_APERTURES;

// Blade path in local space: pivot at (0,0), body extends in +Y toward centre
// Designed so at closeAngle=40° the blade sweeps into centre; at -22° blades are retracted
const BLADE_PATH = `
  M 0 0
  C 0.21 0.11, 0.40 0.48, 0.36 0.90
  C 0.30 1.20, 0.13 1.38, 0 1.42
  C -0.13 1.38, -0.30 1.20, -0.36 0.90
  C -0.40 0.48, -0.21 0.11, 0 0 Z
`.trim();

const PIVOT_R    = 0.68;   // pivot radius from iris centre (SVG unit space)
const OPEN_DEG   = CONFIG.BLADE_OPEN_ANGLE;   // -22 : blades retracted
const CLOSE_DEG  = CONFIG.BLADE_CLOSE_ANGLE;  // +40 : blades cover centre

/**
 * Builds and manages the 312-aperture SVG grid.
 * Single source of truth for all aperture values and system mode.
 */
export class ApertureController {
  constructor(gridEl) {
    this._grid        = gridEl;
    this._frame       = new Float32Array(TOTAL);       // target values 0–255
    this._current     = new Float32Array(TOTAL);       // smoothed display values
    this._blades      = [];   // [apertureIndex][bladeIndex] → SVG <path>
    this._mode         = 'IDLE';
    this._callbacks    = [];
    this._onTransDone  = null;
    this._rafId        = null;
    this._lastTime     = 0;
    this._waveActive   = false;
    this._unlockedCols = null;   // null = unrestricted; Set during wave reopen phase
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  async init() {
    this._buildGrid();
    this._startRenderLoop();
  }

  _buildGrid() {
    this._grid.innerHTML = '';
    this._blades = [];

    for (let i = 0; i < TOTAL; i++) {
      const cell = document.createElement('div');
      cell.className = 'iris-cell';

      const { svg, blades } = this._createIrisSVG(i);
      cell.appendChild(svg);
      this._grid.appendChild(cell);
      this._blades.push(blades);
    }
  }

  _createIrisSVG(idx) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '-1 -1 2 2');
    svg.setAttribute('xmlns', SVG_NS);

    // Housing (dark outer disc)
    const housing = document.createElementNS(SVG_NS, 'circle');
    housing.setAttribute('cx', '0'); housing.setAttribute('cy', '0');
    housing.setAttribute('r', '1');
    housing.setAttribute('fill', '#0b0b0b');
    svg.appendChild(housing);

    // Backlight (always rendered; blades cover it)
    const light = document.createElementNS(SVG_NS, 'circle');
    light.setAttribute('cx', '0'); light.setAttribute('cy', '0');
    light.setAttribute('r', '0.90');
    light.setAttribute('fill', 'url(#backlight-grad)');
    svg.appendChild(light);

    // Clip path so blades don't bleed outside housing
    const clipId = `hc-${idx}`;
    const defs   = document.createElementNS(SVG_NS, 'defs');
    const clip   = document.createElementNS(SVG_NS, 'clipPath');
    clip.setAttribute('id', clipId);
    const clipCirc = document.createElementNS(SVG_NS, 'circle');
    clipCirc.setAttribute('cx', '0'); clipCirc.setAttribute('cy', '0');
    clipCirc.setAttribute('r', '0.90');
    clip.appendChild(clipCirc);
    defs.appendChild(clip);
    svg.appendChild(defs);

    // Blade group (clipped)
    const bladeGroup = document.createElementNS(SVG_NS, 'g');
    bladeGroup.setAttribute('clip-path', `url(#${clipId})`);

    const blades = [];
    for (let b = 0; b < CONFIG.BLADE_COUNT; b++) {
      const blade = document.createElementNS(SVG_NS, 'path');
      blade.setAttribute('d', BLADE_PATH);
      blade.setAttribute('fill', 'url(#blade-sheen)');
      blade.setAttribute('stroke', '#1e1e1e');
      blade.setAttribute('stroke-width', '0.018');
      bladeGroup.appendChild(blade);
      blades.push(blade);
    }
    svg.appendChild(bladeGroup);

    // Outer ring detail
    const ring = document.createElementNS(SVG_NS, 'circle');
    ring.setAttribute('cx', '0'); ring.setAttribute('cy', '0');
    ring.setAttribute('r', '0.97');
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', '#2e2e2e');
    ring.setAttribute('stroke-width', '0.055');
    svg.appendChild(ring);

    // Inner pivot ring detail
    const inner = document.createElementNS(SVG_NS, 'circle');
    inner.setAttribute('cx', '0'); inner.setAttribute('cy', '0');
    inner.setAttribute('r', PIVOT_R.toString());
    inner.setAttribute('fill', 'none');
    inner.setAttribute('stroke', '#1e1e1e');
    inner.setAttribute('stroke-width', '0.018');
    svg.appendChild(inner);

    // Centre screw detail
    const screw = document.createElementNS(SVG_NS, 'circle');
    screw.setAttribute('cx', '0'); screw.setAttribute('cy', '0');
    screw.setAttribute('r', '0.05');
    screw.setAttribute('fill', '#222');
    screw.setAttribute('stroke', '#333');
    screw.setAttribute('stroke-width', '0.015');
    svg.appendChild(screw);

    return { svg, blades };
  }

  // ── Render loop ───────────────────────────────────────────────────────────

  _startRenderLoop() {
    const tick = (now) => {
      const dt = Math.min((now - this._lastTime) / 1000, 0.1);
      this._lastTime = now;
      this._updateCurrent(dt);
      this._renderBlades();
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  _updateCurrent(dt) {
    // Exponential approach: ~80ms settle time
    const alpha = 1 - Math.exp(-dt / 0.04);
    for (let i = 0; i < TOTAL; i++) {
      this._current[i] += (this._frame[i] - this._current[i]) * alpha;
    }
  }

  _renderBlades() {
    for (let i = 0; i < TOTAL; i++) {
      const openVal  = this._current[i] / 255;                       // 0–1
      const closeDeg = OPEN_DEG + (1 - openVal) * (CLOSE_DEG - OPEN_DEG);
      const blades   = this._blades[i];

      for (let b = 0; b < CONFIG.BLADE_COUNT; b++) {
        const baseDeg = (b / CONFIG.BLADE_COUNT) * 360;
        // rotate to base → translate to pivot → apply close rotation → translate back
        blades[b].setAttribute('transform',
          `rotate(${baseDeg}) translate(0,${-PIVOT_R}) rotate(${closeDeg}) translate(0,${PIVOT_R})`
        );
      }
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  setState(index, value) {
    if (index < 0 || index >= TOTAL) return;
    this._frame[index] = Math.max(0, Math.min(255, value));
    this._notifyCallbacks();
  }

  setFrame(arr) {
    for (let i = 0; i < TOTAL; i++) {
      // During wave reopen phase, only apply values to unlocked columns
      if (this._unlockedCols !== null) {
        const col = i % COLS;
        if (!this._unlockedCols.has(col)) continue;
      }
      this._frame[i] = Math.max(0, Math.min(255, arr[i] ?? 0));
    }
    this._notifyCallbacks();
  }

  setMode(mode) {
    if (this._mode === mode) return;
    this._mode = mode;
    this._updateModeUI(mode);

    if (mode === 'IDLE') {
      // Content engine takes over (notified via event)
      document.dispatchEvent(new CustomEvent('aperture:idle'));
    } else if (mode === 'TRANSITIONING') {
      // Wave: close all L→R, then trigger transition-complete
      const currentFrame = Array.from(this._frame);
      const closedFrame  = new Array(TOTAL).fill(0);
      this.runWaveTransition(currentFrame, closedFrame, () => {
        if (this._onTransDone) this._onTransDone();
      });
    }
  }

  runWaveTransition(fromFrame, toFrame, onComplete) {
    this._waveActive    = true;
    this._unlockedCols  = null;   // null = no restriction
    const delay = CONFIG.WAVE_COLUMN_DELAY_MS;

    // Phase 1: close all columns L→R
    for (let col = 0; col < COLS; col++) {
      setTimeout(() => {
        for (let row = 0; row < ROWS; row++) {
          this._frame[row * COLS + col] = toFrame[row * COLS + col];
        }
      }, col * delay);
    }

    const phase1Done = COLS * delay + 120;

    // Phase 2: onComplete fires (starts camera / REFLECTION mode),
    // then unlock columns L→R so live values reveal staggered left-to-right.
    setTimeout(() => {
      if (onComplete) onComplete();   // switches mode to REFLECTION

      this._unlockedCols = new Set();
      for (let col = 0; col < COLS; col++) {
        setTimeout(() => {
          this._unlockedCols.add(col);
          if (col === COLS - 1) {
            this._unlockedCols = null;  // fully unlocked — no more restriction
            this._waveActive   = false;
          }
        }, col * delay);
      }
    }, phase1Done);
  }

  get currentMode() { return this._mode; }
  get frame()       { return Array.from(this._frame); }

  onFrameUpdate(cb)        { this._callbacks.push(cb); }
  onTransitionComplete(cb) { this._onTransDone = cb; }

  _notifyCallbacks() {
    const snapshot = Array.from(this._frame);
    this._callbacks.forEach(cb => cb(snapshot));
  }

  _updateModeUI(mode) {
    const badge = document.getElementById('mode-badge');
    const label = document.getElementById('mode-label');
    if (!badge) return;
    badge.className = mode.toLowerCase();
    label.textContent = mode === 'TRANSITIONING' ? 'TRANSIT' : mode;
  }

  // Resize grid cells to fill viewport
  resize() {
    const main = document.getElementById('main');
    if (!main) return;
    const vw = main.clientWidth  - 20;
    const vh = main.clientHeight - 20;
    const cellW = Math.floor((vw - (COLS - 1) * 3) / COLS);
    const cellH = Math.floor((vh - (ROWS - 1) * 3) / ROWS);
    const cell  = Math.min(cellW, cellH);
    const totalW = cell * COLS + (COLS - 1) * 3;
    const totalH = cell * ROWS + (ROWS - 1) * 3;
    const container = document.getElementById('grid-container');
    if (container) {
      container.style.width  = `${totalW}px`;
      container.style.height = `${totalH}px`;
    }
    const grid = this._grid;
    grid.style.width  = `${totalW}px`;
    grid.style.height = `${totalH}px`;
    // Override grid cell size
    grid.style.gridTemplateColumns = `repeat(${COLS}, ${cell}px)`;
    grid.style.gridTemplateRows    = `repeat(${ROWS}, ${cell}px)`;
  }
}
