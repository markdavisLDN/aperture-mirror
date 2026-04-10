import { CONFIG } from '../config.js';

const COLS  = CONFIG.GRID_COLS;
const ROWS  = CONFIG.GRID_ROWS;
const TOTAL = CONFIG.TOTAL_APERTURES;

// Lightweight seeded noise (value noise, not Perlin — avoids library dependency)
function hash(n) {
  let x = Math.sin(n) * 43758.5453123;
  return x - Math.floor(x);
}
function smoothNoise2D(x, y, t) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx*fx*(3-2*fx), uy = fy*fy*(3-2*fy);
  const a = hash(ix     + iy*57 + t*13);
  const b = hash(ix+1   + iy*57 + t*13);
  const c = hash(ix     + (iy+1)*57 + t*13);
  const d = hash(ix+1   + (iy+1)*57 + t*13);
  return a + (b-a)*ux + (c-a)*uy + (d-a+a-b-c+b+c-a)*ux*uy;
  // simplified: lerp(lerp(a,b,ux), lerp(c,d,ux), uy)
}
function lerp2D(x, y, t) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x-ix, fy = y-iy;
  const ux = fx*fx*(3-2*fx), uy = fy*fy*(3-2*fy);
  const a=hash(ix+iy*57+t*7), b=hash(ix+1+iy*57+t*7);
  const c=hash(ix+(iy+1)*57+t*7), d=hash(ix+1+(iy+1)*57+t*7);
  return a+(b-a)*ux+(c-a)*uy+(d-b-c+a)*ux*uy;
}

/**
 * Each pattern function signature: (t: seconds, speed: number) → Float32Array(312)
 * Values 0–255.
 */

export const PATTERNS = {

  scan_h(t, speed) {
    const out = new Float32Array(TOTAL);
    const lineRow = (t * speed * ROWS) % ROWS;
    for (let row = 0; row < ROWS; row++) {
      const dist = Math.abs(row - lineRow);
      const v = Math.max(0, 255 - dist * 80);
      for (let col = 0; col < COLS; col++) {
        out[row * COLS + col] = v;
      }
    }
    return out;
  },

  scan_v(t, speed) {
    const out = new Float32Array(TOTAL);
    const lineCol = (t * speed * COLS) % COLS;
    for (let col = 0; col < COLS; col++) {
      const dist = Math.abs(col - lineCol);
      const v = Math.max(0, 255 - dist * 80);
      for (let row = 0; row < ROWS; row++) {
        out[row * COLS + col] = v;
      }
    }
    return out;
  },

  ripple(t, speed) {
    const out = new Float32Array(TOTAL);
    const cx = COLS / 2, cy = ROWS / 2;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const dx = (col - cx) / COLS * 2;
        const dy = (row - cy) / ROWS * 2;
        const dist = Math.sqrt(dx*dx + dy*dy);
        const v = (Math.sin(dist * 12 - t * speed * 4) + 1) / 2;
        out[row * COLS + col] = v * 220 + 20;
      }
    }
    return out;
  },

  noise(t, speed) {
    const out = new Float32Array(TOTAL);
    const tOff = t * speed * 0.3;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const nx = col / COLS * 3;
        const ny = row / ROWS * 3;
        const n1 = lerp2D(nx, ny, tOff);
        const n2 = lerp2D(nx*2, ny*2, tOff*1.3) * 0.5;
        const v  = (n1 + n2) / 1.5;
        out[row * COLS + col] = Math.max(20, Math.min(235, v * 215 + 20));
      }
    }
    return out;
  },

  pulse(t, speed) {
    const out = new Float32Array(TOTAL);
    const v = ((Math.sin(t * speed * Math.PI * 2) + 1) / 2) * 230 + 10;
    out.fill(v);
    return out;
  },

  columns(t, speed) {
    const out = new Float32Array(TOTAL);
    for (let col = 0; col < COLS; col++) {
      const phase = (t * speed * 2 + col / COLS * 2) % 2;
      const v = phase < 1
        ? phase * 230
        : (2 - phase) * 230;
      for (let row = 0; row < ROWS; row++) {
        out[row * COLS + col] = Math.max(10, v);
      }
    }
    return out;
  },

  cascade(t, speed) {
    const out = new Float32Array(TOTAL);
    for (let col = 0; col < COLS; col++) {
      const colSpeed = speed * (0.6 + hash(col * 3.7) * 0.8);
      const offset   = hash(col * 1.3) * ROWS;
      for (let row = 0; row < ROWS; row++) {
        const pos = ((t * colSpeed * ROWS + offset) % ROWS);
        const dist = Math.abs(row - pos);
        const wrap = Math.min(dist, ROWS - dist);
        out[row * COLS + col] = Math.max(0, 240 - wrap * 55);
      }
    }
    return out;
  },

  edges_only(t, speed) {
    const out = new Float32Array(TOTAL);
    const pulse = ((Math.sin(t * speed * 2) + 1) / 2) * 80 + 150;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const isEdge = row === 0 || row === ROWS-1 || col === 0 || col === COLS-1;
        out[row * COLS + col] = isEdge ? pulse : 0;
      }
    }
    return out;
  },
};
