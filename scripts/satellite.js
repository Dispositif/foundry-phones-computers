import { DialogV2, MODULE_ID } from "./constants.js";
import { holderName, phoneUsers, viaSatellite } from "./devices.js";
import { esc, rerenderAll } from "./util.js";
import { t } from "./i18n.js";
/* -------------------------------------------- */
/*  Satellite link: the GM decides each one     */
/* -------------------------------------------- */

// id (call or message) -> { finish, kind } while the GM's window is open.
export const satPending = new Map();
// Scenes where the GM chose "For the whole scene" (this session only: forgotten on reload).
const openSky = new Set();

/** The GM's window: closing it with the cross is an answer too. */
class SatDialog extends DialogV2 {
  _onClose(options) {
    super._onClose(options);
    this.onClosed?.();
  }
}

/** Scenes a carried device is in (the scenes its holders view). */
function scenesOf(p) {
  return [...new Set(phoneUsers(p.actor).map((u) => u.viewedScene).filter(Boolean))].map((id) => game.scenes.get(id)).filter(Boolean);
}

/** Devices of this exchange that go through the satellite now ({ item, phone, actor }). */
export function satDevices(list) {
  return list.filter((p) => p?.phone && viaSatellite(p.phone));
}

/** "For the whole scene" chosen before for every scene involved: no window. */
function linkedBefore(sats) {
  return sats.every((p) => {
    const scenes = scenesOf(p);
    return scenes.length > 0 && scenes.every((sc) => openSky.has(sc.id));
  });
}

/**
 * GM: a call or a message goes through the satellite. Resolves "ok", "nosat" (satellite not found)
 * or "cancelled" (the agent hung up meanwhile). The window waits as long as the GM needs:
 * the agent's device searches for the satellite until then.
 * sats: the satellite devices; who / to: names for the window; kind: "call" or "sms"; text: the message.
 */
export function requestLink(id, { sats, who, to, kind, text = "" }) {
  if (!sats.length || linkedBefore(sats)) return Promise.resolve("ok");
  return new Promise((resolve) => {
    const scenes = [...new Set(sats.flatMap(scenesOf))];
    let closed = false;
    const finish = (result) => {
      if (!satPending.has(id)) return;
      satPending.delete(id);
      rerenderAll();
      if (!closed && dialog.rendered) dialog.close();
      resolve(result);
    };
    satPending.set(id, { finish, kind });
    const devices = sats.map((p) => `<li><i class="fas fa-satellite"></i> ${esc(p.phone.label)} <small>(${esc(holderName(p.item, p.phone))})</small></li>`).join("");
    const where = scenes.length ? `<p class="spt-sat-where"><i class="fas fa-map-location-dot"></i> ${scenes.map((sc) => esc(sc.name)).join(", ")}</p>` : "";
    // A jammer does not cut the satellite, but the GM may want to know it is there.
    const jam = scenes.some((sc) => sc.getFlag(MODULE_ID, "jammed")) ? `<p class="spt-sat-jam"><i class="fas fa-tower-broadcast"></i> ${t("Satellite.JammerHere")}</p>` : "";
    const quote = kind === "sms" && text ? `<blockquote class="spt-sat-text">${esc(text)}</blockquote>` : "";
    const dialog = new SatDialog({
      window: { title: t("Satellite.Title"), icon: "fas fa-satellite-dish" },
      classes: ["spt-sat-dialog"],
      position: { width: 460 },
      content: `<div class="spt-sat-request">
          <p class="spt-sat-question">${t("Satellite.Question")}</p>
          <p>${t(kind === "sms" ? "Satellite.Sms" : "Satellite.Call", { who: `<strong>${esc(who)}</strong>`, to: `<strong>${esc(to)}</strong>` })}</p>
          ${quote}
          <ul class="spt-sat-devices">${devices}</ul>
          ${where}${jam}
          <p class="hint">${t("Satellite.Hint")}</p>
        </div>`,
      buttons: [
        { action: "ok", label: t("Satellite.Establish"), icon: "fas fa-satellite-dish", default: true, callback: () => "ok" },
        ...(scenes.length ? [{ action: "scene", label: t("Satellite.WholeScene"), icon: "fas fa-cloud-sun", callback: () => "scene" }] : []),
        { action: "nosat", label: t("Satellite.NotFound"), icon: "fas fa-ban", callback: () => "nosat" }
      ],
      submit: (result) => {
        closed = true; // DialogV2 closes by itself after submit
        finish(result === "scene" ? "ok" : result);
        // Open sky for the whole scene: the next links there are established without asking.
        if (result === "scene") for (const sc of scenes) openSky.add(sc.id);
      }
    });
    // Closed with the cross: no satellite.
    dialog.onClosed = () => {
      closed = true;
      finish("nosat");
    };
    dialog.render({ force: true });
  });
}

/** A call waits for its satellite link (the network counts it as busy). */
export function callLinkPending() {
  return [...satPending.values()].some((x) => x.kind === "call");
}

/** The agent hung up while the GM was deciding: the window goes away. */
export function cancelLink(id) {
  satPending.get(id)?.finish("cancelled");
}
