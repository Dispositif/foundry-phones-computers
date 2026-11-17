import { MODULE_ID } from "./constants.js";

/**
 * Advanced features a GM can switch off to keep the module simple while discovering it.
 * Hidden features keep their data: switched back on, everything comes back.
 */
export const FEATURES = ["secure", "compromised", "jammer", "tracking", "satellite"];
// Features added after the setting existed: off until the GM switches them on, in every world.
const OFF_UNTIL_SET = ["satellite"];

/** Is this advanced feature on? Before the world setting exists (older worlds): on, except the newer ones. */
export function feature(key) {
  try {
    return game.settings.get(MODULE_ID, "features")?.[key] ?? !OFF_UNTIL_SET.includes(key);
  } catch {
    return !OFF_UNTIL_SET.includes(key);
  }
}

/**
 * First start of the module in a world (active GM): a new world starts with the advanced
 * features off, a world that already has devices keeps them all on (except the newer ones).
 */
export async function initFeatures(hasDevices) {
  if (!game.user.isGM || game.users.activeGM !== game.user) return;
  if (game.settings.get(MODULE_ID, "features")) return;
  await game.settings.set(MODULE_ID, "features", Object.fromEntries(FEATURES.map((k) => [k, hasDevices && !OFF_UNTIL_SET.includes(k)])));
}

export async function setFeature(key, on) {
  const cur = { ...Object.fromEntries(FEATURES.map((k) => [k, feature(k)])), [key]: !!on };
  await game.settings.set(MODULE_ID, "features", cur);
}
