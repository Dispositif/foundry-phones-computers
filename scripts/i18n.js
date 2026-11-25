import { universeKey } from "./universes.js";

/* -------------------------------------------- */
/*  Module texts (Foundry's language, English fallback) */
/* -------------------------------------------- */

/** "fr" or "en": the user's Foundry language (number and date formats, plurals). */
export function currentLang() {
  return (game.i18n?.lang ?? "en").startsWith("fr") ? "fr" : "en";
}

/** Translates a key (SPT. prefix optional), with {name} variables. */
export function t(key, data = {}) {
  const k = key.startsWith("SPT.") ? key : `SPT.${key}`;
  // The universe's vocabulary first ("Universe.<key>.<same key>"), then the usual text; the user's language, then English.
  const uk = `SPT.Universe.${universeKey()}.${k.slice(4)}`;
  const i18n = game.i18n;
  const found = [[uk, false], [k, false], [uk, true], [k, true]].find(([x, fb]) => i18n?.has?.(x, fb));
  const s = found ? i18n.localize(found[0]) : k;
  return String(s).replace(/\{(\w+)\}/g, (m, n) => (n in data ? String(data[n]) : m));
}

/** Plural: ".one" and ".other" keys; {n} = the count. */
export function tn(key, n, data = {}) {
  const one = currentLang() === "fr" ? n <= 1 : n === 1;
  return t(`${key}.${one ? "one" : "other"}`, { n, ...data });
}

/** Object whose properties are translated when read. */
export function labels(prefix, keys) {
  const o = {};
  for (const k of keys) Object.defineProperty(o, k, { get: () => t(`${prefix}.${k}`), enumerable: true });
  return o;
}
