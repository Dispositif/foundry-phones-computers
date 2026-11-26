import { expect, test } from "@playwright/test";
import { deviceLog, expectLogEntry, expectLogUnchanged, openDevice, unique } from "./helpers.mjs";
import { MODULE_ID } from "./env.mjs";
import { NUMBERS, freshSession } from "./world.mjs";

/**
 * What the GM's client (the network) enforces: devices only their holders use, one call at a time,
 * hidden numbers, out-of-service and unknown numbers, devices NPCs carry.
 * Not serial: the tests do not depend on each other (a failure restarts the session).
 */
const SOCKET = `module.${MODULE_ID}`;
const OFF_NUMBER = "555-0300";
const UNKNOWN_NUMBER = "555-0444";
const NPC_DEVICE = "555-0177";
const DIRECTORY = `Mr Smith | ${NUMBERS["Mr Smith"]} | public`;

test.describe("GM rules", () => {
  let s;

  test.beforeAll(async ({ browser }) => {
    s = await freshSession(browser);
  });

  test.afterAll(async () => {
    await s?.close();
  });

  const playerSms = (page, uuid, to, text) =>
    page.evaluate(async ({ uuid, to, text }) => (await window.spt("player-calls.js")).playerSendSms(fromUuidSync(uuid), to, text), { uuid, to, text });
  const gmSms = (to, text, sender) => s.gm.evaluate(async ({ to, text, sender }) => (await window.spt("messages.js")).sendSms(`phone:${to}`, text, sender ? { sender } : {}), { to, text, sender });
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
  /** Sends a raw module message, as a modified client could (bypassing the device's own checks). */
  const emit = (page, data) => page.evaluate(({ socket, data }) => game.socket.emit(socket, { ...data, userId: game.user.id }), { socket: SOCKET, data });
  const gmIncoming = () => s.gm.evaluate(async () => (await window.spt("gm-actions.js")).gmIncoming.size);
  const ringDialog = () => s.gm.locator(".spt-phone-ring-dialog");
  const setDirectory = (text) => s.gm.evaluate(({ id, text }) => game.settings.set(id, "directory", text), { id: MODULE_ID, text });
  const directory = () => s.gm.evaluate((id) => game.settings.get(id, "directory"), MODULE_ID);
  /** The warning the device shows (its window must be open). */
  const expectNotice = async (page, key, data = {}) => {
    const text = await page.evaluate(async ({ key, data }) => (await window.spt("i18n.js")).t(key, data), { key, data });
    await expect(page.locator(".spt-device-notice.warn")).toContainText(text);
  };
  const endNpcCall = async (action = "noanswer") => {
    await ringDialog().locator(`button[data-action="${action}"]`).click();
    await expect(ringDialog()).toBeHidden();
  };

  test("A player cannot use another player's device: the GM ignores SMS, calls, read marks and gifts made with it", async () => {
    const { gm, alice, bob, aliceDevice } = s;
    // Something unread on Alice's phone, to check Bob cannot mark it read.
    const unread = unique("For Alice only");
    await gmSms(NUMBERS.Alice, unread, "Mr Smith");
    await expectLogEntry(alice, aliceDevice.uuid, { text: unread, read: false });
    const before = await deviceLog(alice, aliceDevice.uuid);
    const bobActor = await bob.evaluate(() => game.user.character.id);

    await emit(bob, { type: "playerSms", fromItemUuid: aliceDevice.uuid, to: NUMBERS["Mr Smith"], text: "Spoofed" });
    await emit(bob, { type: "playerCall", fromItemUuid: aliceDevice.uuid, to: NUMBERS["Mr Smith"], callId: "spoofedcall00001" });
    await emit(bob, { type: "playerRead", itemUuid: aliceDevice.uuid, key: NUMBERS["Mr Smith"] });
    await emit(bob, { type: "playerGive", itemUuid: aliceDevice.uuid, actorId: bobActor });

    await expectLogUnchanged(alice, aliceDevice.uuid, before);
    expect(await gmIncoming()).toBe(0);
    await expect(ringDialog()).toBeHidden();
    // Still on Alice's character.
    expect(await gm.evaluate((uuid) => fromUuidSync(uuid)?.parent?.name, aliceDevice.uuid)).toBe("Agent Alice");
  });

  test("A player cannot pass for another one: Bob's client claiming to be Alice is ignored", async () => {
    const { gm, alice, bob, aliceDevice } = s;
    const unread = unique("Still unread");
    await gmSms(NUMBERS.Alice, unread, "Mr Smith");
    await expectLogEntry(alice, aliceDevice.uuid, { text: unread, read: false });
    const before = await deviceLog(alice, aliceDevice.uuid);
    const aliceId = await alice.evaluate(() => game.user.id);
    const bobActor = await bob.evaluate(() => game.user.character.id);
    // Raw messages with Alice's user id written in them, sent from Bob's browser.
    const forge = (data) => bob.evaluate(({ socket, data }) => game.socket.emit(socket, data), { socket: SOCKET, data: { ...data, userId: aliceId } });

    await forge({ type: "playerSms", fromItemUuid: aliceDevice.uuid, to: NUMBERS["Mr Smith"], text: "Forged" });
    await forge({ type: "playerCall", fromItemUuid: aliceDevice.uuid, to: NUMBERS["Mr Smith"], callId: "forgedcall000001" });
    await forge({ type: "playerRead", itemUuid: aliceDevice.uuid, key: NUMBERS["Mr Smith"] });
    await forge({ type: "playerGive", itemUuid: aliceDevice.uuid, actorId: bobActor });

    await expectLogUnchanged(alice, aliceDevice.uuid, before);
    expect(await gmIncoming()).toBe(0);
    await expect(ringDialog()).toBeHidden();
    expect(await gm.evaluate((uuid) => fromUuidSync(uuid)?.parent?.name, aliceDevice.uuid)).toBe("Agent Alice");
  });

  test("Network busy: while a call rings, and while one is in progress, a second call gets “busy” (on the device and from the GM)", async () => {
    const { gm, alice, bob, aliceDevice, bobDevice } = s;
    // Alice calls Mr Smith: it rings at the GM.
    const first = await playerCall(alice, aliceDevice.uuid, NUMBERS["Mr Smith"]);
    await expect(ringDialog()).toBeVisible();

    await openDevice(bob, bobDevice.uuid);
    // Bob's device knows a call is ringing at the table: refused at once.
    await expect.poll(() => playerCall(bob, bobDevice.uuid, NUMBERS["Mr Smith"])).toBeNull();
    await expectNotice(bob, "CallerResult.busy");
    // Even past the device's own check, the GM answers "busy".
    await emit(bob, { type: "playerCall", fromItemUuid: bobDevice.uuid, to: NUMBERS["Mr Smith"], callId: "busywhileringing" });
    await expectLogEntry(bob, bobDevice.uuid, { kind: "call", dir: "out", call: "busywhileringing", result: "busy" });
    expect(await gmIncoming()).toBe(1);
    // The GM cannot place a call either.
    const gmTry = await gm.evaluate(async (to) => {
      const notice = await (await window.spt("ring.js")).ring(`phone:${to}`, { caller: "Mr Smith" });
      return { message: notice?.message ?? null, expected: (await window.spt("i18n.js")).t("Warn.NetworkBusy"), ringing: (await window.spt("ring.js")).pendingCalls.size };
    }, NUMBERS.Bob);
    expect(gmTry.message).toBe(gmTry.expected);
    expect(gmTry.ringing).toBe(0);
    expect(await bob.evaluate(async () => (await window.spt("player-calls.js")).activeCall)).toBeNull();

    // The GM answers: the call is in progress, still busy for the others.
    await endNpcCall("answer");
    await expect.poll(() => gm.evaluate(async () => [...(await window.spt("live-call.js")).liveCalls.values()].some((c) => !c.ended && !c.dialing))).toBe(true);
    await emit(bob, { type: "playerCall", fromItemUuid: bobDevice.uuid, to: NUMBERS.Alice, callId: "busywhilelive0001" });
    await expectLogEntry(bob, bobDevice.uuid, { kind: "call", dir: "out", call: "busywhilelive0001", result: "busy" });
    expect(await alice.evaluate(async () => (await window.spt("player-calls.js")).activeCall)).toBeNull();

    await alice.evaluate(async (callId) => (await window.spt("live-call.js")).hangUpLive(callId), first);
    await expect.poll(() => gm.evaluate(async () => [...(await window.spt("live-call.js")).liveCalls.values()].some((c) => !c.ended))).toBe(false);
  });

  test("Hidden number: a message from a hidden number cannot be answered, nor called back", async () => {
    const { alice, aliceDevice } = s;
    const text = unique("Anonymous tip");
    await gmSms(NUMBERS.Alice, text); // no sender: hidden number
    const masked = await alice.evaluate(async () => (await window.spt("constants.js")).MASKED);
    await expectLogEntry(alice, aliceDevice.uuid, { kind: "sms", dir: "in", text, with: masked });
    await openDevice(alice, aliceDevice.uuid);
    const before = await deviceLog(alice, aliceDevice.uuid);

    expect(await playerSms(alice, aliceDevice.uuid, masked, "Who are you?")).toBe(false);
    await expectNotice(alice, "Warn.CantReplyMasked");
    expect(await playerCall(alice, aliceDevice.uuid, masked)).toBeNull();
    await expectNotice(alice, "Warn.CantCallMasked");
    await expectLogUnchanged(alice, aliceDevice.uuid, before);
    expect(await gmIncoming()).toBe(0);
  });

  test("Out-of-service number (directory “off”): the SMS is not delivered, the call gets “unassigned”, the GM is not disturbed", async () => {
    const { alice, aliceDevice } = s;
    await setDirectory(`${DIRECTORY}\n| ${OFF_NUMBER} | off`);
    await expect.poll(() => alice.evaluate(async (n) => (await window.spt("devices.js")).isOffNumber({}, n), OFF_NUMBER)).toBe(true);
    try {
      await openDevice(alice, aliceDevice.uuid);
      const text = unique("Hello?");
      expect(await playerSms(alice, aliceDevice.uuid, OFF_NUMBER, text)).toBe(true);
      await expectLogEntry(alice, aliceDevice.uuid, { kind: "sms", dir: "out", text, off: true });
      await expectNotice(alice, "Warn.SmsUnassigned");

      const callId = await playerCall(alice, aliceDevice.uuid, OFF_NUMBER);
      await expectLogEntry(alice, aliceDevice.uuid, { kind: "call", dir: "out", call: callId, result: "unassigned" });
      expect(await gmIncoming()).toBe(0);
      await expect(ringDialog()).toBeHidden();
    } finally {
      await setDirectory(DIRECTORY);
    }
  });

  test("Unknown number: the GM types who answers in the call window, the name goes to the directory", async () => {
    const { alice, aliceDevice } = s;
    try {
      const callId = await playerCall(alice, aliceDevice.uuid, UNKNOWN_NUMBER);
      await expect(ringDialog()).toBeVisible();
      await ringDialog().locator('input[name="sptNpcName"]').fill("Mrs Doe");
      await endNpcCall("noanswer");
      await expectLogEntry(alice, aliceDevice.uuid, { kind: "call", dir: "out", call: callId, result: "noanswer" });
      await expect.poll(directory).toContain(`Mrs Doe | ${UNKNOWN_NUMBER}`);
    } finally {
      await setDirectory(DIRECTORY);
    }
  });

  test("Unknown name: a name that is neither a contact nor in the directory is refused on the device", async () => {
    const { alice, aliceDevice } = s;
    await openDevice(alice, aliceDevice.uuid);
    const before = await deviceLog(alice, aliceDevice.uuid);
    expect(await playerSms(alice, aliceDevice.uuid, "Zorglub", "Hi")).toBe(false);
    await expectNotice(alice, "Warn.UnknownName", { name: "Zorglub" });
    expect(await playerCall(alice, aliceDevice.uuid, "Zorglub")).toBeNull();
    await expectLogUnchanged(alice, aliceDevice.uuid, before);
    expect(await gmIncoming()).toBe(0);
  });

  test("A device Mr Smith carries: Alice's SMS reaches the GM and stays in his device's history; her call rings at the GM", async () => {
    const { gm, alice, aliceDevice } = s;
    const npcDevice = await gm.evaluate(
      async (number) => (await (await window.spt("devices.js")).createPhone(game.actors.getName("Mr Smith"), { label: "Smith's phone", number })).uuid,
      NPC_DEVICE
    );
    try {
      const text = unique("Mr Smith?");
      expect(await playerSms(alice, aliceDevice.uuid, NPC_DEVICE, text)).toBe(true);
      // For the GM: an unseen message to answer as the NPC; and a copy in the NPC's device (read, an NPC's).
      await expectLogEntry(alice, aliceDevice.uuid, { kind: "sms", dir: "out", text, seen: false });
      await expectLogEntry(gm, npcDevice, { kind: "sms", dir: "in", text, with: NUMBERS.Alice, read: true, npc: true });

      const callId = await playerCall(alice, aliceDevice.uuid, NPC_DEVICE);
      await expect(ringDialog()).toBeVisible();
      await expect(ringDialog()).toContainText("Mr Smith");
      await endNpcCall("noanswer");
      await expectLogEntry(alice, aliceDevice.uuid, { kind: "call", dir: "out", call: callId, result: "noanswer" });
    } finally {
      await gm.evaluate(async (uuid) => fromUuidSync(uuid)?.delete(), npcDevice);
    }
  });
});
