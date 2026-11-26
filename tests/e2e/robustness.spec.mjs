import { expect, test } from "@playwright/test";
import { deviceLog, expectLogEntry, join, playerCall, playerSms, reload, ringingAt, unique } from "./helpers.mjs";
import { NUMBERS, freshSession } from "./world.mjs";

/**
 * The table is not always stable: a player reloads during a call, the GM leaves and comes back,
 * two GMs are connected. Not serial: a failure restarts the session.
 */
test.describe("Robustness", () => {
  let s;

  test.beforeAll(async ({ browser }) => {
    s = await freshSession(browser);
  });

  test.afterAll(async () => {
    await s?.close();
  });

  const lineState = (page, callId) =>
    page.evaluate(async (callId) => {
      const live = (await window.spt("live-call.js")).liveCalls.get(callId);
      return !live ? null : live.ended ? live.ended.reason : live.dialing ? "dialing" : "live";
    }, callId);

  test("Bob reloads his page during a call: the call is still there, and ends for him when Alice hangs up", async () => {
    const { gm, alice, bob, aliceDevice } = s;
    const callId = await playerCall(alice, aliceDevice.uuid, NUMBERS.Bob);
    await expect.poll(() => ringingAt(bob)).toBe(callId);
    await bob.evaluate(async () => (await window.spt("player-calls.js")).endCall("answer"));
    await expect.poll(() => lineState(gm, callId)).toBe("live");

    await reload(bob);
    await expect.poll(() => lineState(bob, callId)).toBe("live");

    await alice.evaluate(async (id) => (await window.spt("live-call.js")).hangUpLive(id), callId);
    await expect.poll(() => lineState(bob, callId)).toBe("hangup");
  });

  test("Two GMs connected: a player's message is handled once", async ({ browser }) => {
    const { gm, alice, bob, aliceDevice, bobDevice } = s;
    const second = await gm.evaluate(async () => (await User.create({ name: "Assistant GM", role: CONST.USER_ROLES.GAMEMASTER, password: "" })).id);
    let gm2;
    try {
      gm2 = await join(browser, "Assistant GM");
      const text = unique("Once only");
      expect(await playerSms(alice, aliceDevice.uuid, NUMBERS.Bob, text)).toBe(true);
      await expectLogEntry(bob, bobDevice.uuid, { text });
      await bob.waitForTimeout(1500);
      expect((await deviceLog(bob, bobDevice.uuid)).filter((e) => e.text === text)).toHaveLength(1);
      expect((await deviceLog(alice, aliceDevice.uuid)).filter((e) => e.text === text)).toHaveLength(1);
    } finally {
      await gm2?.context().close();
      await gm.evaluate(async (id) => game.users.get(id)?.delete(), second);
    }
  });
});
