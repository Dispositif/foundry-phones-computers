import { expect, test } from "@playwright/test";
import { expectLogEntry, playerSms, setModuleSetting, unique } from "./helpers.mjs";
import { NUMBERS, freshSession } from "./world.mjs";

/**
 * The GM panel, tab by tab, on a world with a bit of everything: an agent writing to an NPC and to
 * an unknown number, two agents writing to each other, a missed call, a laptop with a file, a landline
 * installed in a place, and directory lines (public, pinned).
 */
const MODULE_ID = "soren-phones-computers";
const FIXER = "555-0222";
const UNKNOWN = "555-0777";

test.describe.serial("GM panel", () => {
  let s;
  let ids;
  const text = { npc: unique("Meet me at the docks"), unknown: unique("Who is this"), pcs: unique("Between agents") };

  test.beforeAll(async ({ browser }) => {
    s = await freshSession(browser);
    const { gm, alice, aliceDevice } = s;
    await setModuleSetting(gm, "feature-intel", true, [alice, s.bob]);
    ids = await gm.evaluate(
      async ({ id, fixer, smith }) => {
        await game.settings.set(id, "directory", `# Contacts\nMr Smith | ${smith} | public\nThe Fixer | ${fixer} | pin`);
        const devices = await window.spt("devices.js");
        const scene = await Scene.create({ name: "Motel Starlite" });
        const landline = await devices.createPhone(null, { label: "Motel desk", number: "555-0150", model: "landline", sceneId: scene.id });
        const laptop = await devices.createPhone(game.actors.getName("Agent Alice"), { label: "Field laptop", model: "computer" });
        await (await window.spt("files.js")).addFile(laptop, { type: "image", src: "icons/svg/mystery-man.svg" });
        return { scene: scene.id, landline: landline.uuid, laptop: laptop.uuid };
      },
      { id: MODULE_ID, fixer: FIXER, smith: NUMBERS["Mr Smith"] }
    );
    expect(await playerSms(alice, aliceDevice.uuid, NUMBERS["Mr Smith"], text.npc)).toBe(true);
    expect(await playerSms(alice, aliceDevice.uuid, UNKNOWN, text.unknown)).toBe(true);
    expect(await playerSms(alice, aliceDevice.uuid, NUMBERS.Bob, text.pcs)).toBe(true);
    await expectLogEntry(gm, aliceDevice.uuid, { text: text.pcs, dir: "out" });
    // A missed call on Bob's phone: Mr Smith rings, then hangs up.
    await gm.evaluate(async (to) => {
      const ring = await window.spt("ring.js");
      const callId = await ring.ring(`phone:${to}`, { caller: "Mr Smith" });
      ring.hangUp(callId);
    }, NUMBERS.Bob);
    await expectLogEntry(gm, s.bobDevice.uuid, { kind: "call", result: "missed" });
  });

  test.afterAll(async () => {
    await s?.gm.evaluate(async ({ scene, landline }) => {
      await (await window.spt("gm-panel.js")).PhonePanel.instance?.close();
      await fromUuidSync(landline)?.delete();
      await game.scenes.get(scene)?.delete();
    }, ids);
    await s?.close();
  });

  const panel = () => s.gm.locator("#spt-phone-panel");
  const body = () => panel().locator(".spt-tab-body");
  const openTab = (tab) => s.gm.evaluate(async (tab) => (await window.spt("main.js")).openPanel({ tab }), tab);
  const click = (selector) => panel().locator(selector).first().click();

  test("Send: the agents, and the devices of the one picked", async () => {
    await openTab("send");
    await expect(body()).toContainText("Agent Alice");
    await expect(body()).toContainText("Agent Bob");
    await click('[data-action="sendTo"][data-kind="agent"]:has-text("Agent Alice")');
    await expect(body()).toContainText("Alice's phone");
    await expect(body()).toContainText("Field laptop");
  });

  test("Messages: the agent's thread with the NPC, unread, and the GM's reply reaches her", async () => {
    const { alice, aliceDevice } = s;
    await openTab("inbox");
    await expect(body()).toContainText(text.npc);
    await expect(body()).toContainText(text.unknown);
    await expect(body()).not.toContainText(text.pcs);
    await expect(panel().locator('.spt-tab[data-tab="inbox"] .spt-badge')).toBeVisible();
    // The pinned NPC's chip.
    await expect(body()).toContainText("The Fixer");
    const reply = unique("Midnight, pier 9");
    const thread = panel().locator(".spt-gthread").filter({ hasText: text.npc });
    await thread.locator("[data-draft]").fill(reply);
    await thread.locator("[data-draft]").press("Enter");
    await expectLogEntry(alice, aliceDevice.uuid, { dir: "in", text: reply, with: NUMBERS["Mr Smith"] });
  });

  test("Directory: section title, public and pinned lines, and the unknown number to name", async () => {
    await openTab("directory");
    await expect(body()).toContainText("Contacts");
    await expect(body()).toContainText("Mr Smith");
    await expect(body()).toContainText("The Fixer");
    await expect(body()).toContainText(UNKNOWN);
    await expect(panel().locator('.spt-tab[data-tab="directory"] .spt-badge')).toHaveText("1");
  });

  test("Devices: grouped by holder and by place, with the count", async () => {
    await openTab("devices");
    const group = (name) => panel().locator(".spt-dev-group").filter({ has: s.gm.locator(".spt-dev-group-head", { hasText: name }) });
    await expect(group("Agent Alice")).toContainText("Alice's phone");
    await expect(group("Agent Alice")).toContainText("Field laptop");
    await expect(group("Agent Bob")).toContainText("Bob's phone");
    await expect(group("Motel Starlite")).toContainText("Motel desk");
    await expect(panel().locator('.spt-tab[data-tab="devices"] .spt-count')).toHaveText("4");
  });

  test("Files: the laptop's file, and the count on the tab", async () => {
    await openTab("files");
    await expect(body()).toContainText("mystery-man.svg");
    await expect(body()).toContainText("Field laptop");
    await expect(panel().locator('.spt-tab[data-tab="files"] .spt-count')).toHaveText("1");
  });

  test("Intel: the agents' messages to each other, then the calls", async () => {
    await openTab("watch");
    await expect(body()).toContainText(text.pcs);
    await expect(body()).not.toContainText(text.npc);
    await click('[data-action="watchView"][data-view="calls"]');
    await expect(body()).toContainText("Agent Bob");
    await expect(body()).toContainText("Mr Smith");
  });
});
