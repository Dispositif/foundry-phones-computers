import { expect, test } from "@playwright/test";
import { createScenes, expectLogEntry, playerCall, ringingAt, setModuleSetting, viewScene } from "./helpers.mjs";
import { NUMBERS, freshSession } from "./world.mjs";

/**
 * More calls: the network failing while it rings, a landline shared by the players in a room,
 * a landline in an empty room, and a satellite call.
 * Not serial: the tests do not depend on each other (a failure restarts the session).
 */
const LANDLINE = "555-0150";
const EMPTY_LANDLINE = "555-0151";
const SATPHONE = "555-0160";

test.describe("More calls", () => {
  let s, scenes;

  test.beforeAll(async ({ browser }) => {
    s = await freshSession(browser);
    // Town (active, both agents there) and an empty Warehouse.
    scenes = await createScenes(s.gm, { Town: false, Warehouse: false });
    for (const page of [s.alice, s.bob]) await viewScene(s.gm, page, scenes.Town);
  });

  test.afterAll(async () => {
    await s?.close();
  });

  const gmRing = () => s.gm.locator(".spt-phone-ring-dialog");
  const createLandline = (number, sceneId, label) =>
    s.gm.evaluate(async ({ number, sceneId, label }) => (await (await window.spt("devices.js")).createPhone(null, { label, number, model: "landline", sceneId })).uuid, { number, sceneId, label });
  const removeItem = (uuid) => s.gm.evaluate(async (uuid) => fromUuidSync(uuid)?.delete(), uuid);

  test("The network fails while Alice's call to Bob rings: Alice gets a network error, Bob a missed call", async () => {
    const { gm, alice, bob, aliceDevice, bobDevice } = s;
    const callId = await playerCall(alice, aliceDevice.uuid, NUMBERS.Bob);
    await expect.poll(() => ringingAt(bob)).toBe(callId);

    // The GM's window for the ringing call: "Network failure".
    const fail = gm.locator('.spt-live-netfail[data-action="netFail"]');
    await expect(fail).toBeVisible();
    await fail.click();

    await expect.poll(() => ringingAt(bob)).toBeNull();
    await expectLogEntry(alice, aliceDevice.uuid, { kind: "call", dir: "out", call: callId, result: "neterror" });
    await expectLogEntry(bob, bobDevice.uuid, { kind: "call", dir: "in", call: callId, result: "missed", read: false });
  });

  test("A landline in Town rings for Alice and Bob, who are both there; Bob declines, it stops for Alice too", async () => {
    const { gm, alice, bob } = s;
    const landline = await createLandline(LANDLINE, scenes.Town, "Town hall");
    try {
      const callId = await gm.evaluate(async (to) => (await window.spt("ring.js")).ring(`phone:${to}`, { caller: "Mr Smith" }), LANDLINE);
      expect(typeof callId).toBe("string");
      await expect.poll(() => ringingAt(alice)).toBe(callId);
      await expect.poll(() => ringingAt(bob)).toBe(callId);

      await bob.evaluate(async () => (await window.spt("player-calls.js")).endCall("decline"));
      await expect.poll(() => ringingAt(alice)).toBeNull();
      await expectLogEntry(gm, landline, { kind: "call", dir: "in", call: callId, result: "decline" });
      expect(await gm.evaluate(async () => (await window.spt("ring.js")).pendingCalls.size)).toBe(0);
    } finally {
      await removeItem(landline);
    }
  });

  test("A landline in an empty room: Alice's call reaches the GM, who answers for whoever is there", async () => {
    const { alice, aliceDevice } = s;
    const landline = await createLandline(EMPTY_LANDLINE, scenes.Warehouse, "Warehouse office");
    try {
      const callId = await playerCall(alice, aliceDevice.uuid, EMPTY_LANDLINE);
      await expect(gmRing()).toBeVisible();
      // The GM sees the place and that nobody is there.
      await expect(gmRing()).toContainText("Warehouse");
      await gmRing().locator('button[data-action="noanswer"]').click();
      await expect(gmRing()).toBeHidden();
      await expectLogEntry(alice, aliceDevice.uuid, { kind: "call", dir: "out", call: callId, result: "noanswer" });
    } finally {
      await removeItem(landline);
    }
  });

  test("Satellite call with the network down: the GM establishes the link, then the call rings at the GM; “not found” ends it", async () => {
    const { gm, alice, bob } = s;
    await setModuleSetting(gm, "feature-satellite", true, [alice, bob]);
    const sat = await gm.evaluate(
      async (number) => (await (await window.spt("devices.js")).createPhone(game.actors.getName("Agent Bob"), { label: "Iridium", number, model: "satphone" })).uuid,
      SATPHONE
    );
    await setModuleSetting(gm, "networkDown", true, [alice, bob]);
    try {
      const link = gm.locator(".spt-sat-dialog");
      // Established: the call goes on and rings at the GM (Mr Smith).
      const callId = await playerCall(bob, sat, NUMBERS["Mr Smith"]);
      expect(callId).not.toBeNull();
      expect(await bob.evaluate(async () => (await window.spt("player-calls.js")).outgoing?.searching)).toBe(true);
      await expect(link).toBeVisible();
      await link.locator('button[data-action="ok"]').click();
      await expect(link).toHaveCount(0);
      await expect(gmRing()).toBeVisible();
      await expect.poll(() => bob.evaluate(async () => (await window.spt("player-calls.js")).outgoing?.searching ?? "none")).toBe(false);
      await gmRing().locator('button[data-action="noanswer"]').click();
      await expectLogEntry(bob, sat, { kind: "call", dir: "out", call: callId, result: "noanswer", sat: true });

      // Not found: the call ends with "no satellite", the GM's phone never rings.
      const lostId = await playerCall(bob, sat, NUMBERS["Mr Smith"]);
      await expect(link).toBeVisible();
      await link.locator('button[data-action="nosat"]').click();
      await expectLogEntry(bob, sat, { kind: "call", dir: "out", call: lostId, result: "nosat" });
      await expect(gmRing()).toBeHidden();
    } finally {
      await setModuleSetting(gm, "networkDown", false, [alice, bob]);
      await removeItem(sat);
      await setModuleSetting(gm, "feature-satellite", false, [alice, bob]);
    }
  });
});
