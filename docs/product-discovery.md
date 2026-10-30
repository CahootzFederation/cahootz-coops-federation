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
