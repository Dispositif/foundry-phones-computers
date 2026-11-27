import { MODES } from "../constants.js";
import { allPhones, hasSignal, isComputer, isFixed, isLandline, isSatellite, isSecure, mobileSignal, modelOf, modeOf, phoneLabel, viaSatellite } from "../devices.js";
import { t } from "../i18n.js";
import { liveOn } from "../live-call.js";
import { operatorName } from "../names.js";
import { outgoing } from "../player-calls.js";
import { skyOpenFor } from "../satellite.js";
import { esc, shieldIcon } from "../util.js";
/* Player window: Device header: title, signal, ring and power buttons. */

/** Methods of the player window (PlayerPhone), mixed into its prototype: `this` is the window. */
export const headerViews = {
  /**
   * Player header: the device's label and address, as plain text.
   * Click on the address = copy. Other devices: floating button, Ctrl+Shift+P or the character sheet.
   */
  _deviceTitle(p) {
    const name = p.phone.label;
    // Switched off or locked: only the model shows, not the number (or email, ID…).
    const hidden = !this.gm && (p.phone.locked || modeOf(p.phone) === "off");
    const addr = hidden ? "" : p.phone.number ?? "";
    // Hover: the GM also sees who carries the device, or where it is installed.
    const full = this.gm ? phoneLabel(p) : addr ? `${name} · ${addr}` : name;
    // GM: "next" through the other devices of the same holder, or the other fixed devices of the same scene.
    const group = this.gm ? this._siblings(p) : null;
    const next = group
      ? `<a class="spt-next-device" data-action="gmNextDevice" title="${esc(group.title)}" aria-label="${esc(group.title)}"><i class="fas fa-chevron-right"></i></a>`
      : "";
    return `<div class="spt-dev-title" title="${esc(full)}"><strong>${esc(name)}</strong>${addr ? `<small class="spt-dev-addr" data-action="copyAddress" data-address="${esc(addr)}" title="${t("CopyAddress")}">${esc(addr)}</small>` : ""}</div>${next}`;
  },

  /**
   * GM view: the devices this one can step through, by label, or null when it is alone.
   * Carried: every device of the same actor (PC or NPC). Fixed: the fixed devices of the same scene.
   */
  _siblings(p) {
    const actor = p.item.parent instanceof Actor ? p.item.parent : null;
    const sceneId = isFixed(p.phone) ? p.phone.sceneId : null;
    if (!actor && !sceneId) return null;
    const list = allPhones()
      .filter((q) => (actor ? q.item.parent === actor : isFixed(q.phone) && q.phone.sceneId === sceneId))
      .sort((a, b) => (a.phone.label ?? "").localeCompare(b.phone.label ?? ""));
    if (list.length < 2) return null;
    const title = actor ? t("NextDeviceHolder", { name: actor.name }) : t("NextDevicePlace", { name: game.scenes.get(sceneId)?.name ?? "" });
    return { list, title };
  },

  _renderHeader(p) {
    const mode = modeOf(p.phone);
    // GM and player: the same title (the GM changes device from the panel).
    const phoneSel = this._deviceTitle(p);
    const modeBtns = isComputer(p.phone) || (!this.gm && isFixed(p.phone)) ? "" : this._modeButtons(mode, modelOf(p.phone).noSilent);
    // Player, mobile device switched off: only the power button, which switches it on.
    if (!this.gm && mode === "off" && !isFixed(p.phone) && !isComputer(p.phone)) {
      return `<header class="spt-phone-top">${phoneSel}<div class="spt-modes">${modeBtns}</div></header>`;
    }
    const gmOffline = !this.gm && !game.users.activeGM;
    // Signal icon: bars (or Wi-Fi on a laptop), red without network. Installed devices always have a line.
    const netIcon = isComputer(p.phone) ? "fa-wifi" : "fa-signal";
    const signal = gmOffline
      ? `<span class="spt-signal off" title="${t("Net.GmAbsent")}"><i class="fas ${netIcon}"></i> <small>[${t("Net.GmAway")}]</small></span>`
      : isFixed(p.phone)
        ? ""
        : isSatellite(p.phone)
        ? this._satSignal(p)
        : hasSignal(p.phone)
        ? `<i class="fas ${netIcon} spt-signal" title="${esc(isComputer(p.phone) ? t("Net.Signal") : `${t("Net.Signal")} · ${operatorName(p.phone)}`)}"></i>`
        : `<i class="fas ${netIcon} spt-signal off" title="${t("Net.NoSignalShort")}"></i>`;
    const contactsBtn = !isLandline(p.phone) && this._canEditContacts(p)
      ? `<a data-action="contacts" title="${t("Contacts.Title")}" aria-label="${t("Contacts.Title")}"><i class="fas fa-address-book"></i></a>`
      : "";
    const gmTools = this.gm
      ? `${contactsBtn}<a data-action="gmEditDevice" title="${t("EditDevice")}" aria-label="${t("EditDevice")}"><i class="fas fa-gear"></i></a>`
      : contactsBtn;
    // Secure device: a shield next to the signal.
    const secure = isSecure(p.phone) ? shieldIcon({ title: t("Secure.Device"), cls: "spt-secure-badge" }) : "";
    return `<header class="spt-phone-top">${phoneSel}${secure}${signal}${gmTools}<div class="spt-modes">${modeBtns}</div></header>`;
  },

  /**
   * Two buttons: ring/silent (one toggle showing the current state) and power.
   * Switched off, the toggle keeps its space (hidden) so the power button stays in place.
   */
  _modeButtons(mode, noSilent = false) {
    const off = mode === "off";
    const ring = mode === "silent" ? MODES.silent : MODES.on;
    const toggle = off && !this.gm
      ? `<button type="button" class="spt-mode" style="visibility:hidden" tabindex="-1" aria-hidden="true"><i class="fas ${ring.icon}"></i></button>`
      : `<button type="button" class="spt-mode ${off ? "" : "active"}" data-mode="${mode === "on" ? "silent" : "on"}" title="${ring.label}" aria-label="${ring.label}"><i class="fas ${ring.icon}"></i></button>`;
    const powerTitle = t(off ? "PowerOn" : "PowerOff");
    const power = `<button type="button" class="spt-mode ${off ? "active" : ""}" data-mode="${off ? "on" : "off"}" title="${powerTitle}" aria-label="${powerTitle}"><i class="fas ${MODES.off.icon}"></i></button>`;
    // Brick: rings or is off, no silent mode.
    return noSilent ? power : toggle + power;
  },

  /**
   * Satellite device: the mobile network bars (green or red), and always the satellite:
   * grey, green when linked (call through the satellite, or scene opened to it by the GM).
   */
  _satSignal(p) {
    const phone = p.phone;
    // Laptop: Wi-Fi instead of the mobile bars.
    const icon = isComputer(phone) ? "fa-wifi" : "fa-signal";
    const gsm = mobileSignal(phone)
      ? `<i class="fas ${icon} spt-signal" title="${esc(isComputer(phone) ? t("Net.Signal") : `${t("Net.Signal")} · ${operatorName(phone)}`)}"></i>`
      : `<i class="fas ${icon} spt-signal off" title="${t("Net.NoSignalShort")}"></i>`;
    const uuid = p.item.uuid;
    const linked = viaSatellite(phone) && (!!liveOn(uuid) || (outgoing?.itemUuid === uuid && !outgoing.done && !!outgoing.satLinked) || skyOpenFor(p));
    const sat = `<i class="fas fa-satellite spt-sat-signal ${linked ? "linked" : ""}" title="${t("Satellite.Signal")}"></i>`;
    return `${gsm}${sat}`;
  }
};
