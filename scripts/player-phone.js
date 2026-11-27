import { openAttachment, pickImage } from "./attachments.js";
import { ApplicationV2, MODULE_ID, SOCKET } from "./constants.js";
import { addLog, allPhones, displayName, findContact, getLog, getPhoneData, inboxOf, isComputer, isFixed, isLandline, isPager, isSatellite, isUnread, keyFor, markRead, modeOf, mutateLog, phoneLabel, playerUnread, sameConv, skinOf, SKINS } from "./devices.js";
import { DIAL_ANGLE, DIAL_DIGITS, DIAL_STOP } from "./dialer.js";
import { contactsDialog, editPhoneDialog, giveDialog, playerCanGive, playerGiveDialog } from "./dialogs.js";
import { loadLastDevice, myPhones, saveLastDevice } from "./fab.js";
import { addFile, findFile, loadEntryDoc, loadFile, patchFile, removeFile, renameFile } from "./files.js";
import { frameKind, FRAMES } from "./frames.js";
import { bindDrop, bindIconSelects } from "./gm-panel.js";
import { t } from "./i18n.js";
import { dismissEnded, hangUpLive, liveOn, phoneClosed } from "./live-call.js";
import { BOOT_MS } from "./names.js";
import { openPager, PagerWindow } from "./pager.js";
import { activeCall, endCall, outgoing, playerCall, playerSendSms } from "./player-calls.js";
import { attShowHtml, findEntry, forwardEntry, openReader, showScreen } from "./share.js";
import { deviceNotice, esc, nl2br, onRerender, setNoticeHost } from "./util.js";
import { fileViews } from "./views/files.js";
import { headerViews } from "./views/header.js";
import { contactViews } from "./views/contacts.js";
import { menuViews } from "./views/menu.js";
import { callLabel, GM_ENTRY_TYPES, messageViews } from "./views/messages.js";
import { screenViews } from "./views/screens.js";
import { openPlayerGuide, welcomeDevice } from "./welcome.js";
/* -------------------------------------------- */
/*  Player window: My phone                      */
/* -------------------------------------------- */

/**
 * Player: deletes an entry of their device (never the operator's guide). The GM's browser writes it,
 * like every history change; without a GM connected, it is written here.
 */
function removeEntry(item, { id = null, t: ts = null }) {
  if (game.users.activeGM) return game.socket.emit(SOCKET, { type: "playerDelete", itemUuid: item.uuid, entryId: id || null, ts: id ? null : ts, userId: game.user.id });
  const match = (e) => (id ? e.id === id : String(e.t) === ts);
  return mutateLog(item, (log) => log.filter((e) => !match(e) || e.help));
}

/** Phone keypads: the screen buttons the green and red keys press, first one found. */
const PHONE_KEYS = {
  green: ["answer", "call", "dialBack"],
  red: ["decline", "liveHangup", "outHangup", "liveDismiss", "back", "docBack", "contactBack", "openMenu"]
};
/** LCD backlight: how long it stays on after the last change or touch. */
const LIT_MS = 8000;

export class PlayerPhone extends ApplicationV2 {
  static instance = null;

  static DEFAULT_OPTIONS = {
    id: "spt-player-phone",
    classes: ["spt-player-phone"],
    window: { title: "Phones & Computers", icon: "fas fa-mobile-screen", resizable: true },
    position: { width: 340, height: 520 },
    actions: {
      open: function (event, target) { this._go("conv", target.dataset.key); },
      back: function () { this._go("list"); },
      playerGuide: function () { openPlayerGuide(); },
      copyAddress: async function (event, target) {
        const text = target.dataset.address;
        if (!text) return;
        try {
          if (game.clipboard?.copyPlainText) await game.clipboard.copyPlainText(text);
          else await navigator.clipboard.writeText(text);
        } catch {
          return;
        }
        // Brief flash on the address itself (no Foundry notification for players).
        target.classList.add("copied");
        setTimeout(() => target.classList.remove("copied"), 1000);
      },
      compose: function () { this._go("new"); },
      send: function () { this._send(); },
      call: function () { this._call(); },
      dial: function (event, target) { this._dial(target.dataset.digit); },
      dialBack: function () {
        const input = this.element.querySelector("[name=to]");
        if (input) this._state.to = input.value = input.value.slice(0, -1);
      },
      attach: async function () {
        const src = await pickImage();
        if (!src) return;
        this._readForm();
        this._state.att = { type: "image", src };
        this._rerender();
      },
      clearAtt: function () {
        this._readForm();
        this._state.att = null;
        this._rerender();
      },
      contacts: function () { const p = this._current(); if (p && this._canEditContacts(p)) { this._state.q = ""; this._state.contact = null; this._go("contacts"); } },
      addContact: function () {
        const p = this._current();
        const key = this._state.key;
        if (p && this._canEditContacts(p)) this._openContact(p, { name: findContact(p.phone, key)?.name ?? "", number: key, from: key });
      },
      menu: function () { this._toggleMenu(); },
      openMenu: function () { this._go("menu"); },
      info: function () { this._go("info"); },
      menuPowerOff: function () { const p = this._current(); if (p) this._setMode(p, "off"); },
      contactNew: function () { const p = this._current(); if (p && this._canEditContacts(p)) this._openContact(p); },
      contactEdit: function (event, target) { const p = this._current(); if (p && this._canEditContacts(p)) this._openContact(p, { idx: Number(target.dataset.idx) }); },
      contactBack: function () { this._contactBack(); },
      contactSave: function () { const p = this._current(); if (p && this._canEditContacts(p)) this._saveContact(p); },
      contactDelete: function () { const p = this._current(); if (p && this._canEditContacts(p)) this._deleteContact(p); },
      contactCall: function (event, target) { const p = this._current(); if (p && target.dataset.key) playerCall(p.item, target.dataset.key); },
      contactsText: function () { const p = this._current(); if (p && this.gm) contactsDialog(p.item); },
      answer: function () { if (activeCall?.screen) endCall("answer", activeCall); },
      decline: function () { if (activeCall?.screen) endCall("decline", activeCall); },
      outHangup: function () { if (outgoing?.screen) outgoing.hangup(); },
      // Message not sent (satellite not found): sent again, the failed copy goes away.
      retrySms: async function (event, target) {
        const p = this._current();
        const e = p && getLog(p.phone).find((x) => x.id === target.dataset.id && x.nosat);
        if (!e || !p.item.isOwner) return;
        if (!playerSendSms(p.item, e.with, e.text ?? "", { att: e.att ?? null })) return;
        await removeEntry(p.item, { id: e.id });
      },
      liveDismiss: function () {
        const live = liveOn(this._current()?.item.uuid);
        if (live) dismissEnded(live.callId);
      },
      liveHangup: function () {
        const live = liveOn(this._current()?.item.uuid);
        if (live) hangUpLive(live.callId);
      },
      gmEditDevice: function () { const p = this._current(); if (p) editPhoneDialog(p.item); },
      gmNextDevice: function () {
        const p = this._current();
        const list = p && this.gm ? this._siblings(p)?.list : null;
        if (!list) return;
        const i = list.findIndex((q) => q.item.uuid === p.item.uuid);
        this._state.phoneUuid = list[(i + 1) % list.length].item.uuid;
        this._go("list");
      },
      gmGive: function () { const p = this._current(); if (p && this.gm && !isFixed(p.phone)) giveDialog(p.item); },
      playerGive: async function () {
        const p = this._current();
        if (!p || this.gm || !playerCanGive(p.item)) return;
        if (!game.users.activeGM) return deviceNotice(t("Net.GmAbsent"), { warn: true });
        if (await playerGiveDialog(p.item)) this.close();
      },
      showEntry: async function (event, target) {
        const p = this._current();
        const e = p && findEntry(p.phone, target.dataset.id);
        if (!e) return;
        const who = displayName(p.phone, e.with);
        // A journal: the GM's browser renders it (the agent has no Foundry permission on it).
        const doc = e.att?.type === "doc" ? await loadEntryDoc(p.item, e) : null;
        const attPart = e.att?.type === "doc" ? `<h3 class="spt-show-doc"><i class="fas fa-file-lines"></i> ${esc(e.att.name ?? "")}</h3><div class="spt-doc">${doc ?? `<p><em>${t("Files.Unavailable")}</em></p>`}</div>` : await attShowHtml(e.att);
        const html = `${attPart}${e.text ? `<div class="spt-thread"><div class="spt-bubble ${e.dir}">${nl2br(e.text)}</div></div>` : ""}`;
        showScreen(p, t(e.dir === "in" ? "Share.ReceivedFrom" : "Share.SentTo", { who }), html);
      },
      fwdEntry: function (event, target) {
        const p = this._current();
        const e = p && findEntry(p.phone, target.dataset.id);
        if (e) forwardEntry(p, e);
      },
      showConv: function () {
        const p = this._current();
        if (!p) return;
        const key = this._state.key;
        const lines = getLog(p.phone)
          .filter((e) => sameConv(p.phone, e.with, key))
          .reverse()
          .map((e) => {
            if (e.kind !== "sms") return `<div class="spt-call-line"><i class="fas fa-phone"></i> ${callLabel(e)}</div>`;
            const att = !e.att ? "" : e.att.type === "image" ? `<img class="spt-att-img" src="${esc(e.att.src)}">` : `<div><i class="fas fa-file-lines"></i> ${esc(e.att.name)}</div>`;
            return `<div class="spt-bubble ${e.dir}">${att}${e.text ? `<div>${nl2br(e.text)}</div>` : ""}</div>`;
          })
          .join("");
        showScreen(p, t("Share.ConversationWith", { who: displayName(p.phone, key) }), `<div class="spt-thread ${isComputer(p.phone) ? "mail" : ""}">${lines}</div>`);
      },
      dtab: function (event, target) {
        this._state.tab = target.dataset.tab;
        this._go("list");
      },
      openFile: function (event, target) { this._openFile(target.dataset.id); },
      openDoc: function (event, target) { this._openDoc(target.dataset.id); },
      docBack: function () {
        this._state.view = "conv";
        this._state.file = null;
        this._rerender();
      },
      enlarge: function () {
        const p = this._current();
        const st = this._state.file;
        if (!p || !st?.html) return;
        const f = st.entryId ? null : findFile(p.phone, st.id);
        const e = st.entryId ? findEntry(p.phone, st.entryId) : null;
        const title = f?.name ?? e?.att?.name ?? "";
        openReader(title, f?.type === "image" ? st.html : `<div class="spt-doc">${st.html}</div>`, skinOf(p.phone));
      },
      fileShow: async function (event, target) {
        const p = this._current();
        const f = p && findFile(p.phone, target.dataset.id);
        if (!f || f.locked || f.hidden) return;
        const html = await loadFile(p.item, f);
        if (!html) return deviceNotice(t("Files.Unavailable"), { warn: true });
        showScreen(p, f.name, f.type === "image" ? html : `<div class="spt-doc">${html}</div>`);
      },
      fileFwd: function (event, target) {
        const p = this._current();
        const f = p && findFile(p.phone, target.dataset.id);
        if (!f || f.locked || f.hidden) return;
        const att = f.type === "image" ? { type: "image", src: f.src } : { type: "doc", uuid: f.uuid, name: f.name };
        forwardEntry(p, { text: "", att });
      },
      gmFileLock: function (event, target) {
        const p = this._current();
        const f = p && findFile(p.phone, target.dataset.id);
        if (f) patchFile(p.item, f.id, { locked: !f.locked });
      },
      gmFileHide: function (event, target) {
        const p = this._current();
        const f = p && findFile(p.phone, target.dataset.id);
        if (f) patchFile(p.item, f.id, { hidden: !f.hidden });
      },
      gmFileRename: function (event, target) { const p = this._current(); if (p) renameFile(p.item, target.dataset.id); },
      gmFileDelete: function (event, target) { const p = this._current(); if (p) removeFile(p.item, target.dataset.id); },
      gmFileImage: async function () {
        const p = this._current();
        const src = p && (await pickImage());
        if (src) addFile(p.item, { type: "image", src });
      },
      gmDelete: async function (event, target) {
        const p = this._current();
        const { id, t: ts } = target.dataset;
        if (!p?.item.isOwner) return;
        // Player: confirm first (the GM deletes in one click).
        if (!this.gm) {
          if (isComputer(p.phone) || isFixed(p.phone)) return;
          const ok = await foundry.applications.api.DialogV2.confirm({ classes: ["spt-dialog"], window: { title: t("Delete"), icon: "fas fa-trash" }, content: `<p>${t("DeleteEntryConfirm")}</p>`, rejectClose: false });
          if (!ok) return;
        }
        if (!this.gm) return removeEntry(p.item, { id, t: ts });
        const match = (e) => (e.id ? e.id === id : String(e.t) === ts);
        await mutateLog(p.item, (log) => log.filter((e) => !match(e)));
      }
    }
  };

  _state = { phoneUuid: null, view: "list", key: null, draft: "", to: "", entryType: "smsIn", att: null, tab: null, file: null };

  get title() {
    if (!this.gm) return this._mine().some((p) => isComputer(p.phone)) ? t("MyDevices") : t("MyPhone");
    const p = this._current();
    return p ? `${t("Device")} — ${phoneLabel(p)}` : t("Devices");
  }

  /** The GM sees and prepares every device (including NPC and world ones). */
  get gm() {
    return game.user.isGM;
  }

  _mine() {
    if (this.gm) return allPhones().sort((a, b) => phoneLabel(a).localeCompare(phoneLabel(b)));
    // Same rules as for ringing: the player assigned to the character, otherwise its owners.
    // (Keeps a player from seeing another PC's devices they also own.)
    return myPhones();
  }

  _current() {
    const mine = this._mine();
    const want = this._state.phoneUuid ?? loadLastDevice();
    // A player's pager opens in its own window, never in this one.
    const usable = this.gm ? mine : mine.filter((p) => !isPager(p.phone));
    // Wanted device missing (terminal or landline out of reach): fall back to a personal device.
    return usable.find((p) => p.item.uuid === want) ?? usable.find((p) => !isFixed(p.phone)) ?? usable[0] ?? null;
  }

  /** The GM edits every address book; a player only the personal devices they hold (not installed or shared ones). */
  _canEditContacts(p) {
    return this.gm || (!isFixed(p.phone) && p.item.parent instanceof Actor && p.item.isOwner);
  }

  /** Menu: opens on a usable screen (not off, locked, ringing or on the line), closes back to the list. */
  _toggleMenu() {
    const p = this._current();
    if (!this._hasMenu(p) || this.element?.querySelector(".window-content .spt-lockscreen")) return;
    this._go(this._state.view === "menu" ? "list" : "menu");
  }

  _readForm() {
    const el = this.element;
    if (!el?.querySelector) return;
    this._state.draft = el.querySelector("[name=draft]")?.value ?? this._state.draft;
    this._state.to = el.querySelector("[name=to]")?.value ?? this._state.to;
    this._state.entryType = el.querySelector("[name=entryType]")?.value ?? this._state.entryType;
    const c = this._state.contact;
    if (c && this._state.view === "contact") {
      c.name = el.querySelector("[name=cname]")?.value ?? c.name;
      c.number = el.querySelector("[name=cnum]")?.value ?? c.number;
    }
  }

  async render(...args) {
    // Keep the current input on automatic re-renders (message received, etc.).
    if (this.rendered && !this._skipRead) this._readForm();
    this._skipRead = false;
    return super.render(...args);
  }

  /** Re-render after a deliberate _state change (does not re-read the form). */
  _rerender() {
    this._skipRead = true;
    return this.render();
  }

  _go(view, key = null) {
    this._state.view = view;
    if (view !== "file") this._state.file = null;
    this._state.key = key;
    this._state.draft = "";
    if (view === "new") this._state.to = "";
    this._rerender();
  }

  async _send() {
    this._readForm();
    const p = this._current();
    if (!p) return;
    const to = this._state.view === "new" ? this._state.to : this._state.key;
    if (this.gm) {
      if (!(await this._gmAdd(p, to))) return;
    } else if (!playerSendSms(p.item, to, this._state.draft)) return;
    this._state.draft = "";
    if (this._state.view === "new") {
      this._state.view = "conv";
      this._state.key = keyFor(p.phone, to);
    }
    this._rerender();
  }

  /** GM: adds an entry to the history without sending anything (preparation). */
  async _gmAdd(p, to) {
    to = to?.trim();
    if (!to) return deviceNotice(t("Warn.NoCorrespondent"), { warn: true }), false;
    const key = keyFor(p.phone, to);
    const text = this._state.draft?.trim();
    const type = GM_ENTRY_TYPES[this._state.entryType] ?? GM_ENTRY_TYPES.smsIn;
    const att = type.kind === "sms" ? this._state.att : null;
    if (type.kind === "sms" && !text && !att) return deviceNotice(t("Warn.Empty"), { warn: true }), false;
    await addLog(p.item, { ...type.entry, with: key, ...(type.kind === "sms" ? { text } : {}), ...(att ? { att } : {}), read: true, prep: true });
    this._state.att = null;
    return true;
  }

  _call() {
    this._readForm();
    const p = this._current();
    if (!p) return;
    const to = this._state.view === "new" ? this._state.to : this._state.key;
    if (!to?.trim()) return deviceNotice(t("Warn.NameOrNumber"), { warn: true });
    playerCall(p.item, to);
  }

  /** Rotary dial: the digit is added to the number, the dial turns to the stop and back. */
  _dial(digit) {
    const input = this.element.querySelector("[name=to]");
    if (!input || digit === undefined) return;
    this._state.to = input.value += digit;
    if (!DIAL_DIGITS.includes(digit)) return;
    const angle = DIAL_ANGLE(digit) - DIAL_STOP;
    this.element.querySelector(".spt-rotor")?.animate(
      [{ transform: "rotate(0deg)" }, { transform: `rotate(${angle}deg)`, offset: 0.45 }, { transform: "rotate(0deg)" }],
      { duration: 250 + angle * 3, easing: "ease-in-out" }
    );
  }

  async _renderHTML() {
    const mine = this._mine();
    const p = this._current();
    if (!p) return `<p class="spt-phone-empty">${this.gm ? t("NoDevice") : t("NoPhone")}</p>`;
    const prev = this._state.phoneUuid;
    if (prev && prev !== p.item.uuid) {
      // The displayed device is no longer reachable (the agent left the room, or it was removed).
      this._state.view = "list";
      this._state.key = null;
      const lostPhone = getPhoneData(fromUuidSync(prev));
      if (!this.gm && lostPhone) deviceNotice(t("OutOfReach", { label: lostPhone.label }));
    }
    this._state.phoneUuid = p.item.uuid;

    const incoming = !this.gm && activeCall?.screen && !activeCall.done && activeCall.itemUuid === p.item.uuid ? activeCall.screen : null;
    // On the line: the device shows who is on the other end and a hang-up key.
    const live = !this.gm ? liveOn(p.item.uuid) : null;
    if (live && isLandline(p.phone) && !live.ended) return this._renderDialer(p, mine, null, live);
    if (live && !isLandline(p.phone)) return this._renderLive(p, mine, live);
    if (!this.gm && outgoing?.screen && !outgoing.done && outgoing.itemUuid === p.item.uuid) return this._renderOutgoing(p, mine, outgoing.screen);
    if (incoming && isLandline(p.phone)) return this._renderDialer(p, mine, incoming);
    if (incoming) return this._renderIncoming(p, mine, incoming);
    if (!this.gm && modeOf(p.phone) === "off") return this._renderOff(p, mine);
    if (!this.gm && this._boot?.uuid === p.item.uuid && Date.now() < this._boot.until) return this._renderBoot(p, mine);
    if (!this.gm && p.phone.locked) return this._renderLocked(p, mine);
    if (!this.gm) welcomeDevice(p);
    // A landline has nothing but its dial (no history, no contacts): the GM sees it as the players do.
    if (isLandline(p.phone)) return this._renderDialer(p, mine);
    const computer = isComputer(p.phone);
    // A player cannot write from a mailbox that is locked or absent.
    if (computer && !this.gm && inboxOf(p.phone) !== "on" && ["conv", "new", "doc"].includes(this._state.view)) this._state.view = "list";
    if (this._state.view === "file") return this._renderFile(p, mine);
    if (this._state.view === "doc") return this._renderDoc(p);
    if (this._state.view === "conv") return this._renderConv(p);
    if (this._state.view === "new") return this._renderNew(p);
    if (["menu", "info"].includes(this._state.view)) {
      if (this._hasMenu(p)) return this._state.view === "menu" ? this._renderMenu(p) : this._renderInfo(p);
      this._state.view = "list";
    }
    if (["contacts", "contact"].includes(this._state.view)) {
      if (this._canEditContacts(p)) return this._state.view === "contacts" ? this._renderContacts(p) : this._renderContact(p);
      this._state.view = "list";
    }
    if (computer && this._tab(p) === "files") return this._renderFiles(p, mine);
    if (computer && !this.gm && inboxOf(p.phone) === "locked") return this._renderInboxLocked(p, mine);
    return this._renderList(p, mine);
  }

  /** Switching a device on (player): from off, the network operator shows for a moment. */
  _setMode(p, mode) {
    if (!p) return;
    if (!this.gm && modeOf(p.phone) === "off" && mode !== "off") {
      this._boot = { uuid: p.item.uuid, until: Date.now() + BOOT_MS };
      setTimeout(() => this.rendered && this._rerender(), BOOT_MS + 100);
    }
    p.item.update({ [`flags.${MODULE_ID}.phone.mode`]: mode });
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  /**
   * Draws the device around the screen (player and GM view).
   * The Foundry header stays (drag, menu, close) as a discreet bar over the top bezel.
   * The frame parts live next to .window-content, so they survive re-renders.
   */
  _applyFrame(cur) {
    const el = this.element;
    const kind = cur ? frameKind(cur.phone) : null;
    const frame = FRAMES[kind];
    // The key includes the GM view, which may get a larger window.
    const key = frame ? `${kind}${this.gm ? "-gm" : ""}` : "";
    if ((el.dataset.sptFrame ?? "") === key) return;
    for (const d of el.querySelectorAll(".spt-frame-deco")) d.remove();
    for (const k of Object.keys(FRAMES)) el.classList.toggle(`spt-frame-${k}`, k === kind);
    el.classList.toggle("spt-framed", !!frame);
    el.dataset.sptFrame = key;
    if (!frame) return;
    const content = el.querySelector(".window-content");
    content?.insertAdjacentHTML("beforebegin", frame.before ?? "");
    content?.insertAdjacentHTML("afterend", frame.after ?? "");
    const size = (this.gm && frame.gm) || frame;
    this.setPosition({ width: size.width, height: size.height });
  }

  /** Smartphone: the glass reflection moves a little with the window across the screen (CSS --spt-glare). */
  setPosition(position) {
    const pos = super.setPosition(position);
    const el = this.element;
    if (el && Number.isFinite(pos?.left) && Number.isFinite(pos?.width) && window.innerWidth) {
      const shift = ((pos.left + pos.width / 2) / window.innerWidth - 0.5) * 80;
      el.style.setProperty("--spt-glare", `${Math.round(shift)}px`);
    }
    return pos;
  }

  /** LCD screens: the backlight comes on, then goes off LIT_MS later (purely visual). */
  _wake() {
    const el = this.element;
    if (!el?.classList.contains("spt-skin-mobile")) return;
    el.classList.add("spt-lit");
    clearTimeout(this._litTimer);
    this._litTimer = setTimeout(() => el.classList.remove("spt-lit"), LIT_MS);
  }

  /** Lights the LCD when the device's screen changes (new entry, other view, incoming call), not on every redraw. */
  _wakeOnChange(cur) {
    const sig = cur
      ? [cur.item.uuid, getLog(cur.phone, { includePending: true }).length, this._state.view, this._state.key, !!this.element.querySelector(".spt-incoming")].join("|")
      : "";
    if (sig === this._litSig) return;
    this._litSig = sig;
    this._wake();
  }

  /**
   * Keypad of the mobile, brick and satellite phone. Green (SND) answers or calls, red (END) declines,
   * hangs up or goes back, by pressing the screen's own button. A digit types the number on a "new" screen, CLR erases.
   */
  _pressKey(ev) {
    const digit = ev.target.closest?.("[data-spt-digit]")?.dataset.sptDigit;
    if (digit) {
      const input = this.element.querySelector('.window-content input[name="to"]');
      if (!input) return;
      // CLR erases the last character.
      input.value = digit === "clr" ? input.value.slice(0, -1) : input.value + digit;
      this._state.to = input.value;
      input.focus();
      return;
    }
    const key = ev.target.closest?.("[data-spt-key]")?.dataset.sptKey;
    // Smartphone side button: power on / off.
    // Mobile: the keypad's middle key opens the menu (and closes it).
    if (key === "menu") return void this._toggleMenu();
    if (key === "power") {
      const p = this._current();
      return void (p && this._setMode(p, modeOf(p.phone) === "off" ? "on" : "off"));
    }
    if (!PHONE_KEYS[key]) return;
    const content = this.element.querySelector(".window-content");
    // Switched off: the green key switches the phone on (the screen shows no power button).
    if (key === "green" && content?.querySelector(".spt-offscreen")) return void content.querySelector('[data-mode="on"]')?.click();
    for (const action of PHONE_KEYS[key]) {
      const btn = content?.querySelector(`[data-action="${action}"]`);
      if (btn) return void btn.click();
    }
  }

  /** "Give…" in the window's menu (⋮): GM, any carried device; player, a personal device they hold. */
  _getHeaderControls() {
    const controls = super._getHeaderControls();
    controls.push({ icon: "fas fa-hand-holding-hand", label: t("Give.Menu"), action: this.gm ? "gmGive" : "playerGive", visible: function () { return this._canGive(); } });
    return controls;
  }

  _canGive() {
    const p = this._current();
    if (!p) return false;
    return this.gm ? !isFixed(p.phone) : playerCanGive(p.item);
  }

  _onClose(options) {
    super._onClose?.(options);
    // Closed during a call: the call window takes over. Closed while dialing: the call is dropped (as closing the window did).
    if (!this.gm) phoneClosed();
    if (!this.gm && outgoing?.screen && !outgoing.done) outgoing.hangup();
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    PlayerPhone.instance = this;
    const cur = this._current();
    const skin = cur ? skinOf(cur.phone) : null;
    for (const k of SKINS) this.element.classList.toggle(`spt-skin-${k}`, k === skin);
    // Satellite device: its frame shows it (brick: SAT label, thick antenna).
    this.element.classList.toggle("spt-satellite", !!cur && isSatellite(cur.phone));
    // Landline: its name stays discreet in the header (player side).
    this.element.classList.toggle("spt-landline", !!cur && isLandline(cur.phone));
    // Brick: the antenna is pulled out while the device is on.
    this.element.classList.toggle("spt-antenna-up", !!cur && !this.gm && modeOf(cur.phone) !== "off");
    this.element.classList.toggle("spt-gm-view", this.gm);
    this._applyFrame(cur);
    for (const k of this.element.querySelectorAll("[data-spt-key]")) k.title = k.dataset.sptKey === "power" ? t(modeOf(this._current()?.phone) === "off" ? "PowerOn" : "PowerOff") : k.dataset.sptKey === "menu" ? t("Menu.Title") : k.dataset.sptKey === "green" ? t(this.element.querySelector(".spt-offscreen") ? "PowerOn" : "KeyGreen") : t("KeyRed");
    // Mobile: the light blinks while a message or missed call is unread.
    this.element.classList.toggle("spt-unread", !!cur && playerUnread(cur.phone) > 0);
    // LCD screens: the backlight comes on when the device's screen changes.
    this._wakeOnChange(cur);
    // The menu (⋮) follows the shown device: "Give…" only for a carried one.
    const giveKey = this._canGive();
    if (this._giveKey !== giveKey) {
      this._giveKey = giveKey;
      this._updateFrame({ window: {} });
    }
    const el = this.element;
    // Mobile keypad and LCD backlight. Bound once, on the window.
    if (!el.dataset.sptKeys) {
      el.dataset.sptKeys = "1";
      el.addEventListener("click", (ev) => this._pressKey(ev));
      for (const type of ["pointerdown", "keydown", "wheel"]) el.addEventListener(type, () => this._wake(), { passive: true });
    }
    // Banners: GM preparation, secure device.
    const content = el.querySelector(".window-content");
    // Military look: a banner on computers only (phones show none).
    const banner = { military: cur && isComputer(cur.phone) ? "Theme.Restricted" : null, federal: "Theme.GovSystem" }[skin];
    if (content && banner) content.insertAdjacentHTML("afterbegin", `<div class="spt-banner">${t(banner)}</div>`);
    if (content && this.gm && cur) content.insertAdjacentHTML("beforeend", `<div class="spt-gm-ribbon"><i class="fas fa-pen"></i> ${t("Theme.GmView")}</div>`);
    // Foundry ignores keybindings while typing in a field (landline number, message):
    // Ctrl+Shift+P there still moves to the next device. Bound once, on the window.
    if (!this.gm && !el.dataset.sptNextKey) {
      el.dataset.sptNextKey = "1";
      el.addEventListener("keydown", (ev) => {
        if (!ev.target.matches?.("input, textarea, select, [contenteditable]")) return;
        if (ev.code !== "KeyP" || !ev.shiftKey || !(ev.ctrlKey || ev.metaKey)) return;
        ev.preventDefault();
        ev.stopPropagation();
        cycleDevices();
      });
    }
    if (!this.gm && cur && isLandline(cur.phone)) {
      el.querySelector("[name=to]")?.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") { ev.preventDefault(); this._call(); }
      });
    }
    const p = this._current();
    for (const a of el.querySelectorAll("[data-att-img]")) a.addEventListener("click", () => openAttachment(a));
    if (this.gm && p) bindDrop(el.querySelector(".spt-filedrop"), (att) => addFile(p.item, att));
    if (this.gm) {
      bindDrop(el.querySelector(".spt-drop"), (att) => {
        this._readForm();
        this._state.att = att;
        this._rerender();
      });
    }

    bindIconSelects(el);
    for (const btn of el.querySelectorAll("[data-mode]")) {
      btn.addEventListener("click", () => this._setMode(p, btn.dataset.mode));
    }
    // Texts: Enter sends, Shift+Enter adds a line. Emails are longer: Enter adds a line, Ctrl/Cmd+Enter sends.
    const mail = p && isComputer(p.phone);
    el.querySelector("[name=draft]")?.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      const send = mail ? ev.ctrlKey || ev.metaKey : !ev.shiftKey;
      if (!send) return;
      ev.preventDefault();
      this._send();
    });
    const thread = el.querySelector(".spt-thread");
    if (thread) thread.scrollTop = thread.scrollHeight;
    if (this._state.view === "new" && !this._state.to) el.querySelector("[name=to]")?.focus();
    else if (this._state.view === "contact" && !this._state.contact?.name) el.querySelector("[name=cname]")?.focus();
    else if (!["list", "contacts", "contact", "menu", "info"].includes(this._state.view)) el.querySelector("[name=draft]")?.focus();
    this._bindContactSearch(el);

    // Opening a conversation marks it as read.
    if (p && !this.gm && this._state.view === "conv") {
      const key = this._state.key;
      const hasUnread = getLog(p.phone).some((e) => isUnread(e) && sameConv(p.phone, e.with, key));
      if (hasUnread) {
        // All history writes go through the GM's browser (no collision).
        if (game.users.activeGM) game.socket.emit(SOCKET, { type: "playerRead", itemUuid: p.item.uuid, key, userId: game.user.id });
        else if (p.item.isOwner) markRead(p.item, key);
      }
    }
  }
}

// The window's views live in views/*.js: their methods join the class, `this` stays the window.
Object.assign(PlayerPhone.prototype, headerViews, messageViews, contactViews, menuViews, fileViews, screenViews);

/* Repeated Ctrl+Shift+P: each device in turn (phones, then pagers in their own window), */
/* then everything closes once all were shown; the next press starts again.              */
let cycle = null; // { start, cur } device uuids

function pagerUuid(uuid) {
  return isPager(getPhoneData(fromUuidSync(uuid)));
}

export function shownDevice(uuid) {
  if (pagerUuid(uuid)) return !!PagerWindow.windows.get(uuid)?.rendered;
  const app = PlayerPhone.instance;
  return !!app?.rendered && !app.minimized && app._current()?.item.uuid === uuid;
}

export function hideDevice(uuid) {
  if (pagerUuid(uuid)) PagerWindow.windows.get(uuid)?.close();
  else PlayerPhone.instance?.close();
}

function showPhone(uuid) {
  const app = PlayerPhone.instance ?? new PlayerPhone();
  app._state.phoneUuid = uuid;
  // A fixed device is only passed through: the shortcut and the main button keep the carried one.
  if (!isFixed(getPhoneData(fromUuidSync(uuid)))) saveLastDevice(uuid);
  if (app.rendered && !app.minimized) return app._go("list");
  app._state.view = "list";
  app._skipRead = true;
  app.render({ force: true });
}

/** openDefault: what the shortcut opens when no device is shown yet. */
export function cycleDevices(openDefault = null) {
  const mine = myPhones();
  const list = [...mine.filter((p) => !isPager(p.phone)), ...mine.filter((p) => isPager(p.phone))].map((p) => p.item.uuid);
  const app = PlayerPhone.instance;
  const cur = cycle && shownDevice(cycle.cur)
    ? cycle.cur
    : app?.rendered && !app.minimized
      ? app._current()?.item.uuid
      : list.find((u) => pagerUuid(u) && shownDevice(u));
  if (!cur || !list.includes(cur)) {
    cycle = null;
    return openDefault?.();
  }
  if (cycle?.cur !== cur) cycle = { start: cur, cur };
  const next = list[(list.indexOf(cur) + 1) % list.length];
  if (list.length < 2 || next === cycle.start) {
    hideDevice(cur);
    cycle = null;
    return;
  }
  if (pagerUuid(next)) {
    hideDevice(cur);
    openPager(next, { latest: true });
  } else {
    if (pagerUuid(cur)) hideDevice(cur);
    showPhone(next);
  }
  cycle.cur = next;
}

onRerender(() => {
  if (PlayerPhone.instance?.rendered) PlayerPhone.instance.render();
});
/**
 * Smartphone: a banner at the top of the screen for a new message, when the player is looking
 * at another screen of the same device. Click: opens the conversation. Locked or off: nothing.
 */
export function smsBanner(uuid) {
  const app = PlayerPhone.instance;
  if (!app?.rendered || app.gm) return;
  const p = app._current();
  if (!p || p.item.uuid !== uuid || frameKind(p.phone) !== "smartphone") return;
  if (p.phone.locked || modeOf(p.phone) === "off") return;
  const el = app.element;
  if (el.querySelector(".spt-incoming")) return;
  const e = getLog(p.phone).find((x) => x.kind === "sms" && isUnread(x));
  if (!e) return;
  const key = keyFor(p.phone, e.with);
  if (app._state.view === "conv" && sameConv(p.phone, app._state.key, key)) return;
  el.querySelector(":scope > .spt-sms-banner")?.remove();
  const div = document.createElement("div");
  div.className = "spt-sms-banner";
  const text = e.text ? esc(e.text) : `<i class="fas fa-paperclip"></i> ${t("Attachment")}`;
  div.innerHTML = `<i class="fas fa-comment"></i><span><strong>${esc(displayName(p.phone, key))}</strong><small>${text}</small></span>`;
  div.addEventListener("click", () => {
    div.remove();
    app._go("conv", key);
  });
  el.append(div);
  setTimeout(() => div.remove(), 6000);
}

// Device notices show on the player's phone screen, when it is open.
setNoticeHost(() => (PlayerPhone.instance?.rendered ? PlayerPhone.instance.element : null));
