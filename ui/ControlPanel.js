import { CONFIG } from '../config.js';

/**
 * Wires all sidebar controls to controller/processor/engine instances.
 */
export class ControlPanel {
  constructor({ controller, imgProcessor, faceDetector, content, bridge }) {
    this._ctrl   = controller;
    this._img    = imgProcessor;
    this._face   = faceDetector;
    this._content= content;
    this._bridge = bridge;

    this.processingMode = 'greyscale';
    this.brightness     = CONFIG.DEFAULT_BRIGHTNESS;
    this.contrast       = CONFIG.DEFAULT_CONTRAST;
  }

  init() {
    this._bindProcessing();
    this._bindSliders();
    this._bindHardware();
    this._bindDebug();
    this._bindForceButtons();
    this._bindEditorButton();
    this._handleResize();
  }

  // ── Image processing segmented control ───────────────────────────────────

  _bindProcessing() {
    const seg = document.getElementById('processing-seg');
    if (!seg) return;
    seg.addEventListener('click', e => {
      const btn = e.target.closest('.seg-btn');
      if (!btn) return;
      seg.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      this.processingMode = btn.dataset.mode;
    });
  }

  // ── Sliders ───────────────────────────────────────────────────────────────

  _bindSliders() {
    this._bindSlider('brightness', 'brightness-val', v => {
      this.brightness = v;
    });
    this._bindSlider('contrast', 'contrast-val', v => {
      this.contrast = v;
    });
    this._bindSlider('wave-speed', 'wave-val', v => {
      CONFIG.WAVE_COLUMN_DELAY_MS = v;
    }, '', 'ms');
  }

  _bindSlider(id, valId, onChange, prefix = '', suffix = '') {
    const slider = document.getElementById(id);
    const label  = document.getElementById(valId);
    if (!slider) return;
    slider.addEventListener('input', () => {
      const v = parseInt(slider.value, 10);
      if (label) label.textContent = prefix + v + suffix;
      onChange(v);
    });
  }

  // ── Hardware toggle ───────────────────────────────────────────────────────

  _bindHardware() {
    const toggle = document.getElementById('hw-toggle');
    const status = document.getElementById('ws-status');
    if (!toggle) return;
    toggle.addEventListener('change', () => {
      if (toggle.checked) {
        this._bridge.connect();
        if (status) status.textContent = 'WebSocket: connecting…';
        this._bridge.onStatusChange(s => {
          if (status) status.textContent = `WebSocket: ${s}`;
        });
      } else {
        this._bridge.disconnect();
        if (status) status.textContent = 'WebSocket: inactive';
      }
    });
  }

  // ── Debug view ────────────────────────────────────────────────────────────

  _bindDebug() {
    const toggle = document.getElementById('debug-toggle');
    const panel  = document.getElementById('debug-panel');
    if (!toggle || !panel) return;
    toggle.addEventListener('change', () => {
      panel.classList.toggle('visible', toggle.checked);
    });
  }

  // ── Force mode buttons ────────────────────────────────────────────────────

  _bindForceButtons() {
    document.getElementById('force-idle')?.addEventListener('click', () => {
      this._ctrl.forceMode(null);   // release lock first
      this._ctrl._applyMode('IDLE');
    });

    const reflectBtn = document.getElementById('force-reflect');
    reflectBtn?.addEventListener('click', () => {
      if (this._ctrl._modeLocked && this._ctrl.currentMode === 'REFLECTION') {
        // Toggle off — release lock and return to IDLE
        this._ctrl.forceMode(null);
        this._ctrl._applyMode('IDLE');
      } else {
        // Lock into REFLECTION, skip wave transition
        this._img.resetBackground();
        this._ctrl.forceMode('REFLECTION');
      }
    });
  }

  // ── Content editor ────────────────────────────────────────────────────────

  _bindEditorButton() {
    document.getElementById('open-editor')?.addEventListener('click', () => {
      document.getElementById('editor-overlay')?.classList.add('open');
    });
  }

  // ── Resize ────────────────────────────────────────────────────────────────

  _handleResize() {
    const resize = () => this._ctrl.resize();
    resize();
    window.addEventListener('resize', resize);
  }
}
