import { moduleVersion } from "../constants.js";
import { hasSignal, isComputer, skinOf, unreadCount } from "../devices.js";
import { keypad, rotaryDial } from "../dialer.js";
import { t, tn } from "../i18n.js";
import { otherEnd, statusHtml } from "../live-call.js";
import { bootText } from "../names.js";
import { esc, shieldIcon } from "../util.js";
import { publicOptions } from "./messages.js";
/* Player window: Call screens, switched off, starting up, locked, landline dialer. */

/** Modern landline display on the line: the other end's number, like while it rang (a name only when there is no number to show). */
export function lcdCaller(other) {
  return other.sub || other.name;
}

/** Methods of the player window (PlayerPhone), mixed into its prototype: `this` is the window. */
export const screenViews = {
  /** Incoming call on a smartphone or mobile: shown on its own screen, even when locked. */
  _renderIncoming(p, mine, { caller, known, silent, img, secure }) {
    return `${this._renderHeader(p, mine)}
      <div class="spt-lockscreen spt-incoming">
        <div class="spt-phone-ring ${silent ? "silent" : ""}">
          ${img ? `<div class="spt-live-face spt-ring-face" style="background-image:url('${esc(img)}')"></div>` : `<i class="fas fa-phone-volume"></i>`}
          <p class="spt-caller">${caller ? esc(caller) : t("Call.Ringing")}</p>
          ${known ? `<p>${t("Call.IsCalling")}</p>` : ""}
          ${secure ? `<p class="spt-ring-secure">${shieldIcon()} ${t("Secure.Line")}</p>` : ""}
        </div>
        <div class="spt-incoming-keys">
          <button type="button" class="spt-decline" data-action="decline" title="${t("Call.Decline")}"><i class="fas fa-phone-slash"></i><span class="spt-key-label">${t("Call.Decline")}</span></button>
          <button type="button" class="spt-answer" data-action="answer" title="${t("Call.Answer")}"><i class="fas fa-phone"></i><span class="spt-key-label">${t("Call.Answer")}</span></button>
        </div>
      </div>`;
  },

  /** Call in progress on a smartphone or mobile: the other end (face on a smartphone), the time on the line. */
  _renderLive(p, mine, live) {
    const o = otherEnd(live, p.item.uuid);
    const face = p.phone.model !== "smartphone" ? `<i class="fas fa-phone"></i>`
      : o.img ? `<div class="spt-live-face" style="background-image:url('${esc(o.img)}')"></div>`
      : `<div class="spt-live-face unknown"><i class="fas fa-user"></i></div>`;
    return `${this._renderHeader(p, mine)}
      <div class="spt-lockscreen spt-incoming spt-live-screen">
        <div class="spt-phone-ring">
          <p class="spt-live-status">${statusHtml(live)}</p>
          ${face}
          <p class="spt-caller">${esc(o.name)}</p>
          ${o.sub ? `<p class="spt-live-sub">${esc(o.sub)}</p>` : ""}
        </div>
        <div class="spt-incoming-keys">
          ${live.ended
            ? `<button type="button" class="spt-dismiss" data-action="liveDismiss" title="${t("Close")}"><i class="fas fa-xmark"></i><span class="spt-key-label">${t("Close")}</span></button>`
            : `<button type="button" class="spt-decline" data-action="liveHangup" title="${t("Call.HangUp")}"><i class="fas fa-phone-slash"></i><span class="spt-key-label">${t("Call.HangUp")}</span></button>`}
        </div>
      </div>`;
  },

  /** Outgoing call on a smartphone or mobile: who is called, and a hang-up key. */
  _renderOutgoing(p, mine, { name, img, face, searching }) {
    // The dialed number does not stay on the screen once the call is over.
    this._state.to = "";
    // Smartphone: the face of who is called if the agent knows them, otherwise an empty portrait.
    const pic = !face ? `<i class="fas fa-phone"></i>`
      : img ? `<div class="spt-live-face" style="background-image:url('${esc(img)}')"></div>`
      : `<div class="spt-live-face unknown"><i class="fas fa-user"></i></div>`;
    return `${this._renderHeader(p, mine)}
      <div class="spt-lockscreen spt-incoming spt-live-screen">
        <div class="spt-phone-ring outgoing">
          <p class="spt-live-status">${searching
            ? `<span class="spt-live-state dialing spt-sat-search"><i class="fas fa-satellite"></i> ${t("Satellite.Searching")}</span>`
            : `<span class="spt-live-state dialing"><i class="fas fa-circle"></i> ${t("Call.Calling")}</span>`}</p>
          ${pic}
          <p class="spt-caller">${esc(name)}</p>
        </div>
        <div class="spt-incoming-keys">
          <button type="button" class="spt-decline" data-action="outHangup" title="${t("Call.HangUp")}"><i class="fas fa-phone-slash"></i><span class="spt-key-label">${t("Call.HangUp")}</span></button>
        </div>
      </div>`;
  },

  /** Device switched off: a dark screen, nothing from its history or contacts. */
  _renderOff(p, mine) {
    // A blank screen, switched on again with the header's power button only.
    return `${this._renderHeader(p, mine)}<div class="spt-lockscreen spt-offscreen"></div>`;
  },

  /** Just switched on: the operator's name (or "No signal"). */
  _renderBoot(p, mine) {
    const signal = hasSignal(p.phone) && !!game.users.activeGM;
    return `${this._renderHeader(p, mine)}
      <div class="spt-lockscreen spt-bootscreen">
        <i class="fas fa-signal ${signal ? "" : "spt-signal off"}"></i>
        <p class="spt-operator">${esc(bootText(p.phone))}</p>
        ${moduleVersion() ? `<p class="spt-boot-version">${esc(moduleVersion())}</p>` : ""}
      </div>`;
  },

  _renderLocked(p, mine) {
    const phoneSel = this._deviceTitle(p);
    const unread = unreadCount(p.phone);
    const federal = skinOf(p.phone) === "federal";
    // Terminals (any look) and the federal look show an inactive login form.
    const login = federal || p.phone.model === "desktop";
    const icon = federal ? "fa-id-card" : login ? "fa-user-lock" : "fa-lock";
    const text = federal ? t("Theme.IdRequired") : isComputer(p.phone) ? t("Lock.Session") : t("Warn.Locked");
    const user = federal ? t("Theme.AgentId") : t("Lock.User");
    return `<header class="spt-phone-top">${phoneSel}</header>
      <div class="spt-lockscreen">
        <i class="fas ${icon}"></i>
        ${isComputer(p.phone) ? `<small class="spt-hostname">${esc(p.phone.label ?? "")}</small>` : ""}
        <p>${text}</p>
        ${login ? `<input type="text" class="spt-fake-login" placeholder="${user}" readonly tabindex="-1"><input type="password" class="spt-fake-login" placeholder="••••••••" readonly tabindex="-1">` : ""}
        ${unread ? `<p class="spt-lock-notif">${tn("Unread", unread)}</p>` : ""}
      </div>`;
  },

  /** Landline dialer. While it rings (modern look), the display shows the caller's number and the keys answer or hang up. */
  _renderDialer(p, mine, incoming = null, live = null) {
    this._state.view = "new";
    // Empty display after a call, and on another device than the one last dialed from.
    if (live || incoming || this._state.dialFor !== p.item.uuid) this._state.to = "";
    this._state.dialFor = p.item.uuid;
    const strip = live
      ? `<div class="spt-dial-strip spt-lcd-ringing spt-lcd-live">
          <input type="text" value="${esc(skinOf(p.phone) === "modern" ? lcdCaller(otherEnd(live, p.item.uuid)) : "")}" placeholder="${t("Live.OnLine")}" readonly tabindex="-1">
          <i class="fas fa-phone"></i>
        </div>`
      : incoming
      ? `<div class="spt-dial-strip spt-lcd-ringing">
          <input type="text" value="${esc(incoming.caller ?? "")}" placeholder="${t("Call.Ringing")}" readonly tabindex="-1">
          ${incoming.secure ? shieldIcon({ title: t("Secure.Line") }) : ""}<i class="fas fa-phone-volume"></i>
        </div>`
      : `<div class="spt-dial-strip">
          <input type="text" name="to" list="spt-yellow" value="${esc(this._state.to)}" placeholder="${t("Number")}" autocomplete="off">
          <datalist id="spt-yellow">${publicOptions()}</datalist>
          <button type="button" data-action="dialBack" title="${t("Delete")}"><i class="fas fa-delete-left"></i></button>
        </div>`;
    const keys = live
      ? `<div class="spt-phone-row spt-incoming-row">
          <button type="button" class="spt-decline" data-action="liveHangup"><i class="fas fa-phone-slash"></i> ${t("Call.HangUp")}</button>
        </div>`
      : incoming
      ? `<div class="spt-phone-row spt-incoming-row">
          <button type="button" class="spt-answer" data-action="answer"><i class="fas fa-phone"></i> ${t("Call.Answer")}</button>
          <button type="button" class="spt-decline" data-action="decline"><i class="fas fa-phone-slash"></i> ${t("Call.HangUp")}</button>
        </div>`
      : `<div class="spt-phone-row"><button type="button" data-action="call" ${this.gm ? "disabled" : ""}><i class="fas fa-phone"></i> ${t("Call.Call")}</button></div>`;
    // Rotary landline: no device menu, only its number on a paper label stuck on the set.
    const rotary = skinOf(p.phone) !== "modern";
    const header = rotary ? `<header class="spt-phone-top spt-sticker-top"><span class="spt-number-sticker">${esc(p.phone.number ?? "")}</span></header>` : this._renderHeader(p, mine);
    return `${header}
      <div class="spt-new spt-dialer">
        ${rotary ? rotaryDial() : ""}
        ${strip}
        ${skinOf(p.phone) === "modern" ? keypad() : ""}
        ${keys}
      </div>`;
  }
};
