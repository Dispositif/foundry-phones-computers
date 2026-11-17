import { MODULE_ID } from "./constants.js";

/**
 * Advanced features a GM can switch off to keep the module simple while discovering it.
 * Hidden features keep their data: switched back on, everything comes back.
 */
export const FEATURES = ["intel", "secure", "jammer", "satellite"];
// Tracking is part of the Intel tab. Compromised devices are always available (not a feature).
const ALIASES = { tracking: "intel" };
// Features added after the setting existed: off until the GM switches them on, in every world.
const OFF_UNTIL_SET = ["satellite"];

const settingKey = (key) => `feature-${key}`;

/**
 * One world setting per feature, shown in Foundry's settings too (the GM panel writes the same settings).
 * onChange is passed in: importing util.js here would create an import cycle that breaks the load order.
 */
export function registerFeatureSettings(onChange) {
  for (const key of FEATURES) {
    game.settings.register(MODULE_ID, settingKey(key), {
      name: `SPT.Features.${key}Setting`,
      hint: `SPT.Features.${key}Hint`,
      scope: "world",
      config: true,
      type: Boolean,
      default: !OFF_UNTIL_SET.includes(key),
      onChange
    });
  }
}

/** Value from the old storage (one object), for worlds not migrated yet. */
function legacyFeature(stored, key) {
  // Worlds saved while tracking and the jammer were one switch ("trackJam").
  if (key === "jammer" && stored.jammer === undefined && stored.trackJam !== undefined) return !!stored.trackJam;
  return stored[key] ?? !OFF_UNTIL_SET.includes(key);
}

/** Is this advanced feature on? */
export function feature(key) {
  key = ALIASES[key] ?? key;
  const fallback = !OFF_UNTIL_SET.includes(key);
  try {
    if (!game.settings.get(MODULE_ID, "featuresMigrated")) {
      const stored = game.settings.get(MODULE_ID, "features");
      if (stored) return legacyFeature(stored, key);
    }
    return game.settings.get(MODULE_ID, settingKey(key));
  } catch {
    return fallback;
  }
}

/**
 * First start of the module in a world (active GM). A world with the old storage keeps its choices.
 * Otherwise a new world starts with the advanced features off, a world that already has devices
 * keeps them all on (except the newer ones).
 */
export async function initFeatures(hasDevices) {
  if (!game.user.isGM || game.users.activeGM !== game.user) return;
  if (game.settings.get(MODULE_ID, "featuresMigrated")) return;
  const stored = game.settings.get(MODULE_ID, "features");
  for (const key of FEATURES) {
    const on = stored ? legacyFeature(stored, key) : hasDevices && !OFF_UNTIL_SET.includes(key);
    await game.settings.set(MODULE_ID, settingKey(key), on);
  }
  await game.settings.set(MODULE_ID, "featuresMigrated", true);
}

export async function setFeature(key, on) {
  await game.settings.set(MODULE_ID, settingKey(key), !!on);
}
