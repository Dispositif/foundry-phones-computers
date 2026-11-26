import { expect, test } from "@playwright/test";
import { deviceLog, expectLogEntry, moduleText, openDevice, setModuleSetting, unique } from "./helpers.mjs";
import { MODULE_ID } from "./env.mjs";
import { NUMBERS, freshSession } from "./world.mjs";

/**
 * Scene dead zone: "Bayou" is marked "no mobile network". What counts is the scene the player views
 * (tokens are ignored). "Town" is an ordinary scene. Each test sends Bob back to Town at the end.
 * Not serial: the tests do not depend on each other (a failure restarts the session).
 */
const LANDLINE = "555-0150";
const SATPHONE = "555-0160";

test.describe("Dead zone (scene)", () => {
  let s, bayou, town;

  test.beforeAll(async ({ browser }) => {
    s = await freshSession(browser);
    [bayou, town] = await s.gm.evaluate(async (id) => {
      const make = (name, deadZone) => Scene.create({ name, navigation: true, ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }, flags: { [id]: { deadZone } } });
      const bayou = await make("Bayou", true);
      const town = await make("Town", false);
      // Everyone starts in Town (the active scene).
      await town.activate();
      return [bayou.id, town.id];
    }, MODULE_ID);
    for (const page of [s.alice, s.bob]) await goTo(page, town);
  });

  test.afterAll(async () => {
    await s?.close();
  });

  /** The player views this scene (what the module uses to place them). */
  async function goTo(page, sceneId) {
    // Foundry ignores a scene change while the canvas is still loading: wait for it, then ask again until the GM sees it.
    await expect
      .poll(async () => {
        await page.evaluate(async (sceneId) => {
          if (!canvas.loading && canvas.scene?.id !== sceneId) await game.scenes.get(sceneId).view();
        }, sceneId);
        return s.gm.evaluate(({ name, sceneId }) => game.users.getName(name).viewedScene === sceneId, { name: page.userName, sceneId });
      }, { timeout: 20_000, message: `${page.userName} views scene ${sceneId}` })
      .toBe(true);
  }

  const setDeadZone = async (on) => {
    await s.gm.evaluate(({ id, sceneId, on }) => game.scenes.get(sceneId).setFlag(id, "deadZone", on), { id: MODULE_ID, sceneId: bayou, on });
    for (const page of [s.alice, s.bob]) await expect.poll(() => page.evaluate(({ id, sceneId }) => !!game.scenes.get(sceneId).getFlag(id, "deadZone"), { id: MODULE_ID, sceneId: bayou })).toBe(on);
  };

  const playerSms = (page, uuid, to, text) =>
    page.evaluate(async ({ uuid, to, text }) => (await window.spt("player-calls.js")).playerSendSms(fromUuidSync(uuid), to, text), { uuid, to, text });
  const gmSms = (to, text) => s.gm.evaluate(async ({ to, text }) => (await window.spt("messages.js")).sendSms(`phone:${to}`, text, { sender: "Mr Smith" }), { to, text });
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
  const ringingAt = (page) => page.evaluate(async () => (await window.spt("player-calls.js")).activeCall?.callId ?? null);
  const pendingOf = async (page, uuid, match) => {
    const entry = (await deviceLog(page, uuid)).find(match);
    return entry ? !!entry.pending : "missing";
  };
  const signal = (page, uuid) => page.evaluate(async (uuid) => { const d = await window.spt("devices.js"); return d.hasSignal(d.getPhoneData(fromUuidSync(uuid))); }, uuid);

  test("Bob in the dead zone: no signal on his phone, the GM sees the zone; he cannot send or call", async () => {
    const { gm, bob, alice, aliceDevice, bobDevice } = s;
    await goTo(bob, bayou);
    try {
      await expect.poll(() => signal(bob, bobDevice.uuid)).toBe(false);
      expect(await signal(alice, aliceDevice.uuid)).toBe(true);
      // The GM's panel lists the dead zone and who is in it.
      expect(await gm.evaluate(async () => (await window.spt("devices.js")).deadZoneScenes())).toEqual([{ id: bayou, name: "Bayou", who: ["Agent Bob"] }]);

      await openDevice(bob, bobDevice.uuid);
      const notice = await moduleText(bob, "Net.NoSignal");
      const aliceBefore = await deviceLog(alice, aliceDevice.uuid);
      expect(await playerSms(bob, bobDevice.uuid, NUMBERS.Alice, unique("From the bayou"))).toBe(false);
      await expect(bob.locator(".spt-device-notice.warn")).toContainText(notice);
      expect(await playerCall(bob, bobDevice.uuid, NUMBERS.Alice)).toBeNull();
      await expect(bob.locator(".spt-device-notice.warn")).toContainText(notice);
      await alice.waitForTimeout(1500);
      expect(await deviceLog(alice, aliceDevice.uuid)).toEqual(aliceBefore);
      expect(await ringingAt(alice)).toBeNull();
    } finally {
      await goTo(bob, town);
    }
    expect(await gm.evaluate(async () => (await window.spt("devices.js")).deadZoneScenes())).toEqual([]);
  });

  test("Bob in the dead zone: SMS from the GM and from Alice wait, Alice's call is unreachable; all arrives when he leaves the zone", async () => {
    const { alice, bob, aliceDevice, bobDevice } = s;
    await goTo(bob, bayou);
    const fromGm = unique("GM to the bayou");
    const fromAlice = unique("Alice to the bayou");
    let callId;
    try {
      await gmSms(NUMBERS.Bob, fromGm);
      expect(await playerSms(alice, aliceDevice.uuid, NUMBERS.Bob, fromAlice)).toBe(true);
      await expectLogEntry(bob, bobDevice.uuid, { text: fromGm, pending: true });
      await expectLogEntry(bob, bobDevice.uuid, { text: fromAlice, pending: true });
      callId = await playerCall(alice, aliceDevice.uuid, NUMBERS.Bob);
      await expectLogEntry(alice, aliceDevice.uuid, { kind: "call", dir: "out", call: callId, result: "unreachable" });
      expect(await ringingAt(bob)).toBeNull();
    } finally {
      await goTo(bob, town);
    }
    // Back in Town: the GM's client delivers what was waiting.
    for (const text of [fromGm, fromAlice]) await expect.poll(() => pendingOf(bob, bobDevice.uuid, (e) => e.text === text)).toBe(false);
    await expect.poll(() => pendingOf(bob, bobDevice.uuid, (e) => e.call === callId)).toBe(false);
  });

  test("Dead zone switched off by the GM while Bob is there: what waited is delivered", async () => {
    const { bob, bobDevice } = s;
    await goTo(bob, bayou);
    const text = unique("Signal comes back");
    try {
      await gmSms(NUMBERS.Bob, text);
      await expectLogEntry(bob, bobDevice.uuid, { text, pending: true });
      await setDeadZone(false);
      await expect.poll(() => pendingOf(bob, bobDevice.uuid, (e) => e.text === text)).toBe(false);
      expect(await signal(bob, bobDevice.uuid)).toBe(true);
    } finally {
      await setDeadZone(true);
      await goTo(bob, town);
    }
  });

  test("A landline installed in the dead zone keeps working: it rings for Bob there, and he can call out from it", async () => {
    const { gm, alice, bob, aliceDevice } = s;
    const landline = await gm.evaluate(
      async ({ sceneId, number }) => (await (await window.spt("devices.js")).createPhone(null, { label: "Bayou shack", number, model: "landline", sceneId })).uuid,
      { sceneId: bayou, number: LANDLINE }
    );
    await goTo(bob, bayou);
    try {
      expect(await signal(bob, landline)).toBe(true);
      // Alice calls the shack: it rings for Bob (he is in the room), he declines.
      const callId = await playerCall(alice, aliceDevice.uuid, LANDLINE);
      expect(callId).not.toBeNull();
      await expect.poll(() => ringingAt(bob)).toBe(callId);
      await bob.evaluate(async () => (await window.spt("player-calls.js")).endCall("decline"));
      await expectLogEntry(alice, aliceDevice.uuid, { kind: "call", dir: "out", call: callId, result: "noanswer" });
      await expectLogEntry(bob, landline, { kind: "call", dir: "in", call: callId, result: "decline" });

      // Bob calls Alice from the shack: her phone rings, she declines.
      const outId = await playerCall(bob, landline, NUMBERS.Alice);
      expect(outId).not.toBeNull();
      await expect.poll(() => ringingAt(alice)).toBe(outId);
      await alice.evaluate(async () => (await window.spt("player-calls.js")).endCall("decline"));
      await expectLogEntry(bob, landline, { kind: "call", dir: "out", call: outId, result: "noanswer" });
    } finally {
      await goTo(bob, town);
      await gm.evaluate(async (uuid) => fromUuidSync(uuid)?.delete(), landline);
    }
  });

  test("A satellite phone in the dead zone: the GM decides the link; established, the SMS goes out; not found, it does not", async () => {
    const { gm, alice, bob, aliceDevice } = s;
    await setModuleSetting(gm, "feature-satellite", true, [alice, bob]);
    const sat = await gm.evaluate(
      async ({ number }) => (await (await window.spt("devices.js")).createPhone(game.actors.getName("Agent Bob"), { label: "Iridium", number, model: "satphone" })).uuid,
      { number: SATPHONE }
    );
    await goTo(bob, bayou);
    try {
      await expect.poll(() => signal(bob, sat)).toBe(true);
      const dialog = gm.locator(".spt-sat-dialog");

      // Established: the message reaches Alice.
      const ok = unique("Via satellite");
      expect(await playerSms(bob, sat, NUMBERS.Alice, ok)).toBe(true);
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(ok);
      await dialog.locator('button[data-action="ok"]').click();
      await expect(dialog).toBeHidden();
      await expectLogEntry(alice, aliceDevice.uuid, { kind: "sms", dir: "in", text: ok, with: SATPHONE });

      // Not found: kept on Bob's device as not sent, nothing for Alice.
      const lost = unique("Lost in the sky");
      expect(await playerSms(bob, sat, NUMBERS.Alice, lost)).toBe(true);
      await expect(dialog).toBeVisible();
      await dialog.locator('button[data-action="nosat"]').click();
      await expectLogEntry(bob, sat, { kind: "sms", dir: "out", text: lost, nosat: true });
      await alice.waitForTimeout(1000);
      expect((await deviceLog(alice, aliceDevice.uuid)).some((e) => e.text === lost)).toBe(false);
    } finally {
      await goTo(bob, town);
      await gm.evaluate(async (uuid) => fromUuidSync(uuid)?.delete(), sat);
      await setModuleSetting(gm, "feature-satellite", false, [alice, bob]);
    }
  });
});
