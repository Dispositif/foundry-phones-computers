import { MODULE_ID } from "./constants.js";
import { t, tn } from "./i18n.js";
import { allPhones, getLog, getPhoneData, holders, isFixed, isJammer, isPager, jammedScenes, landlineUsers, modeOf, modelOf, playerUnread } from "./devices.js";
import { gmIncoming } from "./gm-actions.js";
import { elapsed, liveCalls, liveOn } from "./live-call.js";
import { openPanel, openPhone } from "./main.js";
import { activeCall } from "./player-calls.js";
import { myActiveJammers } from "./jammer.js";
/* -------------------------------------------- */
/*  Floating button (players, and GM network)   */
/* -------------------------------------------- */

/** Current player's devices (same rule as for ringing). */
export function myPhones() {
  return allPhones().filter((p) => holders(p).some((u) => u.id === game.user.id));
}

export const FAB_POS_KEY = `${MODULE_ID}.fabPos`;

/** Last device chosen by this player (restored on next opening). */
export function lastDeviceKey() {
  return `${MODULE_ID}.lastDevice.${game.world?.id}.${game.user?.id}`;
}
export function loadLastDevice() {
  try {
    return localStorage.getItem(lastDeviceKey());
  } catch {
    return null;
  }
}
export function saveLastDevice(uuid) {
  try {
    localStorage.setItem(lastDeviceKey(), uuid);
  } catch {}
  // The main button follows the chosen device (icon, greyed when off).
  updateFab();
}

/** Device opened by the main button: the last one chosen, a phone rather than a pager. */
function mainDevice(personal) {
  const phones = personal.filter((p) => !isPager(p.phone));
  return phones.find((p) => p.item.uuid === loadLastDevice()) ?? phones[0] ?? personal[0] ?? null;
}

export function fabButton(cls) {
  const b = document.createElement("div");
  b.className = `spt-fab ${cls}`;
  b.innerHTML = `<i class="fas"></i><span class="spt-fab-badge" hidden>0</span>`;
  return b;
}

export function setFabBadge(btn, n) {
  const badge = btn.querySelector(".spt-fab-badge");
  badge.textContent = n > 9 ? "9+" : String(n);
  badge.hidden = n === 0;
}

/**
 * Floating buttons. The selected carried device is the main round button; the other carried
 * devices are small round satellites in an arc around it; devices installed in the room where
 * the agent stands (landline, terminal) are rounded squares in a row beside the group.
 */
export function updateFab() {
  if (!game.ready) return;
  if (game.user.isGM) return updateGmFab();
  let fab = document.getElementById("spt-phone-fab");
  const mine = myPhones();
  const personal = mine.filter((p) => !isFixed(p.phone));
  // Room buttons: installed devices in the room where the agent is, and shared ones with no place
  // (reached over the network from anywhere, e.g. a case file database). Not a room device used from afar.
  const rooms = mine.filter((p) => isFixed(p.phone) && (!game.scenes.get(p.phone.sceneId) || landlineUsers(p.phone).some((u) => u.id === game.user.id)));
  // A jammer switched on gets its own red satellite (click = its window, to switch it off).
  const jammers = myActiveJammers();
  const wanted = !game.user.isGM && game.settings.get(MODULE_ID, "floatingButton") && personal.length + rooms.length + jammers.length > 0;
  if (!wanted) return fab?.remove();
  if (!fab) fab = createFab();
  const before = fabPositions(fab);
  const ringingUuid = activeCall?.itemUuid ?? null;
  const ringsHere = (p) => !!activeCall && p.item.uuid === ringingUuid;

  // On the line: the button of the device in use turns green with the call's timer.
  const onLine = (p) => {
    const d = liveOn(p.item.uuid);
    return d && !d.ended && !d.dialing ? d : null;
  };
  // A carried device on the line takes the main place for the duration of the call.
  const livePersonal = personal.find(onLine);
  const shown = livePersonal ?? mainDevice(personal);
  const others = personal.filter((p) => p !== shown);
  // Something is ringing that has no button of its own: the main button rings.
  const ringOwned = [...rooms, ...others].some(ringsHere);

  // Main button: the selected carried device.
  let main = fab.querySelector(".spt-fab-main");
  if (!main) fab.prepend((main = fabButton("spt-fab-main")));
  main.hidden = !shown;
  main.dataset.deviceUuid = shown?.item.uuid ?? "";
  if (shown) {
    main.querySelector("i").className = `fas ${modelOf(shown.phone).icon}`;
    setOnLine(main, livePersonal ? onLine(livePersonal) : null);
    main.dataset.liveUuid = livePersonal?.item.uuid ?? "";
    // Switched off: a slash across the icon (a click still opens the dark screen and its power button).
    main.classList.toggle("off", !livePersonal && modeOf(shown.phone) === "off");
    const n = playerUnread(shown.phone);
    setFabBadge(main, n);
    main.classList.toggle("ringing", !!activeCall && !ringOwned);
    main.title = `${shown.phone.label}${n ? ` (${tn("Unread", n)})` : ""}`;
  }

  satelliteButtons(fab, others, { ringing: ringsHere });
  roomButtons(fab, rooms, { unread: (p) => playerUnread(p.phone), ringing: ringsHere, live: onLine });
  jammerButtons(fab, jammers);
  layoutFab(fab);
  markOpen(fab);
  markNew(fab, mine);
  animateMoves(fab, before);
}

/** Device a floating button stands for. */
const buttonUuid = (b) => b.dataset.uuid || b.dataset.deviceUuid || "";

/** Devices whose window is open and not minimized (phone screen, pager, jammer). */
function openDeviceUuids() {
  const out = new Set();
  for (const app of foundry.applications.instances.values()) {
    if (!app.id?.startsWith("spt-") || !app.rendered || app.minimized) continue;
    const uuid = app._current?.()?.item.uuid ?? app.uuid;
    if (uuid) out.add(uuid);
  }
  return out;
}

/** Thin white ring around the buttons whose device window is open. */
function markOpen(fab) {
  const open = openDeviceUuids();
  for (const b of fab.querySelectorAll(".spt-fab")) b.classList.toggle("open", !b.hidden && open.has(buttonUuid(b)));
}

/** Devices this player has already opened (this browser), so a new one can draw the eye. */
function seenKey() {
  return `${MODULE_ID}.seenDevices.${game.world?.id}.${game.user?.id}`;
}
function loadSeen() {
  try {
    const raw = localStorage.getItem(seenKey());
    return raw ? new Set(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
function saveSeen(seen) {
  try {
    localStorage.setItem(seenKey(), JSON.stringify([...seen]));
  } catch {}
}

/**
 * A device the player has never opened pulses gently until its window is opened once.
 * First time on this browser: devices already in use (with a history) count as seen.
 */
function markNew(fab, mine) {
  let seen = loadSeen();
  let changed = false;
  if (!seen) {
    seen = new Set(mine.filter((p) => getLog(p.phone, { includePending: true }).length).map((p) => p.item.uuid));
    changed = true;
  }
  for (const uuid of openDeviceUuids()) {
    if (!seen.has(uuid)) changed = !!seen.add(uuid);
  }
  for (const b of fab.querySelectorAll(".spt-fab:not(.spt-fab-jammer)")) {
    const uuid = buttonUuid(b);
    const isNew = !b.hidden && !!uuid && !seen.has(uuid);
    // A separate halo element: the buttons' ::before / ::after are already used by some looks.
    const halo = b.querySelector(".spt-fab-new");
    if (isNew && !halo) b.insertAdjacentHTML("afterbegin", `<span class="spt-fab-new" aria-hidden="true"></span>`);
    else if (!isNew) halo?.remove();
  }
  if (changed) saveSeen(seen);
}

/** Screen centre and size of each button, by device. */
function fabPositions(fab) {
  const out = new Map();
  for (const b of fab.querySelectorAll(".spt-fab")) {
    const uuid = buttonUuid(b);
    if (!uuid || b.hidden) continue;
    const r = b.getBoundingClientRect();
    out.set(uuid, { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width });
  }
  return out;
}

/** A device that changed place (e.g. a satellite becoming the main button) glides there instead of jumping. */
function animateMoves(fab, before) {
  if (!before.size || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const after = fabPositions(fab);
  for (const b of fab.querySelectorAll(".spt-fab")) {
    const from = before.get(buttonUuid(b));
    const to = after.get(buttonUuid(b));
    if (!from || !to || (Math.abs(from.x - to.x) < 1 && Math.abs(from.y - to.y) < 1)) continue;
    const start = `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(${from.w / to.w})`;
    b.animate([{ transform: start }, { transform: "none" }], { duration: 220, easing: "ease-out" });
  }
}

// The open-window ring follows the device windows.
for (const hook of ["renderApplicationV2", "closeApplicationV2"]) {
  Hooks.on(hook, (app) => {
    if (app.id?.startsWith("spt-")) setTimeout(updateFab, 0);
  });
}

/** Small round button per other carried device (click = it becomes the main one). */
function satelliteButtons(fab, phones, { ringing }) {
  const keep = new Set(phones.map((p) => p.item.uuid));
  for (const b of fab.querySelectorAll(".spt-fab-sat:not(.spt-fab-jammer)")) if (!keep.has(b.dataset.uuid)) b.remove();
  for (const p of phones) {
    let b = [...fab.querySelectorAll(".spt-fab-sat:not(.spt-fab-jammer)")].find((x) => x.dataset.uuid === p.item.uuid);
    if (!b) {
      b = fabButton("spt-fab-sat");
      b.dataset.uuid = p.item.uuid;
      fab.appendChild(b);
    }
    b.querySelector("i").className = `fas ${modelOf(p.phone).icon}`;
    const u = playerUnread(p.phone);
    setFabBadge(b, u);
    b.classList.toggle("ringing", ringing(p));
    b.classList.toggle("off", modeOf(p.phone) === "off");
    b.title = `${p.phone.label}${u ? ` (${tn("Unread", u)})` : ""}`;
  }
}

/** Pulsing red button per jammer switched on. */
function jammerButtons(fab, jammers) {
  const keep = new Set(jammers.map((p) => p.item.uuid));
  for (const b of fab.querySelectorAll(".spt-fab-jammer")) if (!keep.has(b.dataset.uuid)) b.remove();
  for (const p of jammers) {
    let b = [...fab.querySelectorAll(".spt-fab-jammer")].find((x) => x.dataset.uuid === p.item.uuid);
    if (!b) {
      b = fabButton("spt-fab-sat spt-fab-jammer");
      b.dataset.uuid = p.item.uuid;
      b.querySelector("i").className = `fas ${modelOf(p.phone).icon}`;
      fab.appendChild(b);
    }
    b.title = `${p.phone.label} — ${t("Jammer.FabHint")}`;
  }
}

/** Green button and running timer while on the line. */
function setOnLine(btn, data) {
  btn.classList.toggle("online", !!data);
  let timer = btn.querySelector(".spt-fab-timer");
  if (!data) return timer?.remove();
  if (!timer) {
    timer = document.createElement("span");
    timer.className = "spt-fab-timer";
    btn.appendChild(timer);
  }
  timer.dataset.call = data.callId;
  timer.textContent = elapsed(data);
  startFabTicker();
}

let fabTicker = null;
function startFabTicker() {
  if (fabTicker) return;
  fabTicker = setInterval(() => {
    const timers = document.querySelectorAll("#spt-phone-fab .spt-fab-timer");
    if (!timers.length) {
      clearInterval(fabTicker);
      fabTicker = null;
      return;
    }
    for (const el of timers) {
      const data = liveCalls.get(el.dataset.call);
      if (data && !data.ended) el.textContent = elapsed(data);
    }
  }, 1000);
}

/** Satellite slots around the main button: [distance, angle] (angle 0 = towards the screen's centre vertically). */
const SAT_RINGS = [[42, [0, 45, 90]], [78, [0, 30, 60, 90]], [114, [0, 22, 45, 67, 90]]];
/** Centre of the first room square from the main button's centre, then the step between squares. */
const ROOM_START = 61;
const ROOM_STEP = 42;

/**
 * Places satellites and room squares around the main button. The arc and the row always open
 * towards the centre of the screen, whatever corner the group was dragged to.
 */
function layoutFab(fab) {
  const r = fab.getBoundingClientRect();
  const dx = r.left + r.width / 2 < window.innerWidth / 2 ? 1 : -1;
  const dy = r.top + r.height / 2 < window.innerHeight / 2 ? 1 : -1;
  const main = fab.querySelector(".spt-fab-main");
  const hasMain = !!main && !main.hidden;
  const rooms = [...fab.querySelectorAll(".spt-fab-room")];
  const sats = [...fab.querySelectorAll(".spt-fab-sat")];
  // Thicker button looks (e.g. the cyberpunk metal rings) spread the group a little: CSS --spt-fab-spread.
  const k = parseFloat(getComputedStyle(fab).getPropertyValue("--spt-fab-spread")) || 1;
  // The row of squares runs horizontally: satellites then avoid the horizontal slots.
  const slots = SAT_RINGS.flatMap(([d, angles]) => angles.filter((a) => !(rooms.length && a === 90)).map((a) => [d, a]));
  const place = (b, x, y) => {
    const size = b.offsetWidth || 44;
    b.style.left = `${r.width / 2 + x - size / 2}px`;
    b.style.top = `${r.height / 2 + y - size / 2}px`;
  };
  sats.forEach((b, i) => {
    const [d, a] = slots[Math.min(i, slots.length - 1)];
    const rad = (a * Math.PI) / 180;
    place(b, dx * k * d * Math.sin(rad), dy * k * d * Math.cos(rad));
  });
  rooms.forEach((b, i) => place(b, dx * k * ((hasMain ? ROOM_START : 0) + ROOM_STEP * i), 0));
}

/** Rounded square per installed device (landline, terminal), with a pin when it has a place. */
function roomButtons(fab, rooms, { unread, ringing = () => false, live = () => null }) {
  const keep = new Set(rooms.map((p) => p.item.uuid));
  for (const b of fab.querySelectorAll(".spt-fab-room")) if (!keep.has(b.dataset.uuid)) b.remove();
  for (const p of rooms) {
    let b = [...fab.querySelectorAll(".spt-fab-room")].find((x) => x.dataset.uuid === p.item.uuid);
    if (!b) {
      b = fabButton("spt-fab-room");
      b.dataset.uuid = p.item.uuid;
      fab.appendChild(b);
    }
    b.querySelector("i").className = `fas ${modelOf(p.phone).icon}`;
    const u = unread(p);
    setFabBadge(b, u);
    b.classList.toggle("ringing", ringing(p));
    setOnLine(b, live(p));
    const scene = game.scenes.get(p.phone.sceneId);
    setPin(b, !!scene);
    const place = scene?.name ?? t("NoPlace");
    b.title = `${p.phone.label} — ${place}${u ? ` (${tn("Unread", u)})` : ""}`;
  }
}

/** Location pin on a room square (none for a shared device with no place). */
function setPin(btn, on) {
  let pin = btn.querySelector(".spt-fab-pin");
  if (!on) return pin?.remove();
  if (!pin) {
    pin = document.createElement("span");
    pin.className = "spt-fab-pin";
    pin.innerHTML = `<i class="fas fa-location-dot"></i>`;
    btn.appendChild(pin);
  }
}

/** Agents' messages the GM has not opened yet (same count as the Messages tab). */
function gmUnread(phones = allPhones()) {
  let n = 0;
  for (const p of phones) {
    for (const e of getLog(p.phone)) if (e.kind === "sms" && e.dir === "out" && !e.pj && !e.prep && e.seen === false) n++;
  }
  return n;
}

/** GM: one telecom button that opens the Network panel (on Messages when something is unread). */
function updateGmFab() {
  let fab = document.getElementById("spt-phone-fab");
  if (!game.settings.get(MODULE_ID, "gmFloatingButton")) return fab?.remove();
  if (!fab) fab = createFab();
  let main = fab.querySelector(".spt-fab-main");
  if (!main) fab.prepend((main = fabButton("spt-fab-main")));
  main.dataset.gm = "1";
  main.querySelector("i").className = "fas fa-tower-cell";
  const n = gmUnread();
  setFabBadge(main, n);
  // An agent is calling you: orange, and a click brings the call window back.
  const calling = gmIncoming.size > 0;
  main.classList.toggle("calling", calling);
  // A jammer is cutting the network somewhere: red ring.
  const jams = [...jammedScenes().keys()].map((id) => game.scenes.get(id)?.name ?? "?");
  main.classList.toggle("jamming", jams.length > 0);
  main.title = calling ? t("Gm.AgentCalling") : n ? tn("Unread", n) : t("Gm.PanelTitle");
  if (jams.length) main.title += `\n${t("Jammer.GmFab", { scenes: jams.join(", ") })}`;
  // Devices installed on the scene the GM is viewing: one click opens their GM view.
  const sceneId = canvas?.scene?.id ?? game.user.viewedScene;
  const rooms = sceneId ? allPhones().filter((p) => isFixed(p.phone) && p.phone.sceneId === sceneId) : [];
  roomButtons(fab, rooms, { unread: (p) => gmUnread([p]) });
  layoutFab(fab);
  markOpen(fab);
}

/** GM: the incoming call window comes forward (closing it would mean "no answer"). */
function showGmCall() {
  const call = [...gmIncoming.values()].find((c) => c.dialog);
  if (!call) return false;
  call.dialog.maximize?.();
  call.dialog.bringToFront?.();
  return true;
}

export function createFab() {
  const fab = document.createElement("div");
  fab.id = "spt-phone-fab";
  try {
    const pos = JSON.parse(localStorage.getItem(FAB_POS_KEY) ?? "null");
    if (pos) Object.assign(fab.style, { left: `${pos.left}px`, top: `${pos.top}px`, bottom: "auto" });
  } catch {}
  // Click = open the button's device; drag = move the group (position remembered).
  let drag = null;
  fab.addEventListener("pointerdown", (ev) => {
    const r = fab.getBoundingClientRect();
    drag = { dx: ev.clientX - r.left, dy: ev.clientY - r.top, moved: false, btn: ev.target.closest(".spt-fab") };
    fab.setPointerCapture(ev.pointerId);
  });
  fab.addEventListener("pointermove", (ev) => {
    if (!drag) return;
    const left = Math.max(0, Math.min(window.innerWidth - fab.offsetWidth, ev.clientX - drag.dx));
    const top = Math.max(0, Math.min(window.innerHeight - fab.offsetHeight, ev.clientY - drag.dy));
    if (!drag.moved && Math.hypot(left - fab.offsetLeft, top - fab.offsetTop) < 4) return;
    drag.moved = true;
    Object.assign(fab.style, { left: `${left}px`, top: `${top}px`, bottom: "auto" });
  });
  fab.addEventListener("pointerup", () => {
    if (!drag) return;
    if (drag.moved) {
      try {
        localStorage.setItem(FAB_POS_KEY, JSON.stringify({ left: fab.offsetLeft, top: fab.offsetTop }));
      } catch {}
      layoutFab(fab);
    } else if (drag.btn?.dataset.gm) {
      if (!showGmCall()) openPanel(gmUnread() ? { tab: "inbox" } : {});
    } else if (drag.btn) {
      // On the line: back to the device in use.
      let uuid = drag.btn.dataset.uuid || drag.btn.dataset.liveUuid;
      if (!uuid) {
        // Main phone: the last personal device chosen.
        const personal = myPhones().filter((p) => !isFixed(p.phone));
        uuid = mainDevice(personal)?.item.uuid;
      }
      if (uuid) {
        const ph = getPhoneData(fromUuidSync(uuid));
        if (!game.user.isGM && !isPager(ph) && !isJammer(ph) && !isFixed(ph)) saveLastDevice(uuid);
        openPhone(uuid);
      }
    }
    drag = null;
  });
  document.body.appendChild(fab);
  return fab;
}

