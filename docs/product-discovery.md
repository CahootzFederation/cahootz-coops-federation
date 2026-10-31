# Shared-price product discovery

The public shared-price catalog is backed by durable sourcing data rather than
being treated as marketplace inventory. A discovered supplier item is not a
purchasable Cahootz product until a separate supplier and fulfillment workflow
approves it.

## Data model

- `CommonsProductProfile` defines one Commons' research brief, cadence, monthly
  run cap, homepage visibility, and optional live `coopId`.
- `SourcedProduct` is the global supplier-product identity. It may be linked to
  many Commons, which is how cross-Commons products avoid duplicated records.
- `CommonsProductMatch` is the many-to-many relation. It owns fit, purpose,
  display order, homepage placement, and the `CANDIDATE` → `APPROVED` review
  state.
- `ProductPriceObservation` is append-only source evidence. It stores the
  public supplier URL, comparison URL, member share, participant threshold,
  prices in integer cents, verified facts, risks, observation time, and an
  evidence hash.
- `ProductDiscoveryRun` is the idempotent audit record for every scheduled or
  manual attempt, including its query, model, outcome, counts, and failure.
- `AIEvaluation` and `AICostEvent` retain the existing raw execution trace and
  model-cost accounting.

Database checks reject invalid participant counts, non-positive prices, bulk
prices that are not below comparison prices, invalid fit scores, unsupported
display tones, malformed source identities or URLs, and invalid currency codes.

## Job behavior

Trigger.dev runs `product-discovery-sweep` daily at 13:20 UTC. Each enabled
profile independently defaults to a seven-day interval, five successful runs
per UTC month, and four candidates per run.

For every due profile the job:

1. Scores verified products already used by other Commons and adds relevant
   cross-Commons links as `CANDIDATE` matches.
2. Runs a bounded web-search research agent for additional public supplier
   candidates.
   When the profile is linked to a Commons (`coopId`), the agent also gets that
   Commons' active charter (up to 4,000 characters) and goals (up to 12). It
   looks for products that help those goals and marks every candidate
   `goalFit` = `FITS` or `DOES_NOT_FIT`, with a one-sentence `goalFitReason`.
   A run keeps up to `maxCandidatesPerRun` finds that fit, plus up to two
   strong deals that don't fit, so an admin can decide. Those are saved like
   any other candidate, shown folded under **Didn't fit the goals** on Product
   ideas with their reason, and never reach Sage's weekly deal question
   unless an admin approves them. Profiles with no Commons have nothing to
   check, so `goalFit` stays empty. This adds input tokens to the same single
   model call; it adds no calls. The model's text fields aren't length-checked
   in its output schema (one wordy field used to fail the whole run); they're
   trimmed to the stored limits when saved.
3. Validates URLs and price invariants, deduplicates products by a SHA-256 hash
   of the canonical source URL, and appends new price evidence.
4. Saves new products and matches as `CANDIDATE`. The job never marks an item
   `VERIFIED`, `APPROVED`, or purchasable.
   A globally `REJECTED` supplier item is never revived for another Commons.
5. Records the run, raw agent evaluation, and token cost. Stable scheduled
   idempotency keys prevent duplicate daily runs, while failed runs may retry.

The manual Trigger task is `run-product-discovery`. A local/manual run can use:

```bash
pnpm -F @cahootz/api product-discovery:run traveler
```

Every run keeps a step-by-step log in `ProductDiscoveryRun.progress` (up to
80 entries): its own steps, each web search and page the model opens (read
from the streamed response as they finish), and each find the model notes
with a `save_find` tool that carries the whole find. If the bot then stops without a usable final answer, the run keeps what it saved. Its output schema coerces or blanks bad fields instead of failing, so one bad item is dropped on its own. The log is saved as
the run goes. `finishedAt` is the real finish time, so run lengths are known;
runs from before this have no length. Product ideas shows a running search
live (time so far, an estimate from the median of the last 20 finished
searches, finds so far and the log, refreshed every 3 seconds) and the
profile's last 10 searches with their logs.

Admins can steer the bot two ways from **Find products now**. **What to look
for this time** is a one-time hint (up to 1,000 characters, text and/or
links): it goes first in that search's brief, is stored on the run
(`ProductDiscoveryRun.hint`) and shown with it, and the bot still follows the
profile, its exclusions and the Commons' charter and goals. **Edit what it
looks for** changes the profile's standing brief (`searchPrompt`,
`description`, `searchTerms`, `excludedTerms`) for every later search,
scheduled ones included; each change is audited as
`PRODUCT_DISCOVERY_PROFILE_UPDATED` with the before and after.

Platform admins can also start an extra run from **Find products now** on the
**Product ideas** tab (`/portal/admin/outreach`). It checks the profile is
turned on and has no run in progress (a run stuck for over 30 minutes no longer
blocks), then queues `run-product-discovery` in Trigger.dev with
`source: "admin"` and writes a `PRODUCT_DISCOVERY_STARTED` audit entry. These
runs are stored with trigger `admin`: they don't count toward or get stopped by
the profile's monthly limit, and they don't move `lastDiscoveredAt`, so the
scheduled cadence stays the same. One run at a time per profile is the only
bound on them. Without a usable `TRIGGER_SECRET_KEY` the run happens in the web
process during local development and is refused in production. The tab shows
scheduled searches used this month, extra admin searches, and what the latest
run found. Like every run, admin runs only add candidates.

It requires the migrated database and `OPENAI_API_KEY`. Set
`PRODUCT_DISCOVERY_MODEL` only when intentionally overriding the default
low-cost model.

## Homepage read path

`productDiscovery.homepageCatalogs` is a public read-only endpoint. It returns
only enabled profiles, `APPROVED` featured matches, `VERIFIED` products, and
the newest non-expired price observation. The marketing page caches the result
for 15 minutes and falls back to the checked-in prototype catalog if the API or
migration is unavailable.

Public curation permits no more than two shared products between any pair of
Commons. Profiles are evaluated in homepage display order; an additional
shared product stays in the review data but is omitted from the later public
catalog. Each seeded Commons also has at least two products unique to it.

Migration `20261027010000_product_discovery_catalog` creates the schema and
seeds the current Planet, Traveler, Family, and Blues of America examples.
Family and Blues of America reuse relevant global product rows from Planet,
exercising the cross-Commons structure from the first deployment.

## From candidate to Group Buy

Platform admins review candidates on **Product ideas** in Vendor outreach (`/portal/admin/outreach`). Approving an item marks the product `VERIFIED` and the match `APPROVED`; it doesn't feature it on the homepage. An approved item for a profile linked to a Commons (`coopId`) can start a seller search, can be named in Sage's weekly deal question, and can prefill a Group Buy. Each uses the one price rule in `suggestItemOfferPrice` (`packages/validators/src/marketplace-offers.ts`): the vendor gets the bulk price, members pay that plus a share of the discount (default 20%) and Stripe's fee, cheap items come in packs, and items where card fees eat the savings aren't asked about. Cahootz never buys the stock itself. See "Items from the product discovery bot" in `docs/vendor-outreach-plan.md`.
