/**
 * Klynge mark + wordmark geometry. Pure, hand-built vector paths (no fonts, no strokes) so every
 * exported SVG is fully editable and license-free. Coordinates are absolute M/L/H/V/Z only.
 *
 * Concept: a stem (structure) + two arms that CONVERGE on a decision node, then BRANCH.
 */

/** Mark on a 64×64 grid (icon safe area 9..55). */
export const MARK = {
  viewBox: [0, 0, 64, 64],
  stem: "M12 9H21V55H12Z",
  upper: "M43 9H54L35 29.5L29.5 24Z",
  lower: "M29.5 40L35 34.5L54 55H43Z",
  node: "M25 32L29.5 27.5L34 32L29.5 36.5Z",
};
/** Tight bounds of the mark artwork inside the 64 grid. */
export const MARK_BOUNDS = { x: 12, y: 9, w: 42, h: 46 };

const CAP = 40;
const S = 7.5;

/** Wordmark letters on a 40-unit cap height. K is derived from the mark (scaled), the rest are geometric. */
export const LETTERS = {
  L: { w: 26, d: [`M0 0H${S}V${CAP - S}H26V${CAP}H0Z`] },
  Y: { w: 34, d: ["M0 0H8.6L17 13.2L25.4 0H34L20.75 20.5V40H13.25V20.5Z"] },
  N: { w: 32, d: [`M0 0H${S}L24.5 26V0H32V40H24.5L${S} 14V40H0Z`] },
  G: { w: 32, d: [`M0 0H32V${S}H${S}V32.5H24.5V24H16V16.5H32V40H0Z`] },
  E: { w: 26, d: [`M0 0H26V${S}H${S}V16.25H22V23.75H${S}V32.5H26V40H0Z`] },
};
export const LETTER_GAP = 6.5;

/** Transform absolute M/L/H/V/Z path data by scale + translate, baking coordinates. */
export function transformPath(d, s, tx, ty) {
  const r = (n) => +n.toFixed(3);
  return d.replace(/([MLHVZ])([^MLHVZ]*)/g, (_, cmd, args) => {
    const nums = args.trim() ? args.trim().split(/[\s,]+/).map(Number) : [];
    if (cmd === "Z") return "Z";
    if (cmd === "H") return "H" + nums.map((x) => r(x * s + tx)).join(" ");
    if (cmd === "V") return "V" + nums.map((y) => r(y * s + ty)).join(" ");
    const out = [];
    for (let i = 0; i < nums.length; i += 2) out.push(`${r(nums[i] * s + tx)} ${r(nums[i + 1] * s + ty)}`);
    return cmd + out.join(" ");
  });
}

/** Mark paths scaled so its artwork is `height` tall, positioned with its top-left at (x, y). */
export function markAt(x, y, height) {
  const s = height / MARK_BOUNDS.h;
  const tx = x - MARK_BOUNDS.x * s;
  const ty = y - MARK_BOUNDS.y * s;
  return {
    stem: transformPath(MARK.stem, s, tx, ty),
    upper: transformPath(MARK.upper, s, tx, ty),
    lower: transformPath(MARK.lower, s, tx, ty),
    node: transformPath(MARK.node, s, tx, ty),
    width: MARK_BOUNDS.w * s,
  };
}

/** Wordmark "KLYNGE" laid out at (x, y) with cap height `cap`. Returns grouped paths and width. */
export function wordmarkAt(x, y, cap) {
  const s = cap / CAP;
  const k = markAt(x, y, cap);
  let cursor = x + k.width + LETTER_GAP * s;
  const letters = [];
  for (const ch of ["L", "Y", "N", "G", "E"]) {
    const L = LETTERS[ch];
    letters.push({ ch, d: L.d.map((d) => transformPath(d, s, cursor, y)) });
    cursor += (L.w + LETTER_GAP) * s;
  }
  return { k, letters, width: cursor - LETTER_GAP * s - x };
}
