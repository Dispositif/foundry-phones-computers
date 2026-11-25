import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeActor, carry, load, setWorld } from "./shim.mjs";

const { randomAddress, phonesByNumber } = await load("devices.js");
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
