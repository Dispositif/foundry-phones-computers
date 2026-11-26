import { expect, test } from "@playwright/test";
import { deviceLog, expectLogEntry, setModuleSetting } from "./helpers.mjs";
import { NUMBERS, freshSession } from "./world.mjs";

/**
 * Calls nobody picks up: an agent who lets it ring, and an NPC the GM does not answer.
 * Not serial: the two tests do not depend on each other (a failure restarts the session).
 */
test.describe("Missed calls", () => {
  let s;

  test.beforeAll(async ({ browser }) => {
    s = await freshSession(browser);
  });

  test.afterAll(async () => {
    await s?.close();
  });

  const call = (page, uuid, to) =>
    page.evaluate(
      async ({ uuid, to }) => {
        const calls = await window.spt("player-calls.js");
        calls.playerCall(fromUuidSync(uuid), to);
        return calls.outgoing?.callId ?? null;
      },
      { uuid, to }
    );

  const outgoing = (page) => page.evaluate(async () => (await window.spt("player-calls.js")).outgoing?.callId ?? null);
  const ringing = (page) => page.evaluate(async () => (await window.spt("player-calls.js")).activeCall?.callId ?? null);

  test("Call PC → PC: Bob lets it ring until the ring time is over, a missed call for him, no answer for Alice", async () => {
    const { gm, alice, bob, aliceDevice, bobDevice } = s;
    // 5 seconds instead of 60 (the shortest step of the setting).
    await setModuleSetting(gm, "ringTimeout", 5, [alice, bob]);
    try {
      const callId = await call(alice, aliceDevice.uuid, NUMBERS.Bob);
      expect(callId).not.toBeNull();
      await expect.poll(() => ringing(bob)).toBe(callId);

      // Nobody touches anything: the ring stops by itself.
      await expect.poll(() => ringing(bob), { timeout: 15_000 }).toBeNull();
      await expectLogEntry(bob, bobDevice.uuid, { kind: "call", dir: "in", call: callId, result: "missed", read: false });
      await expectLogEntry(alice, aliceDevice.uuid, { kind: "call", dir: "out", call: callId, result: "noanswer" });
      expect(await outgoing(alice)).toBeNull();
      // The missed call counts as unread on Bob's device.
      expect(await bob.evaluate(async (uuid) => {
        const { getPhoneData, unreadCount } = await window.spt("devices.js");
        return unreadCount(getPhoneData(fromUuidSync(uuid)));
      }, bobDevice.uuid)).toBe(1);
      // Nobody is on the line.
      expect(await gm.evaluate(async () => [...(await window.spt("live-call.js")).liveCalls.values()].some((c) => !c.ended))).toBe(false);
    } finally {
      await setModuleSetting(gm, "ringTimeout", 60, [alice, bob]);
    }
  });

  test("Call PC → NPC: the GM chooses “No answer”, Alice's call ends with no answer", async () => {
    const { gm, alice, aliceDevice } = s;
    const callId = await call(alice, aliceDevice.uuid, NUMBERS["Mr Smith"]);
    expect(callId).not.toBeNull();

    const ring = gm.locator(".spt-phone-ring-dialog");
    await expect(ring).toBeVisible();
    await expect(ring).toContainText("Mr Smith");
    await ring.locator('button[data-action="noanswer"]').click();
    await expect(ring).toBeHidden();

    await expectLogEntry(alice, aliceDevice.uuid, { kind: "call", dir: "out", call: callId, result: "noanswer" });
    await expect.poll(() => outgoing(alice)).toBeNull();
    // Logged once, and no call started.
    expect((await deviceLog(alice, aliceDevice.uuid)).filter((e) => e.call === callId)).toHaveLength(1);
    expect(await gm.evaluate(async () => [...(await window.spt("live-call.js")).liveCalls.values()].some((c) => !c.ended))).toBe(false);
    expect(await gm.evaluate(async () => (await window.spt("gm-actions.js")).gmIncoming.size)).toBe(0);
  });
});
