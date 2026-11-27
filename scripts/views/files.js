import { filesOf, inboxOf, isComputer, playerUnread } from "../devices.js";
import { findFile, loadEntryDoc, loadFile } from "../files.js";
import { t } from "../i18n.js";
import { findEntry } from "../share.js";
import { deviceNotice, esc } from "../util.js";
/* Player window: Computer files and documents read inside the screen. */

/** Methods of the player window (PlayerPhone), mixed into its prototype: `this` is the window. */
export const fileViews = {
  /** Computer tab: mailbox or files. Without a mailbox, a player only has the files. */
  _tab(p) {
    const inbox = inboxOf(p.phone);
    if (!this.gm && inbox === "none") return "files";
    return this._state.tab ?? (this.gm || inbox === "on" ? "inbox" : "files");
  },

  _tabsHtml(p) {
    if (!isComputer(p.phone)) return "";
    const inbox = inboxOf(p.phone);
    if (!this.gm && inbox === "none") return "";
    const tab = this._tab(p);
    const unread = this.gm ? 0 : playerUnread(p.phone);
    const icon = { on: "fa-envelope", locked: "fa-lock", none: "fa-ban" }[inbox] ?? "fa-envelope";
    const hint = inbox === "on" ? "" : ` title="${t(`Form.Inbox_${inbox}`)}"`;
    const n = filesOf(p.phone, { gm: this.gm }).length;
    return `<nav class="spt-dtabs">
        <a class="${tab === "inbox" ? "active" : ""}" data-action="dtab" data-tab="inbox"${hint}><i class="fas ${icon}"></i> ${t("Files.Inbox")}${unread ? ` <span class="spt-badge">${unread}</span>` : ""}</a>
        <a class="${tab === "files" ? "active" : ""}" data-action="dtab" data-tab="files"><i class="fas fa-folder"></i> ${t("Files.Tab")} <small>${n}</small></a>
      </nav>`;
  },

  _renderFiles(p, mine) {
    const canFwd = inboxOf(p.phone) === "on";
    const rows = filesOf(p.phone, { gm: this.gm })
      .map((f) => {
        const id = esc(f.id);
        const icon = f.type === "image" ? "fa-file-image" : "fa-file-lines";
        const kind = f.type === "image" ? t("Files.Image") : t("Document");
        const acts = this.gm
          ? `<span class="spt-file-acts gm">
              <a data-action="gmFileLock" data-id="${id}" class="${f.locked ? "on" : ""}" title="${f.locked ? t("Files.Unlock") : t("Files.Lock")}"><i class="fas ${f.locked ? "fa-lock" : "fa-lock-open"}"></i></a>
              <a data-action="gmFileHide" data-id="${id}" class="${f.hidden ? "on" : ""}" title="${f.hidden ? t("Files.Reveal") : t("Files.Hide")}"><i class="fas ${f.hidden ? "fa-eye-slash" : "fa-eye"}"></i></a>
              <a data-action="gmFileRename" data-id="${id}" title="${t("Files.Rename")}"><i class="fas fa-pen"></i></a>
              <a data-action="gmFileDelete" data-id="${id}" title="${t("Delete")}"><i class="fas fa-trash"></i></a>
            </span>`
          : f.locked
          ? `<i class="fas fa-lock spt-file-lock" title="${t("Files.Denied")}"></i>`
          : `<span class="spt-file-acts">
              <a data-action="fileShow" data-id="${id}" title="${t("Share.ShowScreen")}"><i class="fas fa-eye"></i></a>
              ${canFwd ? `<a data-action="fileFwd" data-id="${id}" title="${t("Fwd.Forward")}"><i class="fas fa-share"></i></a>` : ""}
            </span>`;
        return `<li class="spt-file ${f.locked ? "locked" : ""} ${f.hidden ? "spt-file-hidden" : ""}" data-action="openFile" data-id="${id}">
            <i class="fas ${icon} spt-file-icon"></i>
            <span class="spt-file-name"><strong>${esc(f.name)}</strong><small>${kind}</small></span>
            ${acts}
          </li>`;
      })
      .join("");
    const foot = this.gm
      ? `<footer class="spt-phone-foot spt-file-foot">
          <div class="spt-filedrop"><i class="fas fa-file-import"></i> ${t("Files.Drop")} · <a data-action="gmFileImage"><i class="fas fa-image"></i> ${t("Files.PickImage")}</a></div>
        </footer>`
      : "";
    return `${this._renderHeader(p, mine)}${this._tabsHtml(p)}
      <ul class="spt-files">${rows || `<li class="spt-phone-empty">${t("Files.Empty")}</li>`}</ul>
      ${foot}`;
  },

  async _openFile(id) {
    const p = this._current();
    const f = p && findFile(p.phone, id);
    if (!f || (!this.gm && f.hidden)) return;
    if (!this.gm && f.locked) return deviceNotice(t("Files.Denied"), { warn: true });
    this._state.view = "file";
    this._state.file = { id };
    this._rerender();
    const html = await loadFile(p.item, f);
    if (this._state.file?.id !== id) return;
    this._state.file = { id, html };
    this._rerender();
  },

  /** A file opened inside the screen: the journal's content or the image, never the Foundry sheet. */
  _renderFile(p, mine) {
    const f = findFile(p.phone, this._state.file?.id);
    if (!f || (!this.gm && (f.locked || f.hidden))) {
      this._state.view = "list";
      this._state.file = null;
      return this._renderFiles(p, mine);
    }
    const html = this._state.file.html;
    const body = html === undefined
      ? `<p class="spt-phone-empty"><i class="fas fa-spinner fa-spin"></i> ${t("Files.Loading")}</p>`
      : html === null
      ? `<p class="spt-phone-empty">${t("Files.Unavailable")}</p>`
      : html;
    const id = esc(f.id);
    const enlarge = html ? `<a data-action="enlarge" title="${t("Files.Enlarge")}"><i class="fas fa-expand"></i></a>` : "";
    const acts = this.gm || !html ? enlarge : `${enlarge}<a data-action="fileShow" data-id="${id}" title="${t("Share.ShowScreen")}"><i class="fas fa-eye"></i></a>${inboxOf(p.phone) === "on" ? `<a data-action="fileFwd" data-id="${id}" title="${t("Fwd.Forward")}"><i class="fas fa-share"></i></a>` : ""}`;
    return `<header class="spt-phone-top conv">
        <a data-action="back" title="${t("Back")}"><i class="fas fa-chevron-left"></i></a>
        <strong>${esc(f.name)}</strong>
        <span class="spt-top-actions">${acts}</span>
      </header>
      <div class="spt-fileview">${body}</div>`;
  },

  async _openDoc(entryId) {
    const p = this._current();
    const e = p && findEntry(p.phone, entryId);
    if (e?.att?.type !== "doc") return;
    this._state.view = "doc";
    this._state.file = { entryId };
    this._rerender();
    const html = await loadEntryDoc(p.item, e);
    if (this._state.file?.entryId !== entryId) return;
    this._state.file = { entryId, html };
    this._rerender();
  },

  /** A journal attached to a message, read inside the screen. Back returns to the conversation. */
  _renderDoc(p) {
    const st = this._state.file;
    const e = st?.entryId ? findEntry(p.phone, st.entryId) : null;
    if (!e) {
      this._state.view = this._state.key ? "conv" : "list";
      this._state.file = null;
      return this._state.key ? this._renderConv(p) : this._renderList(p, this._mine());
    }
    const html = st.html;
    const body = html === undefined
      ? `<p class="spt-phone-empty"><i class="fas fa-spinner fa-spin"></i> ${t("Files.Loading")}</p>`
      : html === null
      ? `<p class="spt-phone-empty">${t("Files.Unavailable")}</p>`
      : html;
    const id = esc(st.entryId);
    const acts = !html ? "" : `<a data-action="enlarge" title="${t("Files.Enlarge")}"><i class="fas fa-expand"></i></a>${this.gm ? "" : `<a data-action="showEntry" data-id="${id}" title="${t("Share.ShowScreen")}"><i class="fas fa-eye"></i></a><a data-action="fwdEntry" data-id="${id}" title="${t("Fwd.Forward")}"><i class="fas fa-share"></i></a>`}`;
    return `<header class="spt-phone-top conv">
        <a data-action="docBack" title="${t("Back")}"><i class="fas fa-chevron-left"></i></a>
        <strong>${esc(e.att.name ?? t("Document"))}</strong>
        <span class="spt-top-actions">${acts}</span>
      </header>
      <div class="spt-fileview">${body}</div>`;
  },

  /** Mailbox locked by the GM: the tab is there, the content is not. */
  _renderInboxLocked(p, mine) {
    return `${this._renderHeader(p, mine)}${this._tabsHtml(p)}
      <div class="spt-lockscreen spt-inbox-locked"><i class="fas fa-lock"></i><p>${t("Files.Restricted")}</p><small>${t("Files.RestrictedHint")}</small></div>`;
  }
};
