import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { BASE_URL, FIXTURES, FOUNDRY_DATA, FOUNDRY_MAIN, MODULE_DIR, MODULE_ID, SERVER_LOG, STATE_DIR, STATE_FILE, SYSTEM_ID, WORLD_ID } from "./env.mjs";
import { LAUNCH_ARGS, join } from "./helpers.mjs";
import { resetWorld } from "./world.mjs";

/** Links the module and the test system into the data folder, and creates the test world once. */
function installFixtures() {
  const data = path.join(FOUNDRY_DATA, "Data");
  for (const dir of ["modules", "systems", "worlds"]) fs.mkdirSync(path.join(data, dir), { recursive: true });
  const link = (target, at) => {
    if (fs.existsSync(at) || fs.lstatSync(at, { throwIfNoEntry: false })) return;
    fs.symlinkSync(target, at, "dir");
  };
  link(MODULE_DIR, path.join(data, "modules", MODULE_ID));
  link(path.join(FIXTURES, "system", SYSTEM_ID), path.join(data, "systems", SYSTEM_ID));
  const world = path.join(data, "worlds", WORLD_ID);
  if (!fs.existsSync(path.join(world, "world.json"))) {
    fs.mkdirSync(world, { recursive: true });
    fs.copyFileSync(path.join(FIXTURES, "world", "world.json"), path.join(world, "world.json"));
  }
}

async function status() {
  try {
    const res = await fetch(`${BASE_URL}/api/status`);
    return res.ok ? await res.json() : { up: true };
  } catch {
    return null;
  }
}

async function until(test, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await test();
    if (value) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${typeof what === "function" ? what() : what}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** Starts Foundry if nothing answers on the port (kept running otherwise: faster reruns). */
async function startServer() {
  if (await status()) return;
  if (!fs.existsSync(FOUNDRY_MAIN)) throw new Error(`Foundry not found: ${FOUNDRY_MAIN} (set FOUNDRY_MAIN)`);
  const port = new URL(BASE_URL).port;
  const log = fs.openSync(SERVER_LOG, "w");
  console.log(`Starting Foundry (${process.execPath} ${process.version}), log: ${SERVER_LOG}`);
  const child = spawn(process.execPath, [FOUNDRY_MAIN, `--dataPath=${FOUNDRY_DATA}`, `--port=${port}`, "--noupdate", "--noupnp"], { stdio: ["ignore", log, log], detached: true });
  // Foundry stopped at once (wrong Node version, port taken…): say why instead of waiting.
  let exited = null;
  child.on("error", (err) => (exited = err.message));
  child.on("exit", (code) => (exited = `exit code ${code}`));
  child.unref();
  fs.writeFileSync(STATE_FILE, JSON.stringify({ pid: child.pid }));
  const tail = () => fs.readFileSync(SERVER_LOG, "utf8").split("\n").filter((l) => !/^\s*["{}]/.test(l)).slice(-15).join("\n");
  await until(async () => {
    if (exited) throw new Error(`Foundry stopped (${exited}):\n${tail()}`);
    return status();
  }, 90_000, () => `the Foundry server. Its log:\n${tail()}`);
}

/** Launches the test world from the setup screen (the request needs a browser session). */
async function launchWorld(browser) {
  const s = await status();
  if (s?.active && s.world === WORLD_ID) return;
  if (s?.active) throw new Error(`Another world is running (${s.world}): return to setup in Foundry, then run the tests again.`);
  const page = await browser.newPage();
  try {
    await page.goto(`${BASE_URL}/setup`);
    if (!/\/setup/.test(page.url())) throw new Error(`Foundry shows ${page.url()}: open ${BASE_URL} once and complete the license and the EULA.`);
    const result = await page.evaluate(async (world) => {
      const res = await fetch("/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "launchWorld", world }) });
      return { status: res.status, body: await res.text() };
    }, WORLD_ID);
    if (result.status !== 200) throw new Error(`Could not launch the test world (HTTP ${result.status}): ${result.body}`);
  } finally {
    await page.close();
  }
  await until(async () => (await status())?.active, 60_000, "the test world");
}

export default async function globalSetup() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  installFixtures();
  await startServer();
  const browser = await chromium.launch({ args: LAUNCH_ARGS });
  try {
    await launchWorld(browser);
    const page = await join(browser, "Gamemaster");
    await resetWorld(page);
    await page.context().close();
  } finally {
    await browser.close();
  }
}
