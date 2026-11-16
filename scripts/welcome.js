import { ApplicationV2, MODULE_ID } from "./constants.js";
import { addLog, allPhones, getLog, hasSignal, isFixed, isPager, keyFor, modeOf, MODELS, msgOn } from "./devices.js";
import { operatorName } from "./names.js";
import { openPanel } from "./main.js";
import { startTour, tourAvailable } from "./tour.js";
import { universeKey } from "./universes.js";
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
    classes: ["spt-welcome"],
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
      settings: function () {
        const sheet = game.settings.sheet ?? new foundry.applications.settings.SettingsConfig();
        sheet.render({ force: true });
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
      <p class="spt-wl-universe">${t("Welcome.Universe")} <strong>${esc(t(`UniverseName.${universeKey()}`))}</strong>
        <a data-action="settings">${t("Welcome.Change")}</a></p>
      <footer class="spt-wl-footer">
        ${tourAvailable() ? `<button type="button" data-action="tour"><i class="fas fa-route"></i> ${t("Welcome.Tour")}</button>` : ""}
        <button type="button" data-action="panel"><i class="fas fa-tower-cell"></i> ${t("Welcome.OpenPanel", { panel })}</button>
      </footer>
      <p class="spt-wl-reopen">${t("Welcome.Reopen", { panel })}</p>
    </div>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    WelcomeApp.instance = this;
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
 * sends a welcome text (a mail on a laptop or terminal), in the universe's wording.
 * Stays in the fiction: nothing in the chat, the message simply lands on the device.
 */
export async function welcomeDevice(p) {
  if (game.user.isGM || !p?.item?.isOwner || welcomed.has(p.item.uuid)) return;
  const phone = p.phone;
  if (phone.welcomed || isPager(phone) || !msgOn(phone) || modeOf(phone) === "off" || !hasSignal(phone) || !game.users.activeGM) return;
  if (!game.settings.get(MODULE_ID, "welcomeMessage") || getLog(phone, { includePending: true }).length) return;
  welcomed.add(p.item.uuid);
  const operator = operatorName(phone);
  const text = t(MODELS[phone.model]?.mail ? "Welcome.Mail" : "Welcome.Sms", { operator });
  await p.item.update({ [`flags.${MODULE_ID}.phone.welcomed`]: true });
  await addLog(p.item, { kind: "sms", dir: "in", with: keyFor(phone, operator), text, read: false, net: true });
}
