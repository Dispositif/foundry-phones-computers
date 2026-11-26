import { MODULE_ID, PLAYERS } from "./env.mjs";
import { expect } from "@playwright/test";
import { join, myDevice, reload } from "./helpers.mjs";

/**
 * The test world, rebuilt from scratch before each run:
 * - users Alice and Bob (players), each with a character carrying a smartphone;
 * - an NPC actor "Mr Smith", and a public directory line for him.
 */
export const NUMBERS = { Alice: "555-0101", Bob: "555-0102", "Mr Smith": "555-0199" };

export async function resetWorld(gm) {
  // The module must be enabled in the world (once): reload so that it starts.
  const enabled = await gm.evaluate((id) => game.modules.get(id)?.active, MODULE_ID);
  if (!enabled) {
    await gm.evaluate(async (id) => {
      const config = game.settings.get("core", "moduleConfiguration") ?? {};
      await game.settings.set("core", "moduleConfiguration", { ...config, [id]: true });
    }, MODULE_ID);
    await reload(gm);
  }

  await gm.evaluate(
    async ({ id, players, numbers }) => {
      const { createPhone } = await window.spt("devices.js");
      // Empty world: no leftovers from an earlier run.
      for (const cls of [ChatMessage, Item, Actor, Scene]) {
        const ids = game.collections.get(cls.documentName).map((d) => d.id);
        if (ids.length) await cls.deleteDocuments(ids);
      }
      const others = game.users.filter((u) => !u.isGM).map((u) => u.id);
      if (others.length) await User.deleteDocuments(others);

      // Module settings: no onboarding windows, a known universe and directory.
      const set = (key, value) => game.settings.set(id, key, value);
      await set("welcomeShown", true);
      await set("universe", "modern");
      await set("directory", `Mr Smith | ${numbers["Mr Smith"]} | public`);
      // Settings some tests change: back to their defaults if a run stopped halfway.
      await set("networkDown", false);
      await set("ringTimeout", 60);
      await set("satSky", []);
      for (const feature of ["satellite", "secure", "jammer", "intel"]) await set(`feature-${feature}`, false);
      await game.user.setFlag(id, "newsSeen", "999.0.0");

      await Actor.create({ name: "Mr Smith", type: "npc" });
      for (const name of players) {
        const user = await User.create({ name, role: CONST.USER_ROLES.PLAYER, password: "" });
        const actor = await Actor.create({ name: `Agent ${name}`, type: "character", ownership: { default: 0, [user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER } });
        await user.update({ character: actor.id });
        const item = await createPhone(actor, { label: `${name}'s phone`, number: numbers[name], model: "smartphone" });
        // Already welcomed: no operator message in the history.
        await item.update({ [`flags.${id}.phone.welcomed`]: true });
      }
    },
    { id: MODULE_ID, players: PLAYERS, numbers: NUMBERS }
  );
}

/**
 * A clean world and the three people connected: for spec files that change the world
 * (devices given away, settings…). The world is reset before the players join.
 */
export async function freshSession(browser) {
  const gm = await join(browser, "Gamemaster");
  await resetWorld(gm);
  const alice = await join(browser, "Alice");
  const bob = await join(browser, "Bob");
  const aliceDevice = await myDevice(alice);
  const bobDevice = await myDevice(bob);
  expect(aliceDevice?.number).toBe(NUMBERS.Alice);
  expect(bobDevice?.number).toBe(NUMBERS.Bob);
  const session = { gm, alice, bob, aliceDevice, bobDevice };
  // The pages as they are at the end: a test may have replaced one (the GM leaving and coming back).
  session.close = async () => {
    for (const page of [session.gm, session.alice, session.bob]) if (!page.isClosed()) await page.context().close();
  };
  return session;
}
