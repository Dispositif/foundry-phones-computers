import { moduleVersion } from "../constants.js";
import { displayName, hasSignal, phoneImages, shownTheme, isComputer, isSatellite, isSecure, modelOf, msgOn } from "../devices.js";
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
      p.phone.model === "smartphone" ? { action: "images", icon: "fa-images", label: t("Menu.Images") } : null,
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

  /** Images app: every image sent or received by message, newest first (built from the history, nothing stored). */
  _renderImages(p) {
    const tiles = phoneImages(p.phone, { includePending: this.gm })
      .map((e) => `<img class="spt-gallery-img" src="${esc(e.att.src)}" data-action="photo" data-id="${esc(e.id ?? String(e.t))}" title="${esc(displayName(p.phone, e.with))}" loading="lazy">`)
      .join("");
    return `<header class="spt-phone-top conv">
        <a data-action="openMenu" title="${t("Back")}"><i class="fas fa-chevron-left"></i></a>
        <strong>${t("Menu.Images")}</strong><span></span>
      </header>
      ${tiles ? `<div class="spt-gallery">${tiles}</div>` : `<p class="spt-phone-empty">${t("Menu.NoImage")}</p>`}`;
  },

  /** One image of the gallery, on the screen: show it to the other PCs, or open it full screen. */
  _renderPhoto(p) {
    const e = phoneImages(p.phone, { includePending: this.gm }).find((x) => (x.id ?? String(x.t)) === this._state.key);
    if (!e) return this._renderImages(p);
    const id = esc(e.id ?? String(e.t));
    const show = this.gm ? "" : `<a data-action="showEntry" data-id="${id}" title="${t("Share.ShowScreen")}"><i class="fas fa-eye"></i></a>`;
    return `<header class="spt-phone-top conv">
        <a data-action="photoBack" title="${t("Back")}"><i class="fas fa-chevron-left"></i></a>
        <strong>${esc(displayName(p.phone, e.with))}</strong>
        <span class="spt-top-actions"><a class="spt-photo-full" data-att-img="${esc(e.att.src)}" title="${t("Files.Enlarge")}"><i class="fas fa-expand"></i></a>${show}</span>
      </header>
      <div class="spt-photo"><img src="${esc(e.att.src)}" data-att-img="${esc(e.att.src)}" title="${t("Enlarge")}"></div>`;
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
