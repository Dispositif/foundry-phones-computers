import { expect, test } from "@playwright/test";
import { deviceLog, expectLogEntry, expectLogUnchanged, expectPhone, moduleText, openDevice, patchPhone, setModuleSetting, unique } from "./helpers.mjs";
import { NUMBERS, freshSession } from "./world.mjs";

/**
 * Messages from the GM, and what the network refuses: no signal, network down, device off or locked.
 * Each test puts back what it changes.
 */
test.describe.serial("Network and device state", () => {
  let s;

  test.beforeAll(async ({ browser }) => {
    s = await freshSession(browser);
  });

  test.afterAll(async () => {
    await s?.close();
  });

  const sendSms = (page, uuid, to, text) =>
    page.evaluate(
      async ({ uuid, to, text }) => {
        const { playerSendSms } = await window.spt("player-calls.js");
        return playerSendSms(fromUuidSync(uuid), to, text);
      },
      { uuid, to, text }
    );

  const call = (page, uuid, to) =>
    page.evaluate(
      async ({ uuid, to }) => {
        const calls = await window.spt("player-calls.js");
        calls.playerCall(fromUuidSync(uuid), to);
        // Read at once: the GM may answer (and clear it) as soon as this task yields.
        return calls.outgoing?.callId ?? null;
      },
      { uuid, to }
    );

  /** Is this history entry still pending? ("missing" if there is no such entry.) */
  const pendingOf = async (page, uuid, match) => {
    const entry = (await deviceLog(page, uuid)).find(match);
    return entry ? !!entry.pending : "missing";
  };

  /** The warning the device shows (its window must be open). */
  const expectNotice = async (page, key) => {
    const text = await moduleText(page, key);
    await expect(page.locator(".spt-device-notice.warn")).toContainText(text);
  };

  test("SMS GM → PC: Mr Smith writes to Alice, the message lands on her device, unread", async () => {
    const { gm, alice, aliceDevice } = s;
    const text = unique("Package at the docks");
    const chatBefore = await gm.evaluate(() => game.messages.size);
    await gm.evaluate(
      async ({ to, text }) => {
        const { sendSms } = await window.spt("messages.js");
        await sendSms(`phone:${to}`, text, { sender: "Mr Smith" });
      },
      { to: NUMBERS.Alice, text }
    );
    // The directory name becomes his number on Alice's device.
    await expectLogEntry(alice, aliceDevice.uuid, { kind: "sms", dir: "in", with: NUMBERS["Mr Smith"], text, read: false });
    expect(await alice.evaluate(async (uuid) => (await window.spt("devices.js")).unreadCount((await window.spt("devices.js")).getPhoneData(fromUuidSync(uuid))), aliceDevice.uuid)).toBe(1);
    expect(await gm.evaluate(() => game.messages.size)).toBe(chatBefore);
  });

  test("No signal on Bob's phone: Alice's SMS waits, and is delivered when the signal returns", async () => {
    const { gm, alice, bob, aliceDevice, bobDevice } = s;
    await patchPhone(gm, bobDevice.uuid, { noSignal: true });
    await expectPhone(alice, bobDevice.uuid, { noSignal: true });

    const text = unique("Where are you?");
    expect(await sendSms(alice, aliceDevice.uuid, NUMBERS.Bob, text)).toBe(true);
    await expectLogEntry(alice, aliceDevice.uuid, { kind: "sms", dir: "out", text });
    await expectLogEntry(bob, bobDevice.uuid, { kind: "sms", dir: "in", text, pending: true });
    // Pending: not shown on Bob's device yet.
    expect((await bob.evaluate(async (uuid) => (await window.spt("devices.js")).getLog((await window.spt("devices.js")).getPhoneData(fromUuidSync(uuid))), bobDevice.uuid)).some((e) => e.text === text)).toBe(false);

    // Signal back: the GM's client delivers what was waiting.
    await patchPhone(gm, bobDevice.uuid, { noSignal: false });
    await expect.poll(() => pendingOf(bob, bobDevice.uuid, (e) => e.text === text)).toBe(false);
    const received = (await deviceLog(bob, bobDevice.uuid)).find((e) => e.text === text);
    expect(received).toMatchObject({ kind: "sms", dir: "in", with: NUMBERS.Alice });
    expect(received.read).toBeFalsy();
  });

  test("No signal on Bob's phone: Alice's call does not get through, Bob sees the missed call when the signal returns", async () => {
    const { gm, alice, bob, aliceDevice, bobDevice } = s;
    await patchPhone(gm, bobDevice.uuid, { noSignal: true });
    await expectPhone(alice, bobDevice.uuid, { noSignal: true });

    const callId = await call(alice, aliceDevice.uuid, NUMBERS.Bob);
    expect(callId).not.toBeNull();
    await expectLogEntry(alice, aliceDevice.uuid, { kind: "call", dir: "out", call: callId, result: "unreachable" });
    // Bob's phone never rang.
    expect(await bob.evaluate(async () => (await window.spt("player-calls.js")).activeCall)).toBeNull();
    await expectLogEntry(bob, bobDevice.uuid, { kind: "call", dir: "in", call: callId, result: "missed", pending: true });

    await patchPhone(gm, bobDevice.uuid, { noSignal: false });
    await expect.poll(() => pendingOf(bob, bobDevice.uuid, (e) => e.call === callId)).toBe(false);
  });

  test("No signal on Alice's phone: her device refuses to send or call, nothing reaches Bob", async () => {
    const { gm, alice, bob, aliceDevice, bobDevice } = s;
    await patchPhone(gm, aliceDevice.uuid, { noSignal: true });
    await expectPhone(alice, aliceDevice.uuid, { noSignal: true });
    await openDevice(alice, aliceDevice.uuid);
    const aliceBefore = await deviceLog(alice, aliceDevice.uuid);
    const bobBefore = await deviceLog(bob, bobDevice.uuid);

    expect(await sendSms(alice, aliceDevice.uuid, NUMBERS.Bob, unique("Lost"))).toBe(false);
    await expectNotice(alice, "Net.NoSignal");
    expect(await call(alice, aliceDevice.uuid, NUMBERS.Bob)).toBeNull();
    await expectNotice(alice, "Net.NoSignal");

    await expectLogUnchanged(bob, bobDevice.uuid, bobBefore);
    expect(await bob.evaluate(async () => (await window.spt("player-calls.js")).activeCall)).toBeNull();
    expect(await deviceLog(alice, aliceDevice.uuid)).toEqual(aliceBefore);
    await patchPhone(gm, aliceDevice.uuid, { noSignal: false });
    await expectPhone(alice, aliceDevice.uuid, { noSignal: false });
  });

  test("Network down (GM setting): no SMS and no call get out, then everything works again", async () => {
    const { gm, alice, bob, aliceDevice, bobDevice } = s;
    await setModuleSetting(gm, "networkDown", true, [alice, bob]);
    await openDevice(alice, aliceDevice.uuid);
    const bobBefore = await deviceLog(bob, bobDevice.uuid);

    expect(await sendSms(alice, aliceDevice.uuid, NUMBERS.Bob, unique("Anyone?"))).toBe(false);
    await expectNotice(alice, "Net.NoSignal");
    expect(await call(alice, aliceDevice.uuid, NUMBERS.Bob)).toBeNull();
    await expectLogUnchanged(bob, bobDevice.uuid, bobBefore);

    await setModuleSetting(gm, "networkDown", false, [alice, bob]);
    const text = unique("Back online");
    expect(await sendSms(alice, aliceDevice.uuid, NUMBERS.Bob, text)).toBe(true);
    await expectLogEntry(bob, bobDevice.uuid, { kind: "sms", dir: "in", text });
  });

  for (const [what, patch, back, notice] of [
    ["switched off", { mode: "off" }, { mode: "on" }, "Warn.PhoneOff"],
    ["locked", { locked: true }, { locked: false }, "Warn.Locked"]
  ]) {
    test(`Alice's phone ${what}: sending and calling are refused on the device, nothing reaches Bob`, async () => {
      const { gm, alice, bob, aliceDevice, bobDevice } = s;
      await patchPhone(gm, aliceDevice.uuid, patch);
      await expectPhone(alice, aliceDevice.uuid, patch);
      await openDevice(alice, aliceDevice.uuid);
      const aliceBefore = await deviceLog(alice, aliceDevice.uuid);
      const bobBefore = await deviceLog(bob, bobDevice.uuid);

      expect(await sendSms(alice, aliceDevice.uuid, NUMBERS.Bob, unique("Hello"))).toBe(false);
      await expectNotice(alice, notice);
      expect(await call(alice, aliceDevice.uuid, NUMBERS.Bob)).toBeNull();
      await expectNotice(alice, notice);

      await expectLogUnchanged(bob, bobDevice.uuid, bobBefore);
      expect(await bob.evaluate(async () => (await window.spt("player-calls.js")).activeCall)).toBeNull();
      expect(await deviceLog(alice, aliceDevice.uuid)).toEqual(aliceBefore);

      await patchPhone(gm, aliceDevice.uuid, back);
      await expectPhone(alice, aliceDevice.uuid, back);
    });
  }
});
