// Central config — tune these constants without touching module code
export const CONFIG = {
  // Grid
  GRID_COLS: 24,
  GRID_ROWS: 13,
  TOTAL_APERTURES: 312,

  // Aperture rendering
  BLADE_COUNT: 6,
  // Blade rotation: degrees of travel from fully open to fully closed
  BLADE_OPEN_ANGLE: -22,   // degrees when open (blades retracted)
  BLADE_CLOSE_ANGLE: 40,   // degrees when closed (blades covering centre)
  IRIS_TRANSITION_MS: 80,  // CSS transition duration for blade movement

  // Camera / processing
  TARGET_FPS_CAMERA: 24,
  TARGET_FPS_RENDER: 60,
  FACE_LOST_TIMEOUT_MS: 3000,

  // Wave transition
  WAVE_COLUMN_DELAY_MS: 40, // stagger between columns

  // Hardware bridge
  HARDWARE_MODE: false,
  WS_URL: 'ws://localhost:8765',

  // Brightness / contrast defaults (0–100)
  DEFAULT_BRIGHTNESS: 80,
  DEFAULT_CONTRAST: 60,
};
