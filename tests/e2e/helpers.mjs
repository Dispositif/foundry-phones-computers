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
  await page.locator('select[name="userId"]').selectOption({ label: userName });
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
  await expect
    .poll(async () => (await deviceLog(page, uuid)).some((e) => Object.entries(fields).every(([k, v]) => e[k] === v)), { timeout, message: `${page.userName}: entry ${JSON.stringify(fields)} in ${uuid}` })
    .toBe(true);
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
