import { ApplicationV2, MODULE_ID } from "./constants.js";
import { addLog, allPhones, getLog, hasSignal, isComputer, isFixed, isPager, keyFor, modeOf, MODELS, msgOn } from "./devices.js";
import { operatorName } from "./names.js";
import { openPanel } from "./main.js";
import { startTour, tourAvailable } from "./tour.js";
import { UNIVERSES, universeKey } from "./universes.js";
import { esc } from "./util.js";
import { t } from "./i18n.js";

/* -------------------------------------------- */
/*  GM welcome: "you are the network"           */
/* -------------------------------------------- */

/** Characters assigned to players, once each, with their players' names. */
function playerCharacters() {
  const byActor = new Map();
  for (const u of game.users) {
    if (u.isGM || !u.character) continue;
    const row = byActor.get(u.character) ?? { actor: u.character, players: [] };
    row.players.push(u.name);
    byActor.set(u.character, row);
  }
  return [...byActor.values()].sort((a, b) => a.actor.name.localeCompare(b.actor.name));
}

/** Devices a character already carries (installed devices and jammers left out). */
function carriedBy(actor) {
  return allPhones().filter((p) => p.actor === actor && !isFixed(p.phone));
}

export class WelcomeApp extends ApplicationV2 {
  static instance = null;

  static DEFAULT_OPTIONS = {
    id: "spt-welcome",
    tag: "form",
    classes: ["spt-dialog", "spt-welcome"],
    window: { icon: "fas fa-tower-cell" },
    position: { width: 540, height: "auto" },
    form: { handler: () => {}, submitOnChange: false, closeOnSubmit: false },
    actions: {
      tour: function () {
        this.close();
        startTour();
      },
      panel: function () {
        this.close();
        openPanel();
      },
      // Universe and advanced features: the settings view of the GM panel.
      settings: function () {
        this.close();
        openPanel({ settings: true });
      }
    }
  };

  get title() {
    return t("Welcome.Title");
  }

  async _renderHTML() {
    const panel = t("Gm.PanelTitle");
    // Ready to play: players with a character, agents with a device (a listing only, nothing to click).
    const players = game.users.filter((u) => !u.isGM);
    const agents = playerCharacters();
    const bare = agents.filter(({ actor }) => !carriedBy(actor).length).length;
    const check = (ok, text) => `<li class="${ok ? "ok" : "warn"}"><i class="fas ${ok ? "fa-check" : "fa-triangle-exclamation"}"></i> ${text}</li>`;
    const withChar = players.filter((u) => u.character).length;
    const ready = [
      players.length ? check(withChar === players.length, t("Welcome.ReadyPlayers", { n: players.length, m: withChar })) : check(false, t("Welcome.ReadyNoPlayers")),
      agents.length ? check(!bare, bare ? t("Welcome.ReadyBare", { n: bare }) : t("Welcome.ReadyDevices")) : ""
    ].join("");
    return `<div class="spt-wl">
      <p class="spt-wl-lead"><i class="fas fa-tower-cell"></i> ${t("Welcome.Lead")}</p>
      <ul class="spt-wl-points">
        <li><i class="fas fa-mobile-screen"></i> ${t("Welcome.PointDevice")}</li>
        <li><i class="fas fa-user-secret"></i> ${t("Welcome.PointNpc", { panel })}</li>
        <li><i class="fas fa-reply"></i> ${t("Welcome.PointReply")}</li>
        <li><i class="fas fa-address-book"></i> ${t("Welcome.PointDirectory")}</li>
      </ul>
      <h3><i class="fas fa-list-check"></i> ${t("Welcome.ReadyTitle")}</h3>
      <ul class="spt-wl-ready">${ready}</ul>
      <p class="spt-wl-universe"><label for="spt-wl-universe">${t("Welcome.Universe")}</label>
        <select id="spt-wl-universe" name="universe">${Object.keys(UNIVERSES)
          .map((k) => `<option value="${k}" ${k === universeKey() ? "selected" : ""}>${esc(t(`UniverseName.${k}`))}</option>`)
          .join("")}</select></p>
      <p class="hint spt-wl-universe-hint">${t("Welcome.UniverseHint")}</p>
      <footer class="spt-wl-footer">
        ${tourAvailable() ? `<button type="button" data-action="tour"><i class="fas fa-route"></i> ${t("Welcome.Tour")}</button>` : ""}
        <button type="button" data-action="panel"><i class="fas fa-tower-cell"></i> ${t("Welcome.OpenPanel", { panel })}</button>
      </footer>
      <p class="spt-wl-more"><a data-action="settings"><i class="fas fa-toolbox"></i> ${t("Welcome.MoreTools")}</a></p>
      <p class="spt-wl-reopen">${t("Welcome.Reopen", { panel })}</p>
    </div>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    WelcomeApp.instance = this;
    // Universe: chosen here on first install (a world setting that needs a reload).
    this.element.querySelector("[name=universe]")?.addEventListener("change", async (ev) => {
      if (ev.target.value === universeKey()) return;
      await game.settings.set(MODULE_ID, "universe", ev.target.value);
      const Config = foundry.applications.settings?.SettingsConfig ?? globalThis.SettingsConfig;
      if (Config?.reloadConfirm) Config.reloadConfirm({ world: true });
      else foundry.utils.debouncedReload();
    });
  }
}

export function openWelcome() {
  if (!game.user.isGM) return;
  const app = WelcomeApp.instance ?? new WelcomeApp();
  app.render({ force: true });
  return app;
}

/**
 * Shown once per world, to the first GM who opens it after installing.
 * A world that already has devices was set up before: no welcome.
 */
export async function maybeWelcome() {
  if (game.user !== game.users.activeGM || game.settings.get(MODULE_ID, "welcomeShown")) return;
  await game.settings.set(MODULE_ID, "welcomeShown", true);
  if (!allPhones({ jammers: true }).length) openWelcome();
}

/* -------------------------------------------- */
/*  Player: welcome message on a new device     */
/* -------------------------------------------- */

const welcomed = new Set();

/**
 * The first time a player opens a new device (empty history), its network operator
 * sends a welcome text, in the universe's wording (not on pagers, laptops or terminals).
 * Stays in the fiction: nothing in the chat, the message simply lands on the device.
 */
export async function welcomeDevice(p) {
  if (game.user.isGM || !p?.item?.isOwner || welcomed.has(p.item.uuid)) return;
  const phone = p.phone;
  if (phone.welcomed || isPager(phone) || isComputer(phone) || !msgOn(phone) || modeOf(phone) === "off" || !hasSignal(phone) || !game.users.activeGM) return;
  if (getLog(phone, { includePending: true }).length) return;
  // Several players own the device: only the first one connected sends it.
  const owners = game.users.filter((u) => u.active && !u.isGM && p.item.testUserPermission(u, "OWNER")).sort((a, b) => a.id.localeCompare(b.id));
  if (owners.length && owners[0] !== game.user) return;
  welcomed.add(p.item.uuid);
  const operator = operatorName(phone);
  const text = t(MODELS[phone.model]?.mail ? "Welcome.Mail" : "Welcome.Sms", { operator, number: phone.number });
  await p.item.update({ [`flags.${MODULE_ID}.phone.welcomed`]: true });
  // help: the bubble ends with a link to the player guide (titled in the fiction: subscriber's guide, user manual...).
  await addLog(p.item, { kind: "sms", dir: "in", with: keyFor(phone, operator), text, read: false, net: true, help: true });
}

/** Player: welcomes each of their devices as soon as it exists (not only when opened), so the floating button shows the unread badge. */
export function welcomeOwnedDevices() {
  if (game.user.isGM || !game.ready) return;
  for (const p of allPhones()) if (p.item.isOwner) welcomeDevice(p);
}

const welcomeSoon = foundry.utils.debounce(welcomeOwnedDevices, 500);
// A device given to the player: created on their character, or ownership granted.
for (const hook of ["createItem", "updateItem", "updateActor"]) Hooks.on(hook, () => welcomeSoon());

/** Player guide: a short help window, opened from the operator's welcome message. */
export function openPlayerGuide() {
  // The icons the player will meet on the device, next to each line.
  const icons = {
    Open: ["fa-mobile-screen"],
    Call: ["fa-phone"],
    Text: ["fa-pen-to-square", "fa-paper-plane"],
    Contacts: ["fa-address-book", "fa-user-plus"],
    Show: ["fa-eye", "fa-share"],
    Next: ["fa-comment-slash"]
  };
  const items = Object.entries(icons)
    .map(([k, ic]) => `<li><span class="spt-guide-ic">${ic.map((i) => `<i class="fas ${i}"></i>`).join("")}</span><span>${t(`Guide.${k}`)}</span></li>`)
    .join("");
  return new foundry.applications.api.DialogV2({
    window: { title: t("Guide.Title"), icon: "fas fa-circle-question" },
    classes: ["spt-dialog", "spt-guide"],
    position: { width: 440 },
    content: `<ul class="spt-guide-list">${items}</ul><p class="spt-guide-credit"><i class="fas fa-tower-cell"></i> ${t("Guide.Credit")}</p>`,
    buttons: [{ action: "ok", label: t("Guide.Ok"), icon: "fas fa-check", default: true }]
  }).render({ force: true });
}
