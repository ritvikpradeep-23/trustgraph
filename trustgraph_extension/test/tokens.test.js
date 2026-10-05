// Design tokens match the spec exactly, and every verdict chip and text
// colour meets WCAG AA contrast, in both themes.
//   node trustgraph_extension/test/tokens.test.js
"use strict";
const D = require("../shared/design.js");

let failed = 0;
const check = (ok, name) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name);
  if (!ok) failed++;
};

// The design spec ("Visual design system (match exactly)").
const SPEC = {
  "--bg": "#060B1A", "--bg-deep": "#020611", "--surface": "#0E1A38", "--surface-2": "#162750", "--surface-3": "#1B3267",
  "--border": "#243A6B", "--primary": "#2F66F0", "--primary-hover": "#2554CA", "--primary-glow": "rgba(47,102,240,.3)",
  "--accent-light": "#9DBBFF", "--text": "#F1F5FF", "--text-muted": "#B4C2E4", "--text-dim": "#7E92C3",
  "--low": "#3EE6A8", "--caution": "#FFB938", "--high": "#FF5468",
};
for (const [k, v] of Object.entries(SPEC)) check(D.DARK[k] === v, `${k} = ${v}`);
check(Object.keys(D.LIGHT).sort().join() === Object.keys(D.DARK).sort().join(), "light theme defines every dark token");

// ---- contrast ---------------------------------------------------------------
function parse(c) {
  if (c.startsWith("#")) return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)).concat(1);
  const m = c.match(/rgba?\(([^)]+)\)/)[1].split(",").map(Number);
  return [m[0], m[1], m[2], m[3] === undefined ? 1 : m[3]];
}
const over = (top, bottom) => { const [r, g, b, a] = parse(top); const [R, G, B] = parse(bottom); return [r * a + R * (1 - a), g * a + G * (1 - a), b * a + B * (1 - a)]; };
const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

for (const [name, T] of [["dark", D.DARK], ["light", D.LIGHT]]) {
  for (const surface of ["--bg", "--surface", "--surface-2"]) {
    // Verdict colours as text straight on a surface (gauge numbers, scores).
    for (const lv of ["low", "caution", "high"]) {
      const r = ratio(parse(T[`--${lv}`]).slice(0, 3), parse(T[surface]).slice(0, 3));
      check(r >= 4.5, `${name}: ${lv} text on ${surface} ${r.toFixed(2)}:1`);
    }
    for (const t of ["--text", "--text-muted", "--text-dim", "--accent-light"]) {
      const r = ratio(parse(T[t]).slice(0, 3), parse(T[surface]).slice(0, 3));
      check(r >= 4.5, `${name}: ${t} on ${surface} ${r.toFixed(2)}:1`);
    }
  }
  // Chips paint their tint over --chip-base, whatever card they sit on.
  for (const lv of ["low", "caution", "high"]) {
    const r = ratio(parse(T[`--${lv}`]).slice(0, 3), over(T[`--${lv}-bg`], T["--chip-base"]));
    check(r >= 4.5, `${name}: ${lv} chip ${r.toFixed(2)}:1`);
  }
  const btn = ratio(parse(T["--on-primary"]).slice(0, 3), parse(T["--primary"]).slice(0, 3));
  check(btn >= 4.5, `${name}: button text on --primary ${btn.toFixed(2)}:1`);
}

console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
