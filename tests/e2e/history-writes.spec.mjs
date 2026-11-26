import { expect, test } from "@playwright/test";
import { deviceLog, join, openDevice } from "./helpers.mjs";
import { NUMBERS, freshSession } from "./world.mjs";

/**
 * Device histories are written by the GM's client, one write after the other (no lost update).
 * A write made from a player's client at the same moment must not erase the GM's, nor the reverse.
 */
const NEW_NUMBER = "555-0170";

test.describe("History writes", () => {
  let s;

  test.beforeAll(async ({ browser }) => {
    s = await freshSession(browser);
  });

  test.afterAll(async () => {
    await s?.close();
  });

  test("A new device: the operator's welcome message and a message from the GM arriving at the same moment are both kept", async () => {
    const { gm, bob } = s;
    const uuid = await gm.evaluate(
      async (number) => (await (await window.spt("devices.js")).createPhone(game.actors.getName("Agent Bob"), { label: "New phone", number })).uuid,
      NEW_NUMBER
    );
    try {
      await expect.poll(() => bob.evaluate((uuid) => !!fromUuidSync(uuid), uuid)).toBe(true);
      // Bob's client welcomes the device while the GM's message to it is on its way.
      await Promise.all([
        bob.evaluate(async (uuid) => {
          const { allPhones } = await window.spt("devices.js");
          const p = allPhones().find((d) => d.item.uuid === uuid);
          await (await window.spt("welcome.js")).welcomeDevice(p);
        }, uuid),
        gm.evaluate(async (to) => (await window.spt("messages.js")).sendSms(`phone:${to}`, "Welcome aboard, from Mr Smith", { sender: "Mr Smith" }), NEW_NUMBER)
      ]);
      await expect
        .poll(async () => {
          const log = await deviceLog(gm, uuid);
          return { welcome: log.some((e) => e.net && e.help), gm: log.some((e) => e.text === "Welcome aboard, from Mr Smith") };
        })
        .toEqual({ welcome: true, gm: true });
    } finally {
      await gm.evaluate(async (uuid) => fromUuidSync(uuid)?.delete(), uuid);
    }
  });

  test("Bob deletes a message on his phone while the GM's next message arrives: the one is gone, the other kept", async () => {
    const { gm, bob, bobDevice } = s;
    const send = (text) => gm.evaluate(async ({ to, text }) => (await window.spt("messages.js")).sendSms(`phone:${to}`, text, { sender: "Mr Smith" }), { to: NUMBERS.Bob, text });
    await send("Delete me");
    await expect.poll(async () => (await deviceLog(bob, bobDevice.uuid)).some((e) => e.text === "Delete me")).toBe(true);
    const id = (await deviceLog(bob, bobDevice.uuid)).find((e) => e.text === "Delete me").id;

    // Bob opens the conversation and deletes the message (confirming), while the GM writes again.
    await openDevice(bob, bobDevice.uuid);
    await bob.locator(`.spt-conv[data-key="${NUMBERS["Mr Smith"]}"]`).click();
    await bob.locator(`.spt-del[data-id="${id}"]`).click();
    const confirm = bob.locator(".spt-dialog").filter({ hasText: await bob.evaluate(async () => (await window.spt("i18n.js")).t("DeleteEntryConfirm")) });
    await expect(confirm).toBeVisible();
    await Promise.all([confirm.locator('button[data-action="yes"]').click(), send("Keep me")]);

    await expect
      .poll(async () => {
        const log = await deviceLog(gm, bobDevice.uuid);
        return { deleted: !log.some((e) => e.text === "Delete me"), kept: log.some((e) => e.text === "Keep me") };
      })
      .toEqual({ deleted: true, kept: true });
  });

  test("The GM saves Bob's device (edit window) while a message to it is being written: the message is kept", async () => {
    const { gm, bobDevice } = s;
    const result = await gm.evaluate(async (uuid) => {
      const { addLog, getPhoneData, markPhone } = await window.spt("devices.js");
      const item = fromUuidSync(uuid);
      const phone = getPhoneData(item);
      const form = { label: phone.label, number: phone.number, model: phone.model, sceneId: phone.sceneId ?? null, theme: phone.theme, inbox: phone.inbox ?? "on", pub: !!phone.pub, secure: !!phone.secure, satellite: !!phone.satellite };
      // The GM saves the edit window at the very moment the message's write leaves for the server.
      let saved = null;
      const hook = Hooks.on("preUpdateItem", (doc, changes) => {
        if (doc !== item || saved || changes?.flags?.["soren-phones-computers"]?.phone?.log === undefined) return;
        saved = markPhone(item, { ...form, label: "Bob's edited phone" });
      });
      try {
        await addLog(item, { kind: "sms", dir: "in", with: "555-0199", text: "Written while edited", read: false });
        await saved;
      } finally {
        Hooks.off("preUpdateItem", hook);
      }
      const after = getPhoneData(item);
      const out = { label: after.label, kept: after.log.some((e) => e.text === "Written while edited"), raced: !!saved };
      // Back as it was for the next tests.
      await markPhone(item, form);
      return out;
    }, bobDevice.uuid);
    expect(result).toEqual({ label: "Bob's edited phone", kept: true, raced: true });
    // The server kept it too (what every other client sees).
    await expect.poll(async () => (await deviceLog(s.bob, bobDevice.uuid)).some((e) => e.text === "Written while edited")).toBe(true);
  });

  test("No GM connected: Bob still marks a message read and deletes one on his phone (written by his own browser)", async ({ browser }) => {
    const { bob, bobDevice } = s;
    const send = (text) => s.gm.evaluate(async ({ to, text }) => (await window.spt("messages.js")).sendSms(`phone:${to}`, text, { sender: "Mr Smith" }), { to: NUMBERS.Bob, text });
    await send("Read me offline");
    await send("Delete me offline");
    await expect.poll(async () => (await deviceLog(bob, bobDevice.uuid)).filter((e) => e.text?.endsWith("offline")).length).toBe(2);
    const id = (await deviceLog(bob, bobDevice.uuid)).find((e) => e.text === "Delete me offline").id;

    await s.gm.context().close();
    await expect.poll(() => bob.evaluate(() => !!game.users.activeGM)).toBe(false);
    try {
      await openDevice(bob, bobDevice.uuid);
      await bob.locator(`.spt-conv[data-key="${NUMBERS["Mr Smith"]}"]`).click();
      await expect.poll(async () => (await deviceLog(bob, bobDevice.uuid)).find((e) => e.text === "Read me offline")?.read).toBe(true);

      await bob.locator(`.spt-del[data-id="${id}"]`).click();
      const confirm = bob.locator(".spt-dialog").filter({ hasText: await bob.evaluate(async () => (await window.spt("i18n.js")).t("DeleteEntryConfirm")) });
      await confirm.locator('button[data-action="yes"]').click();
      await expect.poll(async () => (await deviceLog(bob, bobDevice.uuid)).some((e) => e.text === "Delete me offline")).toBe(false);
    } finally {
      s.gm = await join(browser, "Gamemaster");
    }
    // What Bob wrote alone is what the GM finds when back.
    const log = await deviceLog(s.gm, bobDevice.uuid);
    expect(log.find((e) => e.text === "Read me offline")?.read).toBe(true);
    expect(log.some((e) => e.text === "Delete me offline")).toBe(false);
  });
});
