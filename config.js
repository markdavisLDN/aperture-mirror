// Central config — tune these constants without touching module code
export const CONFIG = {
  // Grid
  GRID_COLS: 32,
  GRID_ROWS: 24,
  TOTAL_APERTURES: 768, // 32×24 — research-backed solid recognition threshold

  // Aperture rendering
  BLADE_COUNT: 6,
  // Blade rotation: degrees of travel from fully open to fully closed
  BLADE_OPEN_ANGLE: 55,    // degrees when open (blades retracted) — was -22, geometry is inverted
  BLADE_CLOSE_ANGLE: -30,  // degrees when closed (blades covering centre) — was 40
  IRIS_TRANSITION_MS: 400,

  // Camera / processing
  TARGET_FPS_CAMERA: 8,   // low fps = less jitter, apertures settle between frames
  TARGET_FPS_RENDER: 60,
  FACE_LOST_TIMEOUT_MS: 8000,

  // Wave transition
  WAVE_COLUMN_DELAY_MS: 40, // stagger between columns

  // Hardware bridge
  HARDWARE_MODE: false,
  WS_URL: 'ws://localhost:8765',

  // Brightness / contrast defaults (0–100)
  DEFAULT_BRIGHTNESS: 100,
  DEFAULT_CONTRAST: 70,
};
