import { expect, test } from "@playwright/test";
import { createScenes, deviceLog, expectGmWarning, expectLogEntry, expectPhone, patchPhone, playerCall, playerSms, ringingAt, setModuleSetting, unique, viewScene } from "./helpers.mjs";
import { NUMBERS, freshSession } from "./world.mjs";

/**
 * Advanced features (off by default, switched on here): secure devices, compromised devices,
 * the jammer and wiretaps. Each test puts back what it changes.
 * Not serial: the tests do not depend on each other (a failure restarts the session).
 */
test.describe("Advanced features", () => {
  let s, scenes;

  test.beforeAll(async ({ browser }) => {
    s = await freshSession(browser);
    for (const feature of ["secure", "jammer", "intel"]) await setModuleSetting(s.gm, `feature-${feature}`, true, [s.alice, s.bob]);
    scenes = await createScenes(s.gm, { Town: false, Warehouse: false });
    for (const page of [s.alice, s.bob]) await viewScene(s.gm, page, scenes.Town);
  });

  test.afterAll(async () => {
    await s?.close();
  });

  const gmSms = (to, text) => s.gm.evaluate(async ({ to, text }) => (await window.spt("messages.js")).sendSms(`phone:${to}`, text, { sender: "Mr Smith" }), { to, text });
  const pendingOf = async (page, uuid, text) => {
    const entry = (await deviceLog(page, uuid)).find((e) => e.text === text);
    return entry ? !!entry.pending : "missing";
  };
  const signal = (page, uuid) => page.evaluate(async (uuid) => { const d = await window.spt("devices.js"); return d.hasSignal(d.getPhoneData(fromUuidSync(uuid))); }, uuid);

  test("Secure devices: messages between two secure phones are encrypted, not when only one is; a secure call too", async () => {
    const { gm, alice, bob, aliceDevice, bobDevice } = s;
    await patchPhone(gm, aliceDevice.uuid, { secure: true });
    await patchPhone(gm, bobDevice.uuid, { secure: true });
    await expectPhone(alice, bobDevice.uuid, { secure: true });
    try {
      const secret = unique("Encrypted");
      expect(await playerSms(alice, aliceDevice.uuid, NUMBERS.Bob, secret)).toBe(true);
      await expectLogEntry(alice, aliceDevice.uuid, { dir: "out", text: secret, secure: true });
      await expectLogEntry(bob, bobDevice.uuid, { dir: "in", text: secret, secure: true });

      // A secure call: the line is encrypted for everyone who sees it.
      const callId = await playerCall(alice, aliceDevice.uuid, NUMBERS.Bob);
      await expect.poll(() => ringingAt(bob)).toBe(callId);
      await bob.evaluate(async () => (await window.spt("player-calls.js")).endCall("answer"));
      await expect.poll(() => gm.evaluate(async (id) => (await window.spt("live-call.js")).liveCalls.get(id)?.secure ?? null, callId)).toBe(true);
      await alice.evaluate(async (id) => (await window.spt("live-call.js")).hangUpLive(id), callId);

      // Bob's phone no longer secure: in clear.
      await patchPhone(gm, bobDevice.uuid, { secure: false });
      await expectPhone(alice, bobDevice.uuid, { secure: false });
      const clear = unique("In clear");
      expect(await playerSms(alice, aliceDevice.uuid, NUMBERS.Bob, clear)).toBe(true);
      await expectLogEntry(bob, bobDevice.uuid, { dir: "in", text: clear });
      expect((await deviceLog(bob, bobDevice.uuid)).find((e) => e.text === clear).secure).toBeFalsy();
      expect((await deviceLog(alice, aliceDevice.uuid)).find((e) => e.text === clear).secure).toBeFalsy();
    } finally {
      await patchPhone(gm, aliceDevice.uuid, { secure: false });
      await patchPhone(gm, bobDevice.uuid, { secure: false });
    }
  });

  test("Secure devices: the GM is warned when Alice forwards an encrypted message in clear", async () => {
    const { gm, alice, aliceDevice } = s;
    await patchPhone(gm, aliceDevice.uuid, { secure: true });
    await expectPhone(alice, aliceDevice.uuid, { secure: true });
    try {
      // Mr Smith is no secure line for Alice: the forward leaves in clear.
      expect(await playerSms(alice, aliceDevice.uuid, NUMBERS["Mr Smith"], unique("Top secret"), { fwd: true, fwdSecure: true })).toBe(true);
      await expectGmWarning(gm, "Gm.LeakedForward", { who: "Agent Alice (Alice's phone)", to: "Mr Smith" });
    } finally {
      await patchPhone(gm, aliceDevice.uuid, { secure: false });
    }
  });

  test("A compromised device: the GM is warned when it sends, and the call window says it", async () => {
    const { gm, alice, aliceDevice } = s;
    await patchPhone(gm, aliceDevice.uuid, { compromised: true });
    await expectPhone(alice, aliceDevice.uuid, { compromised: true });
    try {
      expect(await playerSms(alice, aliceDevice.uuid, NUMBERS.Bob, unique("Tapped"))).toBe(true);
      await expectGmWarning(gm, "Gm.CompromisedDevice", { label: "Alice's phone" });

      const callId = await playerCall(alice, aliceDevice.uuid, NUMBERS["Mr Smith"]);
      const ring = gm.locator(".spt-phone-ring-dialog");
      await expect(ring.locator(".spt-compromised")).toBeVisible();
      await ring.locator('button[data-action="noanswer"]').click();
      await expectLogEntry(alice, aliceDevice.uuid, { kind: "call", call: callId, result: "noanswer" });
    } finally {
      await patchPhone(gm, aliceDevice.uuid, { compromised: false });
    }
  });

  test("Jammer: switched on by Bob, it cuts Town like a dead zone; switched off, what waited arrives", async () => {
    const { gm, alice, bob, aliceDevice } = s;
    const jammer = await gm.evaluate(async () => (await (await window.spt("devices.js")).createPhone(game.actors.getName("Agent Bob"), { label: "Jammer", model: "jammer" })).uuid);
    try {
      await bob.evaluate(async (uuid) => (await window.spt("jammer.js")).setJamming(fromUuidSync(uuid), true), jammer);
      await expect.poll(() => gm.evaluate(({ id }) => !!game.scenes.get(id).getFlag("soren-phones-computers", "jammed"), { id: scenes.Town })).toBe(true);
      await expect.poll(() => signal(alice, aliceDevice.uuid)).toBe(false);

      expect(await playerSms(alice, aliceDevice.uuid, NUMBERS.Bob, unique("Jammed"))).toBe(false);
      const text = unique("Through the jam");
      await gmSms(NUMBERS.Alice, text);
      await expectLogEntry(alice, aliceDevice.uuid, { text, pending: true });

      await bob.evaluate(async (uuid) => (await window.spt("jammer.js")).setJamming(fromUuidSync(uuid), false), jammer);
      await expect.poll(() => signal(alice, aliceDevice.uuid)).toBe(true);
      await expect.poll(() => pendingOf(alice, aliceDevice.uuid, text)).toBe(false);
    } finally {
      await gm.evaluate(async (uuid) => fromUuidSync(uuid)?.delete(), jammer);
    }
  });

  test("Jammer: it switches off when it changes hands, and when its carrier goes to another scene", async () => {
    const { gm, bob } = s;
    const jammed = () => gm.evaluate(({ id }) => !!game.scenes.get(id).getFlag("soren-phones-computers", "jammed"), { id: scenes.Town });
    let jammer = await gm.evaluate(async () => (await (await window.spt("devices.js")).createPhone(game.actors.getName("Agent Bob"), { label: "Jammer", model: "jammer" })).uuid);
    try {
      // Given to Alice while on: it arrives switched off.
      await bob.evaluate(async (uuid) => (await window.spt("jammer.js")).setJamming(fromUuidSync(uuid), true), jammer);
      await expect.poll(jammed).toBe(true);
      jammer = await gm.evaluate(async (uuid) => (await (await window.spt("dialogs.js")).transferPhone(fromUuidSync(uuid), game.actors.getName("Agent Alice"))).uuid, jammer);
      await expect.poll(() => gm.evaluate(async (uuid) => (await window.spt("devices.js")).getPhoneData(fromUuidSync(uuid)).jamming, jammer)).toBe(false);
      await expect.poll(jammed).toBe(false);

      // Back to Bob, on again; Bob goes to the Warehouse: it switches off.
      jammer = await gm.evaluate(async (uuid) => (await (await window.spt("dialogs.js")).transferPhone(fromUuidSync(uuid), game.actors.getName("Agent Bob"))).uuid, jammer);
      await expect.poll(() => bob.evaluate((uuid) => !!fromUuidSync(uuid), jammer)).toBe(true);
      await bob.evaluate(async (uuid) => (await window.spt("jammer.js")).setJamming(fromUuidSync(uuid), true), jammer);
      await expect.poll(jammed).toBe(true);
      await viewScene(gm, bob, scenes.Warehouse);
      await expect.poll(jammed).toBe(false);
      expect(await gm.evaluate(async (uuid) => (await window.spt("devices.js")).getPhoneData(fromUuidSync(uuid)).jamming, jammer)).toBe(false);
    } finally {
      await viewScene(gm, bob, scenes.Town);
      await gm.evaluate(async (uuid) => fromUuidSync(uuid)?.delete(), jammer);
    }
  });

  test("Wiretaps: the GM's Intel tab shows the messages between PCs", async () => {
    const { gm, alice, aliceDevice } = s;
    const text = unique("Between us");
    expect(await playerSms(alice, aliceDevice.uuid, NUMBERS.Bob, text)).toBe(true);
    await expectLogEntry(alice, aliceDevice.uuid, { text, dir: "out", pj: true });
    await gm.evaluate(async () => (await window.spt("main.js")).openPanel({ tab: "watch" }));
    await expect(gm.locator("#spt-phone-panel")).toContainText(text);
    await gm.evaluate(async () => (await window.spt("gm-panel.js")).PhonePanel.instance?.close());
  });
});
