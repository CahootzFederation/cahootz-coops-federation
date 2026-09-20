# Commons action agent rollout

The agent processes each new General Commons post or comment as soon as it is created. With an appropriate `TRIGGER_SECRET_KEY`, the API queues a Trigger.dev background job and a daily recovery scan catches missed jobs and backfills older content in small batches. Without a usable key, the API runs each new-content scan directly after saving the post or comment; this can make the create request slower, and historical backfill requires the platform admin's manual scan button. It uses `gpt-5.6-luna` by default, records action evidence and estimated token costs, and creates proposal drafts for the original author. A platform admin controls each Commons' Auto-reply setting. The setting defaults to on; replies to items older than 48 hours remain in the platform admin queue.

## Before deployment

1. Apply the database migration in `packages/db/prisma/migrations/20260919010000_commons_action_agent`.
2. Review a representative sample of real posts and comments from the Commons. Check action types, exact charter or goal evidence, reply wording, person invitations, and abstentions. The four synthetic examples in `scripts/evaluate-commons-actions.ts` are only a smoke test.
3. As a platform admin, use the Commons AI actions page to scan a page manually and inspect the resulting queue and cost totals. A manual scan can publish eligible replies when Auto-reply is on; turn Auto-reply off for the Commons while reviewing if publication is not intended.
4. Deploy the API and Trigger worker after that review. New-content jobs and the daily recovery scan start automatically; there is no platform-wide environment switch.

The per-Commons Auto-reply switch affects public replies. It does not submit proposals or publish resources. Person resources need member acceptance and platform admin verification; all other resource listings need platform admin verification. Commons admins have no agent controls.

## Use the local Trigger worker

`pnpm dev:trigger` runs the worker, but it does not give the separate API process permission to create task runs. To send new Commons posts and comments to that worker, create a **Development** key for the same Trigger.dev project and your own Development environment, set `TRIGGER_SECRET_KEY="tr_dev_..."` in the root `.env` or `apps/api/.env`, then restart the API. The API loads the root file first and `apps/api/.env` second, so a value in the latter wins. Keep `pnpm dev:trigger` running while testing. The key belongs only on the backend; do not put it in a public web or mobile environment variable. Without a key, or with a non-development key in local development, the API scans directly instead of sending work to Trigger. A production key in a local file cannot target the local development worker. See [Trigger.dev API keys](https://trigger.dev/docs/apikeys).

The platform admin page calls the API server's `commonsActionsAdmin` tRPC router directly. The web server uses the existing signed-in admin session to issue a short-lived API token; the API server validates the token and the platform admin allowlist before serving the request. Both servers must use the same `SESSION_SECRET` and platform admin allowlist. The member app calls the API server's `commonsActions` router directly. Next.js does not run the agent dashboard or action commands.

The cost dashboard shows estimated USD from reported tokens and the pricing version stored on each call. Missing usage or unknown model pricing appears as **unknown**. Provider tool charges are not included in the token estimate. There is no automatic spending cap.
