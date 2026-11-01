-- The four built-in product profiles (Planet, Traveler, Family, Blues of
-- America) become real, private Commons so their product ideas have members to
-- go to. Each one is linked to its profile. A Commons that already has one of
-- these names is linked instead of duplicated, so this is safe to re-run.

CREATE TEMP TABLE "_profile_commons" (
  "profileKey" TEXT,
  "coopId" TEXT,
  "name" TEXT,
  "tagline" TEXT,
  "mission" TEXT,
  "emoji" TEXT,
  "goals" JSONB
);

INSERT INTO "_profile_commons" VALUES
  (
    'planet', 'planet-commons', 'Planet Commons',
    'Less waste, bought together.',
    'We buy lower-waste, reusable and responsibly made everyday things together, so doing right by the planet costs less.',
    '🌱',
    '[{"key":"lower_waste","label":"Lower waste","priorityWeight":0.4,"description":"Buy reusable, refillable, compostable or recycled things in place of throwaway ones."},{"key":"fair_sourcing","label":"Fair sourcing","priorityWeight":0.3,"description":"Choose suppliers who treat workers fairly and say how things are made."},{"key":"shared_savings","label":"Shared savings","priorityWeight":0.3,"description":"Buy in bulk together so members pay less than they would alone."}]'::jsonb
  ),
  (
    'traveler', 'traveler-commons', 'Traveler Commons',
    'Trip essentials by the case.',
    'We order useful travel essentials by the case and split them, so frequent travelers pay less and pack better.',
    '🧳',
    '[{"key":"useful_on_the_road","label":"Useful on the road","priorityWeight":0.4,"description":"Things travelers actually use: toiletries, packing, charging and staying safe."},{"key":"shared_savings","label":"Shared savings","priorityWeight":0.35,"description":"Buy by the case together so each member pays less."},{"key":"travel_light","label":"Travel light","priorityWeight":0.25,"description":"Prefer compact, reusable and rechargeable things over bulky or single-use ones."}]'::jsonb
  ),
  (
    'family', 'family-commons', 'Family Commons',
    'Household staples, stocked together.',
    'We plan for the household staples families use every week and buy them together, so the money stays with our families.',
    '🏡',
    '[{"key":"stay_stocked","label":"Stay stocked","priorityWeight":0.4,"description":"Keep the things families use every week on hand: pantry, paper goods, laundry and cleaning."},{"key":"shared_savings","label":"Shared savings","priorityWeight":0.35,"description":"Buy in bulk together so each household pays less."},{"key":"safe_for_homes","label":"Safe for homes","priorityWeight":0.25,"description":"Skip anything hazardous or age-restricted."}]'::jsonb
  ),
  (
    'blues-of-america', 'blues-of-america', 'Blues of America',
    'Everyday goods from fair-dealing makers.',
    'We buy everyday products together from suppliers with fair labor, climate responsibility and community benefit we can check.',
    '💙',
    '[{"key":"fair_labor","label":"Fair labor","priorityWeight":0.35,"description":"Favor union-made and fair-trade suppliers whose claims can be checked."},{"key":"climate_responsibility","label":"Climate responsibility","priorityWeight":0.3,"description":"Favor recycled, low-waste and lower-impact products."},{"key":"community_benefit","label":"Community benefit","priorityWeight":0.35,"description":"Favor suppliers that give back to communities and civil-rights causes, and buy together so members pay less."}]'::jsonb
  );

INSERT INTO "public"."CoopConfig" (
  "id", "coopId", "version", "isActive", "name", "slug", "tagline", "description",
  "displayMission", "iconEmoji", "displayOrder", "isPrivate", "joinPolicy",
  "applicationQuestions", "charterText", "missionGoals", "structuralWeights", "scoreMix",
  "proposalCategories", "sectorExclusions", "createdBy", "updatedAt"
)
SELECT
  'coop-config-' || pc."coopId", pc."coopId", 1, true, pc."name", pc."coopId", pc."tagline", p."description",
  pc."mission", pc."emoji", 999, true, 'APPLICATION_REQUIRED',
  '[]'::jsonb,
  '# ' || pc."name" || ' Starter Charter' || E'\n'
    || 'Status: Platform-generated purpose statement. Members may replace this through the Commons'' charter process.' || E'\n\n'
    || '## Purpose' || E'\n' || pc."mission" || E'\n\n'
    || '## Stated goals' || E'\n'
    || (SELECT string_agg('- ' || (g->>'label') || ': ' || (g->>'description'), E'\n') FROM jsonb_array_elements(pc."goals") g)
    || E'\n\n' || 'This starter charter states purpose and goals only. It does not establish voting, financial, membership, or disciplinary rules.',
  pc."goals",
  '{"feasibility":0.4,"risk":0.35,"accountability":0.25}'::jsonb,
  '{"missionWeight":0.6,"structuralWeight":0.4}'::jsonb,
  '[{"key":"procurement","label":"Group buying","isActive":true,"description":"Buying things together in bulk so members pay less."},{"key":"governance","label":"Rules and how we decide","isActive":true},{"key":"other","label":"Other","isActive":true}]'::jsonb,
  '[]'::jsonb,
  'platform:product-profiles',
  CURRENT_TIMESTAMP
FROM "_profile_commons" pc
JOIN "public"."CommonsProductProfile" p ON p."key" = pc."profileKey"
WHERE p."coopId" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "public"."CoopConfig" c WHERE c."coopId" = pc."coopId")
  AND NOT EXISTS (
    SELECT 1 FROM "public"."CoopConfig" c
    WHERE c."isActive" AND lower(trim(c."name")) = lower(pc."name")
  );

-- Link each profile to the active Commons with its name (new or already there).
UPDATE "public"."CommonsProductProfile" p
SET "coopId" = c."coopId", "updatedAt" = CURRENT_TIMESTAMP
FROM "_profile_commons" pc
JOIN "public"."CoopConfig" c ON c."isActive" AND lower(trim(c."name")) = lower(pc."name")
WHERE p."key" = pc."profileKey" AND p."coopId" IS NULL;

-- Deon (deon@appmunki.com) stewards the four new Commons. Skipped where that
-- account doesn't exist, such as local and test databases.
INSERT INTO "public"."UserCoopMembership" (
  "id", "userId", "coopId", "status", "roles", "approvedBy", "approvedAt", "joinedAt", "lastActiveAt", "updatedAt"
)
SELECT
  'membership-' || pc."coopId" || '-' || u."id", u."id", pc."coopId", 'ACTIVE', ARRAY['member', 'steward'],
  u."id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "_profile_commons" pc
JOIN "public"."CoopConfig" c ON c."coopId" = pc."coopId" AND c."id" = 'coop-config-' || pc."coopId"
JOIN "public"."User" u ON lower(u."email") = 'deon@appmunki.com'
ON CONFLICT ("userId", "coopId") DO UPDATE
SET "status" = 'ACTIVE', "roles" = ARRAY['member', 'steward'], "updatedAt" = CURRENT_TIMESTAMP;

DROP TABLE "_profile_commons";
