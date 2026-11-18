import { attChipHtml, attFromDrop, pickImage } from "./attachments.js";
import { ApplicationV2, DialogV2, HandlebarsApplicationMixin, MASKED, MODES, MODULE_ID } from "./constants.js";
import { filesOverview, previewEntry, previewFile, setFileStates } from "./files.js";
import { allJammers, isJammer, isNpcHeld, jammedScenes, allPhones, phonesByNumber, holders, sharedUsers, displayName, getLog, getPhoneData, hasSignal, holderName, inDeadZone, isFixed, keyFor, modelOf, msgOn, patchLog, phoneLabel, sameConv, unmarkPhone, unreadCount, modeOf, gmName, isUnknownNumber, npcDirectory, findNpc, isComputer, isSecure, secureWith, setSecureWith, carriedPhone, directoryRows, npcLabel, npcId, saveNpc, patchNpc, deleteNpc, nameUnknown, freeNpcNumber, publicName, landlineUsers, isOffNumber, createPhone, randomAddress, isSatellite, modelLabel, viaSatellite, iconOf } from "./devices.js";
import { contactsDialog, directoryDialog, editPhoneDialog, giveDialog, newPhoneDialog, quickKinds } from "./dialogs.js";
import { copyJournalLink } from "./journal-links.js";
import { openPhone } from "./main.js";
import { sendSms } from "./messages.js";
import { hangUpAll, pendingCalls, ring } from "./ring.js";
import { clock, liveCalls, timerHtml } from "./live-call.js";
import { esc, isMasked, nl2br, norm } from "./util.js";
import { currentLang, t, tn } from "./i18n.js";
import { OPERATORS, SAT_OPERATORS, deviceName } from "./names.js";
import { satellitePolicy, universe, universeKey } from "./universes.js";
import { openWelcome } from "./welcome.js";
import { FEATURES, feature, setFeature } from "./features.js";
/* -------------------------------------------- */
/*  GM panel                                    */
/* -------------------------------------------- */


const CALL_ROWS = 40;

/**
 * Every call, answered or not, between agents too: one line per call, most recent first.
 * The two ends of a call are matched by its id (calls logged before 0.38 stay one line per device).
 */
function callRows(phones) {
  const calls = new Map();
  for (const p of phones) {
    for (const e of getLog(p.phone, { includePending: true })) {
      if (e.kind !== "call") continue;
      const id = e.call ?? `${p.item.uuid}|${e.id ?? e.t}`;
      if (!calls.has(id)) calls.set(id, { id, t: 0, outs: [], ins: [] });
      const c = calls.get(id);
      c.t = Math.max(c.t, e.t ?? 0);
      (e.dir === "out" ? c.outs : c.ins).push({ p, e });
    }
  }
  const who = ({ p }) => holderName(p.item, p.phone);
  return [...calls.values()].sort((a, b) => b.t - a.t).slice(0, CALL_ROWS).map((c) => {
    const out = c.outs[0];
    const all = [...c.outs, ...c.ins];
    // Caller: the agent's device that dialed, otherwise the NPC (or hidden number) the GM called as.
    const from = out ? who(out) : gmName(c.ins[0].p.phone, c.ins[0].e.with);
    const to = c.ins.length ? [...new Set(c.ins.map(who))].join(", ") : gmName(out.p.phone, out.e.with);
    const answered = all.some((x) => x.e.result === "answer");
    const result = answered ? "answer" : out ? out.e.result : c.ins[0].e.result;
    const live = liveCalls.get(c.id);
    const dur = all.find((x) => x.e.dur != null)?.e.dur;
    return {
      t: c.t,
      actorIds: [...new Set(all.map((x) => x.p.actor?.id).filter(Boolean))],
      from,
      to,
      fromAgent: !!out,
      answered,
      compromised: all.some((x) => x.p.phone.compromised),
      secure: all.some((x) => x.e.secure) || !!live?.secure,
      live: live && !live.ended && !live.dialing ? timerHtml(live) : "",
      result: t(`Calls.${result === "voicemail" ? "noanswer" : result}`),
      dur: dur != null ? clock(dur) : ""
    };
  });
}

/** Between agents: the other end(s) of a thread, each with their device icon. */
function otherAgents(th) {
  const others = phonesByNumber(keyFor(th.phone, th.key)).filter((p) => p.item !== th.item);
  if (!others.length) return [{ name: gmName(th.phone, th.key), icon: null }];
  const seen = new Set();
  return others
    .map((p) => ({ name: holderName(p.item, p.phone), icon: iconOf(p.phone), modelLabel: modelOf(p.phone).label }))
    .filter((o) => !seen.has(o.name) && seen.add(o.name));
}

/** Calls by real time of play: the last hour, the last 24 hours, before (empty groups left out). */
function callGroups(rows) {
  const hour = Date.now() - 3600 * 1000;
  const day = Date.now() - 24 * 3600 * 1000;
  const groups = [
    { label: t("Calls.LastHour"), rows: rows.filter((r) => r.live || r.t >= hour) },
    { label: t("Calls.Today"), rows: rows.filter((r) => !r.live && r.t < hour && r.t >= day) },
    { label: t("Calls.Before"), rows: rows.filter((r) => !r.live && r.t < day) }
  ];
  return groups.filter((g) => g.rows.length);
}

/** Drop zone for an attachment. */
export function bindDrop(zone, onAtt) {
  if (!zone) return;
  zone.addEventListener("dragover", (ev) => {
    ev.preventDefault();
    zone.classList.add("spt-drag");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("spt-drag"));
  zone.addEventListener("drop", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    zone.classList.remove("spt-drag");
    const att = attFromDrop(ev);
    if (att) onAtt(att);
    else if (att !== false) ui.notifications.warn(t("Warn.DropHint"));
  });
}

/** Messages sent by players to NPCs (the GM's "inbox"). */
/** Bubbles shown per thread in the GM inbox. */
const INBOX_BUBBLES = 6;

/** Attachment in a GM inbox bubble: thumbnail or journal name. */
function bubbleAtt(att) {
  if (!att) return "";
  if (att.type === "image") return `<img class="spt-bb-img" src="${esc(att.src)}" alt="">`;
  return `<span class="spt-bb-doc"><i class="fas fa-file-lines"></i> ${esc(att.name ?? "")}</span>`;
}

export function gmInbox() {
  const out = [];
  for (const p of allPhones()) {
    for (const e of getLog(p.phone)) {
      // To an NPC, and between agents (pj: read only for the GM, never unread).
      if (e.kind === "sms" && e.dir === "out" && !e.prep) out.push({ ...p, e });
    }
  }
  return out.sort((a, b) => b.e.t - a.e.t);
}

/** Threads shown per page in the GM conversations. */
const THREAD_PAGE = 30;

/**
 * GM conversations: one thread per agent device and correspondent (NPC), or per pair of agents.
 * Activity counts both ways (an agent's message, the GM's reply or first message); unread threads first.
 */
function collectThreads(phones) {
  const threads = new Map();
  // The operator's welcome message is the network talking, not a conversation.
  const operators = new Set([...Object.values(OPERATORS).flat(), ...Object.values(SAT_OPERATORS)].map(norm));
  for (const p of phones) {
    for (const e of getLog(p.phone, { includePending: true })) {
      // npc: the copy kept on a device an NPC carries (the GM's thread is on the PC's device).
      if (e.kind !== "sms" || e.prep || e.off || e.net || e.npc || (e.dir === "in" && operators.has(norm(e.with)))) continue;
      const key = keyFor(p.phone, e.with);
      let agents = false;
      if (e.dir === "out") agents = !!e.pj;
      // Received from another agent's device: the sender's copy already makes the thread.
      else if (phonesByNumber(key).some((q) => q.item !== p.item)) continue;
      const k = norm(key);
      const id = agents ? `pj|${[norm(p.phone.number), k].sort().join("|")}` : `${p.item.uuid}|${k}`;
      if (!threads.has(id)) {
        const npc = agents ? null : findNpc(key, { all: true });
        threads.set(id, { id, item: p.item, phone: p.phone, actor: p.actor, key: e.with, unread: 0, agents, t: 0, npcId: npc ? npcId(npc) : k });
      }
      const th = threads.get(id);
      th.t = Math.max(th.t, e.t ?? 0);
      if (e.dir === "out" && e.seen === false) th.unread++;
    }
  }
  return [...threads.values()].sort((a, b) => (b.unread > 0) - (a.unread > 0) || b.t - a.t);
}

/**
 * Messages link of a device (Devices tab): a PC's device filters on that PC, an NPC's (or nobody's)
 * on its number. null when it has no thread the GM answers (or no filter fits: places, shared items).
 */
function messagesFilter(p, threads) {
  if (isFixed(p.phone) || !p.phone.number) return null;
  if (isNpcHeld(p)) return threads.some((th) => th.npcId === norm(p.phone.number)) ? { npc: norm(p.phone.number) } : null;
  return p.actor && threads.some((th) => th.item === p.item) ? { agent: p.actor.id } : null;
}

/** A device the GM can pin: installed in a place, or carried by no PC (an NPC's, or given to nobody). */
function pinnable(p) {
  return isFixed(p.phone) || isNpcHeld(p);
}

/** Pinned devices, for the sender list and Messages: { number, name } ("Dr Kane · Smartphone", "Motel Starlite · Landline"). */
function pinnedDevices(phones) {
  return phones
    .filter((p) => p.phone.pin && p.phone.number && pinnable(p))
    .map((p) => {
      const where = isFixed(p.phone) ? game.scenes.get(p.phone.sceneId)?.name : p.actor?.name;
      return { number: p.phone.number, name: `${where || p.phone.label} · ${where ? modelLabel(p.phone) : p.phone.number}` };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * GM panel only (out of game, real time is fine): "just now", "5 min ago", "3 h ago", "12 days ago",
 * "4 months ago", "2 years ago".
 */
function timeAgo(ts) {
  if (!ts) return "";
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return t("Gm.JustNow");
  const rtf = new Intl.RelativeTimeFormat(currentLang(), { numeric: "always", style: "short" });
  const steps = [["minute", 60, 60], ["hour", 3600, 24], ["day", 86400, 30], ["month", 2592000, 12]];
  for (const [unit, size, max] of steps) if (s / size < max) return rtf.format(-Math.floor(s / size), unit);
  return rtf.format(-Math.floor(s / 31536000), "year");
}

/** Agents: the players' characters, and any player-owned actor carrying a device. */
function agentActors(phones) {
  const agents = new Map();
  for (const u of game.users) if (!u.isGM && u.character) agents.set(u.character.id, u.character);
  for (const p of phones) if (p.actor?.hasPlayerOwner) agents.set(p.actor.id, p.actor);
  return [...agents.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Between agents: the actors at both ends of a thread. */
function threadActors(th) {
  const ids = new Set([th.actor?.id]);
  for (const p of phonesByNumber(keyFor(th.phone, th.key))) if (p.actor) ids.add(p.actor.id);
  return ids;
}

/** Numbers agents reached that nobody knows (no directory entry, contact or device), most recent first. */
function unknownNumbers(phones) {
  const found = new Map();
  for (const p of phones) {
    for (const e of getLog(p.phone)) {
      if (e.dir !== "out" || e.pj || e.prep || !["sms", "call"].includes(e.kind)) continue;
      const key = keyFor(p.phone, e.with);
      if (!isUnknownNumber(p.phone, key)) continue;
      const k = norm(key);
      if (!found.has(k)) found.set(k, { key, who: new Set(), sms: 0, calls: 0, t: 0 });
      const u = found.get(k);
      u.who.add(holderName(p.item, p.phone));
      u[e.kind === "sms" ? "sms" : "calls"]++;
      u.t = Math.max(u.t, e.t ?? 0);
    }
  }
  return [...found.values()].sort((a, b) => b.t - a.t);
}

/** Directory entry -> agents who exchanged with it (messages or calls, either way). */
function npcUsage(phones) {
  const usage = new Map();
  for (const p of phones) {
    const who = holderName(p.item, p.phone);
    for (const e of getLog(p.phone)) {
      if (e.prep || e.pj || !["sms", "call"].includes(e.kind)) continue;
      const npc = findNpc(keyFor(p.phone, e.with), { all: true });
      if (!npc) continue;
      if (!usage.has(npc.line)) usage.set(npc.line, new Set());
      usage.get(npc.line).add(who);
    }
  }
  return usage;
}

/** The device an agent used last (their last message or call), otherwise the phone they carry. */
function lastUsedDevice(user, devices) {
  let best = null;
  let bestT = -1;
  for (const p of devices) {
    const e = getLog(p.phone).find((x) => x.dir === "out" && !x.prep);
    if (e && (e.t ?? 0) > bestT) [best, bestT] = [p, e.t ?? 0];
  }
  const carried = carriedPhone(user);
  return best ?? devices.find((p) => p.item === carried?.item) ?? devices[0] ?? null;
}

/** Device selector (player phone header). */
export function deviceSelect(mine, p, labelFn) {
  // No model icon: the screen already shows what kind of device it is.
  if (mine.length <= 1) {
    return `<div class="spt-icon-select"><strong>${esc(labelFn(p))}</strong></div>`;
  }
  const opts = mine
    .map((q) => `<option value="${q.item.uuid}" ${q.item.uuid === p.item.uuid ? "selected" : ""}>${esc(labelFn(q))}</option>`)
    .join("");
  return `<div class="spt-icon-select spt-phone-select"><select data-phone-select>${opts}</select></div>`;
}

/** Syncs the icon placed before each <select data-icon-select>. */
export function bindIconSelects(root) {
  for (const select of root.querySelectorAll("select[data-icon-select]")) {
    const icon = select.parentElement.querySelector(":scope > i");
    const sync = () => {
      const opt = select.selectedOptions[0];
      if (icon && opt?.dataset.icon) icon.className = `fas ${opt.dataset.icon}`;
    };
    select.addEventListener("change", sync);
    sync();
  }
}

/** How precisely the network can place a device: carried, switched on, with signal. */
/** model -> [precision, how the network places it] */
const TRACK_LEVEL = { smartphone: ["high", "gps"], computer: ["high", "wifi"], mobile: ["medium", "gsm"], brick: ["medium", "gsm"], satphone: ["medium", "gsm"], pager: ["low", "gsm"] };
/** Precision for this device: a satellite device reports its GPS position to the satellite network. */
const trackLevel = (phone) => (isSatellite(phone) ? ["high", "sat"] : TRACK_LEVEL[phone.model]);
const TRACK_ORDER = { high: 0, medium: 1, low: 2, none: 3 };

/**
 * One group per agent (player characters, and any player-owned actor carrying a device):
 * the devices the network can locate and the best precision.
 * An agent with nothing locatable is listed too: precision none, location unknown.
 */
const RECENT_CALL_MS = 30 * 60 * 1000; // table time

/**
 * The agent's last call in the past 30 minutes (table time), on a device they carry:
 * "12 min ago · → Marlin Hunt · 02:47". A trace on the network.
 */
function lastCall(actor, phones) {
  let last = null;
  for (const p of phones) {
    if (p.actor?.id !== actor.id) continue;
    for (const e of getLog(p.phone, { includePending: true })) {
      if (e.kind !== "call" || !e.t || Date.now() - e.t > RECENT_CALL_MS) continue;
      if (!last || e.t > last.e.t) last = { p, e };
    }
  }
  if (!last) return "";
  const { p, e } = last;
  // The other end: an agent by name, otherwise as the GM knows the number.
  const other = phonesByNumber(keyFor(p.phone, e.with)).find((q) => q.item !== p.item && q.actor?.hasPlayerOwner);
  const who = other ? other.actor.name : gmName(p.phone, e.with);
  const live = e.call ? liveCalls.get(e.call) : null;
  const state = live && !live.ended && !live.dialing ? t("Live.OnLine") : e.dur != null ? clock(e.dur) : e.result !== "answer" ? t(`Calls.${e.result === "voicemail" ? "noanswer" : e.result}`) : "";
  const mins = Math.floor((Date.now() - e.t) / 60000);
  const ago = mins < 1 ? t("Track.JustNow") : t("Track.MinAgo", { n: mins });
  // A call through the satellite leaves a trace on the satellite network.
  const sat = e.sat ? ` · ${t("Track.Via.sat")}` : "";
  return `${ago} · ${e.dir === "out" ? "→" : "←"} ${who}${state ? ` · ${state}` : ""}${sat}`;
}

function trackingRows(phones) {
  return agentActors(phones)
    .map((actor) => {
      const devices = phones
        .filter((p) => p.actor?.id === actor.id && trackLevel(p.phone) && modeOf(p.phone) !== "off" && hasSignal(p.phone))
        .map((p) => {
          const [level, via] = trackLevel(p.phone);
          return { icon: iconOf(p.phone), modelLabel: modelLabel(p.phone), label: p.phone.label, level, via, compromised: !!p.phone.compromised, secure: isSecure(p.phone) };
        })
        .sort((a, b) => TRACK_ORDER[a.level] - TRACK_ORDER[b.level]);
      for (const d of devices) d.levelLabel = `${t(`Track.${d.level}`)} (${t(`Track.Via.${d.via}`)})`;
      const level = devices[0]?.level ?? "none";
      return {
        id: actor.id,
        agent: actor.name,
        img: actor.img,
        level,
        levelLabel: t(`Track.${level}`),
        location: level !== "none" ? "" : inDeadZone(actor) ? t("Track.DeadZone") : t("Track.Unknown"),
        lastCall: lastCall(actor, phones),
        devices
      };
    })
    .sort((a, b) => TRACK_ORDER[a.level] - TRACK_ORDER[b.level] || a.agent.localeCompare(b.agent));
}

/** Files tab search: hides non-matching rows (and groups left empty) without re-rendering. */
function filterFiles(root, query) {
  const q = norm(query);
  for (const g of root.querySelectorAll(".spt-fx-group")) {
    let any = false;
    for (const row of g.querySelectorAll("[data-file]")) {
      const match = !q || norm(row.dataset.search).includes(q);
      row.style.display = match ? "" : "none";
      any ||= match;
    }
    g.style.display = any || !q ? "" : "none";
  }
}

export class PhonePanel extends HandlebarsApplicationMixin(ApplicationV2) {
  static instance = null;

  /** Closed: the Devices filter goes back to "all" for the next opening. */
  _onClose(options) {
    super._onClose(options);
    this._state.devFilter = "all";
  }

  static DEFAULT_OPTIONS = {
    id: "spt-phone-panel",
    tag: "form",
    classes: ["spt-phone-panel"],
    window: { title: "Phones & Computers", icon: "fas fa-tower-cell", resizable: true },
    position: { width: 660, height: 780 },
    form: { handler: () => {}, submitOnChange: false, closeOnSubmit: false },
    actions: {
      watchView: function (event, target) { this._setState({ watchView: target.dataset.view, inboxLimit: THREAD_PAGE }); },
      watchAgent: function (event, target) { this._setState({ watchAgent: target.dataset.agent || null, inboxLimit: THREAD_PAGE }); },
      watchLeak: function () { this._setState({ watchLeak: !this._state.watchLeak }); },
      filterAgent: function (event, target) { this._setState({ inboxAgent: target.dataset.agent || null, inboxNpc: null, inboxLimit: THREAD_PAGE }); },
      // Directory device row: its threads (a PC's device: that PC; an NPC's device: its number).
      filterDevice: function (event, target) {
        const { agent = null, npc = null } = target.dataset;
        this._setState({ inboxAgent: agent, inboxNpc: npc, tab: "inbox", inboxLimit: THREAD_PAGE });
      },
      filterNpc: function (event, target) {
        const id = target.dataset.npc || null;
        this._setState({ inboxNpc: this._state.inboxNpc === id ? null : id, inboxAgent: null, tab: "inbox", inboxLimit: THREAD_PAGE });
      },
      moreThreads: function () { this._setState({ inboxLimit: this._state.inboxLimit + THREAD_PAGE }); },
      writeAs: function (event, target) {
        // "Write as this NPC to…": the Send tab, with the agent and the NPC as sender.
        this._focusSend = true;
        this._setState({ tab: "send", sendKind: "agent", sendId: target.dataset.user, target: null, sender: target.dataset.sender ?? "" });
      },
      nameNumber: async function (event, target) {
        const box = target.closest("[data-unknown]");
        const name = box.querySelector("[data-unknown-name]")?.value ?? "";
        if (!name.trim()) return box.querySelector("[data-unknown-name]")?.focus();
        await nameUnknown(box.dataset.unknown, name);
      },
      offNumber: async function (event, target) { await nameUnknown(target.closest("[data-unknown]").dataset.unknown, "", { off: true }); },
      dirAdd: function () { this._dirAdd(); },
      devPub: async function (event, target) {
        const item = fromUuidSync(target.closest("[data-uuid]")?.dataset.uuid);
        const phone = item && getPhoneData(item);
        if (phone) await item.update({ [`flags.${MODULE_ID}.phone.pub`]: !phone.pub });
      },
      devPin: async function (event, target) {
        const item = fromUuidSync(target.closest("[data-uuid]")?.dataset.uuid);
        const phone = item && getPhoneData(item);
        if (phone) await item.update({ [`flags.${MODULE_ID}.phone.pin`]: !phone.pin });
      },
      dirPin: async function (event, target) { const e = this._dirEntry(target); if (e) await patchNpc(e.line, { pin: !e.pin }); },
      dirPub: async function (event, target) { const e = this._dirEntry(target); if (e) await patchNpc(e.line, { pub: !e.pub }); },
      dirOff: async function (event, target) { const e = this._dirEntry(target); if (e) await patchNpc(e.line, { off: !e.off }); },
      dirEdit: function (event, target) { this._setState({ dirEdit: Number(target.closest("[data-line]").dataset.line) }); },
      dirCancel: function () { this._setState({ dirEdit: null }); },
      dirSave: function () { this._dirSave(); },
      dirDelete: async function (event, target) {
        const e = this._dirEntry(target);
        if (!e) return;
        const ok = await DialogV2.confirm({ window: { title: t("Directory.Title"), icon: "fas fa-trash" }, content: `<p>${t("Directory.DeleteConfirm", { name: esc(npcLabel(e)) })}</p>`, rejectClose: false });
        if (ok) await deleteNpc(e.line);
      },
      sendTo: function (event, target) {
        this._focusSend = true;
        this._setState({ sendKind: target.dataset.kind, sendId: target.dataset.id ?? null, target: null, adding: false });
      },
      pickDevice: function (event, target) { this._focusSend = true; this._setState({ target: target.dataset.target }); },
      pickSender: function (event, target) { this._focusSend = true; this._setState({ sender: target.dataset.value }); },
      quickCreate: function (event, target) { this._quickCreate(target.dataset.kind); },
      reroll: function () { this._setState({ draws: null }); },
      addDevice: function () { this._setState({ adding: true, draws: null }); },
      cancelAdd: function () { this._setState({ adding: false }); },
      moreOptions: async function () {
        const actor = game.users.get(this._state.sendId)?.character ?? null;
        const res = await newPhoneDialog({ actor });
        if (res?.item?.parent === actor) this._created(res.item);
      },
      switchTab: function (event, target) { this._focusSend = true; this._setState({ tab: target.dataset.tab }); },
      mode: function (event, target) { this._focusSend = true; this._setState({ mode: target.dataset.mode }); },
      ring: function () { this._doRing(); },
      ringSecure: function () { this._doRing(true); },
      smsSecure: function () { this._doSms(true); },
      hangup: function () { hangUpAll(); },
      sms: function () { this._doSms(); },
      newPhone: async function () {
        const res = await newPhoneDialog();
        if (res?.open && res.item) openPhone(res.item.uuid);
      },
      directory: function () { directoryDialog(); },
      welcome: function () { openWelcome(); },
      // Module settings: a view of the panel instead of the tabs (gear in the status bar).
      openSettings: function () { this._setState({ settingsOpen: !this._state.settingsOpen }); },
      closeSettings: function () { this._setState({ settingsOpen: false }); },
      foundrySettings: function () {
        const sheet = game.settings.sheet ?? new foundry.applications.settings.SettingsConfig();
        sheet.render({ force: true });
      },
      reloadWorld: function () {
        const SC = foundry.applications.settings?.SettingsConfig;
        if (SC?.reloadConfirm) return SC.reloadConfirm({ world: true });
        foundry.utils.debouncedReload();
      },
      editPhone: async function (event, target) { editPhoneDialog(await fromUuid(target.dataset.uuid)); },
      contacts: async function (event, target) { contactsDialog(await fromUuid(target.dataset.uuid)); },
      give: async function (event, target) { giveDialog(await fromUuid(target.dataset.uuid)); },
      openPhone: function (event, target) { openPhone(target.dataset.uuid); },
      unmarkPhone: async function (event, target) {
        // Removing the device deletes the item. "Keep the item" only removes the device function.
        const item = await fromUuid(target.dataset.uuid);
        const choice = await DialogV2.wait({
          window: { title: t("Unmark.Title"), icon: "fas fa-trash" },
          content: `<p>${t("Unmark.Confirm", { name: esc(item.name) })}</p>`,
          buttons: [
            { action: "delete", label: t("Unmark.Delete"), icon: "fas fa-trash", default: true },
            { action: "keep", label: t("Unmark.Keep"), icon: "fas fa-box" },
            { action: "cancel", label: t("Cancel"), icon: "fas fa-xmark" }
          ],
          rejectClose: false
        });
        if (choice === "delete") await item.delete();
        else if (choice === "keep") await unmarkPhone(item);
      },
      selectPhone: function (event, target) {
        // Clicking a device opens the Send tab with it: as the sender for an NPC's device (the GM speaks
        // from it), otherwise as the recipient, through its PC card, its place card or "Other devices".
        this._focusSend = true;
        const item = fromUuidSync(target.dataset.uuid);
        const phone = getPhoneData(item);
        if (!phone) return;
        const p = { item, phone, actor: item.parent instanceof Actor ? item.parent : null };
        if (isNpcHeld(p)) return this._setState({ sender: phone.number, tab: "send" });
        const user = p.actor && !isFixed(phone) ? game.users.find((u) => !u.isGM && u.character?.id === p.actor.id) : null;
        const place = isFixed(phone) && game.scenes.get(phone.sceneId) && landlineUsers(phone).length ? phone.sceneId : null;
        const send = user ? { sendKind: "agent", sendId: user.id } : place ? { sendKind: "place", sendId: place } : { sendKind: "other", sendId: null };
        this._setState({ ...send, adding: false, target: `phone:${phone.number}`, tab: "send" });
      },
      sendReply: function (event, target) { this._sendReply(target.closest("[data-thread]")); },
      toggleSecureWith: async function (event, target) {
        // Secure line with this NPC, for this secure device: the GM's replies and calls, and the agent's messages.
        const th = target.closest("[data-thread]");
        const item = await fromUuid(th.dataset.uuid);
        const phone = getPhoneData(item);
        await setSecureWith(item, th.dataset.key, !secureWith(phone, th.dataset.key));
      },
      callBack: async function (event, target) {
        const th = target.closest("[data-thread]");
        const item = await fromUuid(th.dataset.uuid);
        const phone = getPhoneData(item);
        ring(`phone:${phone.number}`, { caller: displayName(phone, th.dataset.key) });
      },
      toggleNetwork: async function () {
        await game.settings.set(MODULE_ID, "networkDown", !game.settings.get(MODULE_ID, "networkDown"));
      },
      copyLink: function () {
        this._readForm();
        copyJournalLink(this._state);
      },
      copySecureLink: function () {
        this._readForm();
        copyJournalLink(this._state, { secure: true });
      },
      attach: async function () {
        const src = await pickImage();
        if (!src) return;
        this._readForm();
        this._state.att = { type: "image", src };
        this._skipRead = true;
        this.render();
      },
      clearAtt: function (event, target) {
        this._readForm();
        // In a thread: the attachment waiting in its reply line.
        const th = target.closest("[data-thread]");
        if (th) {
          delete this._state.replyAtts[th.dataset.thread];
          this._skipRead = true;
          return this.render();
        }
        this._state.att = null;
        this._skipRead = true;
        this.render();
      },
      toggleLock: async function (event, target) {
        const item = await fromUuid(target.dataset.uuid);
        await item.update({ [`flags.${MODULE_ID}.phone.locked`]: !getPhoneData(item)?.locked });
      },
      toggleCompromised: async function (event, target) {
        const item = await fromUuid(target.dataset.uuid);
        await item.update({ [`flags.${MODULE_ID}.phone.compromised`]: !getPhoneData(item)?.compromised });
      },
      toggleSignal: async function (event, target) {
        const item = await fromUuid(target.dataset.uuid);
        await item.update({ [`flags.${MODULE_ID}.phone.noSignal`]: !getPhoneData(item)?.noSignal });
      },
      filesView: function (event, target) { this._setState({ filesView: target.dataset.view }); },
      devFilter: function (event, target) { this._setState({ devFilter: target.dataset.filter }); },
      filesFilter: function (event, target) { this._setState({ filesFilter: target.dataset.filter }); },
      fileState: function (event, target) {
        const row = target.closest("[data-file]");
        setFileStates([{ uuid: row.dataset.uuid, id: row.dataset.file }], target.dataset.state);
      },
      groupState: function (event, target) {
        setFileStates(JSON.parse(target.closest("[data-refs]").dataset.refs), target.dataset.state);
      },
      previewFile: function (event, target) {
        const row = target.closest("[data-file]");
        if (row.dataset.mail) previewEntry(row.dataset.uuid, row.dataset.file);
        else previewFile(row.dataset.uuid, row.dataset.file);
      },
      cycleInbox: async function (event, target) {
        // Mailbox: available → locked → none → available.
        const item = await fromUuid(target.dataset.uuid);
        const next = { on: "locked", locked: "none", none: "on" }[target.dataset.inbox] ?? "on";
        await item.update({ [`flags.${MODULE_ID}.phone.inbox`]: next });
      },
      markAllSeen: async function () {
        for (const p of allPhones()) await patchLog(p.item, (e) => e.dir === "out" && e.seen === false, { seen: true });
      }
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/gm-panel.hbs`, scrollable: [".spt-tab-body"] }
  };

  static recentSenders = [];

  _state = {
    target: null, sender: "", text: "", att: null, tab: "send", mode: "message", drafts: {},
    inboxAgent: null, inboxNpc: null, inboxLimit: THREAD_PAGE,
    watchView: "listen", watchAgent: null, watchLeak: false,
    replyAtts: {},
    sendKind: null, sendId: null, addToDir: false, adding: false, draws: null, justCreated: null, createdNote: "",
    dirName: "", dirSearch: "", dirOffOpen: false, dirPinNew: false, dirPubNew: false, dirEdit: null,
    filesView: "device", filesFilter: "all", filesQuery: "", devFilter: "all"
  };

  /** Changes the state (tab, mode, recipient…) while keeping the current input. */
  /** Settings view: the module's own settings (read from their registration) and the advanced features. */
  _settingsContext() {
    const keys = ["universe", "gmLook", "language", "numberPrefix", "ringTimeout", "volume", "team", "floatingButton", "gmFloatingButton"];
    // Icons beside some settings and every advanced feature (same icons as the GM tab or the device).
    const ICONS = { team: "fa-user-group", intel: "fa-eye", secure: "fa-shield-halved", jammer: "fa-tower-broadcast", satellite: "fa-satellite" };
    const L = (s) => (s ? game.i18n.localize(s) : "");
    const rows = keys.map((key) => {
      const c = game.settings.settings.get(`${MODULE_ID}.${key}`);
      if (!c) return null;
      const value = game.settings.get(MODULE_ID, key);
      const row = { key, icon: ICONS[key] ?? null, name: L(c.name), hint: L(c.hint), reload: !!c.requiresReload, client: c.scope === "client" };
      if (c.choices) return { ...row, select: true, options: Object.entries(c.choices).map(([v, label]) => ({ value: v, label: L(label), selected: v === value })) };
      if (c.type === Boolean) return { ...row, bool: true, checked: !!value };
      if (c.type === Number && c.range) return { ...row, range: true, value, ...c.range };
      if (c.type === Number) return { ...row, number: true, value };
      return { ...row, text: true, value: value ?? "" };
    }).filter(Boolean);
    const features = FEATURES.map((k) => ({ key: k, icon: ICONS[k] ?? null, name: t(`Features.${k}`), hint: t(`Features.${k}Hint`), checked: feature(k) }));
    return { rows, features, reloadNeeded: !!this._reloadNeeded };
  }

  _setState(patch) {
    this._readForm();
    Object.assign(this._state, patch);
    this._skipRead = true;
    return this.render();
  }

  get title() {
    return t("Gm.PanelTitle");
  }

  /** Window icon by universe: switchboard (vintage), the Net (cyberpunk), otherwise a cell tower. */
  _initializeApplicationOptions(options) {
    options = super._initializeApplicationOptions(options);
    const icon = { retro: "fas fa-tty", cyberpunk: "fas fa-network-wired" }[universeKey()];
    if (icon) options.window.icon = icon;
    return options;
  }

  _readForm() {
    const el = this.element;
    if (!el?.querySelector) return;
    this._state.target = el.querySelector("[name=target]")?.value ?? this._state.target;
    this._state.sender = el.querySelector("[name=sender]")?.value ?? this._state.sender;
    this._state.text = el.querySelector("[name=text]")?.value ?? this._state.text;
    this._state.filesQuery = el.querySelector("[name=filesQuery]")?.value ?? this._state.filesQuery;
    const box = (name) => el.querySelector(`[name=${name}]`);
    this._state.addToDir = box("addToDir")?.checked ?? this._state.addToDir;
    this._state.dirName = box("dirName")?.value ?? this._state.dirName;
    this._state.dirSearch = box("dirSearch")?.value ?? this._state.dirSearch;
    this._state.dirPinNew = box("dirPinNew")?.checked ?? this._state.dirPinNew;
    this._state.dirPubNew = box("dirPubNew")?.checked ?? this._state.dirPubNew;
    for (const input of el.querySelectorAll("[data-draft]")) this._state.drafts[input.dataset.draft] = input.value;
  }

  async render(...args) {
    // Keep the current input before any re-render (actions may change _state afterwards).
    if (this.rendered && !this._skipRead) this._readForm();
    this._skipRead = false;
    return super.render(...args);
  }

  /** Template data: everything is computed here, the template only displays. */
  async _prepareContext() {
    const phones = allPhones().sort((a, b) => phoneLabel(a).localeCompare(phoneLabel(b)));
    const players = game.users.filter((u) => !u.isGM);
    // Direct to a player: only with an assigned character, who carries (or gets) the phone.
    const reachable = players.filter((u) => u.character).sort((a, b) => Number(b.active) - Number(a.active) || a.character.name.localeCompare(b.character.name));
    const countByNumber = phones.reduce((m, p) => m.set(norm(p.phone.number), (m.get(norm(p.phone.number)) ?? 0) + 1), new Map());

    // "Other devices": one line per number, however it is written (555-133 = 555133).
    // Order: agents' devices first, then other carried devices, then fixed ones (by label within each group).
    // An NPC's device is left out: nobody would receive it (the GM writes or calls FROM it instead).
    const rank = (p) => (isFixed(p.phone) ? 2 : p.actor?.hasPlayerOwner ? 0 : 1);
    // Devices already reached through a PC card or a place card are not repeated here.
    const pcIds = new Set(reachable.map((u) => u.character.id));
    const onCard = (p) => (isFixed(p.phone) ? !!game.scenes.get(p.phone.sceneId) && landlineUsers(p.phone).length > 0 : pcIds.has(p.actor?.id));
    const byRank = phones.filter((p) => !isNpcHeld(p) && !onCard(p)).sort((a, b) => rank(a) - rank(b));
    const numbers = [...new Map(byRank.map((p) => [norm(p.phone.number), p.phone.number])).values()];
    const targetDevices = numbers.map((n) => {
      const ps = phones.filter((p) => norm(p.phone.number) === norm(n));
      const label = ps.length > 1 ? `${n} — ${ps.map((p) => p.actor?.name ?? "?").join(" + ")} (${t("Gm.Cloned")})` : phoneLabel(ps[0]);
      return { value: `phone:${n}`, label, icon: iconOf(ps[0].phone), selected: this._state.target === `phone:${n}` };
    });

    // Send: an agent, or a place where agents are, then one of its devices.
    const places = new Map();
    for (const p of phones) {
      if (!isFixed(p.phone) || !game.scenes.get(p.phone.sceneId) || !landlineUsers(p.phone).length) continue;
      if (!places.has(p.phone.sceneId)) places.set(p.phone.sceneId, { id: p.phone.sceneId, name: game.scenes.get(p.phone.sceneId).name, devices: [] });
      places.get(p.phone.sceneId).devices.push(p);
    }
    const st = this._state;
    const validKind = (st.sendKind === "agent" && reachable.some((u) => u.id === st.sendId)) || (st.sendKind === "place" && places.has(st.sendId)) || st.sendKind === "other";
    if (!validKind) Object.assign(st, reachable.length ? { sendKind: "agent", sendId: reachable[0].id } : { sendKind: "other", sendId: null });
    const sendUser = st.sendKind === "agent" ? game.users.get(st.sendId) : null;
    let tiles = [];
    if (sendUser) tiles = phones.filter((p) => p.actor?.id === sendUser.character.id && !modelOf(p.phone).fixed);
    else if (st.sendKind === "place") tiles = places.get(st.sendId).devices;
    const tileValue = (p) => `phone:${p.phone.number}`;
    if (st.sendKind === "other") {
      if (!targetDevices.some((d) => d.value === st.target)) st.target = targetDevices[0]?.value ?? "";
    } else if (!tiles.some((p) => tileValue(p) === st.target)) {
      const pick = sendUser ? lastUsedDevice(sendUser, tiles) : tiles[0];
      st.target = pick ? tileValue(pick) : "";
    }
    for (const d of targetDevices) d.selected = d.value === st.target;
    const capability = (p) => {
      const m = modelOf(p.phone);
      if (m.pager) return t("Gm.CanPage");
      const msg = msgOn(p.phone) ? (m.mail ? t("Gm.Mail") : t("Gm.ModeMessage")) : null;
      return [msg, m.noCalls ? null : t("Gm.ModeCall")].filter(Boolean).join(" · ");
    };
    const selectedTile = tiles.find((p) => tileValue(p) === st.target);
    const sendAgents = reachable.map((u) => ({ id: u.id, name: u.character.name, img: u.character.img, offline: !u.active, active: st.sendKind === "agent" && st.sendId === u.id }));
    const sendPlaces = [...places.values()].sort((a, b) => a.name.localeCompare(b.name)).map((pl) => ({ id: pl.id, name: pl.name, img: game.scenes.get(pl.id)?.thumb || null, active: st.sendKind === "place" && st.sendId === pl.id }));
    const sendTiles = tiles.map((p) => ({
      target: tileValue(p),
      label: p.phone.label,
      icon: iconOf(p.phone),
      // An agent's device: its number or address; a place's: who is there.
      sub: st.sendKind === "place" ? landlineUsers(p.phone).map((u) => u.character?.name ?? u.name).join(", ") : p.phone.number,
      secure: isSecure(p.phone),
      satellite: isSatellite(p.phone),
      selected: p === selectedTile,
      fresh: p.item.uuid === st.justCreated
    }));
    // An agent without a device (or "+"): pick a model, one click creates it with a drawn name and number.
    let createCard = null;
    if (sendUser && (!tiles.length || st.adding)) {
      const actor = sendUser.character;
      if (st.draws?.user !== sendUser.id) st.draws = { user: sendUser.id, list: {} };
      const rec = universe().defaultModel;
      createCard = {
        name: actor.name,
        canCancel: tiles.length > 0,
        kinds: quickKinds().map((k) => {
          st.draws.list[k.key] ??= { label: deviceName(k.model, { satellite: satellitePolicy(k.model) === "forced" }) ?? k.label, number: randomAddress(k.model, { name: actor.name }) };
          const d = st.draws.list[k.key];
          return { ...k, drawLabel: d.label, drawNumber: d.number, recommended: k.model === rec };
        })
      };
    }
    const createdNote = st.createdNote;
    st.createdNote = "";
    st.justCreated = null;
    // Button: "Send to Cole (Smartphone)", "Ring Motel Starlite (Landline)": who, then the kind of device.
    const who = sendUser ? sendUser.character.name : st.sendKind === "place" ? places.get(st.sendId)?.name : "";
    const targetName = selectedTile && who ? t("Gm.DeviceOf", { name: who, device: modelLabel(selectedTile.phone) }) : selectedTile?.phone.label ?? "";

    // Conversations: agents with NPCs (the GM answers), and listening to agents between themselves.
    const allThreads = collectThreads(phones);
    const npcThreads = allThreads.filter((th) => !th.agents);
    const agentThreads = allThreads.filter((th) => th.agents);
    const actors = agentActors(phones);
    if (st.inboxAgent && !actors.some((a) => a.id === st.inboxAgent)) st.inboxAgent = null;
    let shown = npcThreads;
    if (st.inboxAgent) shown = shown.filter((th) => th.actor?.id === st.inboxAgent);
    if (st.inboxNpc) shown = shown.filter((th) => th.npcId === st.inboxNpc);
    const inboxAgents = actors
      .map((a) => ({ id: a.id, name: a.name, img: a.img, active: st.inboxAgent === a.id, unread: npcThreads.filter((th) => th.actor?.id === a.id).reduce((n, th) => n + th.unread, 0) }))
      .filter((a) => npcThreads.some((th) => th.actor?.id === a.id));
    const pinned = npcDirectory().filter((e) => e.pin).map((e) => {
      const id = npcId(e);
      return { id, name: npcLabel(e), active: st.inboxNpc === id, unread: npcThreads.filter((th) => th.npcId === id).reduce((n, th) => n + th.unread, 0) };
    });
    // Pinned devices (an NPC's, or a place's): their threads are filed under their number.
    const pinnedDevs = pinnedDevices(phones);
    for (const d of pinnedDevs) {
      const id = norm(d.number);
      if (pinned.some((x) => x.id === id)) continue;
      pinned.push({ id, name: d.name, active: st.inboxNpc === id, unread: npcThreads.filter((th) => th.npcId === id).reduce((n, th) => n + th.unread, 0) });
    }
    // Filtered on one NPC: "write as this NPC to…" any agent, thread or not.
    let npcFocus = null;
    if (st.inboxNpc) {
      const npc = npcDirectory().find((e) => npcId(e) === st.inboxNpc);
      const th = npcThreads.find((x) => x.npcId === st.inboxNpc);
      const dev = npc ? null : pinnedDevs.find((d) => norm(d.number) === st.inboxNpc);
      const name = npc ? npcLabel(npc) : dev ? dev.name : th ? gmName(th.phone, th.key) : st.inboxNpc;
      npcFocus = { name, number: npc?.name ? npc.number : dev?.number ?? "", sender: npc ? npc.name || npc.number : dev?.number ?? th?.key ?? "", agents: reachable.map((u) => ({ id: u.id, name: u.character.name, img: u.character.img })) };
    }
    const threadView = (th) => {
      const conv = getLog(th.phone, { includePending: true }).filter((e) => e.kind === "sms" && !e.prep && sameConv(th.phone, e.with, th.key));
      const unknown = !th.agents && isUnknownNumber(th.phone, th.key);
      return {
        id: th.id,
        uuid: th.item.uuid,
        key: th.key,
        npcId: th.npcId,
        who: holderName(th.item, th.phone),
        // The agent's device icon: the GM sees at a glance a text (phone) or an email (computer).
        icon: iconOf(th.phone),
        modelLabel: modelOf(th.phone).label,
        // Channel of the thread (text or email): replies always go back the same way.
        channel: isComputer(th.phone) ? "fa-envelope" : "fa-comment",
        channelLabel: isComputer(th.phone) ? t("Gm.Mail") : t("Gm.ModeMessage"),
        // Between agents: the other agent's name (with their device icon); to an NPC: the directory name.
        others: th.agents ? otherAgents(th) : [],
        to: th.agents ? "" : gmName(th.phone, th.key),
        // The NPC's number or email, shown small after a known name.
        addr: th.agents || isMasked(th.key) || gmName(th.phone, th.key) === th.key ? "" : th.key,
        pinned: !th.agents && !!findNpc(keyFor(th.phone, th.key), { all: true })?.pin,
        agents: th.agents,
        unknown,
        compromised: !!th.phone.compromised,
        // Secure device: the shield switches the secure line with this NPC (between agents: shown only).
        canSecure: !th.agents && isSecure(th.phone),
        secure: th.agents ? !!conv[0]?.secure : secureWith(th.phone, th.key),
        unread: th.unread,
        canCall: !th.agents && !modelOf(th.phone).noCalls,
        // The link would go through the satellite (no mobile network there): shown on the buttons.
        viaSat: viaSatellite(th.phone),
        draft: this._state.drafts[th.id] ?? "",
        attChip: attChipHtml(this._state.replyAtts[th.id]),
        bubbles: conv.slice(0, INBOX_BUBBLES).reverse().map((e) => ({
          dir: e.dir,
          fwd: !!e.fwd,
          secure: !!e.secure,
          pending: !!e.pending,
          att: bubbleAtt(e.att),
          text: e.text ? nl2br(e.text) : "",
          // Messages that reach the GM (sent by the agent): how long ago, the date on hover.
          ago: e.dir === "out" ? timeAgo(e.t) : "",
          when: e.dir === "out" && e.t ? new Date(e.t).toLocaleString(currentLang()) : ""
        })),
        more: Math.max(0, conv.length - INBOX_BUBBLES)
      };
    };
    const inbox = shown.slice(0, st.inboxLimit).map(threadView);
    const inboxUnread = npcThreads.reduce((n, th) => n + th.unread, 0);

    // Wiretaps: messages between agents the GM has not looked at yet (reset when the GM opens Wiretaps).
    // Intel is an advanced feature: switched off, its tab is gone.
    if (st.tab === "watch" && !feature("intel")) st.tab = this._state.tab = "send";
    const listenSeen = game.user.getFlag(MODULE_ID, "listenSeen") ?? 0;
    const viewingListen = st.tab === "watch" && (st.watchView ?? "listen") === "listen";
    let listenNew = 0;
    for (const p of phones) listenNew += getLog(p.phone).filter((e) => e.kind === "sms" && e.dir === "out" && e.pj && (e.t ?? 0) > listenSeen).length;
    if (viewingListen && listenNew) {
      this._markListenSeen = true;
      listenNew = 0;
    }

    // Surveillance (read only): wiretaps between agents, calls, tracking; one agent filter for all three,
    // and "what the enemy sees" (compromised devices only).
    let watch = null;
    if (st.tab === "watch") {
      const agentOk = (ids) => !st.watchAgent || ids.has(st.watchAgent);
      const leakOk = (th) => !st.watchLeak || th.phone.compromised || phonesByNumber(keyFor(th.phone, th.key)).some((p) => p.phone.compromised);
      const views = ["listen", "calls", ...(feature("tracking") ? ["tracking"] : [])];
      const view = views.includes(st.watchView) ? st.watchView : "listen";
      watch = {
        view,
        leak: st.watchLeak,
        allAgents: !st.watchAgent,
        agents: actors.map((a) => ({ id: a.id, name: a.name, img: a.img, active: st.watchAgent === a.id }))
      };
      if (view === "listen") {
        const list = agentThreads.filter((th) => agentOk(threadActors(th)) && leakOk(th));
        watch.threads = list.slice(0, st.inboxLimit).map(threadView);
        watch.more = list.length > st.inboxLimit;
      } else if (view === "calls") {
        watch.calls = callGroups(callRows(phones).filter((r) => agentOk(new Set(r.actorIds)) && (!st.watchLeak || r.compromised)));
      } else {
        watch.tracking = trackingRows(phones)
          .filter((r) => !st.watchAgent || r.id === st.watchAgent)
          .map((r) => (st.watchLeak ? { ...r, devices: r.devices.filter((d) => d.compromised) } : r))
          .filter((r) => !st.watchLeak || r.devices.length);
      }
    }

    const npcThreadsAll = collectThreads(phones).filter((th) => !th.agents);
    // Devices grouped: by holder, then by place, then "held by nobody".
    const groups = new Map();
    const groupOf = (p) => {
      if (isFixed(p.phone)) {
        const scene = game.scenes.get(p.phone.sceneId);
        if (!scene) return { key: "s:none", cat: "noplace", order: 3, name: t("NoPlace"), img: null, icon: "fa-network-wired" };
        return { key: `s:${p.phone.sceneId}`, cat: "place", order: 2, name: scene.name, img: scene.thumb ?? null, icon: "fa-location-dot" };
      }
      if (p.actor) {
        const npc = isNpcHeld(p);
        return { key: `a:${p.actor.id}`, cat: npc ? "npc" : "pc", order: npc ? 1 : 0, name: p.actor.name, img: p.actor.img, icon: npc ? "fa-user-secret" : "fa-user" };
      }
      const shared = sharedUsers(p.item);
      if (shared.length) return { key: "shared", cat: "none", order: 4, name: t("Gm.Shared"), img: null, icon: "fa-users" };
      return { key: "none", cat: "none", order: 5, name: t("Gm.Nobody"), img: null, icon: "fa-ghost" };
    };
    // Jammers are listed with their carrier, never as recipients.
    const jammers = allJammers().sort((a, b) => phoneLabel(a).localeCompare(phoneLabel(b)));
    for (const p of [...phones, ...jammers]) {
      const g = groupOf(p);
      if (!groups.has(g.key)) groups.set(g.key, { ...g, devices: [] });
      const model = modelOf(p.phone);
      const mode = MODES[modeOf(p.phone)] ?? MODES.on;
      const fixed = isFixed(p.phone);
      const unread = unreadCount(p.phone);
      groups.get(g.key).devices.push({
        uuid: p.item.uuid,
        number: p.phone.number,
        label: p.phone.label,
        icon: iconOf(p.phone),
        modelLabel: modelLabel(p.phone),
        modeIcon: fixed || modeOf(p.phone) === "on" ? null : mode.icon,
        modeLabel: mode.label,
        fixed,
        locked: !!p.phone.locked,
        compromised: !!p.phone.compromised,
        secure: isSecure(p.phone),
        satellite: isSatellite(p.phone),
        noSignal: !fixed && !!p.phone.noSignal,
        cloned: countByNumber.get(norm(p.phone.number)) > 1,
        unread,
        unreadTitle: unread ? tn("Gm.UnreadByPlayer", unread) : "",
        // Pinned (an NPC's, a place's or nobody's device), public, and its threads in Messages.
        canPin: !!p.phone.number && pinnable(p),
        pin: !!p.phone.number && pinnable(p) && !!p.phone.pin,
        pub: !!p.phone.pub,
        filter: messagesFilter(p, npcThreadsAll),
        npcHeld: isNpcHeld(p),
        jammer: isJammer(p.phone),
        jamOn: isJammer(p.phone) && !!p.phone.jamming && !p.phone.jamFailed,
        jamFailed: isJammer(p.phone) && !!p.phone.jamming && !!p.phone.jamFailed
      });
    }
    const allGroups = [...groups.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    // Filter by holder: PCs, NPCs, places, no location, not held (back to "all" each time the panel opens).
    const cats = ["pc", "npc", "place", "noplace", "none"];
    const count = (c) => allGroups.filter((g) => g.cat === c).reduce((n, g) => n + g.devices.length, 0);
    if (st.devFilter !== "all" && !count(st.devFilter)) st.devFilter = "all";
    const devFilters = [
      { key: "all", label: t("Gm.DevCat_all"), n: allGroups.reduce((n, g) => n + g.devices.length, 0) },
      ...cats.map((c) => ({ key: c, label: t(`Gm.DevCat_${c}`), n: count(c) })).filter((f) => f.n)
    ].map((f) => ({ ...f, active: f.key === st.devFilter }));
    const sortedGroups = st.devFilter === "all" ? allGroups : allGroups.filter((g) => g.cat === st.devFilter);

    // What the chosen recipient accepts: only the possible forms are shown.
    const [kind, id] = (this._state.target ?? "").split(/:(.*)/s);
    const tp = kind === "phone" ? phones.filter((p) => norm(p.phone.number) === norm(id)) : [];
    const canMessage = kind === "phone" ? tp.some((p) => msgOn(p.phone)) : kind === "user";
    const canCall = kind === "phone" ? tp.some((p) => !modelOf(p.phone).noCalls) : kind === "user";
    if (!canMessage && canCall) this._state.mode = "call";
    if (!canCall && canMessage) this._state.mode = "message";
    const messaging = canMessage && canCall;
    // "Secure line" box: only for a secure recipient (a player: their character's carried phone).
    const tpUser = kind === "user" ? carriedPhone(game.users.get(id)) : null;
    const canSecure = [...tp, ...(tpUser ? [tpUser] : [])].some((p) => isSecure(p.phone));
    return {
      settingsView: st.settingsOpen ? this._settingsContext() : null,
      feat: Object.fromEntries([...FEATURES, "jammer", "tracking"].map((k) => [k, feature(k)])),
      tab: this._state.tab,
      mode: this._state.mode,
      messaging,
      canSecure,
      down: game.settings.get(MODULE_ID, "networkDown"),
      // Scenes opened to the satellite "for the whole scene": a green satellite in the status bar.
      satSky: feature("satellite") ? (game.settings.get(MODULE_ID, "satSky") ?? []).map((id) => game.scenes.get(id)?.name).filter(Boolean).join(", ") : "",
      // Scenes cut by a jammer: one chip each, a click opens the jammer.
      jams: [...jammedScenes()].flatMap(([sceneId, list]) =>
        list.map((p) => ({ uuid: p.item.uuid, label: t("Jammer.Chip", { scene: game.scenes.get(sceneId)?.name ?? "?", who: p.actor?.name ?? p.phone.label }) }))
      ),
      pending: phones.reduce((n, p) => n + getLog(p.phone, { includePending: true }).filter((e) => e.pending).length, 0),
      ringing: [...pendingCalls.values()].map((c) => c.label).join(", "),
      targetDevices,
      sendAgents,
      sendPlaces,
      sendTiles,
      sendKind: st.sendKind,
      sendUserId: sendUser?.id ?? "",
      createCard,
      createdNote,
      // No agent to write to: no player account, or no player with an assigned character.
      noAgents: reachable.length ? "" : players.length ? t("Gm.NoAgents") : t("Gm.NoPlayers"),
      targetName,
      viaSat: tp.some((p) => viaSatellite(p.phone)),
      sender: this._state.sender,
      senderOptions: this._senderOptions(phones, kind, id),
      pinnedSenders: [...npcDirectory().filter((e) => e.pin).map((e) => ({ value: e.name || e.number, label: npcLabel(e) })), ...pinnedDevices(phones).map((d) => ({ value: d.number, label: d.name }))],
      knownSenders: JSON.stringify(this._knownSenders(phones)),
      addToDir: this._state.addToDir,
      text: this._state.text,
      attChip: attChipHtml(this._state.att),
      inbox,
      inboxUnread,

      inboxAgents,
      inboxAllAgents: !st.inboxAgent,
      pinned,
      npcFocus,
      moreThreads: shown.length > st.inboxLimit,
      showMarkAll: inboxUnread > 0,
      npcThreadCount: npcThreads.length,
      agentThreadCount: agentThreads.length,
      directory: this._state.tab === "directory" ? this._directoryContext(phones) : null,
      unknownCount: unknownNumbers(phones).length,
      groups: sortedGroups,
      devFilters,
      deviceCount: phones.length,
      watch,
      listenNew,
      files: this._state.tab === "files" ? this._filesContext(phones) : null,
      fileCount: phones.reduce((n, p) => n + (isComputer(p.phone) ? (p.phone.files ?? []).length + getLog(p.phone, { includePending: true }).filter((e) => e.att?.type === "doc").length : 0), 0)
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    PhonePanel.instance = this;
    // Settings view: each field saves on change.
    for (const el of this.element.querySelectorAll("[data-setting]")) {
      el.addEventListener("change", async () => {
        const key = el.dataset.setting;
        const c = game.settings.settings.get(`${MODULE_ID}.${key}`);
        const value = el.type === "checkbox" ? el.checked : c?.type === Number ? Number(el.value) : el.value;
        if (c?.requiresReload) this._reloadNeeded = true;
        await game.settings.set(MODULE_ID, key, value);
        this.render();
      });
    }
    for (const el of this.element.querySelectorAll("[data-feature]")) {
      el.addEventListener("change", () => setFeature(el.dataset.feature, el.checked));
    }
    if (this._markListenSeen) {
      this._markListenSeen = false;
      game.user.setFlag(MODULE_ID, "listenSeen", Date.now());
    }
    bindIconSelects(this.element);
    const search = this.element.querySelector("[name=filesQuery]");
    if (search) {
      search.addEventListener("input", () => filterFiles(this.element, search.value));
      filterFiles(this.element, search.value);
    }
    this.element.querySelector("select[name=target]")?.addEventListener("change", (ev) => {
      this._focusSend = true;
      this._setState({ target: ev.target.value });
    });
    if (this._focusSend) {
      this._focusSend = false;
      this.element.querySelector(".spt-gm-send textarea[name=text], .spt-gm-send [data-action=ring]")?.focus();
    }
    // Directory: Enter adds (quick add), saves (inline edit) or names an unknown number.
    // Directory search: filters the rows in place, no re-render.
    this.element.querySelector(".spt-dir-off")?.addEventListener("toggle", (ev) => (this._state.dirOffOpen = ev.target.open));
    const dirSearch = this.element.querySelector("[name=dirSearch]");
    if (dirSearch) {
      dirSearch.addEventListener("input", () => this._dirFilter(dirSearch.value));
      this._dirFilter(dirSearch.value);
    }
    for (const input of this.element.querySelectorAll("[name=dirName]")) {
      input.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        this._dirAdd();
      });
    }
    for (const input of this.element.querySelectorAll("[name=dirEditName], [name=dirEditNumber]")) {
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape") return ev.preventDefault(), this._setState({ dirEdit: null });
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        this._dirSave();
      });
    }
    for (const input of this.element.querySelectorAll("[data-unknown-name]")) {
      input.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        if (input.value.trim()) nameUnknown(input.closest("[data-unknown]").dataset.unknown, input.value);
      });
    }
    // Quick creation: hovering a model shows the name and number it will get.
    const preview = this.element.querySelector("[data-quick-preview]");
    if (preview) {
      const idle = preview.textContent;
      for (const b of this.element.querySelectorAll(".spt-quick-kinds [data-preview]")) {
        b.addEventListener("mouseenter", () => (preview.textContent = b.dataset.preview));
        b.addEventListener("mouseleave", () => (preview.textContent = idle));
      }
    }
    // "From": "add to directory" only for a sender nobody knows yet.
    const sender = this.element.querySelector("[name=sender]");
    const addBox = this.element.querySelector(".spt-add-dir");
    if (sender && addBox) {
      const known = new Set(JSON.parse(sender.dataset.known || "[]"));
      const sync = () => {
        const v = sender.value.trim();
        addBox.hidden = !v || known.has(norm(v)) || isMasked(v);
      };
      sender.addEventListener("input", sync);
      sync();
    }
    for (const input of this.element.querySelectorAll("[data-draft]")) {
      input.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter" || ev.shiftKey) return;
        ev.preventDefault();
        this._sendReply(input.closest("[data-thread]"));
      });
    }
    // A journal page or an image dropped on a thread's reply line: sent with the next reply.
    for (const zone of this.element.querySelectorAll(".spt-reply-drop")) {
      bindDrop(zone, (att) => {
        this._readForm();
        this._state.replyAtts[zone.closest("[data-thread]").dataset.thread] = att;
        this._skipRead = true;
        this.render();
      });
    }
    bindDrop(this.element.querySelector(".spt-drop"), (att) => {
      this._readForm();
      this._state.att = att;
      this._skipRead = true;
      this.render();
    });
  }

  /** Quick creation from the Send tab: the drawn name and number, for the selected agent. */
  async _quickCreate(key) {
    const user = game.users.get(this._state.sendId);
    const actor = user?.character;
    const kind = quickKinds().find((k) => k.key === key);
    if (!actor || !kind) return;
    const draw = this._state.draws?.user === user.id ? this._state.draws.list[key] : null;
    const item = await createPhone(actor, { model: kind.model, label: draw?.label, number: draw?.number });
    if (item) this._created(item);
  }

  /** A device was just created for the selected agent: it becomes the recipient, its tile lights up. */
  _created(item) {
    const phone = getPhoneData(item);
    this._focusSend = true;
    this._setState({
      target: `phone:${phone.number}`,
      adding: false,
      draws: null,
      justCreated: item.uuid,
      createdNote: t("Gm.Created", { label: phone.label, number: phone.number, name: item.parent?.name ?? "" })
    });
  }

  /**
   * Directory tab: quick add, numbers to identify, then three sections: the devices (agents and places,
   * read from the items), the NPCs (directory lines, section titles kept) and the numbers out of service.
   */
  _directoryContext(phones) {
    const usage = npcUsage(phones);
    const edit = this._state.dirEdit;
    const all = directoryRows().map((r) => {
      if (r.title !== undefined) return { title: r.title, line: r.line };
      const who = [...(usage.get(r.line) ?? [])].join(", ");
      return { ...r, label: npcLabel(r), unnamed: !r.name, editing: r.line === edit, who, npcId: npcId(r), search: `${r.name} ${r.number}`.toLowerCase() };
    });
    // A section title is kept only if an active NPC follows it.
    const rows = all.filter((r, i) => {
      if (r.title === undefined) return !r.off || r.editing;
      for (const n of all.slice(i + 1)) {
        if (n.title !== undefined) return false;
        if (!n.off || n.editing) return true;
      }
      return false;
    });
    const off = all.filter((r) => r.title === undefined && r.off && !r.editing);
    // Devices are managed in the Devices tab: here only to point a search there ("555-1234 is a device").
    const devices = phones
      .filter((p) => p.phone.number)
      .map((p) => {
        const name = publicName(p) || p.phone.label || "";
        return { number: p.phone.number, name, search: `${name} ${p.phone.number}`.toLowerCase() };
      });
    const unknown = unknownNumbers(phones).map((u) => ({
      key: u.key,
      who: [...u.who].join(", "),
      count: [u.sms ? tn("Directory.Messages", u.sms) : "", u.calls ? tn("Directory.Calls", u.calls) : ""].filter(Boolean).join(" · ")
    }));
    return { rows, off, offOpen: this._state.dirOffOpen, devices, unknown, name: this._state.dirName, search: this._state.dirSearch, pin: this._state.dirPinNew, pub: this._state.dirPubNew };
  }

  /** Directory search: hides the rows that do not match (name or number), and the empty section titles. */
  _dirFilter(query) {
    this._state.dirSearch = query;
    const q = query.trim().toLowerCase();
    const root = this.element.querySelector(".spt-gm-directory");
    if (!root) return;
    for (const row of root.querySelectorAll("[data-search]")) row.hidden = !!q && !row.dataset.search.includes(q);
    for (const title of root.querySelectorAll(".spt-dir-section")) title.hidden = !!q;
    // A device found by the search: only a pointer to the Devices tab, shown while searching.
    for (const row of root.querySelectorAll("[data-device-hit]")) row.hidden = !q || !row.dataset.deviceHit.includes(q);
    // Out of service, folded: opened when the search finds a line there.
    const off = root.querySelector(".spt-dir-off");
    if (off && q && off.querySelector("[data-search]:not([hidden])")) off.open = true;
  }

  _dirEntry(target) {
    const line = Number(target.closest("[data-line]")?.dataset.line);
    return npcDirectory().find((e) => e.line === line) ?? null;
  }

  /** Quick add: an empty number gets a free one. */
  async _dirAdd() {
    this._readForm();
    const st = this._state;
    const name = st.dirName.trim();
    if (!name) return this.element.querySelector("[name=dirName]")?.focus();
    // The number is generated: the GM can change it afterwards (click on the name).
    const number = freeNpcNumber();
    const ok = await saveNpc({ name, number, pin: st.dirPinNew, pub: st.dirPubNew });
    if (!ok) return;
    Object.assign(st, { dirName: "", dirPinNew: false, dirPubNew: false });
    this._skipRead = true;
    await this.render();
    this.element.querySelector("[name=dirName]")?.focus();
  }

  async _dirSave() {
    const row = this.element.querySelector("[data-line].editing");
    const e = row && npcDirectory().find((x) => x.line === Number(row.dataset.line));
    if (!e) return this._setState({ dirEdit: null });
    const name = row.querySelector("[name=dirEditName]")?.value ?? e.name;
    const number = row.querySelector("[name=dirEditNumber]")?.value ?? e.number;
    if (await saveNpc({ ...e, name, number }, e.line)) this._setState({ dirEdit: null });
  }

  /** Names and numbers the "From" field already knows (no "add to directory" for them). */
  _knownSenders(phones) {
    const known = new Set([norm(t("Masked"))]);
    for (const e of npcDirectory()) for (const v of [e.name, e.number]) if (v) known.add(norm(v));
    for (const p of phones) {
      known.add(norm(p.phone.number));
      for (const c of p.phone.contacts ?? []) for (const v of [c.name, c.number]) if (v) known.add(norm(v));
    }
    return [...known];
  }

  /** "Add to directory" ticked: the typed sender becomes an entry (a name, or a number to name later). */
  async _senderToDirectory() {
    const s = this._state.sender.trim();
    if (!this._state.addToDir || !s || isMasked(s) || findNpc(s, { all: true })) return;
    this._state.addToDir = false;
    await saveNpc(/^[\d\s()+.-]+$/.test(s) || s.includes("@") ? { number: s } : { name: s });
  }

  /** Inline reply in a thread: sent as the NPC, and the thread is marked read. */
  async _sendReply(th) {
    const input = th?.querySelector("[data-draft]");
    const text = input?.value.trim() ?? "";
    const att = this._state.replyAtts[th?.dataset.thread] ?? null;
    if (!text && !att) return;
    const item = await fromUuid(th.dataset.uuid);
    const phone = getPhoneData(item);
    const key = th.dataset.key;
    input.value = "";
    delete this._state.drafts[th.dataset.thread];
    delete this._state.replyAtts[th.dataset.thread];
    await patchLog(item, (e) => e.dir === "out" && sameConv(phone, e.with, key), { seen: true });
    await sendSms(`phone:${phone.number}`, text, { sender: displayName(phone, key), att });
  }

  /** secure: the "secure" button (secure recipient only); the plain button is a line in clear. */
  async _doRing(secure = false) {
    this._readForm();
    if (!this._state.target) return ui.notifications.warn(t("Warn.NoRecipient"));
    this._rememberSender();
    await this._senderToDirectory();
    ring(this._state.target, { caller: this._normSender(), secure });
  }

  /** Files tab: every computer file, by device or by source journal. */
  _filesContext(phones) {
    const where = (p) => {
      if (isFixed(p.phone)) return game.scenes.get(p.phone.sceneId)?.name ?? t("NoPlace");
      if (p.actor) return t("Files.CarriedBy", { name: p.actor.name });
      const n = sharedUsers(p.item).length;
      return n ? t("Files.SharedWith", { n }) : t("Gm.Nobody");
    };
    const computers = phones
      .filter((p) => isComputer(p.phone))
      .map((p) => ({ item: p.item, phone: p.phone, label: p.phone.label || p.item.name, icon: iconOf(p.phone), img: p.actor?.img ?? null, where: where(p) }));
    const { view, filter } = { view: this._state.filesView, filter: this._state.filesFilter };
    const { groups, counts } = filesOverview(computers, { view, filter });
    const filters = [
      { key: "all", label: t("Files.All"), icon: null },
      { key: "visible", label: t("Files.State_visible"), icon: "fa-eye" },
      { key: "locked", label: t("Files.State_locked"), icon: "fa-lock" },
      { key: "hidden", label: t("Files.State_hidden"), icon: "fa-eye-slash" }
    ].map((f) => ({ ...f, n: counts[f.key], active: f.key === filter }));
    return { groups, filters, view, query: this._state.filesQuery, hasComputers: computers.length > 0, noFiles: !counts.all };
  }

  /**
   * Sender suggestions: hidden number, the recipient's contacts, recent senders, other devices.
   * The field stays free text; a contact name is turned into its number on the recipient's side.
   */
  _senderOptions(phones, kind, id) {
    const recipient = kind === "phone"
      ? phones.filter((p) => norm(p.phone.number) === norm(id))
      : phones.filter((p) => !isFixed(p.phone) && holders(p).some((u) => u.id === id));
    const opts = new Map();
    const add = (value, label = "") => {
      if (value && !opts.has(norm(value))) opts.set(norm(value), { value, label });
    };
    add(t("Masked"));
    for (const e of npcDirectory()) if (e.pin) add(e.number || e.name, `★ ${npcLabel(e)}`);
    for (const d of pinnedDevices(phones)) add(d.number, `★ ${d.name}`);
    // NPC directory first: the value is the number, so a secret NPC shows as a number on the agent's side.
    for (const e of npcDirectory()) if (!e.off) add(e.number || e.name, e.name && e.number ? `${e.name} · ${t("Directory.Title")}` : t("Directory.Title"));
    for (const p of recipient) for (const c of p.phone.contacts ?? []) add(c.name, c.number ? `${c.number} · ${t("Gm.InContacts")}` : t("Gm.InContacts"));
    for (const s of PhonePanel.recentSenders) add(s, t("Gm.Recent"));
    const mine = new Set(recipient.map((p) => p.item.uuid));
    for (const p of phones) if (!mine.has(p.item.uuid)) add(p.phone.number, phoneLabel(p));
    return [...opts.values()];
  }

  /** Remembers the last senders used (this session only). */
  _rememberSender() {
    const s = this._state.sender.trim();
    if (!s || isMasked(s)) return;
    PhonePanel.recentSenders = [s, ...PhonePanel.recentSenders.filter((x) => norm(x) !== norm(s))].slice(0, 5);
  }

  /** Typed sender; "Hidden number" (in any language) is stored in its internal form. */
  _normSender() {
    const s = this._state.sender.trim();
    if (!s || isMasked(s)) return MASKED;
    // A directory NPC typed by name is sent from its number (the agent sees the number unless they know it).
    const npc = findNpc(s, { all: true });
    return npc?.number || s;
  }

  async _doSms(secure = false) {
    this._readForm();
    if (!this._state.target) return ui.notifications.warn(t("Warn.NoRecipient"));
    this._rememberSender();
    await this._senderToDirectory();
    await sendSms(this._state.target, this._state.text, { sender: this._normSender(), att: this._state.att, secure });
    this._state.text = "";
    this._state.att = null;
    this._skipRead = true;
    this.render();
  }
}

