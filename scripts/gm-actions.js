import { MODULE_ID, PAGER_MAX, RING_SRC, SECURE_ICON, SMS_SRC, SOCKET } from "./constants.js";
import { addLog, isComputer, isFixed, mutateLog, isNpcHeld, isSecure, secureWith, setSecureWith, displayName, getPhoneData, holderName, holders, isLandline, keyFor, modelOf, phonesByNumber, gmName, isUnknownNumber, isOffNumber, nameUnknown } from "./devices.js";
import { deliverToPhone } from "./messages.js";
import { RingDialog } from "./player-calls.js";
import { finishOrigin, hangUp, networkBusy, pendingCalls, ring } from "./ring.js";
import { esc, playLocal, rerenderAll } from "./util.js";
import { labels, t } from "./i18n.js";
import { agentSide, npcSide, startLive } from "./live-call.js";
import { cancelLink, requestLink, satDevices, satPending } from "./satellite.js";

/** The sending device as a device entry ({ item, phone, actor }), for the satellite check. */
const entryOf = (item) => ({ item, phone: getPhoneData(item), actor: item?.parent instanceof Actor ? item.parent : null });
/* -------------------------------------------- */
/*  GM: handling player actions                 */
/* -------------------------------------------- */

/** GM: does the acting agent actually hold this device? */
export function senderHolds(item, userId) {
  const phone = getPhoneData(item);
  if (!phone || !userId) return false;
  const actor = item.parent instanceof Actor ? item.parent : null;
  const ok = holders({ item, phone, actor }).some((u) => u.id === userId);
  if (!ok) console.warn(`${MODULE_ID} | ${game.users.get(userId)?.name ?? userId} does not hold "${phone.label}": action ignored.`);
  return ok;
}

/** Warns the GM when a compromised device (tapped, known to the enemy) sends or receives. */
function warnCompromised(...phones) {
  for (const phone of phones) if (phone?.compromised) ui.notifications.warn(t("Gm.CompromisedDevice", { label: phone.label }));
}

export async function onPlayerSms({ fromItemUuid, to, text, att = null, fwd = false, fwdSecure = false, userId }) {
  const from = fromUuidSync(fromItemUuid);
  if (!senderHolds(from, userId)) return;
  const fromPhone = getPhoneData(from);
  text = text ?? "";
  if (!fromPhone || (!text.trim() && !att) || !to?.trim()) return;
  if (att && !modelOf(fromPhone).attachments) att = null;
  if (!text.trim() && !att) return;
  const extra = { ...(att ? { att } : {}), ...(fwd ? { fwd: true } : {}) };
  const key = keyFor(fromPhone, to);
  // Between PCs, a pager gets the message directly (cut to its one line), like dialing a pager and keying a callback number.
  const reached = phonesByNumber(key).concat(phonesByNumber(to)).filter((p, i, arr) => p.item !== from && arr.findIndex((q) => q.item === p.item) === i);
  // A device an NPC carries: the message goes to the GM, like any NPC.
  const targets = reached.filter((p) => !isNpcHeld(p));
  if (targets.some((p) => modelOf(p.phone).pager) && text.replace(/\s+/g, " ").trim().length > PAGER_MAX) {
    game.socket.emit(SOCKET, { type: "smsResult", targetUserId: userId, result: "pagerCut" });
  }
  const who = `${holderName(from, fromPhone)} (${fromPhone.label})`;
  // Satellite at either end: the GM decides whether the link can be established.
  const sats = satDevices([entryOf(from), ...reached]);
  if (sats.length) {
    const to = targets.length ? targets.map((p) => holderName(p.item, p.phone)).join(", ") : displayName(fromPhone, key);
    const link = await requestLink(foundry.utils.randomID(), { sats, who, to, kind: isComputer(fromPhone) ? "mail" : "sms", text });
    if (link !== "ok") {
      // Satellite not found: not sent. The agent sees it on the device and can try again.
      await addLog(from, { kind: "sms", dir: "out", with: key, text, nosat: true, ...extra });
      game.socket.emit(SOCKET, { type: "smsResult", targetUserId: userId, result: "nosat" });
      return rerenderAll();
    }
  }
  warnCompromised(fromPhone, ...targets.map((p) => p.phone));

  if (targets.length) {
    // Between PCs: delivered directly (nothing in the chat). Encrypted when both devices are secure.
    const secure = isSecure(fromPhone) && targets.every((p) => isSecure(p.phone));
    if (fwd && fwdSecure && !secure) warnLeak(who, targets.map((p) => holderName(p.item, p.phone)).join(", "));
    await addLog(from, { kind: "sms", dir: "out", with: key, text, pj: true, ...extra, ...(secure ? { secure: true } : {}) });
    for (const p of targets) await deliverToPhone(p, fromPhone.number, text, att, { fwd, secure });
  } else if (isOffNumber(fromPhone, key)) {
    // Unassigned number (directory "off"): not delivered, the agent's device says so. Nothing for the GM.
    await addLog(from, { kind: "sms", dir: "out", with: key, text, off: true, ...extra });
    game.socket.emit(SOCKET, { type: "smsResult", targetUserId: userId, result: "unassigned" });
  } else {
    // To an NPC: lands with the GM. Encrypted if the GM set a secure line with this NPC.
    const secure = secureWith(fromPhone, key);
    if (fwd && fwdSecure && !secure) warnLeak(who, displayName(fromPhone, key));
    await addLog(from, { kind: "sms", dir: "out", with: key, text, seen: false, ...extra, ...(secure ? { secure: true } : {}) });
    // A device an NPC carries keeps the message in its history (found if the PCs get hold of it).
    for (const p of reached.filter(isNpcHeld)) await addLog(p.item, { kind: "sms", dir: "in", with: keyFor(p.phone, fromPhone.number), text, read: true, npc: true, ...extra });
    const toName = displayName(fromPhone, key);
    ui.notifications.info(`📱 ${t("Gm.WritesTo", { who, name: toName })}`);
    playLocal(SMS_SRC);
  }
  rerenderAll();
}

/** GM: an encrypted message was forwarded in clear (a leak the GM may use). */
function warnLeak(who, to) {
  ui.notifications.warn(t("Gm.LeakedForward", { who, to }));
}

export const gmIncoming = new Map(); // callId -> { dialog, sound, done, origin }

const OUTCOME_LABELS = labels("Outcome", ["answer", "noanswer", "unreachable", "unassigned"]);
export const NPC_OUTCOMES = {
  answer: { get label() { return OUTCOME_LABELS.answer; }, icon: "fas fa-phone" },
  noanswer: { get label() { return OUTCOME_LABELS.noanswer; }, icon: "fas fa-phone-slash" },
  unreachable: { get label() { return OUTCOME_LABELS.unreachable; }, icon: "fas fa-signal" },
  unassigned: { get label() { return OUTCOME_LABELS.unassigned; }, icon: "fas fa-ban" }
};

export async function onPlayerCall({ fromItemUuid, to, callId, userId }) {
  const from = fromUuidSync(fromItemUuid);
  if (!senderHolds(from, userId)) return;
  const fromPhone = getPhoneData(from);
  if (!fromPhone || !to?.trim()) return;
  const key = keyFor(fromPhone, to);
  const origin = { userId, itemUuid: fromItemUuid, callId, key, name: displayName(fromPhone, key) };
  // One call at a time on the network: a second one gets "network busy".
  if (networkBusy()) return finishOrigin(origin, "busy");
  const number = phonesByNumber(key).length ? key : to;
  const targets = phonesByNumber(number).filter((p) => p.item !== from);
  // A landline with nobody in the room: the GM answers in place of whoever is there (NPC).
  const emptyRooms = targets.length > 0 && targets.every((p) => isLandline(p.phone) && !holders(p, { activeOnly: true }).length);
  // A device an NPC carries (no player holds it): the GM answers as that NPC.
  const npcEnd = targets.length > 0 && !emptyRooms && targets.every(isNpcHeld);
  const gmAnswers = emptyRooms || npcEnd;

  // Satellite at either end: the GM decides first; the caller's device searches for the satellite meanwhile.
  const sats = satDevices([entryOf(from), ...targets]);
  if (sats.length) {
    const who = `${holderName(from, fromPhone)} (${fromPhone.label})`;
    const to = targets.length && !gmAnswers ? targets.map((p) => holderName(p.item, p.phone)).join(", ") : origin.name;
    const link = await requestLink(callId, { sats, who, to, kind: "call" });
    if (link === "cancelled") return finishOriginLogOnly(origin, "cancelled");
    if (link !== "ok") return finishOrigin(origin, "nosat");
    origin.sat = true;
    game.socket.emit(SOCKET, { type: "satLink", targetUserId: userId, callId });
    // Another call started while the GM was deciding.
    if (networkBusy()) return finishOrigin(origin, "busy");
  }

  if (targets.length && !gmAnswers) {
    warnCompromised(fromPhone, ...targets.map((p) => p.phone));
    ring(`phone:${number}`, { caller: fromPhone.number, origin, callId });
    return;
  }
  // Unassigned number (directory "off"): the network answers, the GM is not disturbed.
  if (!targets.length && isOffNumber(fromPhone, key)) return finishOrigin(origin, "unassigned");
  const place = emptyRooms ? `📍 ${targets.map((p) => `${p.phone.label} (${game.scenes.get(p.phone.sceneId)?.name ?? t("NoPlace")})`).join(", ")}` : "";
  // The NPC whose device rings: the GM sees who is called.
  const npcDevice = npcEnd ? targets.map((p) => `${p.actor?.name ?? holderName(p.item, p.phone)} (${p.phone.label})`).join(", ") : "";

  // To an NPC: the GM picks the outcome.
  const who = `${holderName(from, fromPhone)} (${fromPhone.label})`;
  const call = { done: false, sound: null, dialog: null, origin };
  gmIncoming.set(callId, call);
  rerenderAll(); // GM floating button turns orange
  // Secure device: "Answer secure" puts the NPC on a secure line (remembered for this NPC, then the default button).
  const canSecure = isSecure(fromPhone);
  const remembered = secureWith(fromPhone, key);
  const unknown = isUnknownNumber(fromPhone, key);
  let secure = false;
  const finish = (result) => {
    if (result === "answerSecure") {
      result = "answer";
      secure = true;
    }
    if (call.done) return;
    call.done = true;
    call.sound?.stop();
    gmIncoming.delete(callId);
    rerenderAll();
    if (call.dialog?.rendered) call.dialog.close();
    if (result !== "cancelled") finishOrigin(origin, result);
    // The NPC's device keeps the call in its history (a PC who searches it finds the call log).
    if (npcEnd && result !== "unassigned") {
      for (const p of targets) addLog(p.item, { kind: "call", call: callId, dir: "in", with: keyFor(p.phone, fromPhone.number), result: result === "answer" ? "answer" : "missed", read: true, npc: true });
    }
    // Unknown number: the name typed in the window goes to the directory; "Unassigned" marks it off.
    if (unknown && result !== "cancelled" && (call.npcName?.trim() || result === "unassigned")) nameUnknown(key, call.npcName, { off: result === "unassigned" });
    if (result === "answer") {
      if (canSecure) setSecureWith(from, key, secure);
      startLive(callId, agentSide(from, userId), npcSide(key, origin.name, gmName(fromPhone, key), secure, fromPhone));
    }
    // Hung up by the agent: finishOrigin was skipped, so the history gets the entry here (other outcomes are already logged).
    else if (result === "cancelled") addLog(from, { kind: "call", call: callId, dir: "out", with: key, result: "cancelled" });
  };
  const dialog = new RingDialog({
    window: { title: emptyRooms ? t("Gm.EmptyLandlineCall") : t("Gm.AgentCalling"), icon: emptyRooms ? "fas fa-phone" : "fas fa-mobile-screen" },
    classes: ["spt-phone-ring-dialog"],
    position: { width: 520 },
    content: `<div class="spt-phone-ring"><i class="fas fa-phone-volume"></i><p class="spt-caller">${esc(gmName(fromPhone, key))}${unknown ? ` <small>(${t("Directory.Unknown")})</small>` : ""}</p>${unknown ? `<p class="spt-unknown-name"><input type="text" name="sptNpcName" placeholder="${esc(t("Directory.WhoAnswers"))}" aria-label="${esc(t("Directory.WhoAnswers"))}" autocomplete="off"></p>` : ""}${place ? `<p><strong>${esc(place)}</strong><br><em>${t("Gm.NobodyThere")}</em></p>` : ""}${npcDevice ? `<p><i class="fas fa-mobile-screen"></i> <strong>${esc(npcDevice)}</strong></p>` : ""}<p>${t("Gm.CalledBy", { who: `<strong>${esc(who)}</strong>` })}</p>${fromPhone.compromised ? `<p class="spt-compromised"><i class="fas fa-triangle-exclamation"></i> ${t("Gm.CompromisedDevice", { label: esc(fromPhone.label) })}</p>` : ""}</div>`,
    buttons: Object.entries(NPC_OUTCOMES).flatMap(([action, o]) => {
      const button = { action, label: o.label, icon: o.icon, default: action === "answer" && !(canSecure && remembered), callback: () => action };
      if (action !== "answer" || !canSecure) return [button];
      return [button, { action: "answerSecure", label: t("Secure.Answer"), icon: `fas ${SECURE_ICON}`, default: remembered, callback: () => "answerSecure" }];
    }),
    submit: (result) => {
      call.dialog = null;
      finish(result);
    }
  });
  dialog.onClosed = () => finish("noanswer");
  call.dialog = dialog;
  call.finish = finish;
  dialog.render({ force: true }).then(() => {
    // Unknown number: the name the GM types is kept for the directory.
    dialog.element?.querySelector("[name=sptNpcName]")?.addEventListener("input", (ev) => (call.npcName = ev.target.value));
  });
  call.sound = await playLocal(RING_SRC, { loop: true });
  if (call.done) call.sound?.stop();
}

export function onPlayerHangup({ callId }) {
  // Hung up while the GM was deciding on the satellite link.
  if (satPending.has(callId)) return cancelLink(callId);
  const npc = gmIncoming.get(callId);
  if (npc) {
    npc.finish("cancelled");
    ui.notifications.info(`📱 ${t("Gm.AgentHungUp")}`);
    return;
  }
  const call = pendingCalls.get(callId);
  if (call?.origin) {
    hangUp(callId, { notifyOrigin: false });
    finishOriginLogOnly(call.origin, "cancelled");
  }
}

export function finishOriginLogOnly(origin, result) {
  const item = fromUuidSync(origin.itemUuid);
  if (item) addLog(item, { kind: "call", call: origin.callId, dir: "out", with: origin.key, result, ...(origin.sat ? { sat: true } : {}) });
}

/* -------------------------------------------- */
/*  GM: history writes asked by players         */
/* -------------------------------------------- */
// One writer per history (the GM's browser, in each device's queue): a player's write and
// the GM's at the same moment would otherwise overwrite each other.

/** GM: the operator's welcome message on a new device a player holds. */
export function onPlayerWelcome({ itemUuid, with: key, text, userId }) {
  const item = fromUuidSync(itemUuid);
  if (!getPhoneData(item) || !senderHolds(item, userId) || typeof key !== "string" || typeof text !== "string") return;
  return addLog(item, { kind: "sms", dir: "in", with: key, text, read: false, net: true, help: true });
}

/**
 * GM: a player deletes an entry of a device they hold (by id, or by time for old entries).
 * The operator's guide stays; on a computer or an installed device, only an unsent copy goes.
 */
export function onPlayerDelete({ itemUuid, entryId = null, ts = null, userId }) {
  const item = fromUuidSync(itemUuid);
  const phone = getPhoneData(item);
  if (!phone || !senderHolds(item, userId) || (!entryId && ts == null)) return;
  const match = (e) => (entryId ? e.id === entryId : String(e.t) === String(ts));
  const keepAll = isComputer(phone) || isFixed(phone);
  return mutateLog(item, (log) => log.filter((e) => !match(e) || e.help || (keepAll && !e.nosat)));
}
