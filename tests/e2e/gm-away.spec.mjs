import { expect, test } from "@playwright/test";
import { expectLogEntry, join, openDevice, playerCall, playerSms, ringingAt, setModuleSetting } from "./helpers.mjs";
import { NUMBERS, freshSession } from "./world.mjs";

/** The GM's browser is the network: what happens when the GM leaves during a call, and comes back. */
test.describe("GM away", () => {
  let s;

  test.beforeAll(async ({ browser }) => {
    s = await freshSession(browser);
  });

  test.afterAll(async () => {
    await s?.close();
  });

  test("The GM leaves while Alice's call rings: her device says the network is gone; when the GM is back, she can call again", async ({ browser }) => {
    const { alice, bob, aliceDevice, bobDevice } = s;
    await setModuleSetting(s.gm, "ringTimeout", 5, [alice, bob]);
    try {
      const callId = await playerCall(alice, aliceDevice.uuid, NUMBERS.Bob);
      await expect.poll(() => ringingAt(bob)).toBe(callId);

      await s.gm.context().close();
      await expect.poll(() => alice.evaluate(() => !!game.users.activeGM)).toBe(false);
      // No GM: no network. The device says why.
      await openDevice(alice, aliceDevice.uuid);
      expect(await playerSms(alice, aliceDevice.uuid, NUMBERS.Bob, "Anyone?")).toBe(false);
      const away = await alice.evaluate(async () => (await window.spt("i18n.js")).t("Net.GmAbsent"));
      await expect(alice.locator(".spt-device-notice.warn")).toContainText(away);
      // Bob's phone stops ringing after the ring time.
      await expect.poll(() => ringingAt(bob), { timeout: 15_000 }).toBeNull();

      // The GM comes back: Alice can call Bob again (no call left hanging).
      s.gm = await join(browser, "Gamemaster");
      await expect.poll(() => alice.evaluate(() => !!game.users.activeGM)).toBe(true);
      const again = await playerCall(alice, aliceDevice.uuid, NUMBERS.Bob);
      expect(again).not.toBe(callId);
      await expect.poll(() => ringingAt(bob)).toBe(again);
      await bob.evaluate(async () => (await window.spt("player-calls.js")).endCall("decline"));
      await expectLogEntry(bob, bobDevice.uuid, { kind: "call", dir: "in", call: again, result: "decline" });
    } finally {
      if (!s.gm.isClosed()) await setModuleSetting(s.gm, "ringTimeout", 60, [alice, bob]);
    }
  });
});
