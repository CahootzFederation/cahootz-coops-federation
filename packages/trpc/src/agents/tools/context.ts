import type { db } from "@repo/db";

/**
 * What an agent tool receives to do its work. Deliberately not the raw
 * Prisma client with no scoping attached — carrying the calling user's
 * identity means each tool's execute() can run the exact same permission
 * checks a tRPC procedure would (see buildGetGroupHistoryTool), so a tool
 * call can never see more than the equivalent HTTP endpoint would.
 */
export interface AgentToolContext {
  db: typeof db;
  requestingUserId: string | null; // null only for system/background jobs
  coopId: string;
}
