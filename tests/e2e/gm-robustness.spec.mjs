import { expect, test } from "@playwright/test";
import { deviceLog, expectLogEntry, expectPhone, join, patchPhone, playerCall, playerSms, reload, ringingAt, setModuleSetting, unique } from "./helpers.mjs";
import { NUMBERS, freshSession } from "./world.mjs";

/**
 * The GM's browser is the network. What happens when it reloads in the middle of things
 * (a call ringing, a call in progress, messages waiting), and when two GMs are connected at once:
 * only the active GM acts as the network (no entry written twice, nothing delivered twice).
 * Not serial: each test leaves the table as it found it.
 */
const SECOND_GM = "Second GM";

/** The call as this page sees it: null, "dialing", "live" or the reason it ended. */
const lineState = (page, callId) =>
  page.evaluate(async (callId) => {
    const live = (await window.spt("live-call.js")).liveCalls.get(callId);
    return !live ? null : live.ended ? live.ended.reason : live.dialing ? "dialing" : "live";
  }, callId);

/** Alice's call being dialed (her side), or null. */
const outgoingAt = (page) => page.evaluate(async () => (await window.spt("player-calls.js")).outgoing?.callId ?? null);

/** Calls ringing in this GM's browser (the network's memory). */
const gmPending = (gm) => gm.evaluate(async () => (await window.spt("ring.js")).pendingCalls.size);

/** History entries of a device matching these fields, as this page sees it. */
const entries = async (page, uuid, fields) => (await deviceLog(page, uuid)).filter((e) => Object.entries(fields).every(([k, v]) => e[k] === v));

/** Calls in progress kept in the world (restored after a reload). */
const storedCalls = (gm) => gm.evaluate(() => Object.keys(game.settings.get("soren-phones-computers", "liveCalls") ?? {}).length);

const gmSms = (gm, to, text) => gm.evaluate(async ({ to, text }) => (await window.spt("messages.js")).sendSms(`phone:${to}`, text, { sender: "Mr Smith" }), { to, text });

/** Alice calls Bob, he answers: the call id, live for the three of them. */
async function liveCall(gm, alice, bob, aliceDevice) {
  const callId = await playerCall(alice, aliceDevice.uuid, NUMBERS.Bob);
  expect(callId).not.toBeNull();
  await expect.poll(() => ringingAt(bob)).toBe(callId);
  await bob.evaluate(async () => (await window.spt("player-calls.js")).endCall("answer"));
  for (const page of [gm, alice, bob]) await expect.poll(() => lineState(page, callId)).toBe("live");
  return callId;
}

/** Alice hangs up: the call ends for all, and each device has one answered entry with its duration. */
async function hangUpAndCheck(gm, alice, bob, aliceDevice, bobDevice, callId) {
  await alice.evaluate(async (id) => (await window.spt("live-call.js")).hangUpLive(id), callId);
  for (const page of [gm, bob]) await expect.poll(() => lineState(page, callId)).not.toBe("live");
  for (const [page, uuid, dir] of [[alice, aliceDevice.uuid, "out"], [bob, bobDevice.uuid, "in"]]) {
    await expect.poll(async () => (await entries(page, uuid, { call: callId, dir, result: "answer" }))[0]?.dur, { message: `${page.userName}: duration of ${callId}` }).toBeGreaterThanOrEqual(0);
    expect(await entries(page, uuid, { call: callId }), `${page.userName}: one entry for ${callId}`).toHaveLength(1);
  }
}

test.describe("GM reloads", () => {
  let s;

  test.beforeAll(async ({ browser }) => {
    s = await freshSession(browser);
  });

  test.afterAll(async () => {
    await s?.close();
  });

  test("The GM reloads while Alice's call to Bob rings: the call ends on both sides, nothing is left hanging, the next call works", async () => {
    const { gm, alice, bob, aliceDevice, bobDevice } = s;
    const callId = await playerCall(alice, aliceDevice.uuid, NUMBERS.Bob);
    await expect.poll(() => ringingAt(bob)).toBe(callId);

    await reload(gm);
    // The GM's memory of the ringing call is gone: the players' sides end it too.
    await expect.poll(() => ringingAt(bob)).toBeNull();
    await expect.poll(() => outgoingAt(alice)).toBeNull();
    expect(await gmPending(gm)).toBe(0);
    for (const page of [gm, alice, bob]) expect(await lineState(page, callId)).toBeNull();

    // The network is free again: a new call rings, is answered and hung up normally.
    const again = await liveCall(gm, alice, bob, aliceDevice);
    expect(again).not.toBe(callId);
    await hangUpAndCheck(gm, alice, bob, aliceDevice, bobDevice, again);
  });

  test("The GM reloads during a call in progress: the network is gone, the call is cut for Alice and Bob and not brought back; they can call again", async () => {
    const { gm, alice, bob, aliceDevice, bobDevice } = s;
    const callId = await liveCall(gm, alice, bob, aliceDevice);

    await reload(gm);
    // Cut on the players' side when the GM left (in-game: a network failure).
    for (const page of [alice, bob]) await expect.poll(() => lineState(page, callId)).not.toBe("live");
    // The GM back: the call is not reopened, nothing stays stored, the line is free.
    expect(await lineState(gm, callId)).toBeNull();
    await expect.poll(() => storedCalls(gm)).toBe(0);
    for (const page of [alice, bob]) await expect.poll(() => lineState(page, callId), { timeout: 15_000 }).toBeNull();
    // One answered entry per device (no duration: nobody saw the end).
    expect(await entries(alice, aliceDevice.uuid, { call: callId })).toHaveLength(1);
    expect(await entries(bob, bobDevice.uuid, { call: callId })).toHaveLength(1);

    const again = await liveCall(gm, alice, bob, aliceDevice);
    await hangUpAndCheck(gm, alice, bob, aliceDevice, bobDevice, again);
  });

  test("The GM reloads while messages wait for Bob (no signal): when the signal returns, each is delivered once, unread", async () => {
    const { gm, alice, bob, aliceDevice, bobDevice } = s;
    await patchPhone(gm, bobDevice.uuid, { noSignal: true });
    await expectPhone(bob, bobDevice.uuid, { noSignal: true });
    try {
      const fromGm = unique("GM before reload");
      const fromAlice = unique("Alice before reload");
      await gmSms(gm, NUMBERS.Bob, fromGm);
      expect(await playerSms(alice, aliceDevice.uuid, NUMBERS.Bob, fromAlice)).toBe(true);
      await expectLogEntry(bob, bobDevice.uuid, { text: fromGm, pending: true });
      await expectLogEntry(bob, bobDevice.uuid, { text: fromAlice, pending: true });

      await reload(gm);
      // Still waiting after the reload (kept in the device, not in the GM's memory).
      await expectLogEntry(gm, bobDevice.uuid, { text: fromGm, pending: true });
      await expectLogEntry(gm, bobDevice.uuid, { text: fromAlice, pending: true });

      await patchPhone(gm, bobDevice.uuid, { noSignal: false });
      for (const text of [fromGm, fromAlice]) {
        await expect.poll(async () => (await entries(bob, bobDevice.uuid, { text })).map((e) => !!e.pending)).toEqual([false]);
        expect((await entries(bob, bobDevice.uuid, { text }))[0]).toMatchObject({ kind: "sms", dir: "in", read: false });
      }
      await bob.waitForTimeout(1500);
      for (const text of [fromGm, fromAlice]) expect(await entries(bob, bobDevice.uuid, { text })).toHaveLength(1);
      expect(await entries(alice, aliceDevice.uuid, { text: fromAlice })).toHaveLength(1);
    } finally {
      await patchPhone(gm, bobDevice.uuid, { noSignal: false });
    }
  });
});

test.describe("Two GMs connected", () => {
  let s, gm2;

  test.beforeAll(async ({ browser }) => {
    s = await freshSession(browser);
    await s.gm.evaluate((name) => User.create({ name, role: CONST.USER_ROLES.GAMEMASTER, password: "" }), SECOND_GM);
    gm2 = await join(browser, SECOND_GM);
  });

  test.afterAll(async ({ browser }) => {
    if (gm2 && !gm2.isClosed()) await gm2.context().close();
    if (!s) return;
    // The first GM may have left in a test: back, to remove the second one.
    if (s.gm.isClosed()) s.gm = await join(browser, "Gamemaster");
    await s.gm.evaluate((name) => game.users.getName(name)?.delete(), SECOND_GM);
    await s.close();
  });

  /** The two GM pages: the active one (the network) first. Which one it is depends on the user ids. */
  const gms = async () => {
    const pages = [s.gm, gm2];
    const active = await s.gm.evaluate(() => game.users.activeGM?.name);
    expect([s.gm.userName, gm2.userName]).toContain(active);
    return active === s.gm.userName ? pages : pages.reverse();
  };

  test("A call between Alice and Bob: it rings once, only the active GM tracks it, and each history gets one entry", async () => {
    const { alice, bob, aliceDevice, bobDevice } = s;
    const [active, other] = await gms();
    const callId = await playerCall(alice, aliceDevice.uuid, NUMBERS.Bob);
    await expect.poll(() => ringingAt(bob)).toBe(callId);
    expect(await gmPending(active)).toBe(1);
    expect(await gmPending(other)).toBe(0);

    await bob.evaluate(async () => (await window.spt("player-calls.js")).endCall("answer"));
    for (const page of [active, other, alice, bob]) await expect.poll(() => lineState(page, callId)).toBe("live");
    await hangUpAndCheck(active, alice, bob, aliceDevice, bobDevice, callId);
    await expect.poll(() => lineState(other, callId)).not.toBe("live");
  });

  test("Messages from the GM and from Alice wait for Bob (no signal): delivered once when the signal returns", async () => {
    const { alice, bob, aliceDevice, bobDevice } = s;
    const [active, other] = await gms();
    await patchPhone(other, bobDevice.uuid, { noSignal: true });
    await expectPhone(bob, bobDevice.uuid, { noSignal: true });
    try {
      // The GM who is not the network writes: it still goes through once.
      const fromGm = unique("Other GM");
      const fromAlice = unique("Alice waits");
      await gmSms(other, NUMBERS.Bob, fromGm);
      expect(await playerSms(alice, aliceDevice.uuid, NUMBERS.Bob, fromAlice)).toBe(true);
      await expectLogEntry(bob, bobDevice.uuid, { text: fromGm, pending: true });
      await expectLogEntry(bob, bobDevice.uuid, { text: fromAlice, pending: true });

      // Signal back, switched by the GM who is not the network: the active one delivers.
      await patchPhone(other, bobDevice.uuid, { noSignal: false });
      for (const text of [fromGm, fromAlice]) await expect.poll(async () => (await entries(bob, bobDevice.uuid, { text })).map((e) => !!e.pending)).toEqual([false]);
      await bob.waitForTimeout(1500);
      for (const text of [fromGm, fromAlice]) expect(await entries(active, bobDevice.uuid, { text }), `one entry "${text}"`).toHaveLength(1);
      expect(await entries(alice, aliceDevice.uuid, { text: fromAlice })).toHaveLength(1);
    } finally {
      await patchPhone(active, bobDevice.uuid, { noSignal: false });
    }
  });

  test("The active GM reloads while a call rings: the call does not stay stuck, and the next call works", async () => {
    const { alice, bob, aliceDevice, bobDevice } = s;
    const [active] = await gms();
    await setModuleSetting(active, "ringTimeout", 5, [alice, bob]);
    try {
      const callId = await playerCall(alice, aliceDevice.uuid, NUMBERS.Bob);
      await expect.poll(() => ringingAt(bob)).toBe(callId);
      await reload(active);
      // Within the ring time (and a margin), both sides are free again.
      await expect.poll(() => ringingAt(bob), { timeout: 15_000 }).toBeNull();
      await expect.poll(() => outgoingAt(alice), { timeout: 15_000 }).toBeNull();

      const [now] = await gms();
      const again = await liveCall(now, alice, bob, aliceDevice);
      await hangUpAndCheck(now, alice, bob, aliceDevice, bobDevice, again);
    } finally {
      await setModuleSetting(s.gm, "ringTimeout", 60, [alice, bob]);
    }
  });

  test("A GM who is not the network leaves and comes back during a call: nothing is cut", async ({ browser }) => {
    const { alice, bob, aliceDevice, bobDevice } = s;
    const [active, other] = await gms();
    const callId = await liveCall(active, alice, bob, aliceDevice);
    const name = other.userName;
    await other.context().close();
    await expect.poll(() => alice.evaluate((name) => game.users.getName(name).active, name)).toBe(false);
    await alice.waitForTimeout(1000);
    for (const page of [active, alice, bob]) expect(await lineState(page, callId)).toBe("live");
    // Back: whichever is now the network, the call goes on and ends normally.
    const back = await join(browser, name);
    if (name === SECOND_GM) gm2 = back;
    else s.gm = back;
    await expect.poll(() => lineState(back, callId)).toBe("live");
    const [now] = await gms();
    await hangUpAndCheck(now, alice, bob, aliceDevice, bobDevice, callId);
  });

  test("The active GM leaves during a call: it is cut for everyone; the other GM becomes the network, records the duration, and calls and messages still work", async () => {
    const { alice, bob, aliceDevice, bobDevice } = s;
    const [active, other] = await gms();
    const cutId = await liveCall(active, alice, bob, aliceDevice);
    await active.context().close();
    await expect.poll(() => alice.evaluate(() => game.users.activeGM?.name)).toBe(other.userName);
    for (const page of [other, alice, bob]) await expect.poll(() => lineState(page, cutId)).not.toBe("live");
    for (const [page, uuid, dir] of [[alice, aliceDevice.uuid, "out"], [bob, bobDevice.uuid, "in"]]) {
      await expect.poll(async () => (await entries(page, uuid, { call: cutId, dir, result: "answer" }))[0]?.dur, { message: `${page.userName}: duration of ${cutId}` }).toBeGreaterThanOrEqual(0);
      expect(await entries(page, uuid, { call: cutId })).toHaveLength(1);
    }
    await expect.poll(() => storedCalls(other)).toBe(0);
    for (const page of [alice, bob]) await expect.poll(() => lineState(page, cutId), { timeout: 15_000 }).toBeNull();

    const text = unique("New network");
    expect(await playerSms(alice, aliceDevice.uuid, NUMBERS.Bob, text)).toBe(true);
    await expectLogEntry(bob, bobDevice.uuid, { text });
    await bob.waitForTimeout(1500);
    expect(await entries(bob, bobDevice.uuid, { text })).toHaveLength(1);

    const callId = await liveCall(other, alice, bob, aliceDevice);
    await hangUpAndCheck(other, alice, bob, aliceDevice, bobDevice, callId);
  });
});

test.describe("Assistant GM alone", () => {
  const ASSISTANT = "Assistant GM";
  let s, assistant;

  test.beforeAll(async ({ browser }) => {
    s = await freshSession(browser);
    await s.gm.evaluate((name) => User.create({ name, role: CONST.USER_ROLES.ASSISTANT, password: "" }), ASSISTANT);
    assistant = await join(browser, ASSISTANT);
    // The Gamemaster leaves: the assistant is the only GM, so the network.
    await s.gm.context().close();
    await expect.poll(() => s.alice.evaluate(() => game.users.activeGM?.name)).toBe(ASSISTANT);
  });

  test.afterAll(async ({ browser }) => {
    if (assistant && !assistant.isClosed()) await assistant.context().close();
    if (!s) return;
    if (s.gm.isClosed()) s.gm = await join(browser, "Gamemaster");
    await s.gm.evaluate((name) => game.users.getName(name)?.delete(), ASSISTANT);
    await s.close();
  });

  test("An Assistant GM alone runs the network: messages (also waiting ones), calls and their history", async () => {
    const { alice, bob, aliceDevice, bobDevice } = s;
    const text = unique("Assistant network");
    expect(await playerSms(alice, aliceDevice.uuid, NUMBERS.Bob, text)).toBe(true);
    await expectLogEntry(bob, bobDevice.uuid, { kind: "sms", dir: "in", text, read: false });
    const fromGm = unique("Assistant writes");
    await gmSms(assistant, NUMBERS.Alice, fromGm);
    await expectLogEntry(alice, aliceDevice.uuid, { kind: "sms", dir: "in", text: fromGm, with: NUMBERS["Mr Smith"] });

    // Waiting for Bob (no signal), delivered once when the signal returns.
    await patchPhone(assistant, bobDevice.uuid, { noSignal: true });
    await expectPhone(bob, bobDevice.uuid, { noSignal: true });
    const waiting = unique("Assistant waits");
    try {
      expect(await playerSms(alice, aliceDevice.uuid, NUMBERS.Bob, waiting)).toBe(true);
      await expectLogEntry(bob, bobDevice.uuid, { text: waiting, pending: true });
    } finally {
      await patchPhone(assistant, bobDevice.uuid, { noSignal: false });
    }
    await expect.poll(async () => (await entries(bob, bobDevice.uuid, { text: waiting })).map((e) => !!e.pending)).toEqual([false]);

    const callId = await liveCall(assistant, alice, bob, aliceDevice);
    await hangUpAndCheck(assistant, alice, bob, aliceDevice, bobDevice, callId);
  });
});
