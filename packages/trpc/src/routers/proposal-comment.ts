import { z } from "zod";
import { router } from "../trpc.js";
import { authenticatedProcedure, publicProcedure } from "../procedures/index.js";
import { CommentInputZ, CommentOutputZ, proposalEngine } from "@repo/validators";
import type { AuthenticatedContext } from "../context.js";
import { withAIEvaluationLogging } from "../services/ai-evaluation-log.js";

type CommentAIEvaluationOutput = {
  alignment: "ALIGNED" | "NEUTRAL" | "MISALIGNED";
  score: number;
  analysis: string;
  goalsImpacted: string[];
};

function mapCommentToOutput(
  record: any,
  aiEvaluation?: CommentAIEvaluationOutput | null,
): {
  id: string;
  proposalId: string;
  authorWallet: string;
  authorName?: string | null;
  content: string;
  createdAt: string;
  aiEvaluation?: CommentAIEvaluationOutput | null;
} {
  return {
    id: record.id,
    proposalId: record.proposalId,
    authorWallet: record.authorWallet,
    authorName: record.authorName,
    content: record.content,
    createdAt: record.createdAt instanceof Date ? record.createdAt.toISOString() : record.createdAt,
    aiEvaluation: aiEvaluation ?? null,
  };
}

export const proposalCommentRouter = router({
  /**
   * Create a comment on a proposal, then run AI evaluation
   */
  create: authenticatedProcedure
    .input(CommentInputZ)
    .output(CommentOutputZ)
    .mutation(async ({ input, ctx }) => {
      const { walletAddress } = ctx as AuthenticatedContext;

      // Verify proposal exists
      const proposal = await ctx.db.proposal.findUnique({
        where: { id: input.proposalId },
      });
      if (!proposal) {
        throw new Error("Proposal not found");
      }

      // Create the comment
      const comment = await ctx.db.proposalComment.create({
        data: {
          proposalId: input.proposalId,
          authorWallet: walletAddress,
          content: input.content,
        },
      });

      // Run AI evaluation
      let aiEvaluation: CommentAIEvaluationOutput | null = null;
      try {
        // Fetch coop config if available
        const coopConfig = proposal.coopId
          ? await ctx.db.coopConfig.findFirst({
              where: { coopId: proposal.coopId, isActive: true },
            })
          : null;

        const configData = coopConfig
          ? {
              charterText: coopConfig.charterText,
              missionGoals: coopConfig.missionGoals as any[],
              structuralWeights: coopConfig.structuralWeights as { feasibility: number; risk: number; accountability: number },
              scoreMix: coopConfig.scoreMix as { missionWeight: number; structuralWeight: number },
              screeningPassThreshold: coopConfig.screeningPassThreshold,
              proposalCategories: coopConfig.proposalCategories as any[],
              sectorExclusions: (coopConfig.sectorExclusions as Array<string | { value: string; description?: string }>)
                .map(e => typeof e === "string" ? { value: e } : e),
              quorumPercent: coopConfig.quorumPercent,
              approvalThresholdPercent: coopConfig.approvalThresholdPercent,
              votingWindowDays: coopConfig.votingWindowDays,
            }
          : undefined;

        aiEvaluation = await withAIEvaluationLogging(
          {
            agentKey: "comment-evaluation",
            agentName: "Comment Evaluation Agent",
            entityType: "ProposalComment",
            entityId: comment.id,
            input: { commentText: input.content, proposalId: input.proposalId },
          },
          () =>
            proposalEngine.evaluateComment(
              input.content,
              {
                title: proposal.title,
                summary: proposal.summary,
                category: proposal.category.toLowerCase(),
              },
              configData,
            ),
        );
      } catch (err) {
        // AI evaluation failure should not block comment creation
        console.error("AI comment evaluation failed:", err);
      }

      return mapCommentToOutput(comment, aiEvaluation);
    }),

  /**
   * List comments for a proposal with AI evaluations
   */
  listByProposal: publicProcedure
    .input(z.object({
      proposalId: z.string(),
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
    }))
    .output(z.object({
      comments: z.array(CommentOutputZ),
      total: z.number(),
    }))
    .query(async ({ input, ctx }) => {
      const [comments, total] = await Promise.all([
        ctx.db.proposalComment.findMany({
          where: { proposalId: input.proposalId },
          orderBy: { createdAt: "asc" },
          skip: input.offset,
          take: input.limit,
        }),
        ctx.db.proposalComment.count({
          where: { proposalId: input.proposalId },
        }),
      ]);

      const evaluations = comments.length
        ? await ctx.db.aIEvaluation.findMany({
            where: {
              entityType: "ProposalComment",
              entityId: { in: comments.map((c) => c.id) },
            },
            orderBy: { createdAt: "desc" },
          })
        : [];

      const evaluationByCommentId = new Map<string, CommentAIEvaluationOutput>();
      for (const evaluation of evaluations) {
        if (!evaluation.entityId || evaluationByCommentId.has(evaluation.entityId)) continue;
        const output = evaluation.output as Partial<CommentAIEvaluationOutput> | null;
        if (!output) continue;
        evaluationByCommentId.set(evaluation.entityId, {
          alignment: output.alignment as CommentAIEvaluationOutput["alignment"],
          score: output.score as number,
          analysis: output.analysis as string,
          goalsImpacted: output.goalsImpacted as string[],
        });
      }

      return {
        comments: comments.map((comment) =>
          mapCommentToOutput(comment, evaluationByCommentId.get(comment.id) ?? null),
        ),
        total,
      };
    }),
});
