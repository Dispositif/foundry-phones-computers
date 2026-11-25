import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Where the Foundry v14 test install lives. Defaults: next to the module folder, as in
 * ~/Work/foundry-dev/Foundry-node (app/FoundryVTT-Node-14.370 + data-v14). Override with env variables.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MODULE_DIR = path.resolve(HERE, "../..");
const DEV_DIR = path.resolve(MODULE_DIR, "..");

export const PORT = Number(process.env.FOUNDRY_PORT ?? 30014);
export const BASE_URL = process.env.FOUNDRY_URL ?? `http://localhost:${PORT}`;
export const FOUNDRY_MAIN = process.env.FOUNDRY_MAIN ?? path.join(DEV_DIR, "Foundry-node", "app", "FoundryVTT-Node-14.370", "main.js");
export const FOUNDRY_DATA = process.env.FOUNDRY_DATA ?? path.join(DEV_DIR, "Foundry-node", "data-v14");
export const FIXTURES = path.join(HERE, "fixtures");
// Outside the Playwright output folder, which is emptied at each run.
export const STATE_DIR = path.join(HERE, ".foundry");
export const STATE_FILE = path.join(STATE_DIR, "server.json");
export const SERVER_LOG = path.join(STATE_DIR, "foundry.log");

export const MODULE_ID = "soren-phones-computers";
export const SYSTEM_ID = "spt-test";
export const WORLD_ID = "spt-tests";
export const GM = "Gamemaster";
export const PLAYERS = ["Alice", "Bob"];
