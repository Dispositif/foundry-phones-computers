import { MODULE_ID } from "./constants.js";
import { feature } from "./features.js";
/* -------------------------------------------- */
/*  Universes: era or genre of the world        */
/* -------------------------------------------- */

/**
 * One entry per universe. Keys are stable (stored in the world setting); visible names
 * live in the language files ("UniverseName.<key>"), so they can be renamed freely.
 *
 * models:       device models offered when creating a device.
 * themes:       looks offered per model; the first one is the default look.
 *               "standard" = the model's own look. A model not listed keeps every look.
 * satellite:    satellite option per model (advanced feature "satellite"):
 *               "option" = the GM may tick it, "forced" = always satellite (the model is
 *               only offered while the feature is on). A model not listed: never satellite.
 * defaultModel: device created for a character when a player is called or texted.
 * numberPrefix: start of new numbers while the world setting keeps its default ("555-").
 * mailPrefix:   laptops and terminals get an ID ("NX-4217") instead of a random email address.
 * ring:         ringtone given to new devices that ring (file in sounds/), instead of the model's.
 *
 * The universe only sets what is offered for NEW devices: existing devices keep their look,
 * ringtone and options when the universe changes.
 * Vocabulary: the language files may override any key under "Universe.<key>.<same key>".
 */
export const DEFAULT_UNIVERSE = "modern";
export const UNIVERSES = {
  retro: {
    models: ["landline", "pager", "mobile", "brick", "computer", "desktop", "jammer"],
    themes: {
      landline: ["modern", "vintage"],
      mobile: ["standard"],
      brick: ["standard"],
      pager: ["standard"],
      computer: ["console", "standard"],
      desktop: ["console", "standard", "military", "federal"]
    },
    defaultModel: "mobile"
  },
  modern: {
    models: ["smartphone", "mobile", "brick", "pager", "computer", "desktop", "landline", "jammer"],
    themes: {
      smartphone: ["standard", "military"],
      mobile: ["standard"],
      brick: ["standard"],
      pager: ["standard"],
      computer: ["standard", "federal", "military", "console"],
      desktop: ["standard", "federal", "military", "console"],
      landline: ["modern", "vintage"]
    },
    // The brick only exists as a satellite phone here (no GSM brick in the 2000s).
    satellite: { brick: "forced", smartphone: "option", pager: "option" },
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
    satellite: { smartphone: "option", pager: "option" },
    defaultModel: "smartphone",
    numberPrefix: "NC-",
    mailPrefix: "NX-",
    ring: "ring-cyber.ogg"
  }
};

/** The universe setting as stored (may still be "all", the removed "Any setting", until migrated). */
export function storedUniverseKey() {
  try {
    return game.settings.get(MODULE_ID, "universe");
  } catch {
    return DEFAULT_UNIVERSE;
  }
}

/** Key of the world's universe (Modern before the settings are ready, or if unknown). */
export function universeKey() {
  const key = storedUniverseKey();
  return UNIVERSES[key] ? key : DEFAULT_UNIVERSE;
}

export function universe() {
  return UNIVERSES[universeKey()];
}

/** Satellite option for a new device of this model: "option", "forced" or null (feature off: always null). */
export function satellitePolicy(model) {
  if (!feature("satellite")) return null;
  return universe().satellite?.[model] ?? null;
}

/** Can a new device of this model be created in this universe? (a satellite-only model needs the feature) */
export function modelAllowed(model) {
  if (!universe().models.includes(model)) return false;
  return universe().satellite?.[model] !== "forced" || feature("satellite");
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
