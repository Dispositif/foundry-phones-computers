import { MODULE_ID } from "../constants.js";
import { contactsOf, getPhoneData, modelOf, msgOn } from "../devices.js";
import { t } from "../i18n.js";
import { esc } from "../util.js";
/* Player window: the address book, inside the device (list with search, contact sheet). */

/** Sorted by name, own contacts first kept with their index in the stored list (team contacts have none). */
function sortedContacts(phone) {
  const own = (phone.contacts ?? []).map((c, i) => ({ ...c, idx: i }));
  const all = contactsOf(phone).map((c) => (c.team ? c : own.find((o) => o.name === c.name && o.number === c.number) ?? c));
  return all.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/** Methods of the player window (PlayerPhone), mixed into its prototype: `this` is the window. */
export const contactViews = {
  _renderContacts(p) {
    const calls = !modelOf(p.phone).noCalls;
    const sms = msgOn(p.phone);
    const q = (this._state.q ?? "").trim().toLocaleLowerCase();
    const rows = sortedContacts(p.phone)
      .map((c) => {
        const key = c.number || c.name;
        const hay = `${c.name} ${c.number ?? ""}`.toLocaleLowerCase();
        const open = c.team ? `data-action="open" data-key="${esc(key)}"` : `data-action="contactEdit" data-idx="${c.idx}"`;
        return `<li class="spt-conv spt-contact" data-search="${esc(hay)}" ${q && !hay.includes(q) ? "hidden" : ""}>
            <div class="spt-contact-main" ${open}>
              <strong>${esc(c.name)}${c.team ? ` <i class="fas fa-users spt-contact-team" title="${t("Contacts.Team")}"></i>` : ""}</strong>
              ${c.number ? `<small>${esc(c.number)}</small>` : ""}
            </div>
            <span class="spt-contact-acts">
              ${sms ? `<a data-action="open" data-key="${esc(key)}" title="${t("Contacts.Message")}"><i class="fas fa-comment"></i></a>` : ""}
              ${calls && c.number ? `<a data-action="contactCall" data-key="${esc(key)}" title="${t("Call.Call")}"><i class="fas fa-phone"></i></a>` : ""}
            </span>
          </li>`;
      })
      .join("");
    return `<header class="spt-phone-top conv">
        <a data-action="contactBack" title="${t("Back")}"><i class="fas fa-chevron-left"></i></a>
        <strong>${t("Contacts.Title")}</strong>
        <span class="spt-top-actions"><a data-action="contactNew" title="${t("Contacts.New")}"><i class="fas fa-plus"></i></a></span>
      </header>
      <div class="spt-contact-search"><i class="fas fa-magnifying-glass"></i><input type="search" name="q" value="${esc(this._state.q ?? "")}" placeholder="${t("Contacts.Search")}"></div>
      <ul class="spt-conv-list spt-contact-list">${rows || `<li class="spt-phone-empty">${t("Contacts.None")}</li>`}</ul>
      ${this.gm ? `<footer class="spt-phone-foot spt-contact-foot"><a data-action="contactsText"><i class="fas fa-file-lines"></i> ${t("Contacts.AsText")}</a></footer>` : ""}`;
  },

  _renderContact(p) {
    const c = this._state.contact ?? { name: "", number: "" };
    const saved = c.idx != null;
    const key = (c.number || c.name || "").trim();
    const calls = !modelOf(p.phone).noCalls;
    return `<header class="spt-phone-top conv">
        <a data-action="contactBack" title="${t("Back")}"><i class="fas fa-chevron-left"></i></a>
        <strong>${saved ? esc(c.name) : t("Contacts.New")}</strong><span></span>
      </header>
      <div class="spt-new spt-contact-sheet">
        <label>${t("Contacts.Name")}<input type="text" name="cname" value="${esc(c.name)}" autocomplete="off"></label>
        <label>${t("Contacts.Number")}<input type="text" name="cnum" value="${esc(c.number ?? "")}" autocomplete="off"></label>
        <div class="spt-phone-row">
          <button type="button" data-action="contactSave"><i class="fas fa-check"></i> ${t("Save")}</button>
          ${saved ? `<button type="button" data-action="contactDelete" class="spt-icon-btn" title="${t("Delete")}"><i class="fas fa-trash"></i></button>` : ""}
        </div>
        ${saved && key ? `<div class="spt-phone-row">
          ${msgOn(p.phone) ? `<button type="button" data-action="open" data-key="${esc(key)}"><i class="fas fa-comment"></i> ${t("Contacts.Message")}</button>` : ""}
          ${calls && c.number ? `<button type="button" data-action="contactCall" data-key="${esc(key)}"><i class="fas fa-phone"></i> ${t("Call.Call")}</button>` : ""}
        </div>` : ""}
      </div>`;
  },

  /** Opens the contact sheet: a stored contact (index), or a new one (prefilled, e.g. from a conversation). */
  _openContact(p, { idx = null, name = "", number = "", from = null } = {}) {
    const stored = idx != null ? (p.phone.contacts ?? [])[idx] : null;
    this._state.contact = stored ? { idx, name: stored.name, number: stored.number ?? "", from } : { idx: null, name, number, from };
    this._go("contact", this._state.key);
  },

  /** Back from the address book: to where it was opened from. */
  _contactBack() {
    const from = this._state.contact?.from;
    if (this._state.view === "contact" && !from) return this._go("contacts");
    this._state.contact = null;
    if (from) return this._go("conv", from);
    this._go("list");
  },

  async _saveContact(p) {
    this._readForm();
    const c = this._state.contact;
    const name = c?.name?.trim();
    const number = c?.number?.trim() ?? "";
    if (!name) return;
    const contacts = [...(getPhoneData(p.item).contacts ?? [])];
    if (c.idx != null && contacts[c.idx]) contacts[c.idx] = { name, number };
    else contacts.push({ name, number });
    await p.item.update({ [`flags.${MODULE_ID}.phone.contacts`]: contacts });
    const from = c.from;
    this._state.contact = null;
    if (from) return this._go("conv", from);
    this._go("contacts");
  },

  async _deleteContact(p) {
    const c = this._state.contact;
    if (c?.idx == null) return;
    const contacts = [...(getPhoneData(p.item).contacts ?? [])];
    contacts.splice(c.idx, 1);
    await p.item.update({ [`flags.${MODULE_ID}.phone.contacts`]: contacts });
    this._state.contact = null;
    this._go("contacts");
  },

  /** Search: filters the rows in place (no re-render, the field keeps its focus). */
  _bindContactSearch(el) {
    const input = el.querySelector(".spt-contact-search [name=q]");
    if (!input) return;
    input.addEventListener("input", () => {
      this._state.q = input.value;
      const q = input.value.trim().toLocaleLowerCase();
      for (const li of el.querySelectorAll(".spt-contact[data-search]")) li.hidden = !!q && !li.dataset.search.includes(q);
    });
  }
};
