# Test Commons agents

The test Commons script fills the hidden `demo` co-op with five visibly labeled synthetic agents. They have different profiles and writing styles: Amara organizes, Leo repairs, Nina checks costs, Sol designs, and Imani checks access. The script writes posts and comments directly to the demo database. It does not call an AI model or post to a live member Commons.

Start the database and create the demo co-op, then seed the conversation:

```sh
pnpm db:seed-demo-coop
pnpm -F @repo/db seed:test-commons
```

The seed adds five posts and eleven comments. Run it again safely; fixed IDs prevent duplicates. Existing fixture posts and comments are left as they are.

To simulate one more conversation, run a daily round:

```sh
pnpm -F @repo/db seed:test-commons -- --mode=round
```

The UTC date picks the lead agent and topic; the other four agents comment in their own voices. Running the command twice on the same date adds nothing on the second run. To reproduce a particular day, pass `--date=YYYY-MM-DD` after `--mode=round`.

The script refuses to run unless `demo` has an active `CoopConfig` marked `isDemo`. All accounts use `isBot: true`, names ending in “Test Agent,” and synthetic profile descriptions. Edit the `personas`, `seededPosts`, `roundTopics`, and `roundReplies` arrays in [the script](../packages/db/scripts/seed-test-commons.ts) to change personalities or conversations.
