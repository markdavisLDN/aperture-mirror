import { CONFIG } from '../config.js';

/**
 * WebSocket bridge to physical hardware server.
 * Inactive by default (HARDWARE_MODE = false).
 * When inactive, logs simulated PWM output to console.
 *
 * Physical build: set HARDWARE_MODE = true in config.js and point
 * WS_URL at the Node.js/Python server running on the installation machine.
 */
export class WebSocketBridge {
  constructor(controller) {
    this._ctrl      = controller;
    this._ws        = null;
    this._active    = CONFIG.HARDWARE_MODE;
    this._frameId   = 0;
    this._onStatus  = null;
    this._simLogRateLimit = 0;
  }

  connect() {
    if (this._ws) return;
    this._active = true;
    try {
      this._ws = new WebSocket(CONFIG.WS_URL);
      this._ws.onopen  = () => {
        console.log('[Bridge] Connected to hardware server');
        this._setStatus('connected');
      };
      this._ws.onclose = () => {
        console.log('[Bridge] Disconnected');
        this._ws = null;
        this._setStatus('disconnected');
      };
      this._ws.onerror = () => {
        console.warn('[Bridge] Connection error — is hardware server running?');
        this._setStatus('error');
      };
      this._ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'ack') {
            // Frame acknowledged by hardware server
          }
        } catch (_) {}
      };
    } catch (e) {
      console.warn('[Bridge] WebSocket unavailable:', e.message);
      this._setStatus('unavailable');
    }
  }

  disconnect() {
    this._active = false;
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
  }

  /**
   * Called on every frame update from ApertureController.
   * @param {number[]} frame  312 values 0–255
   */
  sendFrame(frame) {
    this._frameId++;

    if (this._active && this._ws?.readyState === WebSocket.OPEN) {
      // Physical mode: send to hardware server
      this._ws.send(JSON.stringify({ type: 'frame', frameId: this._frameId, frame }));
    } else if (!this._active) {
      // Simulation mode: log at max 2 Hz to avoid console flood
      const now = Date.now();
      if (now - this._simLogRateLimit >= 500) {
        this._simLogRateLimit = now;
        this._logSimulation(frame);
      }
    }
  }

  _logSimulation(frame) {
    // Log a sample of apertures (first 3) so console is readable
    const samples = [0, 12, 311].map(i => {
      const row = Math.floor(i / CONFIG.GRID_COLS);
      const col = i % CONFIG.GRID_COLS;
      const pwm = Math.round((frame[i] / 255) * 100);
      return `[APERTURE SIM] col:${col} row:${row} value:${Math.round(frame[i])} pwm:${pwm}%`;
    });
    samples.forEach(s => console.log(s));
  }

  onStatusChange(cb) { this._onStatus = cb; }

  _setStatus(s) { if (this._onStatus) this._onStatus(s); }
}
