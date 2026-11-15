import { ApplicationV2, MODULE_ID } from "./constants.js";
import { addLog, allPhones, createPhone, getLog, hasSignal, isFixed, isPager, keyFor, modeOf, MODELS, msgOn } from "./devices.js";
import { operatorName } from "./names.js";
import { openPanel } from "./main.js";
import { startTour, tourAvailable } from "./tour.js";
import { modelAllowed, universe, universeKey } from "./universes.js";
import { esc } from "./util.js";
import { t } from "./i18n.js";

/* -------------------------------------------- */
/*  GM welcome: "you are the network"           */
/* -------------------------------------------- */

/** Models a character can carry, offered when equipping player characters. */
const CARRIED = ["smartphone", "mobile", "pager", "computer"];

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
      equip: async function () {
        for (const row of this.element.querySelectorAll("[data-actor]")) {
          if (!row.querySelector("input[type=checkbox]")?.checked) continue;
          const actor = game.actors.get(row.dataset.actor);
          const model = row.querySelector("select")?.value;
          if (actor && MODELS[model]) await createPhone(actor, { model });
        }
        this.render();
      },
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
    const models = CARRIED.filter(modelAllowed);
    const def = models.includes(universe().defaultModel) ? universe().defaultModel : models[0];
    const rows = playerCharacters().map(({ actor, players }) => {
      const has = carriedBy(actor);
      const options = models.map((m) => `<option value="${m}" ${m === def ? "selected" : ""}>${esc(MODELS[m].label)}</option>`).join("");
      const owned = has.map((p) => `<span class="spt-wl-has"><i class="fas ${MODELS[p.phone.model]?.icon ?? "fa-mobile-screen"}"></i> ${esc(p.item.name)}</span>`).join("");
      return `<li class="spt-wl-row ${has.length ? "equipped" : ""}" data-actor="${actor.id}">
          <label class="spt-wl-who"><input type="checkbox" ${has.length ? "" : "checked"}>
            <strong>${esc(actor.name)}</strong> <span class="spt-wl-player">${esc(players.join(", "))}</span></label>
          <span class="spt-wl-state">${owned}</span>
          <select aria-label="${esc(t("Form.Model"))}">${options}</select>
        </li>`;
    });
    const equip = rows.length
      ? `<ul class="spt-wl-list">${rows.join("")}</ul>
         <div class="spt-wl-actions"><button type="button" class="spt-primary" data-action="equip"><i class="fas fa-mobile-screen"></i> ${t("Welcome.Equip")}</button></div>`
      : `<p class="spt-wl-empty"><i class="fas fa-circle-info"></i> ${t("Welcome.NoCharacters")}</p>`;
    return `<div class="spt-wl">
      <p class="spt-wl-lead"><i class="fas fa-tower-cell"></i> ${t("Welcome.Lead")}</p>
      <ul class="spt-wl-points">
        <li><i class="fas fa-mobile-screen"></i> ${t("Welcome.PointDevice")}</li>
        <li><i class="fas fa-user-secret"></i> ${t("Welcome.PointNpc", { panel })}</li>
        <li><i class="fas fa-reply"></i> ${t("Welcome.PointReply")}</li>
      </ul>
      <h3><i class="fas fa-users"></i> ${t("Welcome.EquipTitle")}</h3>
      ${equip}
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
  await addLog(p.item, { kind: "sms", dir: "in", with: keyFor(phone, operator), text, read: false });
}
