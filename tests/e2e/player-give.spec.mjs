import { expect, test } from "@playwright/test";
import { createScenes, deviceLog, join, moduleText, openDevice, patchPhone, viewScene } from "./helpers.mjs";
import { NUMBERS, freshSession } from "./world.mjs";

/**
 * A player gives a device from its window's menu (⋮ → "Give…"): to another PC, or to nobody (it stays
 * behind, among the world items). The active GM makes the transfer. Only personal devices the player
 * carries can be given (not a landline, not a world item). Serial: the device moves from test to test.
 */
test.describe.serial("Player gives a device from its window", () => {
  let s;

  test.beforeAll(async ({ browser }) => {
    s = await freshSession(browser);
  });

  test.afterAll(async () => {
    await s?.close();
  });

  const win = (page) => page.locator("#spt-player-phone");
  const giveDialog = (page) => page.locator(".spt-dialog").filter({ has: page.locator('select[name="target"]') });

  /** Opens the window's ⋮ menu: the "Give…" entry (Foundry v14: a context menu; v13: a dropdown). */
  async function giveEntry(page) {
    await win(page).locator('[data-action="toggleControls"]').click();
    const label = await moduleText(page, "Give.Menu");
    return page.locator("#context-menu .context-item, #spt-player-phone .controls-dropdown.expanded .header-control").filter({ hasText: label });
  }

  /** The window's menu entries for the device shown (the actions, as Foundry filters them). */
  const menuActions = (page) =>
    page.evaluate(async () => {
      const app = (await window.spt("player-phone.js")).PlayerPhone.instance;
      return [...app._headerControlButtons()].map((c) => c.action);
    });

  /** Personal devices on this user's character: [{ uuid, number }]. */
  const carried = (page) =>
    page.evaluate(async () => {
      const { getPhoneData } = await window.spt("devices.js");
      return (game.user.character?.items ?? []).filter((i) => getPhoneData(i)).map((i) => ({ uuid: i.uuid, number: getPhoneData(i).number }));
    });

  /** World items (not carried) with this number, as the GM sees them. */
  const worldItems = (number) =>
    s.gm.evaluate(async (number) => {
      const { getPhoneData } = await window.spt("devices.js");
      return game.items.filter((i) => getPhoneData(i)?.number === number).map((i) => i.uuid);
    }, number);

  /** GM: puts a device back on a character (between tests). */
  const handTo = (uuid, actorName) =>
    s.gm.evaluate(async ({ uuid, actorName }) => (await (await window.spt("dialogs.js")).transferPhone(fromUuidSync(uuid), game.actors.getName(actorName))).uuid, { uuid, actorName });

  /** Picks the recipient in the open Give window and confirms. */
  async function giveTo(page, label) {
    const dialog = giveDialog(page);
    await expect(dialog).toBeVisible();
    await dialog.locator('select[name="target"]').selectOption({ label });
    await dialog.locator('button[data-action="ok"]').click();
    await expect(dialog).toBeHidden();
  }

  test("Alice gives her phone to Agent Bob from the ⋮ menu: Bob gets the “New device” window, which opens it", async () => {
    const { gm, alice, bob, aliceDevice } = s;
    await openDevice(alice, aliceDevice.uuid);
    await (await giveEntry(alice)).click();
    await giveTo(alice, "Agent Bob");
    // Her window closes: the device is no longer hers.
    await expect(win(alice)).toBeHidden();

    const given = bob.locator(".spt-given");
    await expect(given).toBeVisible();
    await expect(given).toContainText("Alice's phone");
    await given.locator('button[data-action="open"]').click();
    await expect(given).toBeHidden();

    await expect.poll(async () => (await carried(alice)).length).toBe(0);
    await expect.poll(async () => (await carried(bob)).map((d) => d.number).sort()).toEqual([NUMBERS.Alice, NUMBERS.Bob].sort());
    const handed = (await carried(bob)).find((d) => d.number === NUMBERS.Alice);
    // Bob's window shows the device he was given.
    await expect(win(bob)).toBeVisible();
    await expect.poll(() => bob.evaluate(async () => (await window.spt("player-phone.js")).PlayerPhone.instance?._state.phoneUuid)).toBe(handed.uuid);
    // The GM is told who gave what.
    await expect(gm.locator("#notifications .notification").filter({ hasText: "Agent Alice" }).filter({ hasText: "Agent Bob" }).first()).toBeVisible();
    s.handed = handed.uuid;
  });

  test("Bob leaves it (“Nobody”): it becomes a world item, carried by no one", async () => {
    const { gm, bob } = s;
    await openDevice(bob, s.handed);
    await (await giveEntry(bob)).click();
    await giveTo(bob, await moduleText(bob, "Give.Nobody"));

    await expect.poll(async () => (await carried(bob)).map((d) => d.number)).toEqual([NUMBERS.Bob]);
    await expect.poll(() => worldItems(NUMBERS.Alice)).toHaveLength(1);
    expect(await gm.evaluate((uuid) => !!fromUuidSync(uuid), s.handed)).toBe(false);
    // Nobody to tell: no "New device" window anywhere.
    await expect(s.alice.locator(".spt-given")).toHaveCount(0);
    await expect(bob.locator(".spt-given")).toHaveCount(0);

    // Back to Alice for the next tests.
    s.aliceDevice = { ...s.aliceDevice, uuid: await handTo((await worldItems(NUMBERS.Alice))[0], "Agent Alice") };
    await expect.poll(async () => (await carried(s.alice)).map((d) => d.number)).toEqual([NUMBERS.Alice]);
  });

  test("No GM connected: “Give…” says the network is gone, and nothing moves", async ({ browser }) => {
    const { alice, aliceDevice } = s;
    await s.gm.context().close();
    await expect.poll(() => alice.evaluate(() => !!game.users.activeGM)).toBe(false);
    try {
      await openDevice(alice, aliceDevice.uuid);
      await (await giveEntry(alice)).click();
      await expect(win(alice).locator(".spt-device-notice.warn")).toContainText(await moduleText(alice, "Net.GmAbsent"));
      await expect(giveDialog(alice)).toHaveCount(0);
      expect((await carried(alice)).map((d) => d.uuid)).toEqual([aliceDevice.uuid]);
    } finally {
      s.gm = await join(browser, "Gamemaster");
    }
    await expect.poll(() => alice.evaluate(() => !!game.users.activeGM)).toBe(true);
    expect((await carried(alice)).map((d) => d.uuid)).toEqual([aliceDevice.uuid]);
  });

  test("A locked phone can still be given (its number stays hidden), and Bob gets it, locked", async () => {
    const { gm, alice, bob, aliceDevice } = s;
    await patchPhone(gm, aliceDevice.uuid, { locked: true });
    await openDevice(alice, aliceDevice.uuid);
    await expect.poll(() => alice.evaluate(async (uuid) => (await window.spt("devices.js")).getPhoneData(fromUuidSync(uuid)).locked, aliceDevice.uuid)).toBe(true);
    await (await giveEntry(alice)).click();
    const dialog = giveDialog(alice);
    await expect(dialog).toBeVisible();
    // Alice cannot read the number of a locked device: the Give window does not show it either.
    await expect(dialog.locator(".window-title")).not.toContainText(NUMBERS.Alice);
    await giveTo(alice, "Agent Bob");

    const given = bob.locator(".spt-given");
    await expect(given).toBeVisible();
    await expect(given).not.toContainText(NUMBERS.Alice);
    await given.locator('button[data-action="later"]').click();
    await expect.poll(async () => (await carried(alice)).length).toBe(0);
    const handedOf = async () => (await carried(bob)).find((d) => d.number === NUMBERS.Alice)?.uuid ?? null;
    await expect.poll(handedOf).not.toBeNull();
    const handed = await handedOf();
    expect(await bob.evaluate(async (uuid) => (await window.spt("devices.js")).getPhoneData(fromUuidSync(uuid)).locked, handed)).toBe(true);

    // Back to Alice, unlocked.
    s.aliceDevice = { ...s.aliceDevice, uuid: await handTo(handed, "Agent Alice") };
    await patchPhone(gm, s.aliceDevice.uuid, { locked: false });
  });

  test("Only personal devices carried by the player: no “Give…” for a landline in the room or a world item, and the GM ignores a forged gift", async () => {
    const { gm, alice, aliceDevice } = s;
    const scenes = await createScenes(gm, { Office: false });
    await viewScene(gm, alice, scenes.Office);
    const created = await gm.evaluate(
      async ({ sceneId, aliceId }) => {
        const { createPhone } = await window.spt("devices.js");
        const landline = await createPhone(null, { label: "Office desk", number: "555-0170", model: "landline", sceneId });
        const loose = await createPhone(null, { label: "Spare phone", number: "555-0171", model: "smartphone" });
        await loose.update({ ownership: { default: 0, [aliceId]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER } });
        return { landline: landline.uuid, loose: loose.uuid };
      },
      { sceneId: scenes.Office, aliceId: await alice.evaluate(() => game.user.id) }
    );
    try {
      // Her own phone: "Give…" is there.
      await openDevice(alice, aliceDevice.uuid);
      expect(await menuActions(alice)).toContain("playerGive");
      for (const uuid of [created.landline, created.loose]) {
        await alice.evaluate(async (uuid) => {
          const app = (await window.spt("player-phone.js")).PlayerPhone.instance;
          app._state.phoneUuid = uuid;
          await app.render();
        }, uuid);
        await expect.poll(() => alice.evaluate(async () => (await window.spt("player-phone.js")).PlayerPhone.instance._current()?.item.uuid)).toBe(uuid);
        expect(await menuActions(alice), uuid).not.toContain("playerGive");
      }

      // A modified client sends the gift anyway: the GM does not move them.
      const bobActor = await gm.evaluate(() => game.actors.getName("Agent Bob").id);
      for (const uuid of [created.landline, created.loose]) {
        await alice.evaluate(({ uuid, actorId }) => game.socket.emit("module.soren-phones-computers", { type: "playerGive", itemUuid: uuid, actorId, userId: game.user.id }), { uuid, actorId: bobActor });
      }
      await alice.waitForTimeout(1500);
      for (const uuid of [created.landline, created.loose]) expect(await gm.evaluate((uuid) => !!fromUuidSync(uuid), uuid), uuid).toBe(true);
      expect(await gm.evaluate(async () => (await window.spt("devices.js")).allPhones().filter((p) => p.actor?.name === "Agent Bob").length)).toBe(1);
      // History of the landline untouched (nothing logged by a refused gift).
      expect(await deviceLog(gm, created.landline)).toEqual([]);
    } finally {
      await gm.evaluate(async (uuids) => {
        for (const uuid of uuids) await fromUuidSync(uuid)?.delete();
      }, Object.values(created));
    }
  });
});
