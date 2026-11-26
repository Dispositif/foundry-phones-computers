import { expect, test } from "@playwright/test";
import { freshSession } from "./world.mjs";

/**
 * What the module adds to Foundry's own GM interface: the Items and Scenes sidebars,
 * the sidebar context menus, and the scene configuration.
 */
const MODULE_ID = "soren-phones-computers";
const NUMBER = "555-0190";

test.describe("GM sidebars", () => {
  let s;

  test.beforeAll(async ({ browser }) => {
    s = await freshSession(browser);
  });

  test.afterAll(async () => {
    await s?.close();
  });

  test("Items and Scenes sidebars, context menu and scene configuration show the devices and dead zones", async () => {
    const { gm } = s;
    const { sceneId, uuid } = await gm.evaluate(
      async ({ id, number }) => {
        const scene = await Scene.create({ name: "Motel Starlite", flags: { [id]: { deadZone: true } } });
        const item = await (await window.spt("devices.js")).createPhone(null, { label: "Motel desk", number, model: "landline", sceneId: scene.id });
        return { sceneId: scene.id, uuid: item.uuid };
      },
      { id: MODULE_ID, number: NUMBER }
    );
    try {
      const seen = await gm.evaluate(
        async ({ sceneId, uuid }) => {
          const { t } = await window.spt("i18n.js");
          await ui.items.render({ force: true });
          await ui.scenes.render({ force: true });
          const item = fromUuidSync(uuid);
          const itemLi = ui.items.element.querySelector(`li[data-entry-id="${item.id}"], li[data-document-id="${item.id}"]`);
          const sceneLi = ui.scenes.element.querySelector(`li[data-entry-id="${sceneId}"], li[data-document-id="${sceneId}"]`);

          // Context menu of the device's sidebar entry: the module's entries, and Foundry's "Edit" hidden for a device.
          const options = [{ name: "SIDEBAR.Edit", icon: '<i class="fas fa-edit"></i>', condition: true, callback: () => {} }];
          Hooks.callAll("getItemContextOptions", ui.items, options);
          const shown = options.filter((o) => (typeof o.condition === "function" ? o.condition(itemLi) : o.condition ?? true)).map((o) => o.name);

          // Scene configuration: the dead zone box, ticked.
          const sheet = game.scenes.get(sceneId).sheet;
          await sheet.render({ force: true });
          await new Promise((r) => setTimeout(r, 200));
          const box = sheet.element?.querySelector(`.spt-deadzone input[name="flags.soren-phones-computers.deadZone"]`);
          const out = {
            newDeviceButton: !!ui.items.element.querySelector(".spt-new-device-btn"),
            caption: itemLi?.querySelector(".spt-item-sub")?.textContent.trim() ?? null,
            deadZoneMark: !!sceneLi?.querySelector(".spt-dz-mark"),
            sceneDevices: !!sceneLi?.querySelector(".spt-scene-devs i"),
            menu: { edit: shown.includes("SIDEBAR.Edit"), editDevice: shown.includes(t("EditDevice")), give: shown.includes(`${t("Give.Give")}…`), itemSheet: shown.includes(t("Sheet.ItemSheet")) },
            deadZoneBox: box ? box.checked : null
          };
          await sheet.close();
          return out;
        },
        { sceneId, uuid }
      );
      expect(seen).toEqual({
        newDeviceButton: true,
        caption: `Motel Starlite · ${NUMBER}`,
        deadZoneMark: true,
        sceneDevices: true,
        // An installed landline cannot be given; Foundry's "Edit" is hidden for a device.
        menu: { edit: false, editDevice: true, give: false, itemSheet: true },
        deadZoneBox: true
      });
    } finally {
      await gm.evaluate(async ({ sceneId, uuid }) => {
        await fromUuidSync(uuid)?.delete();
        await game.scenes.get(sceneId)?.delete();
      }, { sceneId, uuid });
    }
  });
});
