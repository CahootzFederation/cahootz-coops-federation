import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "@playwright/test";

const POLL_MS = 500;
const MAX_WAIT_MS = 15 * 60_000;

function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs `fn` while holding a lock shared by every Playwright worker on this machine.
 *
 * Spec files run side by side and share the two fixture accounts. Most specs only create their own
 * uniquely named content, but some flip an account-wide setting (for example "Show Sage decision
 * trails"), and a parallel spec flipping it back changes what the first one sees. Wrap the whole test
 * body, including its cleanup, so specs that touch the same setting take turns. Time spent waiting is
 * added to the test's timeout.
 */
export async function withExclusiveAccountSetting<T>(name: string, fn: () => Promise<T>): Promise<T> {
  // Keyed by API so suites from other worktrees (with their own API and database) don't wait on this one.
  const scope = (process.env.E2E_API_BASE_URL || "http://localhost:3001").replace(/[^a-z0-9]+/gi, "-");
  const lockDir = path.join(os.tmpdir(), `cahootz-e2e-${scope}-${name}.lock`);
  const ownerFile = path.join(lockDir, "pid");
  const started = Date.now();

  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      fs.writeFileSync(ownerFile, String(process.pid));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // A worker that crashed mid-test leaves its lock behind; take it over.
      const owner = Number(fs.readFileSync(ownerFile, { encoding: "utf8", flag: "a+" }) || 0);
      if (owner && !isAlive(owner)) {
        fs.rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() - started > MAX_WAIT_MS) throw new Error(`Timed out waiting for the E2E lock "${name}" (${lockDir})`);
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }

  const waited = Date.now() - started;
  if (waited > 0) test.info().setTimeout(test.info().timeout + waited);
  try {
    return await fn();
  } finally {
    fs.rmSync(lockDir, { recursive: true, force: true });
  }
}
