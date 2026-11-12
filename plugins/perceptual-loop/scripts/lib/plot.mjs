// Plots for eyes, drawn on RGB8 with the bitmap font, so a sweep needs no
// plotting library: lines and arrows, and small multiples, one panel per
// series over the frames, with the flagged frames marked in red.
import { CELL_H, drawText, fitText, textWidth } from "./font.mjs";
import { canvas, DIM, FG, fillRect, pad } from "./raster.mjs";

const SCALE = 2;
const LINE_H = CELL_H * SCALE + 6;
export const BLUE = [120, 190, 255];
export const RED = [210, 60, 50];
export const PINK = [255, 120, 110];
const FRAME = [60, 60, 64];

/** A line from (x0, y0) to (x1, y1), `thick` pixels across, clipped to the picture. */
export function drawLine(img, x0, y0, x1, y1, colour, thick = 1) {
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  const r = Math.floor((thick - 1) / 2);
  for (let k = 0; k <= n; k++) {
    const x = Math.round(x0 + ((x1 - x0) * k) / n), y = Math.round(y0 + ((y1 - y0) * k) / n);
    fillRect(img, x - r, y - r, thick, thick, colour);
  }
}

/** An arrow from (x0, y0) to (x1, y1): the shaft and a two-stroke head a third of its length. */
export function drawArrow(img, x0, y0, x1, y1, colour, thick = 1) {
  drawLine(img, x0, y0, x1, y1, colour, thick);
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 2) return;
  const a = Math.atan2(y1 - y0, x1 - x0), head = Math.max(3, len * 0.35);
  for (const side of [-1, 1]) drawLine(img, x1, y1, x1 - head * Math.cos(a + side * 0.5), y1 - head * Math.sin(a + side * 0.5), colour, thick);
}

const strokeRect = (img, x0, y0, x1, y1, colour) => {
  drawLine(img, x0, y0, x1, y0, colour); drawLine(img, x0, y1, x1, y1, colour);
  drawLine(img, x0, y0, x0, y1, colour); drawLine(img, x1, y0, x1, y1, colour);
};

const num = (v) => (Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(2) : Number(v.toPrecision(4)).toString());

/**
 * Small multiples: one panel per series, values over the frames, a red line at each flagged frame.
 * panels: [{ name, values, flagged: [frame numbers], head, alert }]; `frames` are the frame numbers the
 * values sit on (a series shorter than the clip sits on its last frames). A series whose range is under
 * 4 x `floor` is drawn flat rather than zoomed into its rounding.
 */
export function plotPanels(panels, { title = "", frames, width = 1500, floor = 1e-12, more = 0 } = {}) {
  const ph = 150, left = 12 + textWidth("-0.0000", SCALE), right = 16, top = LINE_H + 8, bottom = LINE_H + 4;
  const img = canvas(width, top + ph * panels.length + bottom);
  drawText(img, 8, 4, fitText(title + (more > 0 ? `   (+${more} more series in the report)` : ""), width - 16, SCALE), DIM, SCALE);
  panels.forEach(({ name, values, flagged = [], head = "", alert = false }, k) => {
    const y0 = top + k * ph + LINE_H + 4, y1 = top + (k + 1) * ph - 14;
    const clean = values.filter((v) => v !== null && Number.isFinite(v));
    let lo = clean.length ? Math.min(...clean) : 0, hi = clean.length ? Math.max(...clean) : 1;
    if (hi - lo < 4 * floor) { const mid = (lo + hi) / 2; lo = mid - 2 * floor; hi = mid + 2 * floor; }
    const X = (i) => left + ((width - left - right) * i) / Math.max(1, values.length - 1);
    const Y = (v) => y1 - ((y1 - y0) * (v - lo)) / (hi - lo);
    strokeRect(img, left, y0, width - right, y1, FRAME);
    drawText(img, left, y0 - LINE_H, fitText(head ? `${name}   ${head}` : name, width - left - right, SCALE), alert ? PINK : FG, SCALE);
    drawText(img, 4, y0, fitText(num(hi), left - 8, SCALE), DIM, SCALE);
    drawText(img, 4, y1 - CELL_H * SCALE, fitText(num(lo), left - 8, SCALE), DIM, SCALE);
    const at = new Map(frames.slice(frames.length - values.length).map((f, i) => [f, i]));
    for (const f of flagged) {
      if (!at.has(f)) continue;
      const x = Math.round(X(at.get(f)));
      drawLine(img, x, y0, x, y1, RED);
      drawText(img, Math.min(x + 4, width - right - textWidth(String(f), SCALE)), y0 + 3, String(f), PINK, SCALE);
    }
    const pts = values.map((v, i) => (v !== null && Number.isFinite(v) ? [X(i), Y(v)] : null));
    for (let i = 1; i < pts.length; i++) if (pts[i - 1] && pts[i]) drawLine(img, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], BLUE, 2);
    if (pts.length <= 120) for (const p of pts) if (p) fillRect(img, Math.round(p[0]) - 2, Math.round(p[1]) - 2, 5, 5, [200, 225, 255]);
  });
  if (frames.length) {
    const y = img.height - bottom + 4, last = `frame ${frames.at(-1)}`;
    drawText(img, left, y, `frame ${frames[0]}`, DIM, SCALE);
    drawText(img, width - right - textWidth(last, SCALE), y, last, DIM, SCALE);
  }
  return pad(img);
}
