# Commons action agent rollout

The agent processes each new General Commons post or comment in a background job as soon as it is created. A daily recovery scan catches missed jobs and backfills older content in small batches. It uses `gpt-5.6-luna` by default, records action evidence and estimated token costs, and creates proposal drafts for the original author. A platform admin controls each Commons' Auto-reply setting. The setting defaults to on; replies to items older than 48 hours remain in the platform admin queue.

## Before deployment

1. Apply the database migration in `packages/db/prisma/migrations/20260919010000_commons_action_agent`.
2. Review a representative sample of real posts and comments from the Commons. Check action types, exact charter or goal evidence, reply wording, person invitations, and abstentions. The four synthetic examples in `scripts/evaluate-commons-actions.ts` are only a smoke test.
3. As a platform admin, use the Commons AI actions page to scan a page manually and inspect the resulting queue and cost totals. A manual scan can publish eligible replies when Auto-reply is on; turn Auto-reply off for the Commons while reviewing if publication is not intended.
4. Deploy the API and Trigger worker after that review. New-content jobs and the daily recovery scan start automatically; there is no platform-wide environment switch.

The per-Commons Auto-reply switch affects public replies. It does not submit proposals or publish resources. Person resources need member acceptance and platform admin verification; all other resource listings need platform admin verification. Commons admins have no agent controls.

The cost dashboard shows estimated USD from reported tokens and the pricing version stored on each call. Missing usage or unknown model pricing appears as **unknown**. Provider tool charges are not included in the token estimate. There is no automatic spending cap.
