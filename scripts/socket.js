import { MODULE_ID, PAGER_MAX, SMS_SRC, VIBRATE_SRC } from "./constants.js";
import { markEntryRead, markRead } from "./devices.js";
import { openPager } from "./pager.js";
import { onPlayerCall, onPlayerHangup, onPlayerSms, senderHolds } from "./gm-actions.js";
import { activeCall, endCall, onCallResult, onSatLink, receiveNearbyCall, receiveNearbyRing, receiveNearbySat, receiveRing, stopNearbyRing, stopNearbySat } from "./player-calls.js";
import { onResponse } from "./ring.js";
import { closeDial, endLive, openDial, openLive, openRinging } from "./live-call.js";
import { receiveShow } from "./share.js";
import { onDocRequest, onFileContent, onFileRequest } from "./files.js";
import { onJamSound, onJammerRequest } from "./jammer.js";
import { deviceNotice, isActiveGM, playLocal, rerenderAll } from "./util.js";
import { flushAll } from "./messages.js";
import { t } from "./i18n.js";
/* -------------------------------------------- */
/*  Socket                                      */
/* -------------------------------------------- */

/**
 * senderId: the user who sent the message, set by the Foundry server (it cannot be forged).
 * It replaces the userId the message claims, so a modified client cannot act as another player.
 */
export function onSocket(data, senderId) {
  if (senderId && data?.userId !== undefined) data = { ...data, userId: senderId };
  const forMe = data.targetUserId === game.user.id;
  switch (data.type) {
    case "ring":
      if (forMe) receiveRing(data);
      break;
    case "ringNearby":
      receiveNearbyRing(data);
      openRinging(data);
      break;
    case "satNearby":
      receiveNearbySat(data);
      break;
    case "satNearbyStop":
      stopNearbySat(data);
      break;
    case "callNearby":
      receiveNearbyCall(data);
      openDial(data);
      break;
    case "ringNearbyStop":
    case "nearbyStop":
      stopNearbyRing(data);
      closeDial(data.callId);
      break;
    case "cancel":
      if (forMe && activeCall?.callId === data.callId) endCall("cancelled");
      break;
    case "sms":
      if (forMe) {
        playLocal(data.silent ? VIBRATE_SRC : data.notif ? `modules/${MODULE_ID}/sounds/${data.notif}` : SMS_SRC);
        if (data.open) openPager(data.open, { latest: true });
      }
      break;
    case "smsResult":
      // A message to an unassigned number: the device says it was not delivered.
      if (forMe && data.result === "unassigned") deviceNotice(t("Warn.SmsUnassigned"), { warn: true });
      if (forMe && data.result === "pagerCut") deviceNotice(t("Warn.PagerCutSent", { n: PAGER_MAX }), { warn: true });
      if (forMe && data.result === "nosat") deviceNotice(t("Warn.SmsNoSat"), { warn: true, icon: "fa-satellite" });
      break;
    case "satLink":
      if (forMe) onSatLink(data);
      break;
    case "callResult":
      if (forMe) onCallResult(data);
      break;
    case "signalBack":
      if (forMe) {
        // No notice: the player sees the signal and the new messages on the device itself.
        if (data.bip && data.sms) playLocal(data.notif ? `modules/${MODULE_ID}/sounds/${data.notif}` : SMS_SRC);
        if (data.open) openPager(data.open, { latest: true });
      }
      break;
    case "liveStart":
      openLive(data, { answered: true });
      break;
    case "liveEnd":
      endLive(data.callId, data.reason);
      break;
    case "response":
      if (game.user.isGM) onResponse(data);
      break;
    case "playerSms":
      if (isActiveGM()) onPlayerSms(data);
      break;
    case "playerCall":
      if (isActiveGM()) onPlayerCall(data);
      break;
    case "show":
      if (data.targetUserIds?.includes(game.user.id)) receiveShow(data);
      break;
    case "deviceGiven":
      // Loaded on demand: a static import of dialogs.js here would change the modules' load order.
      if (data.targetUserIds?.includes(game.user.id)) import("./dialogs.js").then((m) => m.receiveDeviceGiven(data));
      break;
    case "sceneChanged":
      // A player changed scene: dead zones and who is in a room follow. Leaving a dead zone delivers what was waiting.
      rerenderAll();
      if (isActiveGM()) flushAll();
      break;
    case "playerGive":
      if (isActiveGM()) import("./dialogs.js").then((m) => m.onPlayerGive(data));
      break;
    case "playerRead":
      if (isActiveGM()) {
        const item = fromUuidSync(data.itemUuid);
        if (item && senderHolds(item, data.userId)) data.entryId ? markEntryRead(item, data.entryId) : markRead(item, data.key);
      }
      break;
    case "fileRequest":
      if (isActiveGM()) onFileRequest(data);
      break;
    case "docRequest":
      if (isActiveGM()) onDocRequest(data);
      break;
    case "fileContent":
      if (forMe) onFileContent(data);
      break;
    case "jamSound":
      onJamSound();
      break;
    case "jammer":
      if (isActiveGM()) onJammerRequest(data);
      break;
    case "playerHangup":
      if (isActiveGM()) onPlayerHangup(data);
      break;
  }
}

