import { expect, test } from "@playwright/test";
import { deviceLog, expectLogEntry, expectLogUnchanged, unique } from "./helpers.mjs";
import { NUMBERS, freshSession } from "./world.mjs";

/** A player gives their phone to another agent: the item changes hands, history included. */
test.describe.serial("Giving a device", () => {
  let s;

  test.beforeAll(async ({ browser }) => {
    s = await freshSession(browser);
  });

  test.afterAll(async () => {
    await s?.close();
  });

  /** Devices this page sees on the character of its user: [{ uuid, number }]. */
  const carried = (page) =>
    page.evaluate(async () => {
      const { getPhoneData } = await window.spt("devices.js");
      return (game.user.character?.items ?? []).filter((i) => getPhoneData(i)).map((i) => ({ uuid: i.uuid, number: getPhoneData(i).number, owner: i.isOwner }));
    });

  test("Alice gives her phone to Agent Bob through the Give window: Bob holds it, with its history, and can use it", async () => {
    const { gm, alice, bob, aliceDevice } = s;
    // Something in the history, to check it moves with the device.
    const text = unique("Before the handover");
    expect(await alice.evaluate(async ({ uuid, to, text }) => (await window.spt("player-calls.js")).playerSendSms(fromUuidSync(uuid), to, text), { uuid: aliceDevice.uuid, to: NUMBERS.Bob, text })).toBe(true);
    await expectLogEntry(alice, aliceDevice.uuid, { kind: "sms", dir: "out", text });

    // Alice opens the Give window, picks Agent Bob and confirms.
    alice.evaluate(async (uuid) => (await window.spt("dialogs.js")).playerGiveDialog(fromUuidSync(uuid)), aliceDevice.uuid);
    const give = alice.locator(".spt-dialog").filter({ has: alice.locator('select[name="target"]') });
    await expect(give).toBeVisible();
    await give.locator('select[name="target"]').selectOption({ label: "Agent Bob" });
    await give.locator('button[data-action="ok"]').click();
    await expect(give).toBeHidden();

    // Bob is told he got it (a window), and closes it.
    const given = bob.locator(".spt-given");
    await expect(given).toBeVisible();
    await expect(given).toContainText("Alice's phone");
    await given.locator('button[data-action="later"]').click();

    // The item left Alice's character and is now on Bob's, his to use.
    await expect.poll(async () => (await carried(alice)).map((d) => d.number)).toEqual([]);
    await expect.poll(async () => (await carried(bob)).map((d) => d.number).sort()).toEqual([NUMBERS.Alice, NUMBERS.Bob].sort());
    const handed = (await carried(bob)).find((d) => d.number === NUMBERS.Alice);
    expect(handed.owner).toBe(true);
    expect((await deviceLog(bob, handed.uuid)).some((e) => e.text === text && e.dir === "out")).toBe(true);
    expect(await gm.evaluate((uuid) => !!fromUuidSync(uuid), aliceDevice.uuid)).toBe(false);

    // Bob can send from it (the GM checks that the sender holds the device).
    const reply = unique("New owner here");
    expect(await bob.evaluate(async ({ uuid, to, text }) => (await window.spt("player-calls.js")).playerSendSms(fromUuidSync(uuid), to, text), { uuid: handed.uuid, to: NUMBERS["Mr Smith"], text: reply })).toBe(true);
    await expectLogEntry(bob, handed.uuid, { kind: "sms", dir: "out", text: reply, with: NUMBERS["Mr Smith"] });

    // Alice can no longer use it: the GM ignores a message sent from it by someone who does not hold it.
    const before = await deviceLog(bob, handed.uuid);
    await alice.evaluate(async ({ uuid, to }) => (await window.spt("player-calls.js")).playerSendSms(fromUuidSync(uuid), to, "Not mine any more"), { uuid: handed.uuid, to: NUMBERS["Mr Smith"] });
    await expectLogUnchanged(bob, handed.uuid, before);
  });
});
