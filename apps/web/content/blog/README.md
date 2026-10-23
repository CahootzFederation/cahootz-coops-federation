# Publishing from pull requests and Notion

Both sources appear on `/blog`, in related posts, the sitemap, and article metadata.

## Pull-request articles

Add a typed `BlogPost` in this folder and register it in `index.ts`. Set `source: "pr"`, a unique permanent slug, author, publication date, and an explicit ISO `submittedAt` timestamp with timezone. Keep `submittedAt` unchanged when editing; use `updatedAt` for revisions. Store images in `public/blog/editorial/` and reference `/blog/editorial/...`.

These files and images are owned by Git. Notion sync never writes them. Article blocks may contain trusted HTML; review links and markup in the PR. Do not import untrusted HTML here.

## Notion articles

Keep publishing through the existing Notion database. Sync writes only `lib/blog.generated.ts` and content-addressed downloaded files directly in `public/blog/`. Do not edit the generated file by hand.

An optional Notion date or created-time property named **Submitted At** or **Submission Date** sets the submission timestamp. Without it, the Notion page's `created_time` is used, never its last-edited time or the sync time. Set that property once to the actual submission date if page creation and submission differ. Existing checked-in snapshots without `submittedAt` fall back to `publishedAt` until their next sync. Publication and modification dates remain separate in article metadata.

The combined list sorts by submission timestamp, newest first, with slug as a stable tie-breaker. Featured homepage selections still honor the existing featured flag. Dates displayed on cards and article headers use submission dates.

Duplicate slugs, including collisions between sources, fail validation instead of allowing one source to replace another. Resolve the conflicting slug in its original source. Sync validates the combined collection before atomically replacing its generated snapshot. Unpublishing a Notion article removes only that Notion article on the next sync.

## Sage handbook

`cahootz-handbook.ts` is credited to Sage, with an explicit AI-helper disclosure. Its hero is an AI-generated conceptual illustration, not a product screenshot. The article links its community-management sources in context and labels examples as illustrative.

## Checks

Run `pnpm -F @cahootz/web test --runInBand lib/blog-sources.test.ts lib/notion-blog-blocks.test.ts app/blog`.
The public UI journey is documented in the repository's `TESTING.md`.
