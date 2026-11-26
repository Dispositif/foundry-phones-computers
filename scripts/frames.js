import { skinOf } from "./devices.js";
/* -------------------------------------------- */
/*  Device frames around the player window      */
/* -------------------------------------------- */

/** Device frames, by kind (see frameKind). Sizes are the window's, frame included. */
const LANDLINE_DECO = `<span class="spt-frame-deco spt-frame-handset"></span><span class="spt-frame-deco spt-frame-cord"></span>`;
export const FRAMES = {
  smartphone: {
    width: 340, height: 640,
    before: `<span class="spt-frame-deco spt-frame-side r"></span><span class="spt-frame-deco spt-frame-side l"></span><span class="spt-frame-deco spt-frame-side l2"></span><span class="spt-frame-deco spt-frame-camera"></span>`,
    after: `<span class="spt-frame-deco spt-frame-homebar"></span>`
  },
  mobile: {
    width: 290, height: 600, gm: { width: 330, height: 660 },
    before: `<div class="spt-frame-deco spt-frame-speaker"></div>`,
    after: `<div class="spt-frame-deco spt-frame-keys" aria-hidden="true"><span class="nav"><i class="fas fa-caret-left"></i><b>OK</b><i class="fas fa-caret-right"></i></span>${"123456789*0#".split("").map((k) => `<span>${k}</span>`).join("")}</div>`
  },
  // 1980s brick: huge tall shell, tiny screen, tiny keys, antenna pulled out during a call.
  brick: {
    width: 240, height: 680, gm: { width: 300, height: 720 },
    before: `<span class="spt-frame-deco spt-frame-antenna"></span><div class="spt-frame-deco spt-brick-grille"></div><div class="spt-frame-deco spt-brick-brand">CELLULAR</div>`,
    after: `<div class="spt-frame-deco spt-brick-pad" aria-hidden="true"><div class="fn">${["RCL", "STO", "FCN", "CLR", "PWR", "VOL"].map((k) => `<span>${k}</span>`).join("")}</div><div class="num">${"123456789*0#".split("").map((k) => `<span>${k}</span>`).join("")}</div><div class="fn"><span class="snd">SND</span><span class="end">END</span></div></div><div class="spt-frame-deco spt-brick-mic"></div>`
  },
  // Satellite phone (2000s): short screen, big keys, thick antenna.
  bricksat: {
    width: 270, height: 570, gm: { width: 320, height: 610 },
    before: `<span class="spt-frame-deco spt-frame-antenna"></span><span class="spt-frame-deco spt-frame-sat">SAT</span><div class="spt-frame-deco spt-frame-speaker"></div>`,
    after: `<div class="spt-frame-deco spt-frame-keys spt-brick-keys" aria-hidden="true"><span class="snd">SND</span><span class="clr">CLR</span><span class="end">END</span>${"123456789*0#".split("").map((k) => `<span>${k}</span>`).join("")}</div>`
  },
  computer: {
    width: 640, height: 460,
    before: `<span class="spt-frame-deco spt-frame-webcam"></span>`,
    after: `<span class="spt-frame-deco spt-frame-base"></span>`
  },
  monitor: {
    width: 640, height: 440,
    before: `<span class="spt-frame-deco spt-frame-led"></span>`,
    after: `<span class="spt-frame-deco spt-frame-stand"></span>`
  },
  crt: {
    width: 620, height: 480,
    before: `<span class="spt-frame-deco spt-frame-led"></span>`,
    after: `<span class="spt-frame-deco spt-frame-scan"></span><span class="spt-frame-deco spt-frame-vents"></span>`
  },
  desk: { width: 330, height: 520, before: LANDLINE_DECO },
  rotary: { width: 370, height: 540, before: LANDLINE_DECO }
};

/** Frame drawn around a device: by model, and by look for terminals and landlines. */
export function frameKind(phone) {
  const model = phone?.model ?? "smartphone";
  const skin = skinOf(phone);
  if (model === "desktop") return ["console", "military"].includes(skin) ? "crt" : "monitor";
  if (model === "landline") return skin === "modern" ? "desk" : "rotary";
  if (model === "satphone") return "bricksat";
  return FRAMES[model] ? model : null;
}
