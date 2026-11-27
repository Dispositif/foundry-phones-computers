import { moduleVersion } from "../constants.js";
import { hasSignal, shownTheme, isComputer, isSatellite, isSecure, modelOf, msgOn } from "../devices.js";
import { t } from "../i18n.js";
import { operatorName } from "../names.js";
import { esc } from "../util.js";
/* Player window: the device's general menu (smartphone: Menu button in the header; mobile: the keypad's middle key). */

/** Methods of the player window (PlayerPhone), mixed into its prototype: `this` is the window. */
export const menuViews = {
  /** Phones only (no computer, no landline): the menu has something to offer. */
  _hasMenu(p) {
    return !!p && !isComputer(p.phone) && ["smartphone", "mobile", "satphone"].includes(p.phone.model);
  },

  _renderMenu(p) {
    const items = [
      { action: "back", icon: msgOn(p.phone) ? "fa-comment" : "fa-phone", label: msgOn(p.phone) && !modelOf(p.phone).noCalls ? t("Menu.MessagesCalls") : msgOn(p.phone) ? t("Menu.Messages") : t("Menu.Calls") },
      this._canEditContacts(p) ? { action: "contacts", icon: "fa-address-book", label: t("Contacts.Title") } : null,
      { action: "info", icon: "fa-circle-info", label: t("Menu.Info") },
      this.gm ? null : { action: "menuPowerOff", icon: "fa-power-off", label: t("PowerOff") },
      this.gm ? null : { action: "playerGuide", icon: "fa-circle-question", label: t("Guide.Title") }
    ].filter(Boolean);
    const rows = items
      .map((i) => `<li data-action="${i.action}"><i class="fas ${i.icon}"></i><span>${i.label}</span></li>`)
      .join("");
    return `<header class="spt-phone-top conv">
        <a data-action="back" title="${t("Back")}"><i class="fas fa-chevron-left"></i></a>
        <strong>${t("Menu.Title")}</strong><span></span>
      </header>
      <ul class="spt-menu">${rows}</ul>`;
  },

  /** About this device: what it is, its number, its operator and network. */
  _renderInfo(p) {
    const ph = p.phone;
    const net = hasSignal(ph) && game.users.activeGM;
    const rows = [
      // The module's version as the phone's model number, then its look.
      [t("Menu.Type"), `${`${modelOf(ph).label} ${moduleVersion()}`.trim()} · ${t(`Theme.${shownTheme(ph.theme, ph.model)}`)}`],
      [t("Menu.Name"), ph.label],
      [t("Menu.Number"), ph.number],
      [t("Menu.Operator"), operatorName(ph)],
      [t("Menu.Network"), net ? t("Net.Signal") : t("Net.NoSignalShort")],
      isSatellite(ph) ? [t("Satellite.Signal"), t("Menu.Yes")] : null,
      isSecure(ph) ? [t("Menu.Security"), t("Secure.Device")] : null
    ].filter((r) => r && r[1]);
    return `<header class="spt-phone-top conv">
        <a data-action="openMenu" title="${t("Back")}"><i class="fas fa-chevron-left"></i></a>
        <strong>${t("Menu.Info")}</strong><span></span>
      </header>
      <dl class="spt-info">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
  }
};
