import { expect } from "@playwright/test";
import { BASE_URL, MODULE_ID } from "./env.mjs";

// Headless Chromium renders WebGL in software (SwiftShader) by default: Foundry's canvas then runs at
// ~2 FPS and three clients at once starve each other (joining takes 40s+). On macOS, use the real GPU.
const GPU_ARGS = process.platform === "darwin" ? ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] : [];
export const LAUNCH_ARGS = ["--autoplay-policy=no-user-gesture-required", "--mute-audio", ...GPU_ARGS];

/** Opens a new browser context and joins the running world as this user (no passwords in the test world). */
export async function join(browser, userName) {
  const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.log(`[${userName}] page error: ${err.message}`));
  await page.goto("/join");
  // The user list: "userId" in Foundry v14, "userid" in v13.
  await page.locator('select[name="userId"], select[name="userid"]').selectOption({ label: userName });
  await page.locator('input[name="password"]').fill("");
  await page.locator('button[name="join"]').click();
  await page.waitForURL(/\/game/);
  await ready(page);
  page.userName = userName;
  return page;
}

/** Waits for Foundry and the module to be ready, and exposes the module's scripts as window.spt(file). */
export async function ready(page) {
  await page.waitForFunction(() => window.game?.ready === true, null, { timeout: 60_000 });
  await page.evaluate((id) => {
    window.spt = (file) => import(`/modules/${id}/scripts/${file}`);
  }, MODULE_ID);
}

export async function reload(page) {
  await page.reload();
  await ready(page);
}

/** This user's character device (the first one it carries). */
export function myDevice(page) {
  return page.evaluate(async () => {
    const { getPhoneData } = await window.spt("devices.js");
    const item = game.user.character?.items.find((i) => getPhoneData(i));
    return item ? { uuid: item.uuid, ...getPhoneData(item) } : null;
  });
}

/** History entries of a device, as this page sees it. */
export function deviceLog(page, uuid) {
  return page.evaluate(async (uuid) => {
    const { getPhoneData, getLog } = await window.spt("devices.js");
    return getLog(getPhoneData(fromUuidSync(uuid)), { includePending: true });
  }, uuid);
}

/** Waits until the device history (seen from this page) has an entry matching all these fields. */
export async function expectLogEntry(page, uuid, fields, timeout = 10_000) {
  try {
    await expect
      .poll(async () => (await deviceLog(page, uuid)).some((e) => Object.entries(fields).every(([k, v]) => e[k] === v)), { timeout, message: `${page.userName}: entry ${JSON.stringify(fields)} in ${uuid}` })
      .toBe(true);
  } catch (err) {
    // Show what the history holds, to tell a missing entry from one with other fields.
    const log = await deviceLog(page, uuid).catch(() => "unreadable");
    err.message += `\nHistory seen by ${page.userName}: ${JSON.stringify(log)}`;
    throw err;
  }
}

export const unique = (prefix) => `${prefix} ${Math.random().toString(36).slice(2, 8)}`;

/** GM: changes fields of a device (flags.<module>.phone.<key>), e.g. { noSignal: true }. */
export function patchPhone(gm, uuid, patch) {
  return gm.evaluate(
    async ({ id, uuid, patch }) => {
      const update = Object.fromEntries(Object.entries(patch).map(([k, v]) => [`flags.${id}.phone.${k}`, v]));
      await fromUuidSync(uuid).update(update);
    },
    { id: MODULE_ID, uuid, patch }
  );
}

/** Waits until this page sees the device with these fields (the update reached this client). */
export async function expectPhone(page, uuid, fields) {
  await expect
    .poll(() => page.evaluate(async (uuid) => (await window.spt("devices.js")).getPhoneData(fromUuidSync(uuid)), uuid), { message: `${page.userName}: ${uuid} has ${JSON.stringify(fields)}` })
    .toMatchObject(fields);
}

/** GM: sets a world setting of the module, and waits until every page sees it. */
export async function setModuleSetting(gm, key, value, pages = []) {
  await gm.evaluate(({ id, key, value }) => game.settings.set(id, key, value), { id: MODULE_ID, key, value });
  for (const page of pages) await expect.poll(() => page.evaluate(({ id, key }) => game.settings.get(id, key), { id: MODULE_ID, key })).toEqual(value);
}

/** A module string in the page's language (t("Warn.PhoneOff")). */
export function moduleText(page, key) {
  return page.evaluate(async (key) => (await window.spt("i18n.js")).t(key), key);
}

/** Opens the player's device window on this device. */
export async function openDevice(page, uuid) {
  await page.evaluate(async (uuid) => (await window.spt("main.js")).openPhone(uuid), uuid);
  await expect.poll(() => page.evaluate(async () => !!(await window.spt("player-phone.js")).PlayerPhone.instance?.rendered)).toBe(true);
}

/**
 * Checks that nothing happens: waits a moment (time for a socket round trip through the GM),
 * then compares the device history with what it was before.
 */
export async function expectLogUnchanged(page, uuid, before, ms = 1500) {
  await page.waitForTimeout(ms);
  expect(await deviceLog(page, uuid), `${page.userName}: history of ${uuid} unchanged`).toEqual(before);
}

/** GM: creates scenes (name -> dead zone?), activates the first one, and returns their ids by name. */
export function createScenes(gm, scenes) {
  return gm.evaluate(
    async ({ id, scenes }) => {
      const ids = {};
      for (const [name, deadZone] of Object.entries(scenes)) {
        const scene = await Scene.create({ name, navigation: true, ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }, flags: { [id]: { deadZone } } });
        ids[name] = scene.id;
      }
      await game.scenes.get(Object.values(ids)[0]).activate();
      return ids;
    },
    { id: MODULE_ID, scenes }
  );
}

/** The player views this scene (what the module uses to place them), as the GM sees it. */
export async function viewScene(gm, page, sceneId) {
  // Foundry ignores a scene change while the canvas is still loading: wait for it, then ask again until the GM sees it.
  await expect
    .poll(async () => {
      await page.evaluate(async (sceneId) => {
        if (!canvas.loading && canvas.scene?.id !== sceneId) await game.scenes.get(sceneId).view();
      }, sceneId);
      return gm.evaluate(({ name, sceneId }) => game.users.getName(name).viewedScene === sceneId, { name: page.userName, sceneId });
    }, { timeout: 20_000, message: `${page.userName} views scene ${sceneId}` })
    .toBe(true);
}

/** Calls from this player's device; returns the call id at once (the GM may clear it as soon as this task yields). */
export function playerCall(page, uuid, to) {
  return page.evaluate(
    async ({ uuid, to }) => {
      const calls = await window.spt("player-calls.js");
      calls.playerCall(fromUuidSync(uuid), to);
      return calls.outgoing?.callId ?? null;
    },
    { uuid, to }
  );
}

/** Sends a message from this player's device (true if the device let it go). */
export function playerSms(page, uuid, to, text, options = {}) {
  return page.evaluate(async ({ uuid, to, text, options }) => (await window.spt("player-calls.js")).playerSendSms(fromUuidSync(uuid), to, text, options), { uuid, to, text, options });
}

/** The call ringing on this player's side (its id), or null. */
export function ringingAt(page) {
  return page.evaluate(async () => (await window.spt("player-calls.js")).activeCall?.callId ?? null);
}

/** A warning shown in the GM's Foundry notifications. */
export async function expectGmWarning(gm, key, data = {}) {
  const text = await gm.evaluate(async ({ key, data }) => (await window.spt("i18n.js")).t(key, data), { key, data });
  await expect(gm.locator("#notifications .notification.warning").filter({ hasText: text }).first()).toBeVisible();
}
