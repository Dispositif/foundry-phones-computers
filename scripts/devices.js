import { feature } from "./features.js";
import { LOG_MAX, MASKED, MODULE_ID, SHEET_ID } from "./constants.js";
import { esc, maskedLabel, norm, randomNumber, isMasked } from "./util.js";
import { t } from "./i18n.js";
import { UNIVERSES, satellitePolicy, storedUniverseKey, universe } from "./universes.js";
import { deviceName, randomEmail } from "./names.js";
/* -------------------------------------------- */
/*  Model: phones, contacts, history            */
/* -------------------------------------------- */

// Device data -> its item, so signal checks can find who carries the device.
const PHONE_ITEM = new WeakMap();

export function getPhoneData(item) {
  const phone = item?.getFlag(MODULE_ID, "phone") ?? null;
  if (phone) PHONE_ITEM.set(phone, item);
  return phone;
}

/** Device models and what they can do. */
export const MODELS = {
  landline: { get label() { return t("Model.landline"); }, icon: "fa-phone", fixed: true, sms: false, callerId: false, attachments: false, ring: "ring-bell.ogg" },
  mobile: { get label() { return t("Model.mobile"); }, icon: "fa-mobile-retro", sms: true, callerId: true, attachments: false, ring: "ring-mobile.ogg", notif: "sms-mobile.ogg" },
  // 1980s brick phone: calls only, no caller ID.
  brick: { get label() { return t("Model.brick"); }, icon: "spt-ico-brick", skin: "mobile", noSilent: true, sms: false, callerId: false, attachments: false, ring: "ring-mobile.ogg" },
  // Satellite phone (Iridium, 2000s): calls and texts, always a satellite device.
  satphone: { get label() { return t("Model.satphone"); }, icon: "spt-ico-satphone", skin: "mobile", noSilent: true, sms: true, callerId: true, attachments: false, ring: "ring-mobile.ogg", notif: "sms-mobile.ogg", satellite: true, satAlways: true },
  pager: { get label() { return t("Model.pager"); }, icon: "fa-pager", sms: true, pager: true, noCalls: true, callerId: true, attachments: false, notif: "pager.ogg", satellite: true },
  smartphone: { get label() { return t("Model.smartphone"); }, icon: "fa-mobile-screen", sms: true, callerId: true, attachments: true, ring: "ring.ogg", satellite: true },
  computer: { get label() { return t("Model.computer"); }, icon: "fa-laptop", sms: true, mail: true, noCalls: true, callerId: true, attachments: true, notif: "mail.ogg", satellite: true },
  desktop: { get label() { return t("Model.desktop"); }, icon: "fa-desktop", fixed: true, sms: true, mail: true, noCalls: true, callerId: true, attachments: true, notif: "mail.ogg" },
  // No screen, no number: an on/off switch that cuts the network on the carrier's scene.
  jammer: { get label() { return t("Model.jammer"); }, icon: "fa-tower-broadcast", jammer: true, sms: false, noCalls: true, callerId: false, attachments: false }
};

/** Jammer: not a phone, never listed as a recipient or in the directory. */
export function isJammer(phone) {
  return !!modelOf(phone).jammer;
}

/** Is this jammer actually cutting the network (switched on, and not made to fail by the GM)? */
export function isJamming(phone) {
  return isJammer(phone) && !!phone.jamming && !phone.jamFailed && !!phone.jamScene;
}

/* Scenes cut by a jammer, cached until a device item changes. */
let jamCache = null;
for (const hook of ["createItem", "updateItem", "deleteItem", "deleteActor"]) Hooks.on(hook, () => (jamCache = null));

/** Scene id -> jammers cutting it ({ item, phone, actor }). */
export function jammedScenes() {
  if (jamCache) return jamCache;
  jamCache = new Map();
  for (const p of allJammers()) {
    if (!isJamming(p.phone)) continue;
    if (!jamCache.has(p.phone.jamScene)) jamCache.set(p.phone.jamScene, []);
    jamCache.get(p.phone.jamScene).push(p);
  }
  return jamCache;
}

/**
 * Satellite device (option ticked by the GM, advanced feature on). Switched off in the settings,
 * the device is an ordinary one again (the option is kept).
 */
export function isSatellite(phone) {
  const model = modelOf(phone);
  if (!model.satellite || !feature("satellite")) return false;
  // The satellite phone always is one; other models when the GM ticked the option.
  return !!model.satAlways || !!phone?.satellite;
}

/** Model name as the GM and players see it. */
export function modelLabel(phone) {
  return modelOf(phone).label;
}

/**
 * Does this device go through the satellite right now? Only when it has no mobile network
 * (dead zone, jammer, network cut): with the mobile network, it calls like any phone.
 */
export function viaSatellite(phone) {
  if (!isSatellite(phone) || phone.noSignal) return false;
  return !mobileSignal(phone);
}

/** Can this device send messages (texts or emails)? */
export function msgOn(phone) {
  const model = modelOf(phone);
  return !!(model.mail || model.sms);
}

/** Secure (encrypted) device: its calls and messages are encrypted when the other end is secure too. */
export function isSecure(phone) {
  // Secure devices switched off in the module settings: every device talks in clear.
  return !!phone?.secure && feature("secure");
}

/**
 * NPCs this secure device talks to on a secure line (normalized keys), set by the GM
 * ("Secure line" box when calling, texting or answering as the NPC).
 */
export function secureWith(phone, key) {
  return isSecure(phone) && (phone.secureWith ?? []).includes(norm(key));
}

/** GM: remembers whether this NPC talks to the device on a secure line. */
export async function setSecureWith(item, key, on) {
  const phone = getPhoneData(item);
  const k = norm(key);
  if (!phone || !isSecure(phone) || !k || secureWith(phone, key) === !!on) return;
  const list = (phone.secureWith ?? []).filter((x) => x !== k);
  if (on) list.push(k);
  await item.update({ [`flags.${MODULE_ID}.phone.secureWith`]: list });
}

/** Pager: receives one short line of text, nothing else. */
export function isPager(phone) {
  return !!modelOf(phone).pager;
}

export function isComputer(phone) {
  return !!modelOf(phone).mail;
}

/** Computer mailbox: "on" (available), "locked" (tab shown, content restricted) or "none" (files only). */
export function inboxOf(phone) {
  return isComputer(phone) ? phone?.inbox ?? "on" : "on";
}

/** Files of a laptop or terminal; players never see hidden ones. */
export function filesOf(phone, { gm = false } = {}) {
  const files = isComputer(phone) ? phone?.files ?? [] : [];
  return gm ? files : files.filter((f) => !f.hidden);
}

/** Unread count as the player sees it: nothing from a mailbox they cannot open. */
export function playerUnread(phone) {
  // A landline has no screen to read anything on: no badge.
  if (modelOf(phone).sms === false) return 0;
  return inboxOf(phone) === "on" ? unreadCount(phone) : 0;
}

/** Ring mode (on, silent, off). Computers have none: always on. */
export function modeOf(phone) {
  if (isComputer(phone)) return "on";
  // A brick has no silent mode: it rings.
  if (modelOf(phone).noSilent && phone?.mode === "silent") return "on";
  return phone?.mode ?? "on";
}

/**
 * Looks the GM can pick per device, and the models they fit.
 * Every created device stores a look: "default" = the model's look. An unknown look
 * (removed, renamed) or one that does not fit the model also falls back to the model's look.
 */
const SCREENS = ["mobile", "smartphone", "computer", "desktop"];
export const DEFAULT_THEME = "default";
// The model's own look, picked explicitly (in a universe, "default" means the universe's default look).
export const BASE_THEME = "standard";
export const THEMES = {
  modern: { models: ["landline"] },
  vintage: { models: ["landline"], skin: "landline" },
  federal: { models: ["computer", "desktop"] },
  console: { models: SCREENS },
  military: { models: SCREENS },
  // Cyberpunk / neon noir looks
  neon: { models: ["smartphone", "computer", "desktop", "pager", "jammer"] },
  glitch: { models: ["smartphone", "computer", "desktop"] }
};
export const SKINS = [...Object.keys(MODELS), ...Object.keys(THEMES)];

export function themeFits(theme, model) {
  return !!THEMES[theme]?.models.includes(model);
}

/**
 * Looks offered for a model: the universe's list (first = default), otherwise every look that fits.
 * A landline has no "default" choice there: modern or vintage (rotary dial, also the old "default").
 */
export function themeChoices(model) {
  const list = universe().themes[model];
  if (list) return list.filter((k) => k === BASE_THEME || themeFits(k, model));
  const fitting = Object.keys(THEMES).filter((k) => themeFits(k, model));
  return model === "landline" ? fitting : [DEFAULT_THEME, ...fitting];
}

/** Look a new device gets when none is chosen: the universe's default; a landline is modern unless "vintage" is picked. */
export function newTheme(model) {
  if (universe().themes[model]) return themeChoices(model)[0];
  return model === "landline" ? "modern" : DEFAULT_THEME;
}

/** Look to store: the choice if it fits the model, otherwise "default". */
export function cleanTheme(theme, model) {
  return themeFits(theme, model) || theme === BASE_THEME ? theme : DEFAULT_THEME;
}

/**
 * Look in effect: the stored one. The universe never changes an existing device's look
 * (new devices store the universe's default look when they are created).
 */
function effectiveTheme(theme, model) {
  // A landline's old "default" is the rotary dial: it stays one.
  if (model === "landline" && (!theme || theme === DEFAULT_THEME)) return "vintage";
  return theme || DEFAULT_THEME;
}

/** The look to select in a form for this device (its own look, even one the universe does not offer). */
export function shownTheme(theme, model) {
  const k = effectiveTheme(theme, model);
  if (k === DEFAULT_THEME && !themeChoices(model).includes(k)) return BASE_THEME;
  return k;
}

/** Look to display: the chosen one if it fits, otherwise the model's look (fallback). */
export function skinOf(phone) {
  const model = MODELS[phone?.model] ? phone.model : "smartphone";
  // "default" keeps the model's look (rotary dial for a landline), so existing devices do not change.
  const theme = effectiveTheme(phone?.theme, model);
  // A model may share another's screen look (the brick: the mobile's LCD).
  return themeFits(theme, model) ? THEMES[theme].skin ?? theme : MODELS[model].skin ?? model;
}

/**
 * Ringtone of a device: the one it got when created (the universe's own ringtone, Cyberpunk),
 * otherwise the modern landline has its own electronic ring, the rotary dial keeps the bell.
 */
export function ringOf(phone) {
  if (phone?.ring) return phone.ring;
  return skinOf(phone) === "modern" ? "ring-landline.ogg" : modelOf(phone).ring;
}

/**
 * Once per world (active GM): before looks stopped following the universe, a device's "default"
 * look and its ringtone came from the universe. Stores them on each device, so changing the
 * universe never changes existing devices. Uses the universe as stored (even the removed "all").
 */
export async function freezeLooks() {
  if (game.settings.get(MODULE_ID, "looksFrozen")) return;
  const u = UNIVERSES[storedUniverseKey()];
  for (const { item, phone } of allPhones({ jammers: true })) {
    const model = MODELS[phone.model] ? phone.model : "smartphone";
    const patch = {};
    const list = u?.themes?.[model]?.filter((k) => k === BASE_THEME || themeFits(k, model));
    if (list?.length) {
      let theme = phone.theme;
      if (model === "landline" && (!theme || theme === DEFAULT_THEME)) theme = "vintage";
      if (theme === DEFAULT_THEME || !theme || !list.includes(theme)) theme = list[0];
      if (theme !== phone.theme) patch.theme = theme;
    }
    if (u?.ring && !phone.ring && modelOf(phone).ring) patch.ring = u.ring;
    if (Object.keys(patch).length) await item.update(Object.fromEntries(Object.entries(patch).map(([k, v]) => [`flags.${MODULE_ID}.phone.${k}`, v])));
  }
  await game.settings.set(MODULE_ID, "looksFrozen", true);
}

/** Early test worlds: a brick ticked "satellite" becomes a satellite phone (its own model now). */
export async function migrateSatphones() {
  for (const { item, phone } of allPhones()) {
    if (phone.model !== "brick" || !phone.satellite) continue;
    const patch = { [`flags.${MODULE_ID}.phone.model`]: "satphone" };
    if (item.img?.startsWith(`modules/${MODULE_ID}/icons/`)) patch.img = modelImg("satphone");
    await item.update(patch);
  }
}

export function modelOf(phone) {
  return MODELS[phone?.model] ?? MODELS.smartphone;
}

export function isLandline(phone) {
  return phone?.model === "landline";
}

/** Device installed in a place (landline, terminal) rather than carried. */
export function isFixed(phone) {
  return !!modelOf(phone).fixed;
}

/**
 * Who holds the device: its carrier, or the agents on its scene if installed.
 * A world item (Items sidebar) is also held by the players the GM gave it to (Observer or more),
 * wherever they are: remote access to a shared terminal, a case file…
 */
export function holders(p, { activeOnly = false } = {}) {
  if (p.actor) return phoneUsers(p.actor, { activeOnly });
  const shared = sharedUsers(p.item).filter((u) => !activeOnly || u.active);
  if (!isFixed(p.phone)) return shared;
  const here = landlineUsers(p.phone);
  return [...here, ...shared.filter((u) => !here.includes(u))];
}

/** Players given a world device item (Observer or more). */
export function sharedUsers(item) {
  if (!item || item.parent) return [];
  return game.users.filter((u) => !u.isGM && item.testUserPermission(u, "OBSERVER"));
}

/** Holder name for GM messages (the place for an installed device). */
export function holderName(item, phone) {
  if (isFixed(phone)) return `📍 ${game.scenes.get(phone.sceneId)?.name ?? t("NoPlace")}`;
  if (item?.parent instanceof Actor) return item.parent.name;
  return sharedUsers(item).length ? t("Gm.Shared") : "?";
}

/** An installed device is held by the connected players viewing its scene (tokens are ignored: one may be left behind). */
export function landlineUsers(phone) {
  const scene = game.scenes.get(phone?.sceneId);
  if (!scene) return [];
  return game.users.filter((u) => !u.isGM && u.active && u.viewedScene === scene.id);
}

/**
 * Is the agent in a dead zone? A scene can be marked "no mobile network, no Wi-Fi" in its configuration.
 * What counts is the scene the agent's player is on (viewing), token or not.
 */
export function inDeadZone(actor) {
  if (!actor) return false;
  // A jammer switched on in the scene counts as a dead zone too (flag kept up to date by the GM: players may not see the jammer).
  return phoneUsers(actor).some((u) => {
    const scene = game.scenes.get(u.viewedScene);
    return !!scene?.getFlag(MODULE_ID, "deadZone") || !!scene?.getFlag(MODULE_ID, "jammed");
  });
}

/**
 * GM: scenes marked "dead zone" where connected players are, with their characters' names.
 * Jammed scenes are left out (they have their own chips).
 */
export function deadZoneScenes() {
  const out = new Map();
  for (const u of game.users) {
    if (u.isGM || !u.active) continue;
    const scene = game.scenes.get(u.viewedScene);
    if (!scene?.getFlag(MODULE_ID, "deadZone")) continue;
    if (!out.has(scene.id)) out.set(scene.id, { id: scene.id, name: scene.name, who: [] });
    out.get(scene.id).who.push(u.character?.name ?? u.name);
  }
  return [...out.values()];
}

/** Dead zone scene a connected player is on (or null). */
export function userDeadZone(user) {
  const scene = user?.active ? game.scenes.get(user.viewedScene) : null;
  return scene?.getFlag(MODULE_ID, "deadZone") ? scene : null;
}

/** Mobile network only: network cut, no signal for this device, or its holder in a dead zone (or jammed). */
export function mobileSignal(phone) {
  // An installed device does not depend on the mobile network: it always has a line.
  if (isFixed(phone)) return true;
  if (game.settings.get(MODULE_ID, "networkDown") || phone?.noSignal) return false;
  const holder = PHONE_ITEM.get(phone)?.parent;
  return !(holder instanceof Actor && inDeadZone(holder));
}

/**
 * Does the device have signal? The mobile network, or the satellite: a satellite device ignores
 * dead zones, jammers and network cuts (the GM decides each connection). "No signal" set by the GM still cuts it.
 */
export function hasSignal(phone) {
  if (mobileSignal(phone)) return true;
  return isSatellite(phone) && !phone?.noSignal;
}

/**
 * All devices: items carried by actors + world items (held by nobody).
 * Jammers are left out unless asked for: they are not phones (no number, no messages).
 */
/* -------------------------------------------- */
/*  Team: player characters know each other     */
/* -------------------------------------------- */

let teamCache = null;
for (const hook of ["createItem", "updateItem", "deleteItem", "updateActor", "updateUser", "updateSetting"]) Hooks.on(hook, () => (teamCache = null));

/** Devices carried by player characters, when the "team" setting is on (cached until something changes). */
function teamDevices() {
  if (teamCache) return teamCache;
  let on = false;
  try {
    on = game.settings.get(MODULE_ID, "team");
  } catch {}
  teamCache = on ? allPhones().filter((p) => p.actor?.hasPlayerOwner && !isFixed(p.phone) && p.phone.number) : [];
  return teamCache;
}

/**
 * The other player characters' devices, as contacts of a device carried by a player character.
 * Same channel only: phones see phone numbers, computers see email addresses. Computed, never stored.
 */
export function teamContacts(phone) {
  const team = teamDevices();
  const self = phone?.number ? team.find((p) => norm(p.phone.number) === norm(phone.number)) : null;
  if (!self) return [];
  const mail = !!MODELS[phone.model]?.mail;
  return team
    .filter((p) => p.actor !== self.actor && !!MODELS[p.phone.model]?.mail === mail)
    // "Cole smartphone": a character may carry several devices.
    .map((p) => ({ name: `${p.actor.name} ${(MODELS[p.phone.model]?.label ?? p.phone.label).toLocaleLowerCase()}`, number: p.phone.number, team: true }));
}

/** A device's own contacts, then its team contacts (those it does not already have). */
export function contactsOf(phone) {
  const own = phone?.contacts ?? [];
  const known = new Set(own.map((c) => norm(c.number)).filter(Boolean));
  return [...own, ...teamContacts(phone).filter((c) => !known.has(norm(c.number)))];
}

export function allPhones({ jammers = false } = {}) {
  const out = [];
  const push = (item) => {
    const phone = getPhoneData(item);
    if (phone && (jammers || !isJammer(phone))) out.push({ item, phone, actor: item.parent instanceof Actor ? item.parent : null });
  };
  for (const actor of game.actors) for (const item of actor.items) push(item);
  for (const item of game.items) push(item);
  return out;
}

export function allJammers() {
  return allPhones({ jammers: true }).filter((p) => isJammer(p.phone));
}

export function phonesByNumber(number) {
  const n = norm(number);
  if (!n) return [];
  return allPhones().filter((p) => norm(p.phone.number) === n);
}

/** Players who "hold" the device carried by this actor. */
export function phoneUsers(actor, { activeOnly = false } = {}) {
  if (!actor) return [];
  const players = game.users.filter((u) => !u.isGM);
  const assigned = players.filter((u) => u.character?.id === actor.id);
  const owners = players.filter((u) => actor.testUserPermission(u, "OWNER"));
  if (!activeOnly) return assigned.length ? assigned : owners;
  const assignedOn = assigned.filter((u) => u.active);
  return assignedOn.length ? assignedOn : owners.filter((u) => u.active);
}

export function phoneLabel({ item, actor, phone }) {
  if (isFixed(phone)) return `📍 ${game.scenes.get(phone.sceneId)?.name ?? t("NoPlace")} — ${phone.label} (${phone.number})`;
  const who = actor?.name ?? (sharedUsers(item).length ? t("Gm.Shared") : t("NoHolder"));
  return `${who} — ${phone.label} (${phone.number})`;
}

export function findContact(phone, str) {
  const s = norm(str);
  if (!s) return null;
  return contactsOf(phone).find((c) => norm(c.name) === s || (c.number && norm(c.number) === s)) ?? null;
}

/** Directory text, as edited by the GM (a New Orleans sample by default). */
export function directoryText() {
  return game.settings.get(MODULE_ID, "directory") ?? "";
}

/*
 * NPC directory (GM): one line per NPC, "Name | number | flags"; "#" lines are section titles.
 * Flags, in any order: "public" (anyone can look it up), "pin" (pinned NPC, GM side), "off" (unassigned number).
 * The name may be empty for a number not named yet ("| 555-1010 | off").
 */
let dirCache = { text: null, list: [] };

/** One directory line read as an entry (null for a blank line or a section title). */
function parseDirLine(l, line) {
  l = l.trim();
  if (!l || l.startsWith("#")) return null;
  const [name, number = "", ...rest] = l.split("|").map((s) => s.trim());
  const flags = rest.map((s) => s.toLowerCase());
  if (!name && !number) return null;
  return { name, number, pub: flags.includes("public"), pin: flags.includes("pin"), off: flags.includes("off"), line };
}

export function npcDirectory() {
  const text = directoryText();
  if (dirCache.text === text) return dirCache.list;
  const list = text.split("\n").map(parseDirLine).filter(Boolean);
  dirCache = { text, list };
  return list;
}

/** Directory lines in order, section titles included (GM directory tab). */
export function directoryRows() {
  return directoryText().split("\n").map((l, line) => {
    const tl = l.trim();
    if (tl.startsWith("#")) return { title: tl.replace(/^#+\s*/, ""), line };
    return parseDirLine(l, line);
  }).filter(Boolean);
}

/** Name of a directory entry for the GM: its name, otherwise its number. */
export function npcLabel(e) {
  return e?.name || e?.number || "";
}

/** Identity of a directory entry, used to match conversations (its number, otherwise its name). */
export function npcId(e) {
  return norm(e?.number || e?.name);
}

function dirLine({ name = "", number = "", pub = false, pin = false, off = false }) {
  const flags = [pub && "public", pin && "pin", off && "off"].filter(Boolean);
  return [name.trim(), number.trim(), ...flags].join(" | ").replace(/\s+$/, "");
}

/**
 * GM: adds or changes a directory entry. line: the line to replace (undefined: added at the end).
 * Returns false (with a warning) when the number is already used elsewhere.
 */
export async function saveNpc(entry, line) {
  if (!game.user.isGM) return false;
  // "|" separates the fields of a directory line.
  const name = String(entry.name ?? "").replaceAll("|", "/").trim();
  const number = String(entry.number ?? "").replaceAll("|", "/").trim();
  if (!name && !number) return false;
  if (number) {
    const twin = npcDirectory().find((e) => e.line !== line && e.number && norm(e.number) === norm(number));
    if (twin) return ui.notifications.warn(t("Directory.Taken", { number, name: npcLabel(twin) })), false;
    if (phonesByNumber(number).length) return ui.notifications.warn(t("Directory.IsDevice", { number })), false;
  }
  const lines = directoryText().split("\n");
  const text = dirLine({ ...entry, name, number });
  if (line === undefined || line === null || line >= lines.length) {
    while (lines.length && !lines.at(-1).trim()) lines.pop();
    lines.push(text);
  } else lines[line] = text;
  await game.settings.set(MODULE_ID, "directory", lines.join("\n"));
  return true;
}

/** GM: changes some fields of an existing entry (flags, name…). */
export function patchNpc(line, patch) {
  const cur = npcDirectory().find((e) => e.line === line);
  if (!cur) return false;
  return saveNpc({ ...cur, ...patch }, line);
}

/** GM: removes a directory line. */
export async function deleteNpc(line) {
  const lines = directoryText().split("\n");
  if (line < 0 || line >= lines.length) return;
  lines.splice(line, 1);
  await game.settings.set(MODULE_ID, "directory", lines.join("\n"));
}

/** Free number for a new NPC (same generator as devices: world prefix, no collision). */
export function freeNpcNumber() {
  return randomAddress("mobile");
}

/**
 * GM: names a number nobody knew (or marks it unassigned). A typed name the agent used
 * instead of a number becomes the entry's name.
 */
export function nameUnknown(key, name = "", { off = false } = {}) {
  const k = String(key ?? "").trim();
  name = String(name ?? "").trim();
  if (!k || (!name && !off)) return false;
  return /\d|@/.test(k) ? saveNpc({ name, number: k, off }) : saveNpc({ name: name || k, off });
}

/** Number marked "off" in the directory: unassigned, nobody answers. */
export function isOffNumber(phone, key) {
  return !!findNpc(keyFor(phone, key), { all: true })?.off;
}

/** Directory entry for a name or a number (public ones only, unless all = true). */
export function findNpc(str, { all = false } = {}) {
  const s = norm(str);
  if (!s) return null;
  return npcDirectory().find((e) => (all || e.pub) && (norm(e.name) === s || (e.number && norm(e.number) === s))) ?? null;
}

/** Name a public device is found under: the agent carrying it, otherwise its own label (a place's landline). */
export function publicName(p) {
  return (p.actor && !isFixed(p.phone) ? p.actor.name : p.phone.label) || "";
}

/** Devices the GM made public (flag "pub"): anyone can look them up by name, like a public NPC. */
export function publicDevices() {
  return allPhones().filter((p) => p.phone.pub && p.phone.number).map((p) => ({ name: publicName(p), number: p.phone.number }));
}

function findPublicDevice(str, { byNumber = false } = {}) {
  const s = norm(str);
  if (!s) return null;
  return publicDevices().find((d) => (d.name && norm(d.name) === s) || (byNumber && norm(d.number) === s)) ?? null;
}

/**
 * GM side: an NPC directory name (public or not) becomes its number, so the device files it
 * under the agent's own contact for that number. Anything else is returned as is.
 */
export function npcNumber(str) {
  const npc = findNpc(str, { all: true });
  return npc?.number && norm(npc.name) === norm(str) ? npc.number : str;
}

/**
 * GM speaking as an NPC (calls, messages): the sender as a number whenever it can be found
 * (a directory name, or a name saved in the recipient's contacts), otherwise as typed.
 * Every way of calling or writing as an NPC goes through it, so they all behave the same.
 */
export function senderKey(sender, recipientPhone = null) {
  if (!sender || isMasked(sender)) return sender;
  const n = npcNumber(sender);
  return recipientPhone ? keyFor(recipientPhone, n) : n;
}

/** Conversation key: the contact's number if any, otherwise its name, otherwise the raw input. Public directory names give their number. */
export function keyFor(phone, str) {
  const c = findContact(phone, str) ?? findNpc(str) ?? findPublicDevice(str);
  if (c) return c.number || numberInText(c.name) || c.name;
  const raw = String(str ?? "").trim();
  return numberInText(raw) || raw;
}

/**
 * A device number typed with other words ("Paul - 555-1234", or a contact saved that way).
 * Only when the input itself is no device address, never inside an email, only a group of
 * 4 digits or more, and only if it points to a single number. Names are never resolved.
 */
export function numberInText(str) {
  const s = String(str ?? "");
  if (s.includes("@") || !/\p{L}/u.test(s) || s.replace(/\D/g, "").length < 4 || phonesByNumber(s).length) return null;
  const found = new Set();
  for (const [group] of s.matchAll(/\d+(?:[\s\-.\/\u2010-\u2015\u2212]?\d+)*/g)) {
    if (group.replace(/\D/g, "").length < 4) continue;
    for (const p of phonesByNumber(group)) found.add(p.phone.number);
  }
  return found.size === 1 ? [...found][0] : null;
}

/**
 * Agent side: a text that leads nowhere (a name with no contact, no directory entry, no device,
 * no conversation on this device). Numbers and emails are always allowed: any number reaches the GM.
 */
export function isUnknownName(phone, str) {
  const raw = String(str ?? "").trim();
  if (!raw || raw.includes("@") || !/\p{L}/u.test(raw) || isMasked(raw)) return false;
  const key = keyFor(phone, raw);
  if (findContact(phone, raw) || findNpc(key, { all: true }) || phonesByNumber(key).length) return false;
  return !getLog(phone, { includePending: true }).some((e) => sameConv(phone, e.with, key));
}

/** Display name for a key, as seen from this device (its contacts, then the public directory). */
export function displayName(phone, key) {
  return findContact(phone, key)?.name || findNpc(key)?.name || findPublicDevice(key, { byNumber: true })?.name || maskedLabel(key);
}

/** Name for the GM: the whole NPC directory first, otherwise as seen from the device. */
export function gmName(phone, key) {
  // The NPC directory wins over the name the agent gave the contact: the GM sees who really answers.
  const npc = findNpc(key, { all: true });
  if (npc) return npc.name && npc.number ? `${npc.name} (${npc.number})` : npcLabel(npc);
  // A device an NPC carries: the GM sees whose it is.
  const carrier = npcCarrier(key);
  if (carrier) return `${carrier.name} (${key})`;
  return displayName(phone, key);
}

/** The NPC actor carrying the device with this number (a carried device no player holds), or null. */
export function npcCarrier(number) {
  return npcDevices(number).find((p) => p.actor)?.actor ?? null;
}

/**
 * A carried device no player holds: an NPC's, or a world item given to nobody. The GM speaks for it
 * (calls and messages reach the GM), and what it receives is already read.
 */
export function isNpcHeld(p) {
  return !isFixed(p.phone) && !holders(p).length;
}

/**
 * Portrait of the NPC behind this number, as an agent's device may show it: an NPC actor's own device,
 * otherwise the actor named like the directory line; only if the agent knows the number (in their contacts)
 * or it is public (device or directory line).
 */
export function knownNpcFace(agentPhone, number) {
  if (!number || isMasked(number)) return null;
  const dev = npcDevices(number).find((p) => p.actor);
  // Known: in the agent's contacts, a public device, or a public directory line with this number.
  if (dev) return findContact(agentPhone, number) || dev.phone.pub || findNpc(number) ? dev.actor.img : null;
  // A directory line named like an NPC actor: that actor's portrait, same rule (contact or public line).
  const actor = directoryActor(number);
  return actor && (findContact(agentPhone, number) || findNpc(number)) ? actor.img : null;
}

/**
 * The NPC actor named like this number's directory line (case and extra spaces ignored), when exactly one
 * actor no player owns has that name. Its portrait stands for the line; nothing is stored.
 */
export function directoryActor(number) {
  if (!number || isMasked(number)) return null;
  const name = findNpc(number, { all: true })?.name;
  if (!name) return null;
  const key = (x) => norm(x).replace(/\s+/g, " ");
  const k = key(name);
  const found = game.actors.filter((a) => !a.hasPlayerOwner && key(a.name) === k);
  return found.length === 1 ? found[0] : null;
}

/**
 * The NPC behind a public number, as the whole table may see it: { name, img } for a public NPC
 * device or a public directory line (portrait: the NPC actor carrying it, or named like the line). null otherwise.
 */
export function publicNpc(number) {
  if (!number || isMasked(number)) return null;
  const dev = npcDevices(number).find((p) => p.actor);
  const line = findNpc(number);
  if (dev && (dev.phone.pub || line)) return { name: line?.name || dev.actor.name, img: dev.actor.img };
  return line?.name ? { name: line.name, img: directoryActor(number)?.img ?? null } : null;
}

/** Devices with this number that the GM speaks for (see isNpcHeld). */
export function npcDevices(number) {
  return phonesByNumber(number).filter(isNpcHeld);
}

/** Number known nowhere (no contact, no directory entry, no device): probably a wrong number. */
export function isUnknownNumber(phone, key) {
  if (!key || isMasked(key) || findContact(phone, key) || findNpc(key, { all: true })) return false;
  return !phonesByNumber(key).length;
}

/** Do two keys point to the same conversation, as seen from this device? */
export function sameConv(phone, a, b) {
  return norm(keyFor(phone, a)) === norm(keyFor(phone, b));
}

/** Compatibility with v0.2 entries. */
export function normalizeEntry(e) {
  return { ...e, dir: e.dir ?? "in", with: e.with ?? e.from ?? MASKED };
}

export function getLog(phone, { includePending = false } = {}) {
  return (phone?.log ?? []).map(normalizeEntry).filter((e) => includePending || !e.pending);
}

/**
 * Write queue per device: each history change waits for the previous one
 * and re-reads the current state, so two simultaneous messages do not overwrite each other.
 */
export const writeQueues = new Map();
export function withItemLock(item, fn) {
  const key = item.uuid;
  const run = (writeQueues.get(key) ?? Promise.resolve()).then(fn, fn);
  const tail = run.catch((err) => console.error(`${MODULE_ID} |`, err));
  writeQueues.set(key, tail);
  tail.then(() => writeQueues.get(key) === tail && writeQueues.delete(key));
  return run;
}

/** Keeps all prepared entries, and the LOG_MAX most recent of the others. */
export function trimLog(log) {
  let n = 0;
  return log.filter((e) => e.prep || ++n <= LOG_MAX);
}

/** Changes the history: fn gets an up-to-date copy and returns the new history (or null if nothing changes). */
export function mutateLog(item, fn) {
  if (!item) return Promise.resolve();
  return withItemLock(item, async () => {
    const phone = getPhoneData(item);
    if (!phone) return;
    const next = fn([...(phone.log ?? [])], phone);
    if (next) await item.update({ [`flags.${MODULE_ID}.phone.log`]: trimLog(next) });
  });
}

export function addLog(item, entry) {
  return mutateLog(item, (log) => [{ id: foundry.utils.randomID(), t: Date.now(), ...entry }, ...log]);
}

/** Received message not yet read by the player, or missed call not yet seen (floating button badge). */
export function isUnread(e) {
  return e.dir === "in" && e.read === false && (e.kind === "sms" || (e.kind === "call" && e.result === "missed"));
}

export function unreadCount(phone) {
  return getLog(phone).filter(isUnread).length;
}

/** Marks one received message as read (pager: one message at a time). */
export function markEntryRead(item, id) {
  return patchLog(item, (e) => isUnread(e) && e.id === id, { read: true });
}

export function markRead(item, key) {
  const phone = getPhoneData(item);
  return patchLog(item, (e) => isUnread(e) && sameConv(phone, e.with, key), { read: true });
}

export function patchLog(item, predicate, patch) {
  return mutateLog(item, (log) => {
    let changed = false;
    const next = log.map((e) => {
      if (!predicate(normalizeEntry(e))) return e;
      changed = true;
      return { ...e, ...patch };
    });
    return changed ? next : null;
  });
}

/** A device's conversations, sorted by activity (+ contacts without messages). */
export function conversations(phone) {
  const map = new Map();
  for (const e of getLog(phone)) {
    const key = keyFor(phone, e.with);
    const k = norm(key);
    if (!map.has(k)) map.set(k, { key, entries: [], unread: 0 });
    const conv = map.get(k);
    conv.entries.push(e);
    if (isUnread(e)) conv.unread++;
  }
  for (const c of contactsOf(phone)) {
    const key = c.number || c.name;
    if (!map.has(norm(key))) map.set(norm(key), { key, entries: [], unread: 0 });
  }
  return [...map.values()].sort((a, b) => (b.entries[0]?.t ?? 0) - (a.entries[0]?.t ?? 0));
}

/** Item icon for each model (shipped with the module, always available). */
/**
 * Icon class of a device (shown as `fas <class>`): Font Awesome, or the brick / satellite phone
 * drawings (CSS mask, styles/phone.css) since Font Awesome has none.
 */
export function iconOf(phone) {
  return modelOf(phone).icon;
}

export const modelImg = (model) => `modules/${MODULE_ID}/icons/${MODELS[model] ? model : "smartphone"}.svg`;

/** Is the item image a default one (Foundry's or ours) that can be replaced? */
export function isDefaultImg(img, type) {
  if (!img || img === "icons/svg/item-bag.svg" || img === Item.DEFAULT_ICON || img.startsWith(`modules/${MODULE_ID}/icons/`)) return true;
  return !!type && img === Item.getDefaultArtwork?.({ type })?.img;
}

/** Item description field for this system (string or { value }), or null. */
function descriptionPath(item) {
  const d = item.system?.description;
  if (typeof d === "string") return "system.description";
  if (typeof d?.value === "string") return "system.description.value";
  return null;
}

/** Short device description: "Smartphone · 555-0142". */
export function deviceDescription(phone) {
  if (isJammer(phone)) return `<p>${esc(modelLabel(phone))}</p>`;
  return `<p>${esc(modelLabel(phone))} · ${esc(phone.number ?? "")}</p>`;
}

/**
 * Fields to set on a device item, without overwriting a GM choice: "device" sheet,
 * model icon, and description (only if empty or written by the module).
 */
export function deviceItemPatch(item, phone) {
  const patch = {};
  const model = phone.model ?? "smartphone";
  if (item.getFlag("core", "sheetClass") === undefined) patch["flags.core.sheetClass"] = SHEET_ID;
  const img = modelImg(model);
  if (isDefaultImg(item.img, item.type) && item.img !== img) patch.img = img;
  const path = descriptionPath(item);
  if (path) {
    const current = foundry.utils.getProperty(item, path) ?? "";
    const auto = deviceDescription(phone);
    const ours = item.getFlag(MODULE_ID, "desc");
    if ((!current.trim() || current === ours) && current !== auto) {
      patch[path] = auto;
      patch[`flags.${MODULE_ID}.desc`] = auto;
    }
  }
  return patch;
}

/** Random number or email (laptop or terminal, made from the holder's name if given) for a new device, never one already used by a device or the directory. */
export function randomAddress(model, { name } = {}) {
  // A jammer has no number: a hidden id keeps it unique (an item dragged to another character moves).
  if (MODELS[model]?.jammer) return `jam-${foundry.utils.randomID(8)}`;
  const used = usedAddresses();
  const mail = MODELS[model]?.mail;
  let address;
  for (let i = 0; i < 50; i++) {
    address = mail ? randomEmail(name) : randomNumber();
    if (!used.has(norm(address))) return address;
  }
  // Unlucky draws (a crowded world): take the first free number in order.
  if (!mail) {
    const prefix = randomNumber().slice(0, -4); // randomNumber() ends with 0 + 3 digits
    for (let n = 0; n < 1000; n++) {
      if (n >= 200 && n < 300) continue; // 555-02xx is reserved
      const candidate = `${prefix}0${String(n).padStart(3, "0")}`;
      if (!used.has(norm(candidate))) return candidate;
    }
  }
  return address;
}

/**
 * Every address already in use or seen in the world: devices (jammers aside), directory lines
 * (out of service included), numbers in device histories and contacts (invented numbers
 * the players dialed). A new address never lands on one of them.
 */
function usedAddresses() {
  const used = new Set();
  const add = (a) => {
    const k = norm(a);
    if (k) used.add(k);
  };
  for (const p of allPhones()) {
    add(p.phone.number);
    for (const c of p.phone.contacts ?? []) add(c.number);
    for (const e of p.phone.log ?? []) add(e.with);
  }
  for (const e of npcDirectory()) add(e.number);
  return used;
}

export function pickItemType() {
  const types = (game.documentTypes?.Item ?? Object.keys(CONFIG.Item.typeLabels ?? {})).filter((t) => t !== "base");
  return types.find((t) => /equip|gear|item|stuff|objet|possession|inventory/i.test(t)) ?? types[0];
}

/**
 * Satellite option of a new device: forced by the universe, or the GM's choice where it is an option.
 * undefined (no choice made): forced only.
 */
export function newSatellite(model, choice) {
  const policy = satellitePolicy(model);
  return policy === "forced" || (policy === "option" && !!choice);
}

export async function createPhone(actor, { label, number, model = "smartphone", sceneId = null, theme = null, secure = false, satellite, pub = false }) {
  satellite = newSatellite(model, satellite);
  label ||= deviceName(model, { satellite }) ?? MODELS[model]?.label ?? MODELS.smartphone.label;
  number ||= randomAddress(model, { name: actor?.name });
  const options = actor ? { parent: actor, spt: true } : { spt: true };
  const item = await Item.create(
    {
      name: label,
      type: pickItemType(),
      img: modelImg(model),
      flags: {
        core: { sheetClass: SHEET_ID },
        [MODULE_ID]: { phone: { label, number, model, sceneId, theme: cleanTheme(!theme || theme === DEFAULT_THEME ? newTheme(model) : theme, model), mode: "on", contacts: [], log: [], ...(secure ? { secure: true } : {}), ...(satellite ? { satellite: true } : {}), ...(pub ? { pub: true } : {}), ...newRing(model) } }
      }
    },
    options
  );
  const patch = item ? deviceItemPatch(item, getPhoneData(item)) : {};
  if (Object.keys(patch).length) await item.update(patch);
  return item;
}

/** Ringtone stored on a new device: the universe's own, if it has one (Cyberpunk). */
function newRing(model) {
  const ring = universe().ring;
  return ring && MODELS[model]?.ring ? { ring } : {};
}

export async function markPhone(item, { label, number, model, sceneId, theme, inbox, pub, secure, satellite }) {
  const prev = getPhoneData(item) ?? { mode: "on", contacts: [], log: [] };
  const next = { ...prev, label, number };
  if (model) next.model = model;
  if (sceneId !== undefined) next.sceneId = sceneId;
  if (inbox !== undefined) next.inbox = inbox;
  if (pub !== undefined) next.pub = !!pub;
  if (secure !== undefined) next.secure = !!secure;
  if (satellite !== undefined) next.satellite = !!satellite && !!MODELS[next.model ?? "smartphone"]?.satellite;
  if (theme !== undefined || !next.theme) next.theme = cleanTheme(theme ?? next.theme, next.model ?? "smartphone");
  const patch = deviceItemPatch(item, next);
  // Device and item share one name.
  if (label && item.name !== label) patch.name = label;
  // Changing the model changes the item image too.
  if (prev.model && next.model !== prev.model) patch.img = modelImg(next.model);
  return item.update({ [`flags.${MODULE_ID}.phone`]: next, ...patch });
}

export async function unmarkPhone(item) {
  // The item becomes an ordinary item again, with the system sheet.
  const patch = item.getFlag("core", "sheetClass") === SHEET_ID ? { "flags.core.-=sheetClass": null } : {};
  if (item.img?.startsWith(`modules/${MODULE_ID}/icons/`)) patch.img = Item.DEFAULT_ICON;
  return item.update({ [`flags.${MODULE_ID}.-=phone`]: null, ...patch });
}


/** The phone the player's character carries (smartphone first, then mobile), or null. */
export function carriedPhone(user) {
  const actor = user?.character ?? null;
  if (!actor) return null;
  const order = ["smartphone", "mobile", "satphone", "brick"];
  return allPhones()
    .filter((p) => p.actor === actor && order.includes(p.phone.model))
    .sort((a, b) => order.indexOf(a.phone.model) - order.indexOf(b.phone.model))[0] ?? null;
}

/**
 * GM: the device a message or call "to a player" lands on. The player's character carried phone
 * (smartphone first, then mobile); if it has none, one of the universe's default model is created.
 * null when the player has no assigned character to carry it.
 */
export async function defaultDeviceFor(user) {
  const actor = user?.character ?? null;
  if (!actor) return null;
  const carried = carriedPhone(user);
  if (carried) return carried;
  const model = universe().defaultModel;
  const label = deviceName(model) ?? MODELS[model]?.label ?? MODELS.smartphone.label;
  const item = await createPhone(actor, { label, number: randomAddress(model, { name: actor.name }), model });
  if (!item) return null;
  ui.notifications.info(`📱 ${t("Info.DefaultCreated", { label, name: actor.name })}`);
  return { item, phone: getPhoneData(item), actor };
}
