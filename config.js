// Central config — tune these constants without touching module code
export const CONFIG = {
  // Grid
  GRID_COLS: 38,
  GRID_ROWS: 28,
  TOTAL_APERTURES: 1064, // 38×28 — +38% vs 32×24 for clearer portrait

  // Aperture rendering
  BLADE_COUNT: 6,
  // Blade rotation: degrees of travel from fully open to fully closed
  BLADE_OPEN_ANGLE: 55,    // degrees when open (blades retracted)
  BLADE_CLOSE_ANGLE: -55,  // degrees when closed — more extreme to ensure full blackout
  IRIS_TRANSITION_MS: 400,

  // Camera / processing
  TARGET_FPS_CAMERA: 6,   // 6fps — gives apertures time to settle between updates
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
