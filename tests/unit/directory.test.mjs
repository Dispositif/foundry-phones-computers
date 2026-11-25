import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeActor, load, setWorld } from "./shim.mjs";

const { npcDirectory, findNpc, directoryActor } = await load("devices.js");

const DIR = `# Section title
Paul Martin | 555-0101 | public
Sheriff | 555-0102 | pin
Old line | 555-0103 | off
Nameless line |  | public`;

test("directory: lines, flags and section titles", () => {
  setWorld({ directory: DIR });
  const list = npcDirectory();
  assert.equal(list.length, 4);
  assert.deepEqual(list.map((e) => [e.name, e.pub, e.pin, e.off]), [
    ["Paul Martin", true, false, false],
    ["Sheriff", false, true, false],
    ["Old line", false, false, true],
    ["Nameless line", true, false, false]
  ]);
});

test("findNpc: public lines only, unless all", () => {
  setWorld({ directory: DIR });
  assert.equal(findNpc("555-0101")?.name, "Paul Martin");
  assert.equal(findNpc("paul martin")?.number, "555-0101");
  assert.equal(findNpc("555-0102"), null);
  assert.equal(findNpc("555-0102", { all: true })?.name, "Sheriff");
});

test("directoryActor: the one NPC actor named like the line", () => {
  const npc = new FakeActor({ id: "n1", name: "  paul   MARTIN " });
  setWorld({ directory: DIR, actors: [npc] });
  assert.equal(directoryActor("555-0101"), npc);
});

test("directoryActor: nothing when ambiguous, player-owned or unnamed", () => {
  const twin1 = new FakeActor({ id: "n1", name: "Paul Martin" });
  const twin2 = new FakeActor({ id: "n2", name: "Paul Martin" });
  setWorld({ directory: DIR, actors: [twin1, twin2] });
  assert.equal(directoryActor("555-0101"), null);
  const pc = new FakeActor({ id: "p", name: "Sheriff", owners: ["p1"] });
  setWorld({ directory: DIR, actors: [pc], users: [{ id: "p1" }] });
  assert.equal(directoryActor("555-0102"), null);
  assert.equal(directoryActor("555-9999"), null);
  assert.equal(directoryActor("Numéro masqué"), null);
});
