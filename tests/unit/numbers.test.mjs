import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeActor, FakeItem, carry, load, setWorld } from "./shim.mjs";

const { allJammers, allPhones, randomAddress, phonesByNumber } = await load("devices.js");
const { norm } = await load("util.js");

test("randomAddress: a 555 number outside the reserved 555-02xx range", () => {
  setWorld();
  for (let i = 0; i < 200; i++) {
    const n = randomAddress("smartphone");
    assert.match(n, /^555-0\d{3}$/);
    assert.ok(!/^555-02\d\d$/.test(n), `reserved number drawn: ${n}`);
  }
});

test("randomAddress: never a number already used (devices, directory, contacts, history)", () => {
  // Every free number but one is taken somewhere: the draw must land on the last free one.
  const all = [];
  for (let n = 0; n < 1000; n++) if (n < 200 || n >= 300) all.push(`555-0${String(n).padStart(3, "0")}`);
  const free = all.pop();
  const third = Math.floor(all.length / 3);
  const a = new FakeActor({ id: "a1", name: "Cole", owners: ["p1"] });
  carry(a, "i1", { number: all[0], contacts: all.slice(1, third).map((number) => ({ name: "x", number })), log: all.slice(third, 2 * third).map((w) => ({ with: w })) });
  const directory = all.slice(2 * third).map((n, i) => `NPC ${i} | ${n}`).join("\n");
  setWorld({ users: [{ id: "p1", active: true }], actors: [a], directory });
  assert.equal(randomAddress("smartphone"), free);
});

test("randomAddress: a jammer gets a hidden id, never a number", () => {
  setWorld();
  assert.match(randomAddress("jammer"), /^jam-/);
});

test("phonesByNumber: matches whatever the formatting", () => {
  const a = new FakeActor({ id: "a1", name: "Cole", owners: ["p1"] });
  carry(a, "i1", { number: "555-0142" });
  setWorld({ actors: [a] });
  assert.equal(phonesByNumber("(555) 0142").length, 1);
  assert.equal(phonesByNumber("555-0143").length, 0);
  assert.equal(norm(phonesByNumber("5550142")[0].phone.number), "5550142");
});

test("device index: kept until a document changes, then found again", () => {
  const a = new FakeActor({ id: "a1", name: "Cole", owners: ["p1"] });
  carry(a, "i1", { number: "555-0142" });
  setWorld({ actors: [a] });
  assert.equal(allPhones().length, 1);
  // A device added without any hook: the index does not see it yet.
  const added = carry(a, "i2", { number: "555-0143" });
  assert.equal(phonesByNumber("555-0143").length, 0);
  // Foundry fires createItem: the index is rebuilt.
  Hooks.callAll("createItem", added, {});
  assert.equal(phonesByNumber("555-0143").length, 1);
  assert.equal(allPhones().length, 2);
  // Removed (deleteItem), and a whole actor deleted (deleteActor: no hook per item).
  a.items.splice(a.items.indexOf(added), 1);
  Hooks.callAll("deleteItem", added, {});
  assert.equal(phonesByNumber("555-0143").length, 0);
  game.actors.splice(0, 1);
  Hooks.callAll("deleteActor", a, {});
  assert.equal(allPhones().length, 0);
});

test("device index: callers get their own arrays, the entries are shared and frozen; jammers apart", () => {
  const a = new FakeActor({ id: "a1", name: "Cole", owners: ["p1"] });
  carry(a, "i1", { number: "555-0150" });
  carry(a, "i2", { number: "555-0140" });
  carry(a, "j1", { model: "jammer", number: "jam-x" });
  const world = new FakeItem({ id: "w1", phone: { model: "landline", number: "555-0100", contacts: [], log: [] } });
  setWorld({ actors: [a], items: [world] });
  const list = allPhones();
  list.sort((x, y) => x.phone.number.localeCompare(y.phone.number)).pop();
  assert.deepEqual(allPhones().map((p) => p.phone.number), ["555-0150", "555-0140", "555-0100"]);
  assert.ok(Object.isFrozen(allPhones()[0]));
  assert.equal(allPhones()[0], allPhones()[0]);
  assert.deepEqual(allJammers().map((p) => p.phone.number), ["jam-x"]);
  assert.equal(allPhones({ jammers: true }).length, 4);
  assert.equal(phonesByNumber("jam-x").length, 0);
});
