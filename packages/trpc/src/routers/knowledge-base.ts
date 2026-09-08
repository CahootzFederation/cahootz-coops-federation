import { z } from "zod";
import { TRPCError } from "@trpc/server";

import type { AccountAuthenticatedContext } from "../context.js";
import { accountAuthenticatedProcedure } from "../procedures/index.js";
import { router } from "../trpc.js";
import { requireMembership } from "./groups.js";
import { requireActiveCommonsMembership } from "./commons.js";
import { ingestDocument } from "../services/knowledge-base.js";

const scopeTypeSchema = z.enum(["commons", "circle"]);

const documentTypeSchema = z.enum([
  "MEETING_NOTES",
  "CHARTER",
  "BYLAWS",
  "FAQ",
  "PROJECT_PLAN",
  "RESEARCH",
  "VENDOR_LIST",
  "GRANT_NOTES",
  "MEMBER_GUIDE",
  "DECISION_SUMMARY",
  "OTHER",
]);

const visibilitySchema = z.enum(["PRIVATE", "CIRCLE", "COMMONS", "PUBLIC"]);

// Scope-level access check shared by upload/list/get below — mirrors the
// membership gate each scope's own router already enforces (requireMembership
// for circles, requireActiveCommonsMembership for commons) rather than
// re-implementing it.
async function requireScopeAccess(
  db: AccountAuthenticatedContext["db"],
  scopeType: "commons" | "circle",
  scopeId: string,
  userId: string,
) {
  if (scopeType === "circle") {
    await requireMembership(db, scopeId, userId);
  } else {
    await requireActiveCommonsMembership(db, userId, scopeId);
  }
}

export const knowledgeBaseRouter = router({
  uploadDocument: accountAuthenticatedProcedure
    .input(
      z.object({
        scopeType: scopeTypeSchema,
        scopeId: z.string().min(1),
        type: documentTypeSchema,
        visibility: visibilitySchema.default("COMMONS"),
        title: z.string().trim().min(1).max(200),
        sourceUrl: z.string().url().optional(),
        content: z.string().trim().min(1).max(100_000),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      const userId = context.accountUser.id;

      await requireScopeAccess(context.db, input.scopeType, input.scopeId, userId);

      const { document, chunkCount } = await ingestDocument({
        coopId: input.scopeType === "commons" ? input.scopeId : context.coopId,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        type: input.type,
        visibility: input.visibility,
        title: input.title,
        sourceUrl: input.sourceUrl,
        uploadedById: userId,
        content: input.content,
      });

      return {
        document: {
          id: document.id,
          title: document.title,
          type: document.type,
          visibility: document.visibility,
          createdAt: document.createdAt.toISOString(),
        },
        chunkCount,
      };
    }),

  listDocuments: accountAuthenticatedProcedure
    .input(
      z.object({
        scopeType: scopeTypeSchema,
        scopeId: z.string().min(1),
      }),
    )
    .query(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      const userId = context.accountUser.id;

      await requireScopeAccess(context.db, input.scopeType, input.scopeId, userId);

      const documents = await context.db.knowledgeDocument.findMany({
        where: {
          scopeType: input.scopeType,
          scopeId: input.scopeId,
          OR: [
            { visibility: { in: ["PUBLIC", "COMMONS", "CIRCLE"] } },
            { visibility: "PRIVATE", uploadedById: userId },
          ],
        },
        orderBy: { createdAt: "desc" },
      });

      return {
        documents: documents.map((d) => ({
          id: d.id,
          title: d.title,
          type: d.type,
          visibility: d.visibility,
          createdAt: d.createdAt.toISOString(),
        })),
      };
    }),

  getDocument: accountAuthenticatedProcedure
    .input(z.object({ documentId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      const userId = context.accountUser.id;

      const document = await context.db.knowledgeDocument.findUnique({
        where: { id: input.documentId },
      });

      if (!document) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Document not found." });
      }

      await requireScopeAccess(
        context.db,
        document.scopeType as "commons" | "circle",
        document.scopeId,
        userId,
      );

      if (document.visibility === "PRIVATE" && document.uploadedById !== userId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "This document is private." });
      }

      return {
        document: {
          id: document.id,
          title: document.title,
          type: document.type,
          visibility: document.visibility,
          content: document.content,
          sourceUrl: document.sourceUrl,
          createdAt: document.createdAt.toISOString(),
        },
      };
    }),
});
