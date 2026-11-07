import { execFileSync } from "node:child_process";
import path from "node:path";
import type { Page } from "@playwright/test";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

/** The private E2E commons both fixture accounts belong to. */
export const OFFERS_COOP_ID = "e2e-private-shared";

/** Group Buys fixture (apps/api/scripts/e2e-marketplace-offers.ts). */
export function offersFixture(args: string[]) {
  return apiFixture("scripts/e2e-marketplace-offers.ts", args);
}

/** Runs an apps/api fixture script and returns its E2E_RESULT JSON. */
export function apiFixture(script: string, args: string[]) {
  const output = execFileSync(
    "pnpm",
    ["--silent", "-F", "@cahootz/api", "exec", "tsx", "--import", "./dotenv.config.js", script, ...args],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000 },
  );
  const line = output
    .split("\n")
    .reverse()
    .find((entry) => entry.startsWith("E2E_RESULT "));
  if (!line) throw new Error(`${script} printed no result:\n${output}`);
  return JSON.parse(line.slice("E2E_RESULT ".length));
}

/** Visible text only: Expo Router keeps earlier screens mounted (hidden). */
export function shown(page: Page, text: string | RegExp, options?: { exact?: boolean }) {
  return page.getByText(text, options).filter({ visible: true });
}

export function visibleButton(page: Page, name: string | RegExp) {
  return page.getByRole("button", { name }).filter({ visible: true }).first();
}

export async function openOffersMarketplace(page: Page) {
  await page.goto(`/board?coopId=${OFFERS_COOP_ID}&lane=marketplace`);
  await shown(page, "Shop together", { exact: true }).waitFor();
}
