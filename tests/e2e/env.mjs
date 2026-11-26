import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Where the Foundry test install lives. Defaults: next to the module folder, as in
 * ~/Work/foundry-dev/Foundry-node (app/FoundryVTT-Node-14.370 + data-v14, port 30014).
 * FOUNDRY_VERSION=13.351 picks the v13 install (app/FoundryVTT-Node-13.351 + data-v13-tests, port 30013).
 * Each path or the port can also be set on its own (FOUNDRY_MAIN, FOUNDRY_DATA, FOUNDRY_PORT).
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MODULE_DIR = path.resolve(HERE, "../..");
const DEV_DIR = path.resolve(MODULE_DIR, "..");

const VERSION = process.env.FOUNDRY_VERSION ?? "14.370";
const MAJOR = VERSION.split(".")[0];
export const PORT = Number(process.env.FOUNDRY_PORT ?? (MAJOR === "14" ? 30014 : 30000 + Number(MAJOR)));
export const BASE_URL = process.env.FOUNDRY_URL ?? `http://localhost:${PORT}`;
export const FOUNDRY_MAIN = process.env.FOUNDRY_MAIN ?? path.join(DEV_DIR, "Foundry-node", "app", `FoundryVTT-Node-${VERSION}`, "main.js");
export const FOUNDRY_DATA = process.env.FOUNDRY_DATA ?? path.join(DEV_DIR, "Foundry-node", MAJOR === "14" ? "data-v14" : `data-v${MAJOR}-tests`);
export const FIXTURES = path.join(HERE, "fixtures");
// Outside the Playwright output folder, which is emptied at each run.
export const STATE_DIR = path.join(HERE, MAJOR === "14" ? ".foundry" : `.foundry-v${MAJOR}`);
export const STATE_FILE = path.join(STATE_DIR, "server.json");
export const SERVER_LOG = path.join(STATE_DIR, "foundry.log");

export const MODULE_ID = "soren-phones-computers";
export const SYSTEM_ID = "spt-test";
export const WORLD_ID = "spt-tests";
export const GM = "Gamemaster";
export const PLAYERS = ["Alice", "Bob"];
