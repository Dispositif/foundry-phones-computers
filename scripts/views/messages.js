import { attChipHtml, attHtml } from "../attachments.js";
import { conversations, displayName, findContact, getLog, isComputer, isFixed, isPager, modelOf, msgOn, npcDirectory, publicDevices, sameConv, skinOf } from "../devices.js";
import { t } from "../i18n.js";
import { esc, isMasked, nl2br, shieldIcon } from "../util.js";
/* Player window: Conversations: list, thread, new message, GM preparation. */

/** Stable case reference, derived from the message id (e.g. 27-B-4417). */
export function caseRef(e) {
  let h = 0;
  for (const c of String(e.id ?? e.t)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `${10 + (h % 90)}-${"ABCDFGHKMNPRST"[(h >>> 7) % 14]}-${String((h >>> 11) % 10000).padStart(4, "0")}`;
}

/** Entry types the GM can write into a history (preparation). */
export const GM_ENTRY_TYPES = {
  smsIn: { get label() { return t("Prep.smsIn"); }, kind: "sms", entry: { kind: "sms", dir: "in" } },
  smsOut: { get label() { return t("Prep.smsOut"); }, kind: "sms", entry: { kind: "sms", dir: "out" } },
  callMissed: { get label() { return t("Prep.callMissed"); }, kind: "call", entry: { kind: "call", dir: "in", result: "missed" } },
  callIn: { get label() { return t("Prep.callIn"); }, kind: "call", entry: { kind: "call", dir: "in", result: "answer" } },
  callOut: { get label() { return t("Prep.callOut"); }, kind: "call", entry: { kind: "call", dir: "out", result: "answer" } }
};

export function callLabel(e) {
  if (e.dir === "out") {
    const out = ["answer", "unassigned", "unreachable", "cancelled", "busy", "neterror"];
    return t(`CallLog.out.${out.includes(e.result) ? e.result : "noanswer"}`);
  }
  return t(`CallLog.in.${["answer", "decline"].includes(e.result) ? e.result : "missed"}`);
}

/** Public directory numbers (yellow pages): any agent can find them by name. */
export function publicOptions() {
  return [...npcDirectory().filter((e) => e.pub && e.number && !e.off), ...publicDevices().filter((d) => d.name)]
    .map((e) => `<option value="${esc(e.name)}" label="${esc(e.number)}"></option>`)
    .join("");
}

/** "New" button of the conversation list: call and/or message, depending on what the device can do. */
export function composeLabel(phone, gm) {
  if (gm) return `<i class="fas fa-pen-to-square"></i> ${t("NewConversation")}`;
  if (isComputer(phone)) return `<i class="fas fa-pen-to-square"></i> ${t("NewMail")}`;
  const sms = msgOn(phone);
  const calls = !modelOf(phone).noCalls;
  if (sms && calls) return `<i class="fas fa-phone"></i><i class="fas fa-comment-sms"></i> ${t("CallOrMessage")}`;
  if (sms) return `<i class="fas fa-comment-sms"></i> ${t("NewMessage")}`;
  return `<i class="fas fa-phone"></i> ${t("Dial")}`;
}

/** Methods of the player window (PlayerPhone), mixed into its prototype: `this` is the window. */
export const messageViews = {
  /** Attachment inside a bubble: an image, or a document card that opens on the device. */
  _attHtml(e) {
    if (e.att?.type !== "doc") return attHtml(e.att);
    return `<a class="spt-att-card" data-action="openDoc" data-id="${esc(e.id ?? String(e.t))}"><i class="fas fa-file-lines"></i><span><strong>${esc(e.att.name ?? t("Document"))}</strong><small>${t("Files.Open")}</small></span></a>`;
  },

  _renderList(p, mine) {
    const convs = conversations(p.phone, { team: false });
    const rows = convs
      .map((c) => {
        const last = c.entries[0];
        const preview = !last
          ? `<em>${t("NoMessage")}</em>`
          : last.kind === "sms"
            ? `${last.dir === "out" ? `${t("You")} : ` : ""}${last.att ? '<i class="fas fa-paperclip"></i> ' : ""}${esc(last.text || (last.att ? t("Attachment") : ""))}`
            : `<i class="fas fa-phone"></i> ${callLabel(last)}`;
        return `<li class="spt-conv ${c.unread ? "unread" : ""}" data-action="open" data-key="${esc(c.key)}">
            <div class="spt-conv-head"><strong>${esc(displayName(p.phone, c.key))}</strong></div>
            <div class="spt-conv-preview">${preview}</div>
            ${c.unread ? `<span class="spt-badge">${c.unread}</span>` : ""}
          </li>`;
      })
      .join("");
    return `${this._renderHeader(p, mine)}${this._tabsHtml(p)}
      <ul class="spt-conv-list">${rows || `<li class="spt-phone-empty">${t("NoConversation")}</li>`}</ul>
      <footer class="spt-phone-foot spt-phone-row">${this._canEditContacts(p) ? `<button type="button" class="spt-icon-btn" data-action="contacts" title="${t("Contacts.Title")}" aria-label="${t("Contacts.Title")}"><i class="fas fa-address-book"></i></button>` : ""}<button type="button" data-action="compose">${composeLabel(p.phone, this.gm)}</button></footer>`;
  },

  _renderConv(p) {
    const key = this._state.key;
    const entries = getLog(p.phone, { includePending: this.gm })
      .filter((e) => sameConv(p.phone, e.with, key))
      .reverse();
    // Delete: the GM any entry; the player their own messages and calls, except the operator's welcome (it holds the player guide)
    // Only on a carried phone: never on a laptop, a terminal or an installed device.
    const playerDel = !isComputer(p.phone) && !isFixed(p.phone);
    const del = (e) => (this.gm || (playerDel && !e.help && !e.pending) ? `<a class="spt-del" data-action="gmDelete" data-id="${e.id ?? ""}" data-t="${e.t}" title="${t("Delete")}"><i class="fas fa-xmark"></i></a>` : "");
    // Player: show screen / forward, on each message.
    const share = (e) => {
      if (this.gm || e.pending) return "";
      const id = esc(e.id ?? String(e.t));
      return `<span class="spt-share"><a data-action="showEntry" data-id="${id}" title="${t("Share.ShowScreen")}"><i class="fas fa-eye"></i></a><a data-action="fwdEntry" data-id="${id}" title="${t("Fwd.Forward")}"><i class="fas fa-share"></i></a></span>`;
    };
    // Encrypted message (secure line): a small shield.
    // An <i>, not a <span>: bubble spans are full-width blocks that would cover the share icons.
    const secureTag = (e) => (e.secure ? shieldIcon({ title: t("Secure.Message"), cls: "spt-secure-tag" }) : "");
    const fwdTag = (e) => (e.fwd ? `<span class="spt-fwd"><i class="fas fa-share"></i> ${t("Fwd.Forwarded")}</span>` : "");
    // Federal look: each email becomes a case file, with a stable reference and a stamp on received ones.
    const federal = skinOf(p.phone) === "federal";
    const fileTag = (e) => (federal ? `<span class="spt-ref">${t("Theme.Ref")} ${caseRef(e)}</span>${e.dir === "in" ? `<span class="spt-stamp">${t("Theme.Confidential")}</span>` : ""}` : "");
    const bubbles = entries
      .map((e) =>
        e.kind === "sms"
          ? `<div class="spt-bubble ${e.dir} ${e.nosat ? "spt-failed" : ""}">${fileTag(e)}${del(e)}${share(e)}${fwdTag(e)}${secureTag(e)}${this._attHtml(e)}${e.text ? `<div>${nl2br(e.text)}</div>` : ""}${e.nosat ? `<span class="spt-notsent"><i class="fas fa-satellite"></i> ${t("Satellite.NotSent")}${this.gm || !e.id ? "" : ` · <a data-action="retrySms" data-id="${esc(e.id)}">${t("Satellite.Retry")}</a>`}</span>` : ""}${e.help ? `<a class="spt-help-link" data-action="playerGuide"><i class="fas fa-circle-question"></i> ${t("Guide.Link")}</a>` : ""}${this.gm && e.dir === "in" && !e.prep ? `<span class="spt-read ${e.read === false ? "unread" : ""}">${e.pending ? t("Read.Pending") : e.read === false ? t("Read.Unread") : t("Read.Seen")}</span>` : ""}</div>`
          : `<div class="spt-call-line"><i class="fas ${e.result === "answer" ? "fa-phone" : "fa-phone-slash"}"></i> ${callLabel(e)} ${del(e)}</div>`
      )
      .join("");
    const masked = isMasked(key);
    // Unknown correspondent, or a team contact (computed): offer to name it in the player's own contacts.
    const contact = masked ? null : findContact(p.phone, key);
    const addBtn = !masked && (!contact || contact.team) && this._canEditContacts(p)
      ? `<a data-action="addContact" title="${t("Contacts.Add")}"><i class="fas fa-user-plus"></i></a>`
      : "";
    const composer = this.gm
      ? this._gmComposer(2)
      : !msgOn(p.phone)
      ? ""
      : masked
      ? `<p class="spt-phone-empty">${t("Warn.CantReplyMasked")}</p>`
      : `<div class="spt-composer"><textarea name="draft" rows="2" placeholder="${t("MessagePlaceholder")}">${esc(this._state.draft)}</textarea>
           <button type="button" data-action="send" title="${t("Send")}"><i class="fas fa-paper-plane"></i></button></div>`;
    return `<header class="spt-phone-top conv">
        <a data-action="back" title="${t("Back")}"><i class="fas fa-chevron-left"></i></a>
        <strong>${esc(displayName(p.phone, key))}${!masked && displayName(p.phone, key) !== key ? `<small class="spt-conv-num">${esc(key)}</small>` : ""}</strong>
        <span class="spt-top-actions">${addBtn}${this.gm || !entries.length ? "" : `<a data-action="showConv" title="${t("Share.ShowConversation")}"><i class="fas fa-eye"></i></a>`}${masked || this.gm || modelOf(p.phone).noCalls ? "" : `<a data-action="call" title="${t("Call.Call")}"><i class="fas fa-phone"></i></a>`}</span>
      </header>
      <div class="spt-thread ${isComputer(p.phone) ? "mail" : ""}">${bubbles || `<p class="spt-phone-empty">${t("NoMessage")}.</p>`}</div>
      ${composer}`;
  },

  _renderNew(p) {
    const known = conversations(p.phone)
      .filter((c) => !isMasked(c.key))
      .map((c) => `<option value="${esc(displayName(p.phone, c.key))}">`)
      .join("") + publicOptions();
    return `<header class="spt-phone-top conv">
        <a data-action="back" title="${t("Back")}"><i class="fas fa-chevron-left"></i></a>
        <strong>${this.gm ? t("NewConversation") : isComputer(p.phone) ? t("NewMail") : msgOn(p.phone) && !modelOf(p.phone).noCalls ? t("CallOrMessage") : msgOn(p.phone) ? t("NewMessage") : t("Dial")}</strong><span></span>
      </header>
      <div class="spt-new">
        <input type="text" name="to" list="spt-known" value="${esc(this._state.to)}" placeholder="${this.gm ? t("Gm.CorrespondentPlaceholder") : t("ToPlaceholder")}">
        <datalist id="spt-known">${known}</datalist>
        ${this.gm
          ? this._gmComposer(5)
          : `${msgOn(p.phone) ? `<textarea name="draft" rows="${isComputer(p.phone) ? 9 : 5}" placeholder="${isComputer(p.phone) ? t("MailPlaceholder") : t("MessagePlaceholder")}">${esc(this._state.draft)}</textarea>` : ""}
        <div class="spt-phone-row">
          ${msgOn(p.phone) ? `<button type="button" data-action="send"><i class="fas fa-paper-plane"></i> ${t("Send")}</button>` : ""}
          ${modelOf(p.phone).noCalls ? "" : `<button type="button" data-action="call"><i class="fas fa-phone"></i> ${t("Call.Call")}</button>`}
        </div>`}
      </div>`;
  },

  /** GM: writes into the history (nothing is sent, no notification). */
  _gmComposer(rows) {
    const cur = this._current()?.phone;
    // A pager only receives: no outgoing entries.
    const types = Object.entries(GM_ENTRY_TYPES).filter(([, ty]) => (ty.kind === "call" ? !modelOf(cur).noCalls : msgOn(cur) && !(isPager(cur) && ty.entry.dir === "out")));
    if (!types.some(([k]) => k === this._state.entryType)) this._state.entryType = types[0][0];
    const opts = types
      .map(([k, ty]) => `<option value="${k}" ${k === this._state.entryType ? "selected" : ""}>${ty.label}</option>`)
      .join("");
    return `<div class="spt-gm-composer spt-drop" title="${t("DropHere")}">
        <select name="entryType">${opts}</select>
        ${attChipHtml(this._state.att)}
        <textarea name="draft" rows="${rows}" placeholder="${t("Prep.TextPlaceholder")}">${esc(this._state.draft)}</textarea>
        <div class="spt-phone-row">
          <button type="button" data-action="attach" title="${t("AttachImage")}" class="spt-icon-btn"><i class="fas fa-paperclip"></i></button>
          <button type="button" data-action="send"><i class="fas fa-plus"></i> ${t("Prep.Add")}</button>
        </div>
      </div>`;
  }
};
