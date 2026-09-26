import type { Context } from "../context.js";
import { sageHandleForCoop } from "./bot.js";
import { RESERVED_MENTION_HANDLES } from "./commons.js";

const RAW_MENTION_RE = /(?<![\w[])@([a-zA-Z0-9_-]{1,30})\b/g;
const ENCODED_MENTION_RE = /\[@([a-zA-Z0-9_-]+)\]/g;

type MentionDb = Pick<Context["db"], "user">;

export interface MentionedUser {
  id: string;
  handle: string;
  isBot: boolean;
  roles: string[];
}

export interface EncodeMentionsResult {
  content: string;
  mentionedUsers: MentionedUser[];
}

export interface EncodeMentionsOptions {
  /** When given, a bare "@sage" token resolves to THIS coop's own Sage
   * account (each coop has its own Sage `User` with a distinct handle)
   * instead of requiring the coop-specific handle to be typed out. */
  coopId?: string;
}

/**
 * Scans raw content for `@handle`-shaped tokens, resolves which ones match a
 * real User.handle (case-insensitive), and rewrites ONLY the resolved
 * matches into canonical bracket form `[@handle]` (using the stored,
 * canonical-case handle). Unresolved `@word` tokens that don't match any
 * real handle are left untouched as plain text - this is what makes brackets
 * safe: only a confirmed reference to a real user ever gets wrapped.
 */
export async function encodeMentions(
  db: MentionDb,
  content: string,
  options: EncodeMentionsOptions = {},
): Promise<EncodeMentionsResult> {
  const candidates = new Set<string>();
  for (const match of content.matchAll(RAW_MENTION_RE)) {
    // Group pings like @everyone are Sage-only; a member typing one should
    // never resolve to (and notify) a legacy account that happens to own
    // that handle.
    if (RESERVED_MENTION_HANDLES.has(match[1].toLowerCase())) continue;
    candidates.add(match[1]);
  }

  if (candidates.size === 0) {
    return { content, mentionedUsers: [] };
  }

  const sageAlias = options.coopId ? sageHandleForCoop(options.coopId) : undefined;
  const hasSageToken = [...candidates].some((c) => c.toLowerCase() === "sage");
  const lookupHandles = new Set(candidates);
  if (hasSageToken && sageAlias) lookupHandles.add(sageAlias);

  const users = await db.user.findMany({
    where: {
      handle: { in: [...lookupHandles], mode: "insensitive" },
      deletedAt: null,
    },
    select: { id: true, handle: true, isBot: true, roles: true },
  });

  if (users.length === 0) {
    return { content, mentionedUsers: [] };
  }

  const byLowerHandle = new Map(
    users.filter((u) => u.handle).map((u) => [u.handle!.toLowerCase(), u]),
  );
  if (hasSageToken && sageAlias) {
    const sageUser = users.find(
      (u) => u.handle?.toLowerCase() === sageAlias.toLowerCase(),
    );
    if (sageUser) byLowerHandle.set("sage", sageUser);
  }

  const rewritten = content.replace(RAW_MENTION_RE, (full, token: string) => {
    const user = byLowerHandle.get(token.toLowerCase());
    return user ? `[@${user.handle}]` : full;
  });

  return {
    content: rewritten,
    mentionedUsers: users
      .filter((u): u is typeof u & { handle: string } => !!u.handle)
      .map((u) => ({ id: u.id, handle: u.handle, isBot: u.isBot, roles: u.roles })),
  };
}

/** Extracts `[@handle]` tokens already persisted in content (read-side helper). */
export function extractEncodedMentionHandles(content: string): string[] {
  return [...content.matchAll(ENCODED_MENTION_RE)].map((m) => m[1]);
}
