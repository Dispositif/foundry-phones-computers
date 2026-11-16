import { MODULE_ID } from "./constants.js";
/* -------------------------------------------- */
/*  Universes: era or genre of the world        */
/* -------------------------------------------- */

/**
 * One entry per universe. Keys are stable (stored in the world setting); visible names
 * live in the language files ("UniverseName.<key>"), so they can be renamed freely.
 *
 * models:       device models offered when creating a device (null = all).
 * themes:       looks offered per model; the first one is the default look.
 *               "standard" = the model's own look. A model not listed keeps every look.
 * defaultModel: device created for a character when a player is called or texted.
 * numberPrefix: start of new numbers while the world setting keeps its default ("555-").
 * mailPrefix:   laptops and terminals get an ID ("NX-4217") instead of a random email address.
 * ring:         ringtone of every device that rings (file in sounds/), instead of the model's.
 *
 * Vocabulary: the language files may override any key under "Universe.<key>.<same key>".
 */
export const UNIVERSES = {
  all: { models: null, themes: {}, defaultModel: "smartphone" },
  retro: {
    models: ["landline", "pager", "mobile", "computer", "desktop", "jammer"],
    themes: {
      landline: ["modern", "vintage"],
      mobile: ["standard"],
      pager: ["standard"],
      computer: ["console", "standard"],
      desktop: ["console", "standard", "military", "federal"]
    },
    defaultModel: "mobile"
  },
  modern: {
    models: ["smartphone", "mobile", "pager", "computer", "desktop", "landline", "jammer"],
    themes: {
      smartphone: ["standard", "military"],
      mobile: ["standard"],
      pager: ["standard"],
      computer: ["standard", "federal", "military", "console"],
      desktop: ["standard", "federal", "military", "console"],
      landline: ["modern", "vintage"]
    },
    defaultModel: "smartphone"
  },
  cyberpunk: {
    models: ["smartphone", "computer", "desktop", "pager", "landline", "jammer"],
    themes: {
      smartphone: ["neon", "glitch", "military"],
      computer: ["neon", "glitch", "console"],
      desktop: ["neon", "glitch", "console", "military"],
      pager: ["neon", "standard"],
      landline: ["modern"],
      jammer: ["neon", "standard"]
    },
    defaultModel: "smartphone",
    numberPrefix: "NC-",
    mailPrefix: "NX-",
    ring: "ring-cyber.ogg"
  }
};

/** Key of the world's universe ("all" before the settings are ready, or if unknown). */
export function universeKey() {
  let key = "all";
  try {
    key = game.settings.get(MODULE_ID, "universe");
  } catch {}
  return UNIVERSES[key] ? key : "all";
}

export function universe() {
  return UNIVERSES[universeKey()];
}

/** Can a new device of this model be created in this universe? */
export function modelAllowed(model) {
  const models = universe().models;
  return !models || models.includes(model);
}

/** GM panel look: the "gmLook" setting, or by universe when "auto" (cyberpunk: haze; vintage: classic; else ops room). */
export function gmLook() {
  let look = "auto";
  try {
    look = game.settings.get(MODULE_ID, "gmLook");
  } catch {}
  if (["ops", "haze", "classic"].includes(look)) return look;
  const key = universeKey();
  return key === "cyberpunk" ? "haze" : key === "retro" ? "classic" : "ops";
}

/** Put the look on <body> (CSS: body[data-spt-gm-look]); the classic look has none. */
export function applyGmLook() {
  const look = gmLook();
  if (look === "classic") delete document.body.dataset.sptGmLook;
  else document.body.dataset.sptGmLook = look;
}
