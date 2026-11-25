import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeActor, carry, load, setWorld } from "./shim.mjs";

const { knownNpcFace, publicNpc } = await load("devices.js");

const DIR = `Paul Martin | 555-0101 | public
Sheriff | 555-0102`;

function world({ contacts = [] } = {}) {
  const pc = new FakeActor({ id: "pc", name: "Cole", owners: ["p1"] });
  const agentItem = carry(pc, "phone", { number: "555-0500", contacts });
  const paul = new FakeActor({ id: "n1", name: "Paul Martin", img: "paul.webp" });
  const sheriff = new FakeActor({ id: "n2", name: "Sheriff", img: "sheriff.webp" });
  setWorld({ users: [{ id: "p1", active: true, character: pc }], actors: [pc, paul, sheriff], directory: DIR });
  return agentItem.phone;
}

test("PC on the line: portrait for a public directory line", () => {
  assert.equal(knownNpcFace(world(), "555-0101"), "paul.webp");
});

test("PC on the line: no portrait for a private line it does not know", () => {
  assert.equal(knownNpcFace(world(), "555-0102"), null);
});

test("PC on the line: portrait for a private line in its contacts", () => {
  assert.equal(knownNpcFace(world({ contacts: [{ name: "Sheriff", number: "555-0102" }] }), "555-0102"), "sheriff.webp");
});

test("Spectators: portrait only for a public line", () => {
  world();
  assert.deepEqual(publicNpc("555-0101"), { name: "Paul Martin", img: "paul.webp" });
  assert.equal(publicNpc("555-0102"), null);
});

test("Hidden number: never a portrait", () => {
  assert.equal(knownNpcFace(world(), "Numéro masqué"), null);
  assert.equal(publicNpc("Numéro masqué"), null);
});

test("An NPC carrying a real device keeps priority", () => {
  const pc = new FakeActor({ id: "pc", name: "Cole", owners: ["p1"] });
  const agent = carry(pc, "phone", { number: "555-0500" });
  const paul = new FakeActor({ id: "n1", name: "Paul Martin", img: "paul.webp" });
  const boss = new FakeActor({ id: "n3", name: "Boss", img: "boss.webp" });
  carry(boss, "bossphone", { number: "555-0101", pub: true });
  setWorld({ users: [{ id: "p1", active: true, character: pc }], actors: [pc, paul, boss], directory: DIR });
  assert.equal(knownNpcFace(agent.phone, "555-0101"), "boss.webp");
});
