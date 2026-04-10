import { CONFIG }      from '../config.js';
import { PATTERNS }    from './patterns.js';
import { FontRenderer } from './fontRenderer.js';

const COLS  = CONFIG.GRID_COLS;
const ROWS  = CONFIG.GRID_ROWS;
const TOTAL = CONFIG.TOTAL_APERTURES;

/**
 * Runs the JSON playlist during IDLE mode.
 * Stops when controller enters REFLECTION / TRANSITIONING.
 */
export class ContentEngine {
  constructor(controller) {
    this._ctrl      = controller;
    this._playlist  = { defaultDuration: 5000, loop: true, sequences: [] };
    this._index     = 0;
    this._running   = false;
    this._rafId     = null;
    this._seqStart  = 0;      // performance.now() when current sequence started
    this._current   = null;   // current sequence item
    this._font      = new FontRenderer();
    this._t         = 0;      // time accumulator for patterns (seconds)
    this._lastTime  = 0;

    // Pause/resume when mode changes
    document.addEventListener('aperture:idle',  () => this.resume());
    document.addEventListener('aperture:faceEnter', () => this.pause());
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async init() {
    await this._font.load();
    await this._loadPlaylist();
  }

  async _loadPlaylist() {
    try {
      const res = await fetch('/api/playlist');
      if (res.ok) {
        this._playlist = await res.json();
        console.log('[ContentEngine] Playlist loaded:', this._playlist.sequences.length, 'sequences');
      }
    } catch (e) {
      console.warn('[ContentEngine] Could not load playlist from server, using default');
    }
  }

  async savePlaylist() {
    try {
      await fetch('/api/playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this._playlist, null, 2),
      });
    } catch (e) {
      console.warn('[ContentEngine] Could not save playlist:', e.message);
    }
  }

  start() {
    if (this._playlist.sequences.length === 0) return;
    this._running  = true;
    this._index    = 0;
    this._seqStart = performance.now();
    this._lastTime = performance.now();
    this._advanceTo(0);
    this._tick(performance.now());
  }

  pause()  { this._running = false; }
  resume() {
    if (!this._running) {
      this._running  = true;
      this._seqStart = performance.now();
      this._lastTime = performance.now();
      this._tick(performance.now());
    }
  }

  // ── Main loop ─────────────────────────────────────────────────────────────

  _tick(now) {
    if (!this._running) return;

    const dt = (now - this._lastTime) / 1000;
    this._lastTime = now;
    this._t += dt;

    const seq      = this._current;
    const elapsed  = now - this._seqStart;
    const duration = seq?.duration ?? this._playlist.defaultDuration;

    if (seq) this._renderSequence(seq, elapsed / duration);

    if (elapsed >= duration) {
      this._nextSequence();
    }

    this._rafId = requestAnimationFrame(t => this._tick(t));
  }

  _nextSequence() {
    let next = this._index + 1;
    if (next >= this._playlist.sequences.length) {
      if (!this._playlist.loop) { this._running = false; return; }
      next = 0;
    }
    this._advanceTo(next);
  }

  _advanceTo(idx) {
    this._index    = idx;
    this._seqStart = performance.now();
    this._t        = 0;
    const seq = this._playlist.sequences[idx] ?? null;
    if (seq) seq._startTime = this._seqStart;  // used by fontRenderer for scroll position
    this._current  = seq;
  }

  // ── Sequence rendering ────────────────────────────────────────────────────

  _renderSequence(seq, progress) {
    let frame;

    switch (seq.type) {
      case 'pattern': {
        const fn = PATTERNS[seq.patternId];
        if (!fn) return;
        frame = fn(this._t, seq.speed ?? 1.0);
        break;
      }
      case 'text': {
        frame = this._font.render(seq.content ?? '', seq);
        break;
      }
      case 'solid': {
        frame = new Float32Array(TOTAL).fill(seq.value ?? 128);
        break;
      }
      case 'custom_grid': {
        frame = new Float32Array(seq.grid ?? new Array(TOTAL).fill(0));
        break;
      }
      default: return;
    }

    // Apply transition fade-in / fade-out
    const FADE = 0.12; // fraction of duration used for fade
    let alpha = 1;
    if (seq.transition === 'fade') {
      if (progress < FADE)       alpha = progress / FADE;
      else if (progress > 1-FADE) alpha = (1 - progress) / FADE;
    }

    if (alpha < 1) {
      const out = new Float32Array(TOTAL);
      const cur = this._ctrl.frame;
      for (let i = 0; i < TOTAL; i++) {
        out[i] = cur[i] * (1 - alpha) + frame[i] * alpha;
      }
      this._ctrl.setFrame(out);
    } else {
      this._ctrl.setFrame(frame);
    }
  }

  // ── Playlist management (used by editor) ──────────────────────────────────

  getPlaylist()       { return JSON.parse(JSON.stringify(this._playlist)); }

  setPlaylist(pl) {
    this._playlist = pl;
    if (this._running) { this._advanceTo(0); }
  }

  previewSequence(seq) {
    seq._startTime = performance.now();
    this._current  = seq;
    this._t        = 0;
    this._seqStart = performance.now();
    this._renderSequence(seq, 0);
  }
}
