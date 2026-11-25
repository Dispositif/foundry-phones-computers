import { expect, test } from "@playwright/test";
import { deviceLog, expectLogEntry, join, myDevice, unique } from "./helpers.mjs";
import { NUMBERS } from "./world.mjs";

/**
 * Calls and messages with three people connected at once: the GM, Alice and Bob.
 * The GM's client is the network: it must stay connected for everything to work.
 */
test.describe.serial("Calls and messages", () => {
  let gm, alice, bob, aliceDevice, bobDevice;

  test.beforeAll(async ({ browser }) => {
    gm = await join(browser, "Gamemaster");
    alice = await join(browser, "Alice");
    bob = await join(browser, "Bob");
    aliceDevice = await myDevice(alice);
    bobDevice = await myDevice(bob);
    expect(aliceDevice?.number).toBe(NUMBERS.Alice);
    expect(bobDevice?.number).toBe(NUMBERS.Bob);
  });

  test.afterAll(async () => {
    for (const page of [gm, alice, bob]) await page?.context().close();
  });

  test("SMS PC → PC: delivered to Bob, kept in both histories, nothing in the chat", async () => {
    const text = unique("Meet at the diner");
    const chatBefore = await gm.evaluate(() => game.messages.size);
    const sent = await alice.evaluate(
      async ({ uuid, to, text }) => {
        const { playerSendSms } = await window.spt("player-calls.js");
        return playerSendSms(fromUuidSync(uuid), to, text);
      },
      { uuid: aliceDevice.uuid, to: NUMBERS.Bob, text }
    );
    expect(sent).toBe(true);

    await expectLogEntry(bob, bobDevice.uuid, { kind: "sms", dir: "in", text });
    await expectLogEntry(alice, aliceDevice.uuid, { kind: "sms", dir: "out", text });
    const received = (await deviceLog(bob, bobDevice.uuid)).find((e) => e.text === text);
    expect(received.read).toBeFalsy();
    // The module never writes to the Foundry chat.
    expect(await gm.evaluate(() => game.messages.size)).toBe(chatBefore);
  });

  test("Call PC → NPC: the GM answers as Mr Smith, then Alice hangs up", async () => {
    await alice.evaluate(
      async ({ uuid, to }) => {
        const { playerCall } = await window.spt("player-calls.js");
        playerCall(fromUuidSync(uuid), to);
      },
      { uuid: aliceDevice.uuid, to: NUMBERS["Mr Smith"] }
    );

    // The GM gets the "agent calling" window, naming the NPC and who calls.
    const ring = gm.locator(".spt-phone-ring-dialog");
    await expect(ring).toBeVisible();
    await expect(ring).toContainText("Mr Smith");
    await expect(ring).toContainText("Agent Alice");
    await ring.locator('button[data-action="answer"]').click();
    await expect(ring).toBeHidden();

    // Both sides are on the line.
    const liveCall = (page) =>
      page.evaluate(async () => {
        const { liveCalls } = await window.spt("live-call.js");
        const live = [...liveCalls.values()].find((c) => !c.ended);
        return live ? { callId: live.callId } : null;
      });
    await expect.poll(() => liveCall(alice)).not.toBeNull();
    await expect.poll(() => liveCall(gm)).not.toBeNull();
    const { callId } = await liveCall(alice);
    await expectLogEntry(alice, aliceDevice.uuid, { kind: "call", dir: "out", call: callId, result: "answer" });

    // Alice hangs up: the call ends everywhere and its duration is recorded.
    await alice.evaluate(async (callId) => {
      const { hangUpLive } = await window.spt("live-call.js");
      hangUpLive(callId);
    }, callId);
    await expect.poll(() => liveCall(gm)).toBeNull();
    await expect.poll(async () => (await deviceLog(gm, aliceDevice.uuid)).find((e) => e.call === callId)?.dur).toBeGreaterThanOrEqual(0);
  });

  test("Call PC → PC: Bob's phone rings, he answers, Alice hangs up", async () => {
    await alice.evaluate(
      async ({ uuid, to }) => {
        const { playerCall } = await window.spt("player-calls.js");
        playerCall(fromUuidSync(uuid), to);
      },
      { uuid: aliceDevice.uuid, to: NUMBERS.Bob }
    );
    const ringing = (page) =>
      page.evaluate(async () => {
        const { activeCall } = await window.spt("player-calls.js");
        return activeCall?.callId ?? null;
      });
    await expect.poll(() => ringing(bob)).not.toBeNull();
    const callId = await ringing(bob);

    await bob.evaluate(async () => {
      const { endCall } = await window.spt("player-calls.js");
      endCall("answer");
    });
    await expectLogEntry(bob, bobDevice.uuid, { kind: "call", dir: "in", call: callId, result: "answer" });
    await expectLogEntry(alice, aliceDevice.uuid, { kind: "call", dir: "out", call: callId, result: "answer" });

    await alice.evaluate(async (callId) => {
      const { hangUpLive } = await window.spt("live-call.js");
      hangUpLive(callId);
    }, callId);
    const onLine = (page) =>
      page.evaluate(async () => {
        const { liveCalls } = await window.spt("live-call.js");
        return [...liveCalls.values()].some((c) => !c.ended);
      });
    await expect.poll(() => onLine(bob)).toBe(false);
  });

  test("Call PC → PC: Bob declines", async () => {
    await alice.evaluate(
      async ({ uuid, to }) => {
        const { playerCall } = await window.spt("player-calls.js");
        playerCall(fromUuidSync(uuid), to);
      },
      { uuid: aliceDevice.uuid, to: NUMBERS.Bob }
    );
    const ringing = () =>
      bob.evaluate(async () => {
        const { activeCall } = await window.spt("player-calls.js");
        return activeCall?.callId ?? null;
      });
    await expect.poll(ringing).not.toBeNull();
    const callId = await ringing();
    await bob.evaluate(async () => {
      const { endCall } = await window.spt("player-calls.js");
      endCall("decline");
    });
    await expectLogEntry(bob, bobDevice.uuid, { kind: "call", dir: "in", call: callId, result: "decline" });
    await expectLogEntry(alice, aliceDevice.uuid, { kind: "call", dir: "out", call: callId, result: "noanswer" });
  });
});
