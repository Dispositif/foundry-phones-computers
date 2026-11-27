import { labels } from "./i18n.js";

export const MODULE_ID = "soren-phones-computers";
export const LEGACY_IDS = ["soren-phone-terminal", "soren-burner-phone", "dg-telephone"]; // former ids (Phone & Terminal v0.16-0.29, Burner Phone v0.8-0.15, DG Téléphone v0.1-0.7)
export const SOCKET = `module.${MODULE_ID}`;
/** The module's version (module.json), shown on the device and in the GM panel title. */
export const moduleVersion = () => game.modules?.get(MODULE_ID)?.version ?? "";
export const RING_SRC = `modules/${MODULE_ID}/sounds/ring.ogg`;
export const SMS_SRC = `modules/${MODULE_ID}/sounds/sms.ogg`;
export const PICKUP_SRC = `modules/${MODULE_ID}/sounds/pickup.ogg`;
export const HANGUP_SRC = `modules/${MODULE_ID}/sounds/hangup.ogg`;
export const RINGBACK_SRC = `modules/${MODULE_ID}/sounds/ringback.ogg`;
// Searching for the satellite: short regular beeps (the pager beeps for now).
export const SAT_SEARCH_SRC = `modules/${MODULE_ID}/sounds/pager.ogg`;
// Icon of secure (encrypted) devices, lines and messages: a shield, never a padlock (locked device).
export const SECURE_ICON = "fa-shield-halved";
// Data exchange heard when a secure line is set up.
export const SECURE_SRC = `modules/${MODULE_ID}/sounds/secure.ogg`;
export const JAM_SRC = `modules/${MODULE_ID}/sounds/jammer.ogg`;
export const VIBRATE_SRC = `modules/${MODULE_ID}/sounds/vibrate.ogg`;
/** Stored value for a hidden number (internal data, shown translated). */
export const MASKED = "Numéro masqué"; // kept in French: stored in existing data
export const PAGER_MAX = 12; // characters on a pager's one-line screen
export const LOG_MAX = 200; // non-prepared entries kept per device (entries prepared by the GM are always kept)

export const { ApplicationV2, DialogV2, HandlebarsApplicationMixin } = foundry.applications.api;
export const AudioHelper = foundry.audio.AudioHelper;

const MODE_LABELS = labels("Mode", ["on", "silent", "off"]);
export const MODES = {
  on: { get label() { return MODE_LABELS.on; }, icon: "fa-bell" },
  silent: { get label() { return MODE_LABELS.silent; }, icon: "fa-bell-slash" },
  off: { get label() { return MODE_LABELS.off; }, icon: "fa-power-off" }
};

/** Outcomes seen by the GM (GM outgoing calls). */
export const RESULT_LABELS = labels("Result", ["answer", "decline", "missed", "cancelled", "off", "nobody", "nosignal"]);

/** Registered "device" sheet, set in flags.core.sheetClass of device items. */
export const SHEET_ID = `${MODULE_ID}.PhoneSheet`;

