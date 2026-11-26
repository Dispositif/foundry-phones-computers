import { expect, test } from "@playwright/test";
import { deviceLog, expectLogEntry, expectPhone, openDevice, patchPhone, unique } from "./helpers.mjs";
import { NUMBERS, freshSession } from "./world.mjs";

/**
 * The GM calls as an NPC, the GM cuts a line, silent mode, and read receipts.
 * Not serial: the tests do not depend on each other (a failure restarts the session).
 */
test.describe("GM calls, silent mode, read receipts", () => {
  let s;

  test.beforeAll(async ({ browser }) => {
    s = await freshSession(browser);
  });

  test.afterAll(async () => {
    await s?.close();
  });

  const gmCall = (to) => s.gm.evaluate(async (to) => (await window.spt("ring.js")).ring(`phone:${to}`, { caller: "Mr Smith" }), to);
  const playerCall = (page, uuid, to) =>
    page.evaluate(
      async ({ uuid, to }) => {
        const calls = await window.spt("player-calls.js");
        calls.playerCall(fromUuidSync(uuid), to);
        return calls.outgoing?.callId ?? null;
      },
      { uuid, to }
    );
  const ringing = (page) => page.evaluate(async () => (await window.spt("player-calls.js")).activeCall?.callId ?? null);
  const answer = (page, result = "answer") => page.evaluate(async (result) => (await window.spt("player-calls.js")).endCall(result), result);
  /** The call as this page sees it: null (none), "live", or the reason it ended. */
  const lineState = (page, callId) =>
    page.evaluate(async (callId) => {
      const live = (await window.spt("live-call.js")).liveCalls.get(callId);
      return !live ? null : live.ended ? live.ended.reason : live.dialing ? "dialing" : "live";
    }, callId);
  const hangUp = (page, callId) => page.evaluate(async (callId) => (await window.spt("live-call.js")).hangUpLive(callId), callId);
  const durationOf = async (uuid, callId) => (await deviceLog(s.gm, uuid)).find((e) => e.call === callId && e.result === "answer")?.dur;

  for (const who of ["Alice", "GM"]) {
    test(`The GM calls Alice as Mr Smith, she answers; ${who === "GM" ? "the GM" : "Alice"} hangs up, the duration is recorded`, async () => {
      const { gm, alice, aliceDevice } = s;
      const callId = await gmCall(NUMBERS.Alice);
      expect(typeof callId).toBe("string");
      await expect.poll(() => ringing(alice)).toBe(callId);
      // Mr Smith is in the directory: his name shows on Alice's screen.
      expect(await alice.evaluate(async () => (await window.spt("player-calls.js")).activeCall.screen?.caller)).toBe("Mr Smith");

      await answer(alice);
      await expect.poll(() => lineState(gm, callId)).toBe("live");
      await expect.poll(() => lineState(alice, callId)).toBe("live");
      await expectLogEntry(alice, aliceDevice.uuid, { kind: "call", dir: "in", call: callId, result: "answer", with: NUMBERS["Mr Smith"] });

      await hangUp(who === "GM" ? gm : alice, callId);
      await expect.poll(() => lineState(gm, callId)).toBe("hangup");
      await expect.poll(() => lineState(alice, callId)).toBe("hangup");
      await expect.poll(() => durationOf(aliceDevice.uuid, callId)).toBeGreaterThanOrEqual(0);
    });
  }

  test("The GM cuts the line of a call between Alice and Bob: it ends for both", async () => {
    const { gm, alice, bob, aliceDevice } = s;
    const callId = await playerCall(alice, aliceDevice.uuid, NUMBERS.Bob);
    await expect.poll(() => ringing(bob)).toBe(callId);
    await answer(bob);
    await expect.poll(() => lineState(gm, callId)).toBe("live");

    // The GM's call window: "Cut the line".
    const cut = gm.locator('.spt-live-cut[data-action="cut"]');
    await expect(cut).toBeVisible();
    await cut.click();
    for (const page of [gm, alice, bob]) await expect.poll(() => lineState(page, callId)).toBe("cut");
  });

  test("Bob's phone in silent mode: the call still arrives, it vibrates instead of ringing", async () => {
    const { gm, alice, bob, aliceDevice, bobDevice } = s;
    await patchPhone(gm, bobDevice.uuid, { mode: "silent" });
    await expectPhone(bob, bobDevice.uuid, { mode: "silent" });
    try {
      const callId = await playerCall(alice, aliceDevice.uuid, NUMBERS.Bob);
      await expect.poll(() => ringing(bob)).toBe(callId);
      expect(await bob.evaluate(async () => (await window.spt("player-calls.js")).activeCall.screen?.silent)).toBe(true);
      await answer(bob, "decline");
      await expectLogEntry(bob, bobDevice.uuid, { kind: "call", dir: "in", call: callId, result: "decline" });
    } finally {
      await patchPhone(gm, bobDevice.uuid, { mode: "on" });
      await expectPhone(bob, bobDevice.uuid, { mode: "on" });
    }
  });

  test("Read receipts: Bob's floating button shows an unread message; opening the conversation marks it read", async () => {
    const { alice, bob, aliceDevice, bobDevice } = s;
    const text = unique("Read me");
    expect(await alice.evaluate(async ({ uuid, to, text }) => (await window.spt("player-calls.js")).playerSendSms(fromUuidSync(uuid), to, text), { uuid: aliceDevice.uuid, to: NUMBERS.Bob, text })).toBe(true);
    await expectLogEntry(bob, bobDevice.uuid, { text, read: false });
    const badge = bob.locator(".spt-fab-main .spt-fab-badge");
    await expect(badge).toBeVisible();
    const unread = await bob.evaluate(async (uuid) => { const d = await window.spt("devices.js"); return d.unreadCount(d.getPhoneData(fromUuidSync(uuid))); }, bobDevice.uuid);
    expect(unread).toBeGreaterThan(0);
    await expect(badge).toHaveText(String(unread));

    await openDevice(bob, bobDevice.uuid);
    await bob.locator(`.spt-conv[data-key="${NUMBERS.Alice}"]`).click();
    await expectLogEntry(s.gm, bobDevice.uuid, { text, read: true });
    await expect.poll(async () => (await deviceLog(bob, bobDevice.uuid)).filter((e) => e.with === NUMBERS.Alice && e.dir === "in" && e.read === false).length).toBe(0);
    if (unread === 1) await expect(badge).toBeHidden();
  });
});
