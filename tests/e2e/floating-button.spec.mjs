import { expect, test } from "@playwright/test";
import { createScenes, viewScene } from "./helpers.mjs";
import { MODULE_ID } from "./env.mjs";
import { freshSession } from "./world.mjs";

/**
 * The player's floating button: always there when the player has a device to use
 * (carried, shared with them, or installed in the room they are in), never otherwise.
 * There is no setting to switch it off.
 */
test.describe("Player floating button", () => {
  let s;

  test.beforeAll(async ({ browser }) => {
    s = await freshSession(browser);
  });

  test.afterAll(async () => {
    await s?.close();
  });

  const fab = () => s.bob.locator("#spt-phone-fab .spt-fab:not([hidden])");
  const create = (data) => s.gm.evaluate(async (data) => (await (await window.spt("devices.js")).createPhone(null, data)).uuid, data);
  const remove = (uuid) => s.gm.evaluate(async (uuid) => fromUuidSync(uuid)?.delete(), uuid);
  const shareWithBob = (uuid, level) =>
    s.gm.evaluate(async ({ uuid, level }) => fromUuidSync(uuid).update({ [`ownership.${game.users.getName("Bob").id}`]: level }), { uuid, level });

  test("Shown only when Bob carries a device, is given one, or stands where one is installed", async () => {
    expect(await s.gm.evaluate((id) => game.settings.settings.has(`${id}.floatingButton`), MODULE_ID)).toBe(false);
    await expect(fab().first()).toBeVisible();

    // No device at all: no button.
    await remove(s.bobDevice.uuid);
    await expect(s.bob.locator("#spt-phone-fab")).toHaveCount(0);

    // A world device nobody is given, and a landline in a room Bob is not in: still no button.
    const scenes = await createScenes(s.gm, { Office: false, Street: false });
    await viewScene(s.gm, s.bob, scenes.Street);
    const spare = await create({ label: "Spare phone", number: "555-0170", model: "smartphone" });
    const landline = await create({ label: "Office line", number: "555-0171", model: "landline", sceneId: scenes.Office });
    await s.bob.waitForTimeout(1000);
    await expect(s.bob.locator("#spt-phone-fab")).toHaveCount(0);

    // The spare phone given to Bob: the button appears; taken back: it goes.
    await shareWithBob(spare, 2);
    await expect(fab().first()).toBeVisible();
    await shareWithBob(spare, 0);
    await expect(s.bob.locator("#spt-phone-fab")).toHaveCount(0);

    // Bob walks into the office: its landline gives him a button; he leaves: it goes.
    await viewScene(s.gm, s.bob, scenes.Office);
    await expect(fab().first()).toBeVisible();
    await viewScene(s.gm, s.bob, scenes.Street);
    await expect(s.bob.locator("#spt-phone-fab")).toHaveCount(0);

    await remove(spare);
    await remove(landline);
  });
});
