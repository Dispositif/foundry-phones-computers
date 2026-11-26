import { esc } from "./util.js";
import { t } from "./i18n.js";
/* -------------------------------------------- */
/*  Landline dials: rotary dial and keypad      */
/* -------------------------------------------- */

/* Rotary dial (landline): 1 at the top right, then counter-clockwise; finger stop between 0 and 1. */
export const DIAL_DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
export const DIAL_STOP = 15;
export const DIAL_ANGLE = (d) => 60 + 30 * DIAL_DIGITS.indexOf(d);

/** Push-button keypad (modern landline, 1980-2020). */
export function keypad() {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];
  return `<div class="spt-keypad">${keys.map((k) => `<button type="button" data-action="dial" data-digit="${k}">${k}</button>`).join("")}</div>`;
}

export function rotaryDial(number) {
  const pos = (deg, r) => [r * Math.cos((deg * Math.PI) / 180), -r * Math.sin((deg * Math.PI) / 180)].map((v) => v.toFixed(1));
  const holes = DIAL_DIGITS.map((d) => ({ d, xy: pos(DIAL_ANGLE(d), 68) }));
  const [s1, s2] = [pos(DIAL_STOP, 80), pos(DIAL_STOP, 99)];
  return `<svg class="spt-rotary" viewBox="-100 -100 200 200" aria-label="${t("Number")}">
      <defs><mask id="spt-holes"><rect x="-100" y="-100" width="200" height="200" fill="#fff"/>${holes.map((h) => `<circle cx="${h.xy[0]}" cy="${h.xy[1]}" r="14" fill="#000"/>`).join("")}<circle r="40" fill="#000"/></mask>
        <radialGradient id="spt-bakelite" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#4a4541"/><stop offset="0.55" stop-color="#1b1917"/><stop offset="1" stop-color="#0c0b0a"/></radialGradient></defs>
      <circle class="spt-dial-plate" r="96"/>
      ${holes.map((h) => `<text class="spt-dial-digit" x="${h.xy[0]}" y="${h.xy[1]}">${h.d}</text>`).join("")}
      <g class="spt-rotor"><circle r="92" fill="url(#spt-bakelite)" mask="url(#spt-holes)"/></g>
      <circle class="spt-dial-card" r="38"/>
      <text class="spt-dial-number" y="4">${esc(number ?? "")}</text>
      <line class="spt-dial-stop" x1="${s1[0]}" y1="${s1[1]}" x2="${s2[0]}" y2="${s2[1]}"/>
      ${holes.map((h) => `<circle class="spt-dial-hole" data-action="dial" data-digit="${h.d}" cx="${h.xy[0]}" cy="${h.xy[1]}" r="15"><title>${h.d}</title></circle>`).join("")}
    </svg>`;
}
