import { publicProcedure } from "../procedures/index.js";
import { router } from "../trpc.js";
import { userRouter } from "./user.js";
import { proposalRouter } from "./proposal.js";
import { healthRouter } from "./health.js";
import { applicationRouter } from "./application.js";
import { authRouter } from "./auth.js";
import { adminRouter } from "./admin";
import { adminAuthRouter } from "./admin-auth.js";
import { ucTransferRouter } from "./uc-transfer.js";
import { onrampRouter } from "./onramp.js";
import { ucAdminRouter } from "./uc-admin.js";
import { p2pRouter } from "./p2p.js";
import { claimRouter } from "./claim.js";
import { storeRouter } from "./store.js";
import { storePayRouter } from "./store-pay.js";
import { categoriesRouter } from "./categories.js";
import { notificationRouter } from "./notification.js";
import { scRewardsRouter } from "./sc-rewards.js";
import { coopConfigRouter } from "./coop-config.js";
import { proposalCommentRouter } from "./proposal-comment.js";
import { proposalReactionRouter } from "./proposal-reaction.js";
import { proposalExpertRouter } from "./proposal-expert.js";
import { treasuryRouter } from "./treasury.js";
import { commerceTransactionsRouter } from "./commerce-transactions.js";
import { treasuryLedgerRouter } from "./treasury-ledger.js";
import { scMintEventsRouter } from "./sc-mint-events.js";
import { stripeConnectRouter } from "./stripe-connect.js";
import { scVerificationRouter } from "./sc-verification.js";
import { platformConfigRouter } from "./platform-config.js";
import { publicCoopInfoRouter } from "./public-coop-info.js";
import { walletAuthRouter } from "./wallet-auth.js";
import { waitlistRouter } from "./waitlist.js";
import { coopAppsRouter } from "./coop-apps.js";
import { directoryRouter } from "./directory.js";

export const appRouter = router({
  user: userRouter,
  proposal: proposalRouter,
  health: healthRouter,
  application: applicationRouter,
  auth: authRouter,
  admin: adminRouter,
  adminAuth: adminAuthRouter,
  ucTransfer: ucTransferRouter,
  onramp: onrampRouter,
  ucAdmin: ucAdminRouter,
  p2p: p2pRouter,
  claim: claimRouter,
  store: storeRouter,
  storePay: storePayRouter,
  categories: categoriesRouter,
  notification: notificationRouter,
  scRewards: scRewardsRouter,
  coopConfig: coopConfigRouter,
  proposalComment: proposalCommentRouter,
  proposalReaction: proposalReactionRouter,
  proposalExpert: proposalExpertRouter,
  treasury: treasuryRouter,
  commerce: commerceTransactionsRouter,
  treasuryLedger: treasuryLedgerRouter,
  scMintEvents: scMintEventsRouter,
  stripeConnect: stripeConnectRouter,
  scVerification: scVerificationRouter,
  platformConfig: platformConfigRouter,
  publicCoopInfo: publicCoopInfoRouter,
  walletAuth: walletAuthRouter,
  waitlist: waitlistRouter,
  coopApps: coopAppsRouter,
  directory: directoryRouter,
});

export type AppRouter = typeof appRouter;
