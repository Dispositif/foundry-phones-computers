import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeActor, carry, load, setWorld } from "./shim.mjs";

const { phoneImages, keyFor, senderKey, modeOf, isUnread, trimLog, getLog, unreadCount, isOffNumber, isUnknownName } = await load("devices.js");
const { LOG_MAX, MASKED } = await load("constants.js");

const DIRECTORY = "Mr Smith | 555-0199 | public\nThe Fixer | 555-0222\n| 555-0300 | off";

/** A smartphone with a saved contact, carried by a PC. */
function world() {
  const a = new FakeActor({ id: "a1", name: "Cole", owners: ["p1"] });
  const item = carry(a, "i1", { number: "555-0101", contacts: [{ name: "Paul", number: "555-1234" }] });
  setWorld({ users: [{ id: "p1", active: true }], actors: [a], directory: DIRECTORY });
  return item.phone;
}

test("keyFor: a contact name gives its number; a public directory name too; a private one does not", () => {
  const phone = world();
  assert.equal(keyFor(phone, "Paul"), "555-1234");
  assert.equal(keyFor(phone, "paul "), "555-1234");
  assert.equal(keyFor(phone, "Mr Smith"), "555-0199");
  // Not public: the agent cannot look the name up.
  assert.equal(keyFor(phone, "The Fixer"), "The Fixer");
});

test("keyFor: a raw number stays itself; a device number typed with words is found in them, any other is not", () => {
  const phone = world();
  assert.equal(keyFor(phone, " 555-0777 "), "555-0777");
  assert.equal(keyFor(phone, "Cole - 555-0101"), "555-0101");
  assert.equal(keyFor(phone, "Diner - 555-0888"), "Diner - 555-0888");
});

test("senderKey: the GM writing as a directory NPC (public or not) sends from its number; a hidden number stays hidden", () => {
  const phone = world();
  assert.equal(senderKey("Mr Smith"), "555-0199");
  assert.equal(senderKey("The Fixer"), "555-0222");
  assert.equal(senderKey(MASKED), MASKED);
  // Unknown name: sent as typed.
  assert.equal(senderKey("Mysterious caller", phone), "Mysterious caller");
});

test("modeOf: on by default; a computer is always on; a brick has no silent mode", () => {
  world();
  assert.equal(modeOf({ model: "smartphone" }), "on");
  assert.equal(modeOf({ model: "smartphone", mode: "silent" }), "silent");
  assert.equal(modeOf({ model: "smartphone", mode: "off" }), "off");
  assert.equal(modeOf({ model: "computer", mode: "off" }), "on");
  assert.equal(modeOf({ model: "brick", mode: "silent" }), "on");
});

test("isUnread: received and not read messages, and missed calls not seen; nothing else", () => {
  assert.equal(isUnread({ kind: "sms", dir: "in", read: false }), true);
  assert.equal(isUnread({ kind: "call", dir: "in", result: "missed", read: false }), true);
  assert.equal(isUnread({ kind: "sms", dir: "in", read: true }), false);
  assert.equal(isUnread({ kind: "sms", dir: "in" }), false);
  assert.equal(isUnread({ kind: "sms", dir: "out", read: false }), false);
  assert.equal(isUnread({ kind: "call", dir: "in", result: "answer", read: false }), false);
});

test("getLog and unreadCount: pending entries (no signal, phone off) are left out until delivered", () => {
  const phone = { model: "smartphone", log: [
    { kind: "sms", dir: "in", text: "a", read: false },
    { kind: "sms", dir: "in", text: "b", read: false, pending: true }
  ] };
  assert.deepEqual(getLog(phone).map((e) => e.text), ["a"]);
  assert.deepEqual(getLog(phone, { includePending: true }).map((e) => e.text), ["a", "b"]);
  assert.equal(unreadCount(phone), 1);
});

test("trimLog: keeps the most recent entries up to the limit, and every entry the GM prepared", () => {
  const log = [];
  for (let i = 0; i < LOG_MAX + 50; i++) log.push({ id: `e${i}`, ...(i % 100 === 99 ? { prep: true } : {}) });
  const kept = trimLog(log);
  const prepared = log.filter((e) => e.prep);
  assert.equal(kept.filter((e) => !e.prep).length, LOG_MAX);
  assert.deepEqual(kept.filter((e) => e.prep), prepared);
  // The list is newest first: the oldest plain entries go.
  assert.equal(kept.find((e) => !e.prep).id, "e0");
  assert.ok(!kept.some((e) => e.id === `e${LOG_MAX + 49}` && !e.prep));
});

test("isOffNumber and isUnknownName: out-of-service numbers, and names the device cannot resolve", () => {
  const phone = world();
  assert.equal(isOffNumber(phone, "555-0300"), true);
  assert.equal(isOffNumber(phone, "555-0199"), false);
  assert.equal(isUnknownName(phone, "Zorglub"), true);
  assert.equal(isUnknownName(phone, "Paul"), false);
  assert.equal(isUnknownName(phone, "555-0444"), false);
});

test("phoneImages: images of the history, newest first, each once, pending ones only for the GM", () => {
  const img = (id, src, extra = {}) => ({ id, kind: "sms", dir: "in", with: "555-1234", t: 0, att: { type: "image", src }, ...extra });
  const phone = { log: [img("c", "c.png"), { id: "t", kind: "sms", dir: "in", with: "x", t: 0, text: "hi" }, img("b", "b.png"), img("b2", "b.png"), img("p", "p.png", { pending: true }), { id: "d", kind: "sms", dir: "in", with: "x", t: 0, att: { type: "doc", uuid: "J.1", name: "File" } }] };
  assert.deepEqual(phoneImages(phone).map((e) => e.att.src), ["c.png", "b.png"]);
  assert.deepEqual(phoneImages(phone, { includePending: true }).map((e) => e.att.src), ["c.png", "b.png", "p.png"]);
});
