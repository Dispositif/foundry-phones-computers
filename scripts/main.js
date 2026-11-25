/**
 * Phones & Computers (soren-phones-computers)
 * Storytelling tool: the GM is the network.
 * - Devices = items flagged by the module (number, name, mode, contacts, history).
 * - The GM calls / texts a device; players reply, write and call.
 * - Conversations per correspondent; the address book builds up in play (+ contacts given by the GM).
 * - Messages to another PC: delivered directly (copy to GM). To an NPC: land with the GM.
 * Target: Foundry VTT v14 (ApplicationV2 / DialogV2 only).
 */

import { LEGACY_IDS, MODULE_ID, SHEET_ID, SOCKET } from "./constants.js";
import { DIRECTORY_SAMPLE } from "./directory-sample.js";
import { ensureDeviceItems, openSystemSheet, registerPhoneSheet } from "./item-sheet.js";
import { allPhones, createPhone, freeNpcNumber, freezeLooks, migrateSatphones, getPhoneData, isFixed, isJammer, isPager, markPhone, npcDirectory, randomAddress, saveNpc, sharedUsers } from "./devices.js";
import { openPager } from "./pager.js";
import { myJammers, openJammer, registerJammerHooks } from "./jammer.js";
import { editPhoneDialog, giveDialog, newPhoneDialog, transferPhone } from "./dialogs.js";
import { myPhones, updateFab } from "./fab.js";
import { PhonePanel } from "./gm-panel.js";
import { registerEnrichers, runJournalLink } from "./journal-links.js";
import { flushAll, flushPending, sendSms } from "./messages.js";
import { restoreLive } from "./live-call.js";
import { DEFAULT_UNIVERSE, UNIVERSES, applyGmLook, storedUniverseKey, universeKey } from "./universes.js";
import { PlayerPhone, cycleDevices } from "./player-phone.js";
import { registerTour } from "./tour.js";
import { maybeWelcome, openWelcome, welcomeOwnedDevices } from "./welcome.js";
import { maybeNews, openNews } from "./news.js";
import { hangUp, ring } from "./ring.js";
import { onSocket } from "./socket.js";
import { esc, isActiveGM, norm, rerenderAll } from "./util.js";
import { initFeatures, registerFeatureSettings } from "./features.js";
import { resetOpenSky } from "./satellite.js";
import { loadLanguages, t, tn } from "./i18n.js";

// Both languages are loaded at startup ("Module language" setting).
loadLanguages();


/* -------------------------------------------- */
/*  Opening                                     */
/* -------------------------------------------- */

export function openPanel({ tab = null, settings = false } = {}) {
  if (!game.user.isGM) return ui.notifications.warn(t("Warn.GmOnlyPanel"));
  const panel = PhonePanel.instance ?? new PhonePanel();
  if (tab) panel._state.tab = tab;
  panel._state.settingsOpen = settings;
  panel.render({ force: true });
  return panel;
}

// GM, repeated Ctrl+Shift+P: each tab of the panel in turn, then it closes once all were shown.
let gmCycle = null; // { start, cur } tab keys
function cyclePanelTabs() {
  const panel = PhonePanel.instance;
  if (!panel?.rendered || panel.minimized || panel._state.settingsOpen) {
    gmCycle = null;
    return openPanel();
  }
  const tabs = [...panel.element.querySelectorAll('.spt-tab[data-action="switchTab"]')].map((a) => a.dataset.tab);
  const cur = panel._state.tab;
  if (!tabs.includes(cur)) return openPanel();
  if (gmCycle?.cur !== cur) gmCycle = { start: cur, cur };
  const next = tabs[(tabs.indexOf(cur) + 1) % tabs.length];
  if (tabs.length < 2 || next === gmCycle.start) {
    gmCycle = null;
    return panel.close();
  }
  gmCycle.cur = next;
  panel._setState({ tab: next });
}

export function openPhone(phoneUuid = null) {
  // A jammer has no screen: its own small window, for the GM too.
  if (phoneUuid && isJammer(getPhoneData(fromUuidSync(phoneUuid)))) return openJammer(phoneUuid);
  if (!game.user.isGM) {
    // A pager has its own window, next to the phone.
    if (phoneUuid && isPager(getPhoneData(fromUuidSync(phoneUuid)))) return openPager(phoneUuid, { latest: true });
    const mine = myPhones();
    if (!phoneUuid && mine.length && mine.every((p) => isPager(p.phone))) return mine.map((p) => openPager(p.item.uuid));
    if (!phoneUuid && !mine.length && myJammers().length) return myJammers().map((p) => openJammer(p.item.uuid));
  }
  const app = PlayerPhone.instance ?? new PlayerPhone();
  // Reopened with no device named (shortcut, main button): back to the carried device, not a landline left open.
  if (!phoneUuid && !game.user.isGM && !app.rendered && app._state.phoneUuid) {
    const last = fromUuidSync(app._state.phoneUuid);
    if (!last || isFixed(getPhoneData(last))) {
      app._state.phoneUuid = null;
      app._state.view = "list";
    }
  }
  if (phoneUuid) {
    app._state.phoneUuid = phoneUuid;
    app._state.view = "list";
    app._skipRead = true;
  }
  app.render({ force: true });
  return app;
}

/* -------------------------------------------- */
/*  Initialization                              */
/* -------------------------------------------- */

Hooks.once("init", () => {
  registerEnrichers();
  registerJammerHooks();
  registerPhoneSheet();
  // Templates: {{spt "Key" var=value}} and {{sptn "Key" n}} use the module's texts (module language).
  Handlebars.registerHelper("spt", (key, options) => t(key, options?.hash ?? {}));
  Handlebars.registerHelper("sptn", (key, n) => tn(key, n));
  // Setting labels follow Foundry's language (translated by Foundry from lang/*.json).
  game.settings.register(MODULE_ID, "universe", {
    name: "SPT.Settings.universe.name",
    hint: "SPT.Settings.universe.hint",
    scope: "world",
    config: true,
    type: String,
    choices: Object.fromEntries(Object.keys(UNIVERSES).map((k) => [k, `SPT.UniverseName.${k}`])),
    default: DEFAULT_UNIVERSE,
    requiresReload: true
  });
  // Existing devices keep their look and ringtone when the universe changes: stored once per world (see freezeLooks).
  game.settings.register(MODULE_ID, "looksFrozen", { scope: "world", config: false, type: Boolean, default: false });
  // Old storage of the advanced features (one object), migrated once to one setting per feature, see features.js.
  game.settings.register(MODULE_ID, "features", { scope: "world", config: false, type: Object, default: null, onChange: () => rerenderAll() });
  game.settings.register(MODULE_ID, "featuresMigrated", { scope: "world", config: false, type: Boolean, default: false, onChange: () => rerenderAll() });
  game.settings.register(MODULE_ID, "gmLook", {
    name: "SPT.Settings.gmLook.name",
    hint: "SPT.Settings.gmLook.hint",
    scope: "world",
    config: true,
    type: String,
    choices: Object.fromEntries(["auto", "ops", "haze", "classic"].map((k) => [k, `SPT.Settings.gmLook.${k}`])),
    default: "auto",
    onChange: () => applyGmLook()
  });
  game.settings.register(MODULE_ID, "language", {
    name: "SPT.Settings.language.name",
    hint: "SPT.Settings.language.hint",
    scope: "world",
    config: true,
    type: String,
    choices: { auto: "SPT.Settings.language.auto", fr: "Français", en: "English" },
    default: "auto",
    requiresReload: true
  });
  game.settings.register(MODULE_ID, "volume", {
    name: "SPT.Settings.volume.name",
    hint: "SPT.Settings.volume.hint",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 0, max: 1, step: 0.05 },
    default: 0.8
  });
  game.settings.register(MODULE_ID, "ringTimeout", {
    name: "SPT.Settings.ringTimeout.name",
    hint: "SPT.Settings.ringTimeout.hint",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 0, max: 120, step: 5 },
    default: 60
  });
  game.settings.register(MODULE_ID, "floatingButton", {
    name: "SPT.Settings.floatingButton.name",
    hint: "SPT.Settings.floatingButton.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => updateFab()
  });
  game.settings.register(MODULE_ID, "gmFloatingButton", {
    name: "SPT.Settings.gmFloatingButton.name",
    hint: "SPT.Settings.gmFloatingButton.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => updateFab()
  });
  game.settings.register(MODULE_ID, "numberPrefix", {
    name: "SPT.Settings.numberPrefix.name",
    hint: "SPT.Settings.numberPrefix.hint",
    scope: "world",
    config: true,
    type: String,
    default: "555-"
  });
  game.settings.register(MODULE_ID, "directory", {
    scope: "world",
    config: false,
    type: String,
    default: DIRECTORY_SAMPLE,
    onChange: () => rerenderAll()
  });
  game.settings.register(MODULE_ID, "team", {
    name: "SPT.Settings.team.name",
    hint: "SPT.Settings.team.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => rerenderAll()
  });
  // GM welcome window: shown once per world.
  game.settings.register(MODULE_ID, "welcomeShown", { scope: "world", config: false, type: Boolean, default: false });
  // Calls in progress (GM writes): found again after a reload.
  game.settings.register(MODULE_ID, "liveCalls", { scope: "world", config: false, type: Object, default: {} });
  // Scenes the GM opened to the satellite "for the whole scene" (emptied at each GM session).
  game.settings.register(MODULE_ID, "satSky", { scope: "world", config: false, type: Array, default: [], onChange: () => rerenderAll() });
  game.settings.register(MODULE_ID, "networkDown", {
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
    onChange: (down) => {
      resetOpenSky();
      rerenderAll();
      if (!down && isActiveGM()) flushAll();
    }
  });
  game.keybindings.register(MODULE_ID, "openPhone", {
    name: "SPT.Settings.keybinding",
    editable: [{ key: "KeyP", modifiers: ["Control", "Shift"] }],
    onDown: () => {
      if (game.user.isGM) cyclePanelTabs();
      // Each new press shows the next device (pagers included), then closes once all were shown.
      else cycleDevices(() => openPhone());
      return true;
    }
  });
  // Advanced features last, so they close the module's list in Foundry's settings.
  registerFeatureSettings(() => rerenderAll());
});

// Button in the "Tokens" toolbar (object structure of controls, v13+).
Hooks.on("getSceneControlButtons", (controls) => {
  const tokens = controls.tokens ?? controls.token;
  if (!tokens?.tools) return;
  tokens.tools.sptPhone = {
    name: "sptPhone",
    title: game.user.isGM ? t("Gm.PanelTitle") : t("MyPhone"),
    icon: game.user.isGM ? "fas fa-tower-cell" : "fas fa-phone",
    order: Object.keys(tokens.tools).length,
    button: true,
    visible: true,
    onChange: () => (game.user.isGM ? openPanel() : openPhone())
  };
});

/** Migrates data from former module ids: device flags, item sheet, world and client settings. */
export async function migrateLegacy() {
  // Client settings (language, volume): each user's browser, once.
  for (const [key, cfg] of game.settings.settings) {
    if (cfg.namespace !== MODULE_ID || cfg.scope !== "client") continue;
    try {
      if (localStorage.getItem(key) !== null) continue;
      for (const id of LEGACY_IDS) {
        const old = localStorage.getItem(`${id}.${cfg.key}`);
        if (old === null) continue;
        localStorage.setItem(key, old);
        break;
      }
    } catch {}
  }
  if (!isActiveGM()) return;
  const items = [...game.items, ...game.actors.contents.flatMap((a) => a.items.contents)];
  let n = 0;
  for (const item of items) {
    if (item._source.flags?.[MODULE_ID]?.phone) continue;
    const oldId = LEGACY_IDS.find((id) => item._source.flags?.[id]?.phone);
    if (!oldId) continue;
    // Moves the whole flag scope (phone, desc, demo), the device sheet and the model icon if they were the old module's.
    const patch = { [`flags.${MODULE_ID}`]: item._source.flags[oldId], [`flags.-=${oldId}`]: null };
    if (item._source.flags?.core?.sheetClass === `${oldId}.PhoneSheet`) patch["flags.core.sheetClass"] = SHEET_ID;
    if (item._source.img?.startsWith(`modules/${oldId}/`)) patch.img = item._source.img.replace(`modules/${oldId}/`, `modules/${MODULE_ID}/`);
    await item.update(patch);
    n++;
  }
  // World settings: migrated once, if the new module has none yet.
  let moved = 0;
  try {
    const world = game.settings.storage.get("world");
    for (const [, cfg] of game.settings.settings) {
      if (cfg.namespace !== MODULE_ID || cfg.scope !== "world") continue;
      if (world.find((s) => s.key === `${MODULE_ID}.${cfg.key}`)) continue;
      for (const id of LEGACY_IDS) {
        const old = world.find((s) => s.key === `${id}.${cfg.key}`);
        if (!old) continue;
        let value = old.value;
        if (typeof value === "string") {
          try {
            value = JSON.parse(value);
          } catch {}
        }
        await game.settings.set(MODULE_ID, cfg.key, value);
        moved++;
        break;
      }
    }
  } catch (err) {
    console.warn(`${MODULE_ID} | could not migrate settings`, err);
  }
  const oldActive = LEGACY_IDS.some((id) => game.modules.get(id)?.active);
  // Only GMs coming from the former module see this: a fresh install has nothing to migrate.
  if (n || moved || oldActive) renamedNotice(n, oldActive);
}

/**
 * Active GM, once: existing devices keep their looks (computed with the universe as it was stored),
 * then the removed "Any setting" universe becomes Modern.
 */
async function migrateUniverse() {
  try {
    await freezeLooks();
    await migrateSatphones();
    if (!UNIVERSES[storedUniverseKey()]) await game.settings.set(MODULE_ID, "universe", DEFAULT_UNIVERSE);
  } catch (err) {
    console.warn(`${MODULE_ID} | could not migrate the universe`, err);
  }
}

/** Tells the GM the module was renamed, what was recovered, and what to do with the old one. */
function renamedNotice(n, oldActive) {
  const lines = [t("Renamed.Body"), n ? t("Migrated", { n }) : "", oldActive ? `<strong>${t("Renamed.Disable")}</strong>` : t("Renamed.Uninstall")];
  foundry.applications.api.DialogV2.prompt({
    classes: ["spt-dialog"],
    window: { title: t("Renamed.Title"), icon: "fas fa-mobile-screen" },
    content: lines.filter(Boolean).map((l) => `<p>${l}</p>`).join(""),
    ok: { label: t("Renamed.Ok") }
  }).catch(() => {});
}

// Another scene activated: satellite approvals "for the whole scene" are forgotten.
Hooks.on("updateScene", (scene, changes) => {
  if (changes.active === true) resetOpenSky();
});

Hooks.once("ready", async () => {
  // Universe accent on the GM panel and floating buttons (CSS: body[data-spt-universe]).
  document.body.dataset.sptUniverse = universeKey();
  applyGmLook();
  initFeatures(allPhones({ jammers: true }).length > 0);
  game.socket.on(SOCKET, onSocket);
  await loadLanguages();
  welcomeOwnedDevices();
  document.body.addEventListener("click", (ev) => {
    const link = ev.target.closest?.("a.spt-link");
    if (!link || !game.user.isGM) return;
    ev.preventDefault();
    ev.stopPropagation();
    runJournalLink(link.dataset);
  });
  await migrateLegacy();
  if (game.user === game.users.activeGM) {
    ensureDeviceItems();
    await migrateUniverse();
    await dropOldDirectoryTip();
    resetOpenSky();
  }
  updateFab();
  restoreLive();
  registerTour();
  game.modules.get(MODULE_ID).api = { openPanel, openPhone, openWelcome, openNews, ring, hangUp, sendSms, allPhones, createPhone, markPhone, transferPhone };
  maybeWelcome();
  maybeNews();
});

/**
 * The old sample directory began with a tip and an agent's number (agents are devices now, not
 * directory lines). Removed from worlds that still have them, untouched if the GM changed them.
 */
async function dropOldDirectoryTip() {
  const TIP = "# Tip: add the agents' own numbers as public, so they all know each other:";
  const text = game.settings.get(MODULE_ID, "directory") ?? "";
  const lines = text.split("\n");
  const i = lines.findIndex((l) => l.trim() === TIP);
  if (i < 0) return;
  let n = 1;
  if (lines[i + 1]?.trim() === "Agent Reyes | 555-0142 | public") n++;
  if (lines[i + n] !== undefined && !lines[i + n].trim()) n++;
  lines.splice(i, n);
  await game.settings.set(MODULE_ID, "directory", lines.join("\n"));
}

Hooks.on("userConnected", rerenderAll);
// Renaming the item also renames the device: they share one name.
Hooks.on("preUpdateItem", (item, changes) => {
  const phone = getPhoneData(item);
  if (!phone || typeof changes.name !== "string") return;
  foundry.utils.setProperty(changes, `flags.${MODULE_ID}.phone.label`, changes.name);
});
// Presence on a scene: who sees installed devices (terminal).
for (const hook of ["createToken", "deleteToken", "canvasReady"]) Hooks.on(hook, () => rerenderAll());

// A renamed scene: the Items sidebar captions of its installed devices follow.
Hooks.on("updateScene", (scene, changes) => {
  if (game.user.isGM && "name" in (changes ?? {}) && game.items.some((i) => getPhoneData(i)?.sceneId === scene.id)) ui.items?.render();
});

// Dead zones: a scene unmarked delivers what was waiting (a player changing scene: see updateUser).
Hooks.on("updateScene", (scene, changes) => {
  if (changes?.flags?.[MODULE_ID] === undefined) return;
  rerenderAll();
  // Dead zone switched on or off: the GM's Scenes sidebar redraws its mark (Foundry skips it for a flag change).
  if (game.user.isGM && Object.keys(changes.flags[MODULE_ID] ?? {}).some((k) => k.endsWith("deadZone"))) ui.scenes?.render();
  if (isActiveGM()) flushAll();
});

/** GM: a "New device" button at the top of the Items sidebar opens the device choice. */
Hooks.on("renderItemDirectory", (app, html) => {
  if (!game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html?.[0] ?? app.element;
  const actions = root?.querySelector(".header-actions");
  if (!actions || actions.querySelector(".spt-new-device-btn")) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "spt-new-device-btn";
  btn.innerHTML = `<i class="fas fa-mobile-screen"></i> ${t("NewDevice")}`;
  btn.addEventListener("click", async (ev) => {
    ev.preventDefault();
    const res = await newPhoneDialog();
    if (res?.open && res.item) openPhone(res.item.uuid);
  });
  actions.append(btn);
});

/**
 * GM, Items sidebar: under each device's name, a small caption (place or holder · number/email)
 * a lock when it is locked, a warning when it is compromised. Display only: the item's name is never changed.
 */
Hooks.on("renderItemDirectory", (app, html) => {
  if (!game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html?.[0] ?? app.element;
  for (const li of root?.querySelectorAll("li.directory-item.entry") ?? []) {
    const item = game.items.get(li.dataset.entryId ?? li.dataset.documentId);
    const phone = item && getPhoneData(item);
    const name = li.querySelector(".entry-name");
    if (!phone || !name || name.querySelector(".spt-item-sub")) continue;
    const where = isFixed(phone)
      ? `<i class="fas fa-location-dot"></i> ${esc(game.scenes.get(phone.sceneId)?.name ?? t("NoPlace"))}`
      : esc(sharedUsers(item).length ? t("Gm.Shared") : t("Gm.Nobody"));
    const address = isJammer(phone) ? "" : String(phone.number ?? "");
    const lock = phone.locked ? ` <i class="fas fa-lock spt-item-lock" title="${esc(t("Lock.Locked"))}"></i>` : "";
    const warn = phone.compromised ? ` <i class="fas fa-triangle-exclamation spt-compromised" title="${esc(t("Gm.Compromised"))}"></i>` : "";
    li.classList.add("spt-device-entry");
    name.innerHTML = `<span class="spt-item-name">${esc(item.name)}${lock}${warn}</span><span class="spt-item-sub">${where}${address ? ` · ${esc(address)}` : ""}</span>`;
  }
});

/**
 * GM, right-click on a device in the Items sidebar: edit it, give it, or open Foundry's own item sheet
 * (a plain click opens the device's GM view). v13+ hook, li is the entry element.
 */
Hooks.on("getItemContextOptions", (app, options) => {
  const device = (li) => {
    const el = li instanceof HTMLElement ? li : li?.[0];
    const item = game.items.get(el?.dataset.entryId ?? el?.dataset.documentId);
    return item && getPhoneData(item) ? item : null;
  };
  const isDevice = (li) => game.user.isGM && !!device(li);
  options.unshift(
    { name: t("EditDevice"), icon: '<i class="fas fa-gear"></i>', condition: isDevice, callback: (li) => editPhoneDialog(device(li)) },
    { name: `${t("Give.Give")}…`, icon: '<i class="fas fa-hand-holding-hand"></i>', condition: (li) => isDevice(li) && !isFixed(getPhoneData(device(li))), callback: (li) => giveDialog(device(li)) },
    { name: t("Sheet.ItemSheet"), icon: '<i class="fas fa-file-lines"></i>', condition: isDevice, callback: (li) => openSystemSheet(device(li)) }
  );
});

/**
 * "Edit" (added by Foundry v14, the game system or another module) only opens the device's GM view,
 * as a plain click does: hidden for devices. Registered at ready, so it runs after the other modules' hooks.
 */
const EDIT_KEYS = ["SIDEBAR.Edit", "CONTROLS.CommonEdit", "DOCUMENT.Edit", "Edit"];
const EDIT_ICON = /fa-(pen-to-square|edit|pen|pencil)\b/;
Hooks.once("ready", () => {
  const labels = new Set(EDIT_KEYS.flatMap((k) => [k, game.i18n.localize(k)]));
  Hooks.on("getItemContextOptions", (app, options) => {
    const isDevice = (li) => {
      const el = li instanceof HTMLElement ? li : li?.[0];
      return !!getPhoneData(game.items.get(el?.dataset.entryId ?? el?.dataset.documentId));
    };
    for (const o of options) {
      if (!labels.has(o.name) && !labels.has(game.i18n.localize(o.name ?? "")) && !EDIT_ICON.test(o.icon ?? "")) continue;
      const cond = o.condition;
      o.condition = (li) => !isDevice(li) && (typeof cond === "function" ? cond(li) : cond ?? true);
    }
  });
});

/**
 * GM, right-click on an NPC in the Actors sidebar: "Add to the directory" (its name, a new free number).
 * Nothing when the name is already listed or the NPC carries a device (its number is already known).
 */
Hooks.on("getActorContextOptions", (app, options) => {
  const npc = (li) => {
    const el = li instanceof HTMLElement ? li : li?.[0];
    const actor = game.actors.get(el?.dataset.entryId ?? el?.dataset.documentId);
    return actor && !actor.hasPlayerOwner ? actor : null;
  };
  options.push({
    name: t("Directory.Add"),
    icon: '<i class="fas fa-phone"></i>',
    condition: (li) => game.user.isGM && !!npc(li),
    callback: (li) => addActorToDirectory(npc(li))
  });
});

/** GM: adds an NPC to the phone directory (its name, a new free number), unless already listed or carrying a device. */
async function addActorToDirectory(actor) {
  if (!game.user.isGM || !actor || actor.hasPlayerOwner) return;
  const name = actor.name.trim();
  // Foundry notifications accept simple HTML: the phone handset icon, the actor's name escaped.
  const notice = (key, data = {}) => ui.notifications.info(`<i class="fas fa-phone"></i> ${t(key, { name: esc(name), ...data })}`);
  if (npcDirectory().some((e) => norm(e.name ?? "") === norm(name))) return notice("Directory.ActorAlready");
  if (actor.items.some((i) => getPhoneData(i))) return notice("Directory.ActorHasDevice");
  const number = freeNpcNumber();
  if (await saveNpc({ name, number })) notice("Directory.ActorAdded", { number: esc(number) });
}

/** GM, an NPC's sheet: "Add to the directory" in the window menu (⋮). V2 sheets (Delta Green…) and older V1 sheets. */
Hooks.on("getHeaderControlsActorSheetV2", (app, controls) => {
  const actor = app.document;
  if (!game.user.isGM || !actor || actor.hasPlayerOwner) return;
  controls.push({ icon: "fas fa-phone", label: t("Directory.Add"), action: "sptAddToDirectory", onClick: () => addActorToDirectory(actor) });
});
Hooks.on("getActorSheetHeaderButtons", (app, buttons) => {
  const actor = app.actor ?? app.document;
  if (!game.user.isGM || !actor || actor.hasPlayerOwner) return;
  buttons.unshift({ label: t("Directory.Add"), class: "spt-add-directory", icon: "fas fa-phone", onclick: () => addActorToDirectory(actor) });
});

/** GM: scenes marked "dead zone" get an icon in the Scenes sidebar (Foundry re-renders it when a scene changes). */
Hooks.on("renderSceneDirectory", (app, html) => {
  if (!game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html?.[0] ?? app.element;
  for (const li of root?.querySelectorAll("li[data-entry-id], li[data-document-id]") ?? []) {
    const scene = game.scenes.get(li.dataset.entryId ?? li.dataset.documentId);
    if (!scene?.getFlag(MODULE_ID, "deadZone") || li.querySelector(".spt-dz-mark")) continue;
    const name = li.querySelector(".entry-name, .document-name, .name") ?? li;
    name.insertAdjacentHTML("beforeend", ` <i class="fas fa-phone-slash spt-dz-mark" title="${t("Scene.DeadZone")}"></i>`);
  }
});

/** Scene configuration: "dead zone" checkbox (no mobile network, no Wi-Fi). */
Hooks.on("renderSceneConfig", (app, html) => {
  const root = html instanceof HTMLElement ? html : html?.[0];
  const tab = root?.querySelector('.tab[data-tab="basics"]') ?? root?.querySelector("form");
  if (!tab || tab.querySelector(".spt-deadzone")) return;
  const checked = app.document?.getFlag(MODULE_ID, "deadZone") ? "checked" : "";
  tab.insertAdjacentHTML("beforeend", `<div class="form-group spt-deadzone">
      <label><i class="fas fa-signal"></i> ${t("Scene.DeadZone")}</label>
      <div class="form-fields"><input type="checkbox" name="flags.${MODULE_ID}.deadZone" ${checked}></div>
      <p class="hint">${t("Scene.DeadZoneHint")}</p>
    </div>`);
});
Hooks.on("updateUser", (user, changes) => {
  if (user.isSelf && "character" in changes) updateFab();
  if ("viewedScene" in changes) {
    rerenderAll();
    // Leaving a dead zone: what was waiting arrives.
    if (isActiveGM()) flushAll();
  }
});
/**
 * A carried device exists only once. Dragged onto another character (Foundry copies it),
 * it changes hands with its history: the old copy is removed. Duplicated in place,
 * the copy becomes a new device with its own number. Installed devices are not affected.
 */
Hooks.on("createItem", async (item, options) => {
  if (options?.spt || !isActiveGM()) return;
  const phone = getPhoneData(item);
  if (!phone || isFixed(phone)) return;
  const twins = allPhones({ jammers: true }).filter((p) => p.item !== item && !isFixed(p.phone) && norm(p.phone.number) === norm(phone.number));
  if (!twins.length) return;
  if (twins.some((p) => p.item.parent === item.parent)) {
    await item.update({ [`flags.${MODULE_ID}.phone`]: { ...phone, number: randomAddress(phone.model, { name: item.parent?.name }), log: [], contacts: [] } });
    return;
  }
  for (const p of twins) await p.item.delete();
});

for (const hook of ["createItem", "updateItem", "deleteItem"]) {
  Hooks.on(hook, (item, changes) => {
    // Ownership counts too: giving a world device to players gives them access.
    const touched = hook === "updateItem" ? changes?.flags?.[MODULE_ID] !== undefined || (!!changes?.ownership && !!getPhoneData(item)) : !!getPhoneData(item);
    if (touched) rerenderAll();
    // A world device changed (place, number, compromised…): the GM's Items sidebar captions follow.
    if (touched && hook === "updateItem" && game.user.isGM && !item.parent) ui.items?.render();
    // Signal back, or switched back on: deliver what was waiting.
    const ph = changes?.flags?.[MODULE_ID]?.phone;
    if (hook === "updateItem" && isActiveGM() && (ph?.noSignal === false || (ph?.mode && ph.mode !== "off"))) flushPending(item);
  });
}

