import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";

import { db } from "@repo/db";

/**
 * Minimal request interface — only the fields tRPC procedures actually read.
 * Avoids referencing @types/express in generated declaration files (TS2742).
 */
export interface TrpcRequest {
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Minimal response interface — included for API symmetry; not read by any procedure.
 */
export interface TrpcResponse {
  // reserved for future use
}

export interface Context {
  db: typeof db;
  req: TrpcRequest;
  res: TrpcResponse;
  coopId: string | undefined;
}

/**
 * Creates the context for tRPC by extracting the request and response objects from the Express context options.
 * Also extracts coopId from X-Coop-Id header if present.
 */
export const createContext = ({ req, res }: CreateExpressContextOptions): Context => {
  const coopId = req.headers['x-coop-id'] as string | undefined;
  return {
    db,
    req: { headers: req.headers as Record<string, string | string[] | undefined> },
    res: res as TrpcResponse,
    coopId,
  };
};

/**
 * Authenticated context - includes walletAddress from the authenticated middleware
 */
export type AuthenticatedContext = Context & {
  walletAddress: string;
};

export type AccountAuthenticatedContext = Context & {
  accountUser: {
    id: string;
    email: string;
    handle: string | null;
    name: string | null;
    phone: string | null;
    roles: string[];
    status: string;
  };
  sessionToken: string;
};

/**
 * Coop-scoped context - requires coopId to be present
 */
export type CoopScopedContext = Context & {
  coopId: string;
};
