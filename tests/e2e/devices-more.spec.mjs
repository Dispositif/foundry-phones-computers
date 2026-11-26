import { expect, test } from "@playwright/test";
import { deviceLog, expectGmWarning, expectLogEntry, expectPhone, patchPhone, playerCall, ringingAt, unique } from "./helpers.mjs";
import { NUMBERS, freshSession } from "./world.mjs";

/**
 * Other devices and content: pager, computer (mail, files, journal documents), image attachments,
 * and the GM's journal links. Each test removes what it creates.
 * Not serial: the tests do not depend on each other (a failure restarts the session).
 */
const PAGER = "555-0180";
const IMAGE = "icons/svg/mystery-man.svg";

test.describe("Pager, computer, attachments, journal links", () => {
  let s;

  test.beforeAll(async ({ browser }) => {
    s = await freshSession(browser);
  });

  test.afterAll(async () => {
    await s?.close();
  });

  const create = (actorName, data) =>
    s.gm.evaluate(async ({ actorName, data }) => (await (await window.spt("devices.js")).createPhone(actorName ? game.actors.getName(actorName) : null, data)).uuid, { actorName, data });
  const remove = (uuid) => s.gm.evaluate(async (uuid) => fromUuidSync(uuid)?.delete(), uuid);
  const gmSms = (to, text, att = null) => s.gm.evaluate(async ({ to, text, att }) => (await window.spt("messages.js")).sendSms(`phone:${to}`, text, { sender: "Mr Smith", att }), { to, text, att });
  const createJournal = (name, content) =>
    s.gm.evaluate(async ({ name, content }) => (await JournalEntry.create({ name, pages: [{ name, type: "text", text: { content } }] })).uuid, { name, content });

  test("Pager: a message is cut to its one-line screen and opens it by itself; a pager takes no calls", async () => {
    const { gm, alice, bob, bobDevice } = s;
    const pager = await create("Agent Alice", { label: "Beeper", number: PAGER, model: "pager" });
    try {
      await gmSms(PAGER, "CALL 555-0199 NOW PLEASE");
      // 12 characters on its screen; the GM is told the message was cut.
      await expectLogEntry(alice, pager, { kind: "sms", dir: "in", text: "CALL 555-019" });
      await expectGmWarning(gm, "Warn.PagerCut", { n: 12 });
      await expect(alice.locator(".spt-pager-window")).toBeVisible();

      // Calling a pager: the network says the number takes no calls.
      const callId = await playerCall(bob, bobDevice.uuid, PAGER);
      await expectLogEntry(bob, bobDevice.uuid, { kind: "call", dir: "out", call: callId, result: "unassigned" });
      expect(await ringingAt(alice)).toBeNull();
    } finally {
      await alice.evaluate(async () => { for (const app of foundry.applications.instances.values()) if (app.element?.classList.contains("spt-pager-window")) await app.close(); });
      await remove(pager);
    }
  });

  test("Computer: mail arrives; Alice opens visible files, not locked or hidden ones; a journal sent by mail opens", async () => {
    const { gm, alice } = s;
    const laptop = await create("Agent Alice", { label: "Laptop", model: "computer" });
    const report = await createJournal("Autopsy report", "<p>Cause of death: unknown toxin.</p>");
    try {
      const address = await gm.evaluate(async (uuid) => (await window.spt("devices.js")).getPhoneData(fromUuidSync(uuid)).number, laptop);
      const mail = unique("Your file is attached");
      await gmSms(address, mail, { type: "doc", uuid: report, name: "Autopsy report" });
      await expectLogEntry(alice, laptop, { kind: "sms", dir: "in", text: mail });

      // The GM puts three copies of the report on the laptop: visible, locked, hidden.
      await gm.evaluate(async ({ laptop, report }) => {
        const files = await window.spt("files.js");
        const item = fromUuidSync(laptop);
        for (const name of ["Visible", "Locked", "Hidden"]) await files.addFile(item, { type: "doc", uuid: report, name });
        const { getPhoneData } = await window.spt("devices.js");
        const ids = Object.fromEntries(getPhoneData(item).files.map((f) => [f.name, f.id]));
        await files.patchFile(item, ids.Locked, { locked: true });
        await files.patchFile(item, ids.Hidden, { hidden: true });
      }, { laptop, report });

      const seen = await alice.evaluate(async (uuid) => {
        const { filesOf, getPhoneData } = await window.spt("devices.js");
        const { loadFile, findFile } = await window.spt("files.js");
        const item = fromUuidSync(uuid);
        const phone = getPhoneData(item);
        const all = Object.fromEntries(phone.files.map((f) => [f.name, f]));
        const open = async (f) => ((await loadFile(item, f)) ?? "").includes("unknown toxin");
        const entry = phone.log.find((e) => e.att?.type === "doc");
        return {
          listed: filesOf(phone).map((f) => f.name),
          visible: await open(all.Visible),
          locked: await open(all.Locked),
          hidden: await open(all.Hidden),
          mailDoc: ((await (await window.spt("files.js")).loadEntryDoc(item, entry)) ?? "").includes("unknown toxin")
        };
      }, laptop);
      expect(seen).toEqual({ listed: ["Visible", "Locked"], visible: true, locked: false, hidden: false, mailDoc: true });
    } finally {
      await remove(laptop);
      await gm.evaluate(async (uuid) => fromUuidSync(uuid)?.delete(), report);
    }
  });

  test("Attachments: an image reaches a smartphone; a mobile without attachments gets the text only, and the GM is told", async () => {
    const { gm, alice, bob, aliceDevice, bobDevice } = s;
    const photo = unique("Look at this");
    await gmSms(NUMBERS.Alice, photo, { type: "image", src: IMAGE });
    await expectLogEntry(alice, aliceDevice.uuid, { text: photo });
    expect((await deviceLog(alice, aliceDevice.uuid)).find((e) => e.text === photo).att).toMatchObject({ type: "image", src: IMAGE });

    await patchPhone(gm, bobDevice.uuid, { model: "mobile" });
    await expectPhone(bob, bobDevice.uuid, { model: "mobile" });
    try {
      const text = unique("Photo for an old phone");
      await gmSms(NUMBERS.Bob, text, { type: "image", src: IMAGE });
      await expectLogEntry(bob, bobDevice.uuid, { text });
      expect((await deviceLog(bob, bobDevice.uuid)).find((e) => e.text === text).att).toBeUndefined();
      await expectGmWarning(gm, "Warn.NoAttachments");
    } finally {
      await patchPhone(gm, bobDevice.uuid, { model: "smartphone" });
    }
  });

  test("Journal links: the GM clicks @SMS in a journal, the message is sent; @Call rings Alice", async () => {
    const { gm, alice, aliceDevice } = s;
    const text = unique("Meet me at midnight");
    // The links as the GM sees them in a journal page.
    await gm.evaluate(async ({ to, text }) => {
      const html = await foundry.applications.ux.TextEditor.implementation.enrichHTML(`<p>@SMS[${to}|Mr Smith]{${text}}</p><p>@Call[${to}|Mr Smith]</p>`);
      const div = document.createElement("div");
      div.id = "spt-test-links";
      div.innerHTML = html;
      document.body.append(div);
    }, { to: NUMBERS.Alice, text });
    try {
      await gm.locator("#spt-test-links a.spt-link.sms").click();
      await expectLogEntry(alice, aliceDevice.uuid, { kind: "sms", dir: "in", text, with: NUMBERS["Mr Smith"] });

      await gm.locator("#spt-test-links a.spt-link.call").click();
      await expect.poll(() => ringingAt(alice)).not.toBeNull();
      await alice.evaluate(async () => (await window.spt("player-calls.js")).endCall("decline"));
      await expect.poll(() => ringingAt(alice)).toBeNull();
    } finally {
      await gm.evaluate(() => document.getElementById("spt-test-links")?.remove());
    }
  });
});
