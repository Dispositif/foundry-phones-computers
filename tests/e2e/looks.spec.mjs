import { expect, test } from "@playwright/test";
import { viewScene } from "./helpers.mjs";
import { NUMBERS, freshSession } from "./world.mjs";

/**
 * Visual references: each model in each of its looks, as Alice sees it, then the GM's views
 * (device window, panel tabs). Disposable, for a refactoring that must not change the looks:
 * run only with LOOKS=1, and the pictures stay out of git (see README). One set per major version.
 */
const MODULE_ID = "soren-phones-computers";
const MAJOR = (process.env.FOUNDRY_VERSION ?? "14").split(".")[0];
const SHOT = { animations: "disabled", caret: "hide", maxDiffPixelRatio: 0.002 };

// [model, look]: every look a model may take (devices.js THEMES), "default" = the model's own.
const LOOKS = [
  ["smartphone", "default"], ["smartphone", "console"], ["smartphone", "military"], ["smartphone", "neon"], ["smartphone", "glitch"],
  ["mobile", "default"], ["mobile", "console"], ["mobile", "military"],
  ["brick", "default"], ["satphone", "default"],
  ["computer", "default"], ["computer", "federal"], ["computer", "console"], ["computer", "military"], ["computer", "neon"], ["computer", "glitch"],
  ["desktop", "default"], ["desktop", "federal"], ["desktop", "console"], ["desktop", "military"], ["desktop", "neon"], ["desktop", "glitch"],
  ["landline", "modern"], ["landline", "vintage"],
  ["pager", "default"], ["pager", "neon"],
  ["jammer", "default"], ["jammer", "neon"]
];

test.describe.serial("Looks", () => {
  test.skip(!process.env.LOOKS, "Visual references: run on demand with LOOKS=1");
  let s;
  let devices = {};
  let scene;

  test.beforeAll(async ({ browser }) => {
    s = await freshSession(browser);
    const { gm, alice } = s;
    // A fixed date and time everywhere: clocks and message times show the same at each run.
    for (const page of [gm, alice]) await page.clock.setFixedTime(new Date("2026-03-14T15:09:26Z"));
    ({ devices, scene } = await gm.evaluate(
      async ({ id, looks, smith }) => {
        const { createPhone, addLog } = await window.spt("devices.js");
        const alice = game.actors.getName("Agent Alice");
        const scene = await Scene.create({ name: "Field office", navigation: true, ownership: { default: 2 } });
        const out = {};
        let n = 300;
        for (const [model, theme] of looks) {
          const fixed = model === "landline" || model === "desktop";
          const mail = model === "computer" || model === "desktop";
          const item = await createPhone(fixed ? null : alice, {
            label: `${model} ${theme}`,
            number: mail ? `${model}.${theme}@field.test` : model === "jammer" ? undefined : `555-0${n++}`,
            model,
            theme,
            sceneId: fixed ? scene.id : null
          });
          await item.update({ [`flags.${id}.phone.welcomed`]: true, [`flags.${id}.phone.contacts`]: [{ name: "Mr Smith", number: smith }] });
          if (model !== "landline" && model !== "jammer") {
            await addLog(item, { kind: "sms", dir: "in", with: smith, text: "The package is at the docks.", read: true, t: Date.UTC(2026, 2, 14, 14, 0) });
            await addLog(item, { kind: "sms", dir: "out", with: smith, text: "On my way.", t: Date.UTC(2026, 2, 14, 14, 5) });
          }
          out[`${model}-${theme}`] = item.uuid;
        }
        return { devices: out, scene: scene.id };
      },
      { id: MODULE_ID, looks: LOOKS, smith: NUMBERS["Mr Smith"] }
    ));
    await viewScene(gm, alice, scene);
    await alice.evaluate(() => document.fonts.ready);
  });

  test.afterAll(async () => {
    await s?.gm.evaluate(async ({ devices, scene }) => {
      for (const uuid of Object.values(devices)) await fromUuidSync(uuid)?.delete();
      await game.scenes.get(scene)?.delete();
    }, { devices, scene });
    await s?.close();
  });

  /** Opens a device on this page and returns its window (phone, pager or jammer). */
  async function open(page, uuid) {
    const id = await page.evaluate(async (uuid) => {
      for (const w of foundry.applications.instances.values()) if (w.id?.startsWith("spt-")) await w.close({ animate: false });
      const app = (await window.spt("main.js")).openPhone(uuid);
      const w = Array.isArray(app) ? app[0] : app;
      await new Promise((r) => setTimeout(r, 300));
      return w?.id ?? null;
    }, uuid);
    const win = page.locator(`#${id}`);
    await expect(win).toBeVisible();
    // Images (icons, frames) loaded before the picture.
    await page.waitForFunction((id) => [...document.querySelectorAll(`#${id} img`)].every((i) => i.complete), id);
    return win;
  }

  for (const [model, theme] of LOOKS) {
    test(`Alice: ${model}, ${theme} look`, async () => {
      const win = await open(s.alice, devices[`${model}-${theme}`]);
      await expect(win).toHaveScreenshot([`v${MAJOR}`, `player-${model}-${theme}.png`], SHOT);
    });
  }

  test("Alice: a conversation on the smartphone and on the laptop", async () => {
    for (const key of ["smartphone-default", "computer-default"]) {
      const win = await open(s.alice, devices[key]);
      await win.locator(`.spt-conv[data-key="${NUMBERS["Mr Smith"]}"]`).click();
      await s.alice.waitForTimeout(300);
      await expect(win).toHaveScreenshot([`v${MAJOR}`, `player-conv-${key}.png`], SHOT);
    }
  });

  test("GM: a device window, and the panel's tabs", async () => {
    const { gm } = s;
    const win = await open(gm, devices["smartphone-default"]);
    await expect(win).toHaveScreenshot([`v${MAJOR}`, "gm-device-smartphone.png"], SHOT);
    await gm.evaluate(async () => {
      for (const w of foundry.applications.instances.values()) if (w.id?.startsWith("spt-")) await w.close({ animate: false });
    });
    for (const tab of ["send", "inbox", "directory", "devices", "files"]) {
      await gm.evaluate(async (tab) => (await window.spt("main.js")).openPanel({ tab }), tab);
      const panel = gm.locator("#spt-phone-panel");
      await expect(panel).toBeVisible();
      await gm.waitForTimeout(300);
      await expect(panel).toHaveScreenshot([`v${MAJOR}`, `gm-panel-${tab}.png`], SHOT);
    }
  });
});
