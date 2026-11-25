import { attChipHtml, attHtml, openAttachment, pickImage } from "./attachments.js";
import { openSystemSheet } from "./item-sheet.js";
import { ApplicationV2, MODES, MODULE_ID, SOCKET } from "./constants.js";
import { SKINS, addLog, allPhones, conversations, displayName, findContact, getLog, getPhoneData, hasSignal, isComputer, isSecure, isFixed, isLandline, isPager, isSatellite, keyFor, markRead, modelOf, msgOn, mutateLog, phoneLabel, sameConv, isUnread, skinOf, unreadCount, modeOf, npcDirectory, publicDevices, inboxOf, filesOf, playerUnread, viaSatellite, mobileSignal } from "./devices.js";
import { addFile, findFile, loadEntryDoc, loadFile, patchFile, removeFile, renameFile } from "./files.js";
import { addContactDialog, contactsDialog } from "./dialogs.js";
import { loadLastDevice, myPhones, saveLastDevice } from "./fab.js";
import { bindDrop, bindIconSelects, deviceSelect } from "./gm-panel.js";
import { activeCall, endCall, outgoing, playerCall, playerSendSms } from "./player-calls.js";
import { dismissEnded, hangUpLive, liveOn, otherEnd, phoneClosed, statusHtml } from "./live-call.js";
import { attShowHtml, findEntry, forwardEntry, openReader, showScreen } from "./share.js";
import { deviceNotice, esc, isMasked, nl2br, shieldIcon } from "./util.js";
import { PagerWindow, openPager } from "./pager.js";
import { skyOpenFor } from "./satellite.js";
import { BOOT_MS, bootText, hostName, operatorName } from "./names.js";
import { openPlayerGuide, welcomeDevice } from "./welcome.js";
import { t, tn } from "./i18n.js";
/* -------------------------------------------- */
/*  Player window: My phone                      */
/* -------------------------------------------- */

/** Device frames, by kind (see frameKind). Sizes are the window's, frame included. */
const LANDLINE_DECO = `<span class="spt-frame-deco spt-frame-handset"></span><span class="spt-frame-deco spt-frame-cord"></span>`;
const FRAMES = {
  smartphone: {
    width: 340, height: 640,
    before: `<span class="spt-frame-deco spt-frame-side r"></span><span class="spt-frame-deco spt-frame-side l"></span><span class="spt-frame-deco spt-frame-side l2"></span><span class="spt-frame-deco spt-frame-camera"></span>`,
    after: `<span class="spt-frame-deco spt-frame-homebar"></span>`
  },
  mobile: {
    width: 290, height: 600, gm: { width: 330, height: 660 },
    before: `<div class="spt-frame-deco spt-frame-speaker"></div>`,
    after: `<div class="spt-frame-deco spt-frame-keys" aria-hidden="true"><span class="nav"><i class="fas fa-caret-left"></i><b>OK</b><i class="fas fa-caret-right"></i></span>${"123456789*0#".split("").map((k) => `<span>${k}</span>`).join("")}</div>`
  },
  // 1980s brick: huge tall shell, tiny screen, tiny keys, antenna pulled out during a call.
  brick: {
    width: 240, height: 680, gm: { width: 300, height: 720 },
    before: `<span class="spt-frame-deco spt-frame-antenna"></span><div class="spt-frame-deco spt-brick-grille"></div><div class="spt-frame-deco spt-brick-brand">CELLULAR</div>`,
    after: `<div class="spt-frame-deco spt-brick-pad" aria-hidden="true"><div class="fn">${["RCL", "STO", "FCN", "CLR", "PWR", "VOL"].map((k) => `<span>${k}</span>`).join("")}</div><div class="num">${"123456789*0#".split("").map((k) => `<span>${k}</span>`).join("")}</div><div class="fn"><span class="snd">SND</span><span class="end">END</span></div></div><div class="spt-frame-deco spt-brick-mic"></div>`
  },
  // Satellite phone (2000s): short screen, big keys, thick antenna.
  bricksat: {
    width: 270, height: 570, gm: { width: 320, height: 610 },
    before: `<span class="spt-frame-deco spt-frame-antenna"></span><span class="spt-frame-deco spt-frame-sat">SAT</span><div class="spt-frame-deco spt-frame-speaker"></div>`,
    after: `<div class="spt-frame-deco spt-frame-keys spt-brick-keys" aria-hidden="true"><span class="snd">SND</span><span class="clr">CLR</span><span class="end">END</span>${"123456789*0#".split("").map((k) => `<span>${k}</span>`).join("")}</div>`
  },
  computer: {
    width: 640, height: 460,
    before: `<span class="spt-frame-deco spt-frame-webcam"></span>`,
    after: `<span class="spt-frame-deco spt-frame-base"></span>`
  },
  monitor: {
    width: 640, height: 440,
    before: `<span class="spt-frame-deco spt-frame-led"></span>`,
    after: `<span class="spt-frame-deco spt-frame-stand"></span>`
  },
  crt: {
    width: 620, height: 480,
    before: `<span class="spt-frame-deco spt-frame-led"></span>`,
    after: `<span class="spt-frame-deco spt-frame-scan"></span><span class="spt-frame-deco spt-frame-vents"></span>`
  },
  desk: { width: 330, height: 520, before: LANDLINE_DECO },
  rotary: { width: 370, height: 540, before: LANDLINE_DECO }
};

/** Frame drawn around a device: by model, and by look for terminals and landlines. */
function frameKind(phone) {
  const model = phone?.model ?? "smartphone";
  const skin = skinOf(phone);
  if (model === "desktop") return ["console", "military"].includes(skin) ? "crt" : "monitor";
  if (model === "landline") return skin === "modern" ? "desk" : "rotary";
  if (model === "satphone") return "bricksat";
  return FRAMES[model] ? model : null;
}

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
      nextDevice: function () { this.nextDevice(); },
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
      contacts: function () { const p = this._current(); if (p && this._canEditContacts(p)) contactsDialog(p.item); },
      addContact: function () {
        const p = this._current();
        if (p && this._canEditContacts(p)) addContactDialog(p.item, this._state.key, findContact(p.phone, this._state.key)?.name ?? "");
      },
      answer: function () { if (activeCall?.screen) endCall("answer", activeCall); },
      decline: function () { if (activeCall?.screen) endCall("decline", activeCall); },
      outHangup: function () { if (outgoing?.screen) outgoing.hangup(); },
      // Message not sent (satellite not found): sent again, the failed copy goes away.
      retrySms: async function (event, target) {
        const p = this._current();
        const e = p && getLog(p.phone).find((x) => x.id === target.dataset.id && x.nosat);
        if (!e || !p.item.isOwner) return;
        if (!playerSendSms(p.item, e.with, e.text ?? "", { att: e.att ?? null })) return;
        await mutateLog(p.item, (log) => log.filter((x) => x.id !== e.id));
      },
      liveDismiss: function () {
        const live = liveOn(this._current()?.item.uuid);
        if (live) dismissEnded(live.callId);
      },
      liveHangup: function () {
        const live = liveOn(this._current()?.item.uuid);
        if (live) hangUpLive(live.callId);
      },
      gmItemSheet: function () { const p = this._current(); if (p) openSystemSheet(p.item); },
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
        const match = (e) => (e.id ? e.id === id : String(e.t) === ts);
        await mutateLog(p.item, (log) => log.filter((e) => !match(e) || (!this.gm && e.help)));
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

  _readForm() {
    const el = this.element;
    if (!el?.querySelector) return;
    this._state.draft = el.querySelector("[name=draft]")?.value ?? this._state.draft;
    this._state.to = el.querySelector("[name=to]")?.value ?? this._state.to;
    this._state.entryType = el.querySelector("[name=entryType]")?.value ?? this._state.entryType;
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

  /** Devices a player can show in this window (a pager has its own window). */
  _usable() {
    return this._mine().filter((p) => !isPager(p.phone));
  }

  /** Switches to the player's next device (header button, repeated Ctrl+Shift+P). */
  nextDevice() {
    const usable = this._usable();
    if (usable.length < 2) return;
    const i = usable.findIndex((p) => p.item.uuid === this._current()?.item.uuid);
    const next = usable[(i + 1) % usable.length];
    this._state.phoneUuid = next.item.uuid;
    // A fixed device is only passed through: the shortcut and the main button keep the carried one.
    if (!isFixed(next.phone)) saveLastDevice(next.item.uuid);
    this._go("list");
  }

  /**
   * Player header: the device's label and address, as plain text.
   * Click on the address = copy. With several devices, a "next" button.
   */
  _deviceTitle(p) {
    const name = p.phone.label;
    // Switched off or locked: only the model shows, not the number (or email, ID…).
    const hidden = !this.gm && (p.phone.locked || modeOf(p.phone) === "off");
    const addr = hidden ? "" : p.phone.number ?? "";
    const full = addr ? `${name} · ${addr}` : name;
    const next = this._usable().length > 1
      ? `<a class="spt-next-device" data-action="nextDevice" title="${t("NextDevice")}" aria-label="${t("NextDevice")}"><i class="fas fa-chevron-right"></i></a>`
      : "";
    return `<div class="spt-dev-title" title="${esc(full)}"><strong>${esc(name)}</strong>${addr ? `<small class="spt-dev-addr" data-action="copyAddress" data-address="${esc(addr)}" title="${t("CopyAddress")}">${esc(addr)}</small>` : ""}</div>${next}`;
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
    if (computer && this._tab(p) === "files") return this._renderFiles(p, mine);
    if (computer && !this.gm && inboxOf(p.phone) === "locked") return this._renderInboxLocked(p, mine);
    return this._renderList(p, mine);
  }

  /** Computer tab: mailbox or files. Without a mailbox, a player only has the files. */
  _tab(p) {
    const inbox = inboxOf(p.phone);
    if (!this.gm && inbox === "none") return "files";
    return this._state.tab ?? (this.gm || inbox === "on" ? "inbox" : "files");
  }

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
  }

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
      <div class="spt-hostname" title="${t("Files.Host")}"><i class="fas fa-network-wired"></i> ${esc(hostName(p.phone))}</div>
      <ul class="spt-files">${rows || `<li class="spt-phone-empty">${t("Files.Empty")}</li>`}</ul>
      ${foot}`;
  }

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
  }

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
  }

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
  }

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
  }

  /** Attachment inside a bubble: an image, or a document card that opens on the device. */
  _attHtml(e) {
    if (e.att?.type !== "doc") return attHtml(e.att);
    return `<a class="spt-att-card" data-action="openDoc" data-id="${esc(e.id ?? String(e.t))}"><i class="fas fa-file-lines"></i><span><strong>${esc(e.att.name ?? t("Document"))}</strong><small>${t("Files.Open")}</small></span></a>`;
  }

  /** Mailbox locked by the GM: the tab is there, the content is not. */
  _renderInboxLocked(p, mine) {
    return `${this._renderHeader(p, mine)}${this._tabsHtml(p)}
      <div class="spt-lockscreen spt-inbox-locked"><i class="fas fa-lock"></i><p>${t("Files.Restricted")}</p><small>${t("Files.RestrictedHint")}</small></div>`;
  }

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
  }

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
  }

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
  }

  /** Device switched off: a dark screen, nothing from its history or contacts. */
  _renderOff(p, mine) {
    // A blank screen, switched on again with the header's power button only.
    return `${this._renderHeader(p, mine)}<div class="spt-lockscreen spt-offscreen"></div>`;
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

  /** Just switched on: the operator's name (or "No signal"). */
  _renderBoot(p, mine) {
    const signal = hasSignal(p.phone) && !!game.users.activeGM;
    return `${this._renderHeader(p, mine)}
      <div class="spt-lockscreen spt-bootscreen">
        <i class="fas fa-signal ${signal ? "" : "spt-signal off"}"></i>
        <p class="spt-operator">${esc(bootText(p.phone))}</p>
      </div>`;
  }

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
        ${isComputer(p.phone) ? `<small class="spt-hostname" title="${t("Files.Host")}">${esc(hostName(p.phone))}</small>` : ""}
        <p>${text}</p>
        ${login ? `<input type="text" class="spt-fake-login" placeholder="${user}" readonly tabindex="-1"><input type="password" class="spt-fake-login" placeholder="••••••••" readonly tabindex="-1">` : ""}
        ${unread ? `<p class="spt-lock-notif">${tn("Unread", unread)}</p>` : ""}
      </div>`;
  }

  _renderHeader(p, mine) {
    const mode = modeOf(p.phone);
    const phoneSel = this.gm ? deviceSelect(mine, p, phoneLabel) : this._deviceTitle(p);
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
      ? `${contactsBtn}<a data-action="gmItemSheet" title="${t("Sheet.ItemSheet")}" aria-label="${t("Sheet.ItemSheet")}"><i class="fas fa-file-lines"></i></a>`
      : contactsBtn;
    // Secure device: a shield next to the signal.
    const secure = isSecure(p.phone) ? shieldIcon({ title: t("Secure.Device"), cls: "spt-secure-badge" }) : "";
    return `<header class="spt-phone-top">${phoneSel}${secure}${signal}${gmTools}<div class="spt-modes">${modeBtns}</div></header>`;
  }

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
  }

  _renderList(p, mine) {
    const convs = conversations(p.phone);
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
      <footer class="spt-phone-foot"><button type="button" data-action="compose">${composeLabel(p.phone, this.gm)}</button></footer>`;
  }

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
  }

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
  }

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

  _onClose(options) {
    super._onClose?.(options);
    // Closed during a call: the call window takes over. Closed while dialing: the call is dropped (as closing the window did).
    if (!this.gm) phoneClosed();
    if (!this.gm && outgoing?.screen && !outgoing.done) outgoing.hangup();
  }

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
    const el = this.element;
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
    el.querySelector("[data-phone-select]")?.addEventListener("change", (ev) => {
      const uuid = ev.currentTarget.value;
      if (!this.gm && isPager(getPhoneData(fromUuidSync(uuid)))) {
        openPager(uuid, { latest: true });
        return this.render();
      }
      this._state.phoneUuid = ev.currentTarget.value;
      saveLastDevice(ev.currentTarget.value);
      this._go("list");
    });
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
    else if (this._state.view !== "list") el.querySelector("[name=draft]")?.focus();

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

/* Rotary dial (landline): 1 at the top right, then counter-clockwise; finger stop between 0 and 1. */
const DIAL_DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
const DIAL_STOP = 15;
const DIAL_ANGLE = (d) => 60 + 30 * DIAL_DIGITS.indexOf(d);

/** Stable case reference, derived from the message id (e.g. 27-B-4417). */
function caseRef(e) {
  let h = 0;
  for (const c of String(e.id ?? e.t)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `${10 + (h % 90)}-${"ABCDFGHKMNPRST"[(h >>> 7) % 14]}-${String((h >>> 11) % 10000).padStart(4, "0")}`;
}

/** Push-button keypad (modern landline, 1980-2020). */
export function keypad() {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];
  return `<div class="spt-keypad">${keys.map((k) => `<button type="button" data-action="dial" data-digit="${k}">${k}</button>`).join("")}</div>`;
}

export function rotaryDial(number) {
  const pos = (deg, r) => [r * Math.cos((deg * Math.PI) / 180), -r * Math.sin((deg * Math.PI) / 180)].map((v) => v.toFixed(1));
  const holes = DIAL_DIGITS.map((d) => ({ d, xy: pos(DIAL_ANGLE(d), 68) }));
  const [s1, s2] = [pos(DIAL_STOP, 80), pos(DIAL_STOP, 99)];
  return `<svg class="spt-rotary" viewBox="-100 -100 200 200" aria-label="${t("Number")}">
      <defs><mask id="spt-holes"><rect x="-100" y="-100" width="200" height="200" fill="#fff"/>${holes.map((h) => `<circle cx="${h.xy[0]}" cy="${h.xy[1]}" r="14" fill="#000"/>`).join("")}<circle r="40" fill="#000"/></mask>
        <radialGradient id="spt-bakelite" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#4a4541"/><stop offset="0.55" stop-color="#1b1917"/><stop offset="1" stop-color="#0c0b0a"/></radialGradient></defs>
      <circle class="spt-dial-plate" r="96"/>
      ${holes.map((h) => `<text class="spt-dial-digit" x="${h.xy[0]}" y="${h.xy[1]}">${h.d}</text>`).join("")}
      <g class="spt-rotor"><circle r="92" fill="url(#spt-bakelite)" mask="url(#spt-holes)"/></g>
      <circle class="spt-dial-card" r="38"/>
      <text class="spt-dial-number" y="4">${esc(number ?? "")}</text>
      <line class="spt-dial-stop" x1="${s1[0]}" y1="${s1[1]}" x2="${s2[0]}" y2="${s2[1]}"/>
      ${holes.map((h) => `<circle class="spt-dial-hole" data-action="dial" data-digit="${h.d}" cx="${h.xy[0]}" cy="${h.xy[1]}" r="15"><title>${h.d}</title></circle>`).join("")}
    </svg>`;
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


/** Modern landline display on the line: the other end's number, like while it rang (a name only when there is no number to show). */
function lcdCaller(other) {
  return other.sub || other.name;
}

/** Public directory numbers (yellow pages): any agent can find them by name. */
function publicOptions() {
  return [...npcDirectory().filter((e) => e.pub && e.number && !e.off), ...publicDevices().filter((d) => d.name)]
    .map((e) => `<option value="${esc(e.name)}" label="${esc(e.number)}"></option>`)
    .join("");
}

/** "New" button of the conversation list: call and/or message, depending on what the device can do. */
function composeLabel(phone, gm) {
  if (gm) return `<i class="fas fa-pen-to-square"></i> ${t("NewConversation")}`;
  if (isComputer(phone)) return `<i class="fas fa-pen-to-square"></i> ${t("NewMail")}`;
  const sms = msgOn(phone);
  const calls = !modelOf(phone).noCalls;
  if (sms && calls) return `<i class="fas fa-phone"></i><i class="fas fa-comment-sms"></i> ${t("CallOrMessage")}`;
  if (sms) return `<i class="fas fa-comment-sms"></i> ${t("NewMessage")}`;
  return `<i class="fas fa-phone"></i> ${t("Dial")}`;
}

/* Repeated Ctrl+Shift+P: each device in turn (phones, then pagers in their own window), */
/* then everything closes once all were shown; the next press starts again.              */
let cycle = null; // { start, cur } device uuids

function pagerUuid(uuid) {
  return isPager(getPhoneData(fromUuidSync(uuid)));
}

function shownDevice(uuid) {
  if (pagerUuid(uuid)) return !!PagerWindow.windows.get(uuid)?.rendered;
  const app = PlayerPhone.instance;
  return !!app?.rendered && !app.minimized && app._current()?.item.uuid === uuid;
}

function hideDevice(uuid) {
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
