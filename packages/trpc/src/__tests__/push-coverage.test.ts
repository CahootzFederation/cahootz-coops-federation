import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";

const SRC = join(__dirname, "..");

// Inbox-only on purpose: admin newsletter drafts waiting for review.
const INBOX_ONLY = new Set(["routers/public-coop-info.ts"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sourceFiles(path);
    return path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : [];
  });
}

// Payment, order and claim alerts used to be written straight to the inbox, so
// they never reached anyone's phone. Every alert goes through
// createNotificationAndPush, which also checks push preferences.
it("sends every alert through createNotificationAndPush", () => {
  const offenders = sourceFiles(SRC)
    .map((path) => relative(SRC, path))
    .filter((path) => path !== "services/push-notification-service.ts" && !INBOX_ONLY.has(path))
    .filter((path) => /\.notification\.(create|createMany)\(/.test(readFileSync(join(SRC, path), "utf8")));
  expect(offenders).toEqual([]);
});
