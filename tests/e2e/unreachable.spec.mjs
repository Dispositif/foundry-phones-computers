import { expect, test } from "@playwright/test";
import { deviceLog, expectLogEntry, expectPhone, join, patchPhone, setModuleSetting, unique } from "./helpers.mjs";
import { NUMBERS, freshSession } from "./world.mjs";

/**
 * Bob cannot be reached: disconnected, without signal (his device alone, or the whole network), or his phone off.
 * Messages from the GM and from Alice wait, calls do not ring; everything shows once he is back.
 * Each test puts back what it changes.
 */
test.describe.serial("Unreachable agent", () => {
  let s;

  test.beforeAll(async ({ browser }) => {
    s = await freshSession(browser);
  });

  test.afterAll(async () => {
    await s?.close();
  });

  const playerSms = (page, uuid, to, text) =>
    page.evaluate(async ({ uuid, to, text }) => (await window.spt("player-calls.js")).playerSendSms(fromUuidSync(uuid), to, text), { uuid, to, text });

  const gmSms = (to, text) =>
    s.gm.evaluate(async ({ to, text }) => (await window.spt("messages.js")).sendSms(`phone:${to}`, text, { sender: "Mr Smith" }), { to, text });

  const playerCall = (page, uuid, to) =>
    page.evaluate(
      async ({ uuid, to }) => {
        const calls = await window.spt("player-calls.js");
        calls.playerCall(fromUuidSync(uuid), to);
        // Read at once: the GM may answer (and clear it) as soon as this task yields.
        return calls.outgoing?.callId ?? null;
      },
      { uuid, to }
    );

  /** The GM calls as Mr Smith: the call id if a device rings, undefined if none does. */
  const gmCall = (to) => s.gm.evaluate(async (to) => (await window.spt("ring.js")).ring(`phone:${to}`, { caller: "Mr Smith" }), to);

  /** What the agent sees on the device (pending entries left out), and the unread count. */
  const shown = (page, uuid) =>
    page.evaluate(async (uuid) => {
      const { getLog, getPhoneData, unreadCount } = await window.spt("devices.js");
      const phone = getPhoneData(fromUuidSync(uuid));
      return { log: getLog(phone), unread: unreadCount(phone) };
    }, uuid);

  const ringingAt = (page) => page.evaluate(async () => (await window.spt("player-calls.js")).activeCall?.callId ?? null);
  const gmHasCall = () => s.gm.evaluate(async () => (await window.spt("ring.js")).pendingCalls.size > 0);

  /** Is this entry pending? ("missing" if there is no such entry.) */
  const pendingOf = async (page, uuid, match) => {
    const entry = (await deviceLog(page, uuid)).find(match);
    return entry ? !!entry.pending : "missing";
  };

  test("Bob disconnected: SMS from the GM and from Alice wait in his phone, he finds them unread when he comes back", async ({ browser }) => {
    const { gm, alice, aliceDevice, bobDevice } = s;
    await s.bob.context().close();
    await expect.poll(() => gm.evaluate(() => game.users.getName("Bob").active)).toBe(false);

    const fromGm = unique("GM while away");
    const fromAlice = unique("Alice while away");
    await gmSms(NUMBERS.Bob, fromGm);
    expect(await playerSms(alice, aliceDevice.uuid, NUMBERS.Bob, fromAlice)).toBe(true);
    await expectLogEntry(gm, bobDevice.uuid, { kind: "sms", dir: "in", text: fromGm, with: NUMBERS["Mr Smith"] });
    await expectLogEntry(gm, bobDevice.uuid, { kind: "sms", dir: "in", text: fromAlice, with: NUMBERS.Alice });

    // A call to a disconnected agent does not ring anywhere: Alice gets no answer, Bob a missed call.
    const callId = await playerCall(alice, aliceDevice.uuid, NUMBERS.Bob);
    expect(callId).not.toBeNull();
    await expectLogEntry(alice, aliceDevice.uuid, { kind: "call", dir: "out", call: callId, result: "noanswer" });
    expect(await gmHasCall()).toBe(false);

    // Bob comes back: everything is there, unread.
    s.bob = await join(browser, "Bob");
    const { log, unread } = await shown(s.bob, bobDevice.uuid);
    for (const text of [fromGm, fromAlice]) expect(log.find((e) => e.text === text)).toMatchObject({ kind: "sms", dir: "in", read: false });
    expect(log.find((e) => e.call === callId)).toMatchObject({ kind: "call", dir: "in", result: "missed", read: false });
    expect(unread).toBe(3);
  });

  test("Bob's device alone out of network: SMS from the GM and from Alice wait, calls do not ring, all delivered when the signal returns", async () => {
    const { gm, alice, bob, aliceDevice, bobDevice } = s;
    await patchPhone(gm, bobDevice.uuid, { noSignal: true });
    await expectPhone(bob, bobDevice.uuid, { noSignal: true });
    const before = await shown(bob, bobDevice.uuid);

    const fromGm = unique("GM no signal");
    const fromAlice = unique("Alice no signal");
    await gmSms(NUMBERS.Bob, fromGm);
    expect(await playerSms(alice, aliceDevice.uuid, NUMBERS.Bob, fromAlice)).toBe(true);
    await expectLogEntry(bob, bobDevice.uuid, { text: fromGm, pending: true });
    await expectLogEntry(bob, bobDevice.uuid, { text: fromAlice, pending: true });

    // Calls: neither the GM's nor Alice's rings at Bob.
    expect(await gmCall(NUMBERS.Bob)).toBeUndefined();
    const callId = await playerCall(alice, aliceDevice.uuid, NUMBERS.Bob);
    await expectLogEntry(alice, aliceDevice.uuid, { kind: "call", dir: "out", call: callId, result: "unreachable" });
    await bob.waitForTimeout(1000);
    expect(await ringingAt(bob)).toBeNull();
    expect(await gmHasCall()).toBe(false);
    // Nothing shows on Bob's device yet.
    expect(await shown(bob, bobDevice.uuid)).toEqual(before);

    await patchPhone(gm, bobDevice.uuid, { noSignal: false });
    for (const text of [fromGm, fromAlice]) await expect.poll(() => pendingOf(bob, bobDevice.uuid, (e) => e.text === text)).toBe(false);
    await expect.poll(() => pendingOf(bob, bobDevice.uuid, (e) => e.call === callId)).toBe(false);
    // Two messages and two missed calls (the GM's and Alice's), unread.
    await expect.poll(async () => (await shown(bob, bobDevice.uuid)).unread).toBe(before.unread + 4);
  });

  test("Whole network down: the GM's SMS to Bob waits, and is delivered when the GM restores the network", async () => {
    const { gm, alice, bob, bobDevice } = s;
    await setModuleSetting(gm, "networkDown", true, [alice, bob]);
    try {
      const text = unique("GM network down");
      await gmSms(NUMBERS.Bob, text);
      await expectLogEntry(bob, bobDevice.uuid, { text, pending: true });
      expect(await gmCall(NUMBERS.Bob)).toBeUndefined();
      expect(await ringingAt(bob)).toBeNull();

      await setModuleSetting(gm, "networkDown", false, [alice, bob]);
      await expect.poll(() => pendingOf(bob, bobDevice.uuid, (e) => e.text === text)).toBe(false);
    } finally {
      await setModuleSetting(gm, "networkDown", false, [alice, bob]);
    }
  });

  test("Bob's phone off: it does not ring and receives nothing; switched on, the messages and missed calls arrive", async () => {
    const { gm, alice, bob, aliceDevice, bobDevice } = s;
    await patchPhone(gm, bobDevice.uuid, { mode: "off" });
    await expectPhone(alice, bobDevice.uuid, { mode: "off" });
    const before = await shown(bob, bobDevice.uuid);

    const fromGm = unique("GM phone off");
    const fromAlice = unique("Alice phone off");
    await gmSms(NUMBERS.Bob, fromGm);
    expect(await playerSms(alice, aliceDevice.uuid, NUMBERS.Bob, fromAlice)).toBe(true);
    await expectLogEntry(bob, bobDevice.uuid, { text: fromGm, pending: true });
    await expectLogEntry(bob, bobDevice.uuid, { text: fromAlice, pending: true });

    expect(await gmCall(NUMBERS.Bob)).toBeUndefined();
    const callId = await playerCall(alice, aliceDevice.uuid, NUMBERS.Bob);
    await expectLogEntry(alice, aliceDevice.uuid, { kind: "call", dir: "out", call: callId, result: "unreachable" });
    await bob.waitForTimeout(1000);
    expect(await ringingAt(bob)).toBeNull();
    expect(await gmHasCall()).toBe(false);
    expect(await shown(bob, bobDevice.uuid)).toEqual(before);

    await patchPhone(gm, bobDevice.uuid, { mode: "on" });
    for (const text of [fromGm, fromAlice]) await expect.poll(() => pendingOf(bob, bobDevice.uuid, (e) => e.text === text)).toBe(false);
    await expect.poll(() => pendingOf(bob, bobDevice.uuid, (e) => e.call === callId)).toBe(false);
    await expect.poll(async () => (await shown(bob, bobDevice.uuid)).unread).toBe(before.unread + 4);
  });
});
