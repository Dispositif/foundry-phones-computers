/**
 * Minimal Foundry stand-in for unit tests (Node, no browser): just enough globals for the module's
 * pure logic (devices, directory, numbers, portraits). setWorld() replaces the fake world between tests.
 */
const MODULE_ID = "soren-phones-computers";
const DEFAULT_SETTINGS = { universe: "modern", directory: "", features: {}, featuresMigrated: true, numberPrefix: "555-", team: false, looksFrozen: true, gmLook: "auto" };
let settings = { ...DEFAULT_SETTINGS };

class App { constructor(options = {}) { this.options = options; } static DEFAULT_OPTIONS = {}; }

// Hooks are recorded, so setWorld() can fire the ones that reset the module's caches.
const hooks = new Map();
globalThis.Hooks = {
  on(name, fn) { if (!hooks.has(name)) hooks.set(name, []); hooks.get(name).push(fn); },
  once() {},
  call() {},
  callAll(name, ...args) { for (const fn of hooks.get(name) ?? []) fn(...args); }
};

globalThis.foundry = {
  applications: { api: { ApplicationV2: App, DialogV2: App, HandlebarsApplicationMixin: (B) => class extends B {} }, sheets: { ItemSheetV2: App }, ux: {}, apps: {}, instances: new Map() },
  audio: { AudioHelper: { play() {} } },
  utils: {
    debounce: (f) => f,
    randomID: () => Math.random().toString(36).slice(2, 10),
    deepClone: (o) => structuredClone(o),
    mergeObject: (a, b) => Object.assign(a, b),
    getProperty: (o, p) => p.split(".").reduce((x, k) => x?.[k], o)
  },
  nue: { Tour: class {} }
};

export class FakeActor {
  constructor({ id, name, img = `${name}.webp`, owners = [] }) {
    Object.assign(this, { id, name, img, owners, items: [], uuid: `Actor.${id}` });
  }
  get hasPlayerOwner() { return this.owners.length > 0; }
  testUserPermission(user) { return user.isGM || this.owners.includes(user.id); }
}
export class FakeItem {
  constructor({ id, phone, parent = null, observers = [] }) {
    Object.assign(this, { id, phone, parent, observers, name: phone?.label ?? id });
    this.uuid = parent ? `${parent.uuid}.Item.${id}` : `Item.${id}`;
  }
  getFlag(mod, key) { return mod === MODULE_ID && key === "phone" ? this.phone : undefined; }
  testUserPermission(user) { return user.isGM || this.observers.includes(user.id) || !!this.parent?.testUserPermission(user); }
}
globalThis.Actor = FakeActor;
globalThis.Item = FakeItem;
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.CONFIG = {};
globalThis.fromUuidSync = (uuid) => allItems().find((i) => i.uuid === uuid) ?? null;

function allItems() {
  return [...game.items, ...game.actors.flatMap((a) => a.items)];
}

function list(arr) {
  const out = [...arr];
  out.get = (id) => out.find((x) => x.id === id) ?? null;
  out.getName = (name) => out.find((x) => x.name === name) ?? null;
  return out;
}

globalThis.game = {
  ready: true,
  user: { id: "gm", isGM: true },
  users: list([]),
  i18n: { lang: "en", has: () => false, localize: (k) => k },
  settings: { get: (mod, key) => settings[key], set: async (mod, key, value) => { settings[key] = value; }, register() {} },
  scenes: list([]),
  actors: list([]),
  items: list([]),
  socket: { emit() {}, on() {} }
};

/**
 * Replaces the fake world. users: [{ id, isGM, active, character }]; actors: FakeActor[] (their items set);
 * items: world FakeItem[]; directory: the NPC directory text; settings: other module settings.
 */
export function setWorld({ users = [], actors = [], items = [], directory = "", settings: extra = {} } = {}) {
  settings = { ...DEFAULT_SETTINGS, directory, ...extra };
  game.users = list([{ id: "gm", isGM: true, active: true }, ...users]);
  game.actors = list(actors);
  game.items = list(items);
  // The module's caches (team contacts, jammers…) are reset on these hooks.
  // A plain document stand-in: the hooks read flags from it.
  const doc = new FakeItem({ id: "_reset" });
  for (const name of ["createItem", "updateSetting", "updateActor", "updateUser"]) Hooks.callAll(name, doc, {});
}

/** A device carried by an actor. */
export function carry(actor, id, phone) {
  const item = new FakeItem({ id, phone: { model: "smartphone", contacts: [], log: [], ...phone }, parent: actor });
  actor.items.push(item);
  return item;
}

const ROOT = new URL("../../scripts/", import.meta.url);
export const load = (file) => import(new URL(file, ROOT));
