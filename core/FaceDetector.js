/**
 * Wraps MediaPipe FaceDetector (Tasks API).
 * Emits 'faceEnter' and 'faceExit' custom events on document.
 *
 * Falls back to a 5-second demo loop if MediaPipe fails to load
 * (e.g. no internet / CDN blocked), so the rest of the app still works.
 */
export class FaceDetector {
  constructor() {
    this._detector  = null;
    this._running   = false;
    this._hasFace   = false;
    this._source    = null;
    this._rafId     = null;
    this._listeners = { faceEnter: [], faceExit: [] };
    this._loaded    = false;
    this._fallback  = false;
    this._bbox      = null; // { x, y, w, h } raw video pixel coords, updated each frame
  }

  // ── Load MediaPipe model ──────────────────────────────────────────────────

  async load() {
    try {
      const { FaceDetector: MPFaceDetector, FilesetResolver } = await import(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/vision_bundle.mjs'
      );

      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm'
      );

      this._detector = await MPFaceDetector.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        minDetectionConfidence: 0.55,
      });

      this._loaded = true;
      console.log('[FaceDetector] MediaPipe loaded');
    } catch (e) {
      console.warn('[FaceDetector] MediaPipe failed, using fallback:', e.message);
      this._fallback = true;
      this._loaded   = true;
    }
  }

  // ── Detection loop ────────────────────────────────────────────────────────

  start(videoEl) {
    this._source = videoEl;
    if (!this._running) {
      this._running = true;
      if (this._fallback) {
        this._runFallback();
      } else {
        this._runLoop();
      }
    }
  }

  stop() {
    this._running = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
  }

  _runLoop() {
    const tick = (now) => {
      if (!this._running) return;
      if (this._source && this._source.readyState >= 2 && this._detector) {
        try {
          const result   = this._detector.detectForVideo(this._source, now);
          const detected = result.detections.length > 0;
          if (detected) {
            // Pick highest-confidence detection; bbox in raw video pixel coords
            const bb = result.detections[0].boundingBox;
            this._bbox = { x: bb.originX, y: bb.originY, w: bb.width, h: bb.height };
          } else {
            this._bbox = null;
          }
          this._update(detected);
        } catch (_) { /* frame not ready */ }
      }
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  /** Fallback: simulate face entering every 12s, staying for 8s */
  _runFallback() {
    console.info('[FaceDetector] Fallback mode — simulating face detection');
    const cycle = () => {
      if (!this._running) return;
      this._update(true);
      setTimeout(() => {
        if (!this._running) return;
        this._update(false);
        setTimeout(cycle, 4000);
      }, 8000);
    };
    setTimeout(cycle, 3000);
  }

  _update(detected) {
    if (detected && !this._hasFace) {
      this._hasFace = true;
      this._emit('faceEnter');
    } else if (!detected && this._hasFace) {
      this._hasFace = false;
      this._emit('faceExit');
    }
  }

  // ── Event emitter ─────────────────────────────────────────────────────────

  on(event, cb) {
    // Internal listeners only — _emit calls them directly.
    // ContentEngine uses document.addEventListener('aperture:*') separately.
    if (this._listeners[event]) this._listeners[event].push(cb);
  }

  _emit(event) {
    this._listeners[event]?.forEach(cb => cb());
    document.dispatchEvent(new CustomEvent(`aperture:${event}`));
  }

  get hasFace()  { return this._hasFace; }
  get isLoaded() { return this._loaded; }
  get bbox()     { return this._bbox; }  // null when no face detected
}
