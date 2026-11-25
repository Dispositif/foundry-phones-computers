import fs from "node:fs";
import { STATE_FILE } from "./env.mjs";

/** Stops Foundry only if the tests started it. Set KEEP_FOUNDRY=1 to keep it running. */
export default async function globalTeardown() {
  if (process.env.KEEP_FOUNDRY || !fs.existsSync(STATE_FILE)) return;
  const { pid } = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  fs.rmSync(STATE_FILE);
  try {
    process.kill(-pid);
  } catch {
    try { process.kill(pid); } catch { /* already gone */ }
  }
}
