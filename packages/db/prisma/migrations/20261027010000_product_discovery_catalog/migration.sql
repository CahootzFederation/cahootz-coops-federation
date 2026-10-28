CREATE TYPE "public"."SourcedProductStatus" AS ENUM ('CANDIDATE', 'VERIFIED', 'REJECTED', 'STALE');
CREATE TYPE "public"."CommonsProductMatchStatus" AS ENUM ('CANDIDATE', 'APPROVED', 'REJECTED', 'PAUSED');
CREATE TYPE "public"."ProductDiscoveryRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED');

CREATE TABLE "public"."CommonsProductProfile" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "coopId" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "participantLabel" TEXT NOT NULL,
  "searchPrompt" TEXT NOT NULL,
  "searchTerms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "excludedTerms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "isEnabled" BOOLEAN NOT NULL DEFAULT true,
  "isHomepageVisible" BOOLEAN NOT NULL DEFAULT false,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "discoveryIntervalHours" INTEGER NOT NULL DEFAULT 168,
  "monthlyRunLimit" INTEGER NOT NULL DEFAULT 5,
  "maxCandidatesPerRun" INTEGER NOT NULL DEFAULT 4,
  "lastDiscoveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommonsProductProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."SourcedProduct" (
  "id" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "brand" TEXT NOT NULL,
  "supplierName" TEXT NOT NULL,
  "imageUrl" TEXT,
  "imageAlt" TEXT,
  "status" "public"."SourcedProductStatus" NOT NULL DEFAULT 'CANDIDATE',
  "lastVerifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SourcedProduct_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."ProductDiscoveryRun" (
  "id" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" "public"."ProductDiscoveryRunStatus" NOT NULL DEFAULT 'RUNNING',
  "trigger" TEXT NOT NULL,
  "model" TEXT,
  "query" TEXT NOT NULL,
  "candidateCount" INTEGER NOT NULL DEFAULT 0,
  "savedProductCount" INTEGER NOT NULL DEFAULT 0,
  "savedMatchCount" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductDiscoveryRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."CommonsProductMatch" (
  "profileId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "status" "public"."CommonsProductMatchStatus" NOT NULL DEFAULT 'CANDIDATE',
  "fitScore" INTEGER NOT NULL,
  "fitReason" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "tone" TEXT NOT NULL DEFAULT 'mint',
  "isHomepageFeatured" BOOLEAN NOT NULL DEFAULT false,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "discoveredByRunId" TEXT,
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommonsProductMatch_pkey" PRIMARY KEY ("profileId", "productId")
);

CREATE TABLE "public"."ProductPriceObservation" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "discoveryRunId" TEXT,
  "sourceUrl" TEXT NOT NULL,
  "comparisonUrl" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "memberShare" TEXT NOT NULL,
  "peopleNeeded" INTEGER NOT NULL,
  "regularPriceCents" INTEGER NOT NULL,
  "bulkShareCents" INTEGER NOT NULL,
  "verifiedFacts" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "risksOrUnverifiedClaims" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "evidenceHash" TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  CONSTRAINT "ProductPriceObservation_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "public"."CommonsProductProfile"
  ADD CONSTRAINT "CommonsProductProfile_discoveryIntervalHours_check" CHECK ("discoveryIntervalHours" > 0),
  ADD CONSTRAINT "CommonsProductProfile_monthlyRunLimit_check" CHECK ("monthlyRunLimit" >= 0),
  ADD CONSTRAINT "CommonsProductProfile_maxCandidatesPerRun_check" CHECK ("maxCandidatesPerRun" BETWEEN 1 AND 8);
ALTER TABLE "public"."CommonsProductMatch"
  ADD CONSTRAINT "CommonsProductMatch_fitScore_check" CHECK ("fitScore" BETWEEN 0 AND 100),
  ADD CONSTRAINT "CommonsProductMatch_tone_check" CHECK ("tone" IN ('pear', 'sky', 'mint', 'coral', 'lavender'));
ALTER TABLE "public"."SourcedProduct"
  ADD CONSTRAINT "SourcedProduct_sourceKey_check" CHECK ("sourceKey" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "SourcedProduct_sourceUrl_check" CHECK ("sourceUrl" ~ '^https?://');
ALTER TABLE "public"."ProductPriceObservation"
  ADD CONSTRAINT "ProductPriceObservation_peopleNeeded_check" CHECK ("peopleNeeded" >= 2),
  ADD CONSTRAINT "ProductPriceObservation_regularPriceCents_check" CHECK ("regularPriceCents" > 0),
  ADD CONSTRAINT "ProductPriceObservation_bulkShareCents_check" CHECK ("bulkShareCents" > 0 AND "bulkShareCents" < "regularPriceCents"),
  ADD CONSTRAINT "ProductPriceObservation_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');

CREATE UNIQUE INDEX "CommonsProductProfile_key_key" ON "public"."CommonsProductProfile"("key");
CREATE INDEX "CommonsProductProfile_coopId_idx" ON "public"."CommonsProductProfile"("coopId");
CREATE INDEX "CommonsProductProfile_isEnabled_displayOrder_idx" ON "public"."CommonsProductProfile"("isEnabled", "displayOrder");
CREATE INDEX "CommonsProductProfile_isHomepageVisible_displayOrder_idx" ON "public"."CommonsProductProfile"("isHomepageVisible", "displayOrder");

CREATE UNIQUE INDEX "SourcedProduct_sourceKey_key" ON "public"."SourcedProduct"("sourceKey");
CREATE INDEX "SourcedProduct_status_updatedAt_idx" ON "public"."SourcedProduct"("status", "updatedAt");
CREATE INDEX "SourcedProduct_category_idx" ON "public"."SourcedProduct"("category");

CREATE UNIQUE INDEX "ProductDiscoveryRun_idempotencyKey_key" ON "public"."ProductDiscoveryRun"("idempotencyKey");
CREATE INDEX "ProductDiscoveryRun_profileId_startedAt_idx" ON "public"."ProductDiscoveryRun"("profileId", "startedAt");
CREATE INDEX "ProductDiscoveryRun_status_startedAt_idx" ON "public"."ProductDiscoveryRun"("status", "startedAt");

CREATE INDEX "CommonsProductMatch_profileId_status_displayOrder_idx" ON "public"."CommonsProductMatch"("profileId", "status", "displayOrder");
CREATE INDEX "CommonsProductMatch_productId_status_idx" ON "public"."CommonsProductMatch"("productId", "status");
CREATE INDEX "CommonsProductMatch_discoveredByRunId_idx" ON "public"."CommonsProductMatch"("discoveredByRunId");

CREATE UNIQUE INDEX "ProductPriceObservation_productId_evidenceHash_key" ON "public"."ProductPriceObservation"("productId", "evidenceHash");
CREATE INDEX "ProductPriceObservation_productId_observedAt_idx" ON "public"."ProductPriceObservation"("productId", "observedAt");
CREATE INDEX "ProductPriceObservation_discoveryRunId_idx" ON "public"."ProductPriceObservation"("discoveryRunId");
CREATE INDEX "ProductPriceObservation_expiresAt_idx" ON "public"."ProductPriceObservation"("expiresAt");

ALTER TABLE "public"."ProductDiscoveryRun"
  ADD CONSTRAINT "ProductDiscoveryRun_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES "public"."CommonsProductProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."CommonsProductMatch"
  ADD CONSTRAINT "CommonsProductMatch_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES "public"."CommonsProductProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."CommonsProductMatch"
  ADD CONSTRAINT "CommonsProductMatch_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "public"."SourcedProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."CommonsProductMatch"
  ADD CONSTRAINT "CommonsProductMatch_discoveredByRunId_fkey"
  FOREIGN KEY ("discoveredByRunId") REFERENCES "public"."ProductDiscoveryRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."ProductPriceObservation"
  ADD CONSTRAINT "ProductPriceObservation_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "public"."SourcedProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."ProductPriceObservation"
  ADD CONSTRAINT "ProductPriceObservation_discoveryRunId_fkey"
  FOREIGN KEY ("discoveryRunId") REFERENCES "public"."ProductDiscoveryRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- These four examples back the current public experiment. A future live
-- Commons can set coopId while keeping the same sourcing and review workflow.
INSERT INTO "public"."CommonsProductProfile" (
  "id", "key", "name", "description", "participantLabel", "searchPrompt",
  "searchTerms", "excludedTerms", "isEnabled", "isHomepageVisible",
  "displayOrder", "updatedAt"
) VALUES
  (
    'product-profile-planet',
    'planet',
    'Planet Commons',
    'Lower-waste, reusable, compostable, and responsibly made essentials for people protecting the planet.',
    'households',
    'Find practical lower-waste, fair-trade, reusable, or environmentally preferable household staples with public bulk pricing.',
    ARRAY['lower-waste', 'recycled', 'reusable', 'compostable', 'fair trade', 'household staple'],
    ARRAY['single-use novelty', 'political merchandise'],
    true,
    true,
    10,
    CURRENT_TIMESTAMP
  ),
  (
    'product-profile-traveler',
    'traveler',
    'Traveler Commons',
    'Useful trip essentials that frequent travelers can order by the case and divide among members.',
    'travelers',
    'Find compact, useful travel essentials with a clear wholesale case quantity and public comparison price.',
    ARRAY['travel', 'toiletries', 'packing', 'personal safety', 'portable', 'rechargeable'],
    ARRAY['luxury luggage', 'restricted item', 'single-use novelty'],
    true,
    true,
    20,
    CURRENT_TIMESTAMP
  ),
  (
    'product-profile-family',
    'family',
    'Family Commons',
    'Repeat household staples that families can plan for, purchase together, and keep stocked.',
    'households',
    'Find repeat-purchase family and household staples with transparent public bulk pricing and practical case sizes.',
    ARRAY['family', 'household', 'laundry', 'pantry', 'paper goods', 'recurring essential'],
    ARRAY['age-restricted', 'hazardous', 'single-use novelty'],
    true,
    true,
    30,
    CURRENT_TIMESTAMP
  ),
  (
    'product-profile-blues',
    'blues-of-america',
    'Blues of America',
    'Everyday products selected around fair labor, climate responsibility, and shared community benefit.',
    'members',
    'Find practical products from suppliers with publicly verifiable fair-trade, union-made, recycled, low-waste, civil-rights, or community-giving practices and clear bulk pricing.',
    ARRAY['fair trade', 'union made', 'recycled', 'low-waste', 'civil rights', 'community benefit'],
    ARRAY['campaign merchandise', 'unverified political claim', 'single-use novelty'],
    true,
    true,
    40,
    CURRENT_TIMESTAMP
  );

INSERT INTO "public"."SourcedProduct" (
  "id", "sourceKey", "sourceUrl", "name", "description", "category", "brand",
  "supplierName", "imageUrl", "imageAlt", "status", "lastVerifiedAt", "updatedAt"
) VALUES
  (
    'sourced-product-laundry-pods', '4b71698ccbef645301f14215b4e3ff2d4894c6779bb9b04cf13556e876ffffea',
    'https://www.dropps.com/products/laundry-pods-bulk', 'Laundry pods',
    'Plastic-free packaging and a product households buy repeatedly.', 'Laundry', 'Dropps', 'Dropps',
    'https://cdn.shopify.com/s/files/1/0268/4219/files/Dropps_64ctHero_FreeClear_Unscented.png?v=1762457052',
    'Dropps Free + Clear laundry pods in a 64-count box', 'VERIFIED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'sourced-product-organic-coffee', '7a9e8cad88bab2454bd1d54804a2bcae839ddf2fdc666025a1054bf853bda0e4',
    'https://www.jocoffee.com/wholesale-ordering.html', 'Organic Fair Trade coffee',
    'USDA Organic and Fair Trade coffee bought as six six-bag cases.', 'Pantry', 'Jo Coffee', 'Jo Coffee',
    'https://m.media-amazon.com/images/I/81ZQntx5zAL._SL1500_.jpg',
    'Jo Coffee Colombia Jo organic Fair Trade coffee bag', 'VERIFIED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'sourced-product-countertop-bags', 'cfee791ecf477d303106b107eeed11c8d2df652c010ae01967b238ed33897b3d',
    'https://greenpaperproducts.com/products/compostable-trash-bags-kitchen-g100', 'Countertop compost bags',
    'Certified compostable liners for participating compost programs.', 'Composting', 'EcoSafe', 'Green Paper Products',
    'https://depot.wastecontrolservices.com/cdn/shop/files/CP1617_individualbox.jpg?v=1752519980&width=1445',
    'EcoSafe compostable countertop bags box', 'VERIFIED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'sourced-product-shampoo-bar', '993f9f6c37beed7a1f9a6c65f35fef301f2d61a24282ef285146b8b7998517fb',
    'https://www.mysoapy.com/product/wholesale-solid-shampoo-bars-re-seller-10-pack/', 'Solid shampoo bar',
    'A concentrated hair-care bar sold in a low-commitment ten-bar reseller pack.', 'Hair care', 'SOAPY', 'SOAPY',
    'https://www.mysoapy.com/wp-content/uploads/2025/02/shampoo-bars-variation-bulk-400x400.png',
    'Assorted SOAPY solid shampoo bars in a wholesale pack', 'VERIFIED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'sourced-product-paper-towels', '87edee1295f2883b7205ada297001e1ec519c7908587f2bfc69f6b84551b2e85',
    'https://us.wholesale.whogivesacrap.org/products/recycled-paper-towels-12-rolls', 'Recycled paper towels',
    'Paper towels made from recycled paper rather than virgin trees.', 'Paper goods', 'Who Gives A Crap', 'Who Gives A Crap',
    'https://ca.whogivesacrap.org/cdn/shop/files/12pk_e4dc2afb-615e-4bac-b4a0-07ba943d30e5.jpg?v=1781079508&width=957',
    'Box of twelve Who Gives A Crap recycled paper towel rolls', 'VERIFIED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'sourced-product-vegan-soap', '2b062bb78f066cfaf6191787e0e42cf4b07eb600827685ddb29bb18cc9ec3e18',
    'https://www.hippotanicals.com/products/vegan-soap-bars-case-of-6', 'Vegan soap bar',
    'A vegan, palm-oil-free everyday soap sold in a six-bar case.', 'Bath', 'Hippotanicals', 'Hippotanicals',
    'https://www.hippotanicals.com/cdn/shop/files/HerbalRefreshSoapTrio_1024x1024.png?v=1738559393',
    'Three packaged Hippotanicals plant-based soap bars', 'VERIFIED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'sourced-product-dryer-balls', '97975bc3a4a8da3fd1c5058ac426f2bb67c04e76ad88cf76ca37564f6557ace4',
    'https://www.bulkapothecary.com/wool-dryer-balls-6-pack/', 'Wool dryer balls',
    'A reusable alternative to disposable dryer sheets, sold by the case.', 'Reusable home', 'Bulk Apothecary', 'Bulk Apothecary',
    'https://cdn11.bigcommerce.com/s-99si0d/images/stencil/400x400/products/9176/53959/wool_dryer_balls_1__81251.1760725246.jpg?c=2',
    'Six wool dryer balls with a cotton storage bag', 'VERIFIED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'sourced-product-toilet-paper', '169de47de7425444baa259fea5aa09ffbcbc6627a90067ef1f3bfdd9affb364e',
    'https://us.wholesale.whogivesacrap.org/products/100-recycled-toilet-paper-48-super-long-rolls-copy', 'Recycled toilet paper',
    'A recurring household essential made from recycled paper.', 'Paper goods', 'Who Gives A Crap', 'Who Gives A Crap',
    'https://missv.com.au/wp-content/uploads/2020/05/WGAC_ProductPhotos_2018Packaging_TransparentBG_DL48Pack_1024x1024.png',
    'Box of individually wrapped recycled toilet paper rolls', 'VERIFIED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'sourced-product-travel-laundry-bags', 'b3870c010c6ee6bef96469e9607d7709f415d8aea46f859a089c04e081eb6c67',
    'https://www.dollardays.com/i2384895-wholesale-travel-laundry-bags-3-pack-assorted-colors.html', 'Travel laundry bags',
    'A compact way to separate clean and worn clothes, supplied in a 48-unit case.', 'Organization', 'DollarDays', 'DollarDays',
    'https://dm61q01mhxuli.cloudfront.net/images/r56/image2/042125102128112.jpg',
    'Three assorted drawstring travel laundry bags', 'VERIFIED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'sourced-product-travel-toothbrush', '78ea468f5cf9c1c9b328ab118bd06b7f8faf076da18d3bad9438affc3be5ec69',
    'https://www.dollardays.com/i2133266-wholesale-travel-toothbrush-2-piece-100-count.html', 'Travel toothbrush',
    'An individually wrapped two-piece toothbrush supplied in a 100-unit case.', 'Toiletries', 'Unbranded', 'DollarDays',
    'https://dm61q01mhxuli.cloudfront.net/images/n25/image2/tbtravel100.jpg',
    'Blue and white two-piece travel toothbrush', 'VERIFIED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'sourced-product-personal-alarm', '00b405830601335fde1d57a3dc2b6df3989b59e09adc31664c6a6af38d9bbeab',
    'https://www.dollardays.com/i2389433-wholesale-mini-emergency-alarm-keychain-assorted.html', 'Personal safety alarm',
    'A 100-decibel keychain alarm with an LED light, supplied in a 24-unit case.', 'Travel safety', 'Mayday', 'DollarDays',
    'https://dm61q01mhxuli.cloudfront.net/images/d27/image2/122225023801987.jpg',
    'Assorted mini emergency alarm keychains with LED lights', 'VERIFIED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'sourced-product-water-fan', 'b7c14dc35fe1252ccf04240085b64f989a0c379df99064756461b49a0c8b692b',
    'https://www.dollardays.com/i2377336-wholesale-2-in-1-rechargeable-water-fans-assorted.html', 'Rechargeable misting fan',
    'A USB-C rechargeable hand fan with four speeds and a refillable misting tank.', 'Warm-weather travel', 'Modern Monkey', 'DollarDays',
    'https://dm61q01mhxuli.cloudfront.net/images/d27/image2/060524102709620.jpg',
    'Assorted handheld rechargeable fans with refillable water tanks', 'VERIFIED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'sourced-product-bluey-lunch-bag', '0e10a8a1941498078b08867745c620082f0703e6eecab3526633a204521d3be1',
    'https://www.4sgm.com/product/83901/Bluey-Insulated-Lunch-Box.html?language=en', 'Insulated kids lunch bag',
    'An insulated school lunch bag with published volume pricing.', 'School lunch', 'Bluey', '4SGM',
    'https://www.4sgm.com/assets/Image/Product/detailsbig/83901.jpg',
    'Bluey insulated children lunch bag', 'VERIFIED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'sourced-product-family-food-containers', '7e602f653c0ce958d28ebf77cf4dbe7da351a5d27bf74deb6cac746f0e90eef8',
    'https://www.4sgm.com/product/36176/Plastic-Food-Containers,-30-Piece-Set,-Reusable,-Blue-Lid,-BPA-Free.html?language=en', '30-piece food container set',
    'Reusable, stackable containers for leftovers, lunches, and meal prep.', 'Meal prep', '4SGM', '4SGM',
    'https://www.4sgm.com/assets/Image/Product/detailsbig/36176.jpg',
    'Thirty-piece reusable food container set with blue lids', 'VERIFIED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'sourced-product-union-printed-tote', 'c583a8c2b9da4cf3f13adc7d61ec695dc51a1d37248918c83363d143616f5902',
    'https://www.cameoline.com/details/tote-bags/2-003', 'Union-printed reusable tote',
    'A reusable tote decorated in a union shop, with the union bug available.', 'Fair labor', 'Cameo Line', 'Cameo Line',
    'https://storage.googleapis.com/live-server/items/1567/17182-003.jpg',
    'Union-shop printed reusable tote bag', 'VERIFIED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'sourced-product-fair-trade-chocolate', 'c51990ac32853f624757f598d87773f0e558740f979e9226e05bbb78e2b6bffa',
    'https://www.serrv.org/60-dark-with-toffee-sea-salt-large-bar-case/', 'Fair Trade chocolate bar',
    'Farmer-owned Fair Trade chocolate sold in a twelve-bar case.', 'Worker-owned supply chain', 'Divine Chocolate', 'SERRV',
    'https://www.divinechocolateusa.com/cdn/shop/files/div-004623-60_-dark-chocolate-with-toffee-sea-salt_1.png?v=1786051511&width=1080',
    'Divine Fair Trade dark chocolate with toffee and sea salt', 'VERIFIED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  );

INSERT INTO "public"."ProductPriceObservation" (
  "id", "productId", "sourceUrl", "comparisonUrl", "memberShare", "peopleNeeded",
  "regularPriceCents", "bulkShareCents", "verifiedFacts", "risksOrUnverifiedClaims",
  "evidenceHash", "observedAt"
) VALUES
  ('price-laundry-pods', 'sourced-product-laundry-pods', 'https://www.dropps.com/products/laundry-pods-bulk', NULL, '64 pods', 12, 2889, 1217, ARRAY['Public price captured for the homepage prototype.'], ARRAY['Supplier confirmation, wholesale eligibility, shipping, tax, and availability still require review.'], 'seed:2026-10-27:laundry-pods', TIMESTAMP '2026-10-27 00:00:00'),
  ('price-organic-coffee', 'sourced-product-organic-coffee', 'https://www.jocoffee.com/wholesale-ordering.html', NULL, '12 oz bag', 36, 1199, 694, ARRAY['Public price captured for the homepage prototype.'], ARRAY['Supplier confirmation, wholesale eligibility, shipping, tax, and availability still require review.'], 'seed:2026-10-27:organic-coffee', TIMESTAMP '2026-10-27 00:00:00'),
  ('price-countertop-bags', 'sourced-product-countertop-bags', 'https://greenpaperproducts.com/products/compostable-trash-bags-kitchen-g100', NULL, '60 bags', 12, 2354, 949, ARRAY['Public price captured for the homepage prototype.'], ARRAY['Supplier confirmation, wholesale eligibility, shipping, tax, and availability still require review.'], 'seed:2026-10-27:countertop-bags', TIMESTAMP '2026-10-27 00:00:00'),
  ('price-shampoo-bar', 'sourced-product-shampoo-bar', 'https://www.mysoapy.com/product/wholesale-solid-shampoo-bars-re-seller-10-pack/', NULL, '1 bar', 10, 1000, 700, ARRAY['Public price captured for the homepage prototype.'], ARRAY['Supplier confirmation, wholesale eligibility, shipping, tax, and availability still require review.'], 'seed:2026-10-27:shampoo-bar', TIMESTAMP '2026-10-27 00:00:00'),
  ('price-paper-towels', 'sourced-product-paper-towels', 'https://us.wholesale.whogivesacrap.org/products/recycled-paper-towels-12-rolls', NULL, '12 rolls', 13, 3900, 2730, ARRAY['Public price captured for the homepage prototype.'], ARRAY['Supplier confirmation, wholesale eligibility, shipping, tax, and availability still require review.'], 'seed:2026-10-27:paper-towels', TIMESTAMP '2026-10-27 00:00:00'),
  ('price-vegan-soap', 'sourced-product-vegan-soap', 'https://www.hippotanicals.com/products/vegan-soap-bars-case-of-6', NULL, '1 bar', 6, 800, 430, ARRAY['Public price captured for the homepage prototype.'], ARRAY['Supplier confirmation, wholesale eligibility, shipping, tax, and availability still require review.'], 'seed:2026-10-27:vegan-soap', TIMESTAMP '2026-10-27 00:00:00'),
  ('price-dryer-balls', 'sourced-product-dryer-balls', 'https://www.bulkapothecary.com/wool-dryer-balls-6-pack/', NULL, '6 balls', 55, 1490, 1000, ARRAY['Public price captured for the homepage prototype.'], ARRAY['Supplier confirmation, wholesale eligibility, shipping, tax, and availability still require review.'], 'seed:2026-10-27:dryer-balls', TIMESTAMP '2026-10-27 00:00:00'),
  ('price-toilet-paper', 'sourced-product-toilet-paper', 'https://us.wholesale.whogivesacrap.org/products/100-recycled-toilet-paper-48-super-long-rolls-copy', NULL, '12 rolls', 32, 1700, 1190, ARRAY['Public price captured for the homepage prototype.'], ARRAY['Supplier confirmation, wholesale eligibility, shipping, tax, and availability still require review.'], 'seed:2026-10-27:toilet-paper', TIMESTAMP '2026-10-27 00:00:00'),
  ('price-travel-laundry-bags', 'sourced-product-travel-laundry-bags', 'https://www.dollardays.com/i2384895-wholesale-travel-laundry-bags-3-pack-assorted-colors.html', 'https://www.relymedia.com/single-products/travel-laundry-bags-3-pack-assorted-colors-219043', '1 carded 3-pack', 48, 243, 143, ARRAY['Public bulk and comparison prices captured for the homepage prototype.'], ARRAY['Supplier confirmation, wholesale eligibility, shipping, tax, and availability still require review.'], 'seed:2026-10-27:travel-laundry-bags', TIMESTAMP '2026-10-27 00:00:00'),
  ('price-travel-toothbrush', 'sourced-product-travel-toothbrush', 'https://www.dollardays.com/i2133266-wholesale-travel-toothbrush-2-piece-100-count.html', 'https://www.4allpromos.com/taxonomy/term/742', '1 toothbrush', 100, 142, 57, ARRAY['Public bulk and comparison prices captured for the homepage prototype.'], ARRAY['Supplier confirmation, wholesale eligibility, shipping, tax, and availability still require review.'], 'seed:2026-10-27:travel-toothbrush', TIMESTAMP '2026-10-27 00:00:00'),
  ('price-personal-alarm', 'sourced-product-personal-alarm', 'https://www.dollardays.com/i2389433-wholesale-mini-emergency-alarm-keychain-assorted.html', 'https://americanbusneo.com/p/product/dce9f902-577a-41ac-a138-1d85e123edd3/mini-emergency-alarm-keychain-assorted', '1 alarm', 24, 928, 546, ARRAY['Public bulk and comparison prices captured for the homepage prototype.'], ARRAY['Supplier confirmation, wholesale eligibility, shipping, tax, and availability still require review.'], 'seed:2026-10-27:personal-alarm', TIMESTAMP '2026-10-27 00:00:00'),
  ('price-water-fan', 'sourced-product-water-fan', 'https://www.dollardays.com/i2377336-wholesale-2-in-1-rechargeable-water-fans-assorted.html', 'https://www.staples.com/Modern-Monkey-Handheld-General-Purpose-Fans/cat_CL80002/fcge8-p9t0b', '1 fan', 24, 1699, 1096, ARRAY['Public bulk and comparison prices captured for the homepage prototype.'], ARRAY['Supplier confirmation, wholesale eligibility, shipping, tax, and availability still require review.'], 'seed:2026-10-27:water-fan', TIMESTAMP '2026-10-27 00:00:00'),
  ('price-bluey-lunch-bag', 'sourced-product-bluey-lunch-bag', 'https://www.4sgm.com/product/83901/Bluey-Insulated-Lunch-Box.html?language=en', NULL, '1 insulated bag', 120, 530, 450, ARRAY['Supplier lists the item in stock, twelve units per case, and $4.50 per unit at ten or more cases.'], ARRAY['Wholesale account, freight, tax, inventory, and final licensing availability require confirmation.'], 'seed:2026-10-27:bluey-lunch-bag', TIMESTAMP '2026-10-27 00:00:00'),
  ('price-family-food-containers', 'sourced-product-family-food-containers', 'https://www.4sgm.com/product/36176/Plastic-Food-Containers,-30-Piece-Set,-Reusable,-Blue-Lid,-BPA-Free.html?language=en', NULL, '1 thirty-piece set', 6, 625, 525, ARRAY['Supplier lists the item in stock, six sets per case, and a published 16 percent promotional discount.'], ARRAY['Wholesale account, freight, tax, inventory, and promotion duration require confirmation.'], 'seed:2026-10-27:family-food-containers', TIMESTAMP '2026-10-27 00:00:00'),
  ('price-union-printed-tote', 'sourced-product-union-printed-tote', 'https://www.cameoline.com/details/tote-bags/2-003', NULL, '1 printed tote', 150, 235, 191, ARRAY['Supplier publishes $2.35 each at fifty units and $1.91 each at one hundred fifty units.', 'The product is decorated in a union shop and the union bug is available.'], ARRAY['Setup fees, artwork, freight, tax, inventory by color, and final order terms require confirmation.'], 'seed:2026-10-27:union-printed-tote', TIMESTAMP '2026-10-27 00:00:00'),
  ('price-fair-trade-chocolate', 'sourced-product-fair-trade-chocolate', 'https://www.serrv.org/60-dark-with-toffee-sea-salt-large-bar-case/', 'https://www.divinechocolateusa.com/collections/dark-chocolate/products/60-dark-chocolate-with-toffee-sea-salt-sharing-bar-3-oz', '1 three-ounce bar', 12, 729, 542, ARRAY['SERRV lists a twelve-bar case for $64.95.', 'Divine lists the individual three-ounce bar at $7.29 and states that its cocoa and sugar follow Fairtrade standards.'], ARRAY['Warm-weather surcharge, shipping, tax, allergens, inventory, and final supplier terms require confirmation.'], 'seed:2026-10-27:fair-trade-chocolate', TIMESTAMP '2026-10-27 00:00:00');

INSERT INTO "public"."CommonsProductMatch" (
  "profileId", "productId", "status", "fitScore", "fitReason", "purpose", "tone",
  "isHomepageFeatured", "displayOrder", "approvedBy", "approvedAt", "updatedAt"
) VALUES
  ('product-profile-planet', 'sourced-product-laundry-pods', 'APPROVED', 100, 'Initial reviewed homepage catalog.', 'Plastic-free packaging and a product households buy repeatedly.', 'pear', true, 10, 'migration:20261027010000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('product-profile-planet', 'sourced-product-organic-coffee', 'APPROVED', 100, 'Initial reviewed homepage catalog.', 'USDA Organic and Fair Trade coffee bought as six six-bag cases.', 'coral', true, 20, 'migration:20261027010000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('product-profile-planet', 'sourced-product-countertop-bags', 'APPROVED', 100, 'Initial reviewed homepage catalog.', 'Certified compostable liners for participating compost programs.', 'mint', true, 30, 'migration:20261027010000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('product-profile-planet', 'sourced-product-shampoo-bar', 'APPROVED', 100, 'Initial reviewed homepage catalog.', 'A concentrated hair-care bar sold in a low-commitment ten-bar reseller pack.', 'lavender', true, 40, 'migration:20261027010000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('product-profile-planet', 'sourced-product-paper-towels', 'APPROVED', 100, 'Initial reviewed homepage catalog.', 'Paper towels made from recycled paper rather than virgin trees.', 'lavender', true, 50, 'migration:20261027010000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('product-profile-planet', 'sourced-product-vegan-soap', 'APPROVED', 100, 'Initial reviewed homepage catalog.', 'A vegan, palm-oil-free everyday soap sold in a six-bar case.', 'mint', true, 60, 'migration:20261027010000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('product-profile-planet', 'sourced-product-dryer-balls', 'APPROVED', 100, 'Initial reviewed homepage catalog.', 'A reusable alternative to disposable dryer sheets, sold by the case.', 'sky', true, 70, 'migration:20261027010000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('product-profile-planet', 'sourced-product-toilet-paper', 'APPROVED', 100, 'Initial reviewed homepage catalog.', 'A recurring household essential made from recycled paper.', 'sky', true, 80, 'migration:20261027010000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('product-profile-traveler', 'sourced-product-travel-laundry-bags', 'APPROVED', 100, 'Initial reviewed homepage catalog.', 'A compact way to separate clean and worn clothes, supplied in a 48-unit case.', 'lavender', true, 10, 'migration:20261027010000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('product-profile-traveler', 'sourced-product-travel-toothbrush', 'APPROVED', 100, 'Initial reviewed homepage catalog.', 'An individually wrapped two-piece toothbrush supplied in a 100-unit case.', 'sky', true, 20, 'migration:20261027010000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('product-profile-traveler', 'sourced-product-personal-alarm', 'APPROVED', 100, 'Initial reviewed homepage catalog.', 'A 100-decibel keychain alarm with an LED light, supplied in a 24-unit case.', 'coral', true, 30, 'migration:20261027010000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('product-profile-traveler', 'sourced-product-water-fan', 'APPROVED', 100, 'Initial reviewed homepage catalog.', 'A USB-C rechargeable hand fan with four speeds and a refillable misting tank.', 'mint', true, 40, 'migration:20261027010000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('product-profile-family', 'sourced-product-bluey-lunch-bag', 'APPROVED', 100, 'Initial reviewed Family catalog.', 'A school-day essential with published volume pricing for ten cases.', 'sky', true, 10, 'migration:20261027010000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('product-profile-family', 'sourced-product-family-food-containers', 'APPROVED', 100, 'Initial reviewed Family catalog.', 'Reusable, stackable containers for leftovers, lunches, and family meal prep.', 'mint', true, 20, 'migration:20261027010000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('product-profile-family', 'sourced-product-laundry-pods', 'APPROVED', 100, 'Verified product reused across Commons.', 'A repeat household staple families can plan and divide together.', 'pear', true, 30, 'migration:20261027010000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('product-profile-family', 'sourced-product-toilet-paper', 'APPROVED', 100, 'Verified product reused across Commons.', 'A recurring household essential families can keep stocked.', 'sky', true, 40, 'migration:20261027010000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('product-profile-blues', 'sourced-product-union-printed-tote', 'APPROVED', 100, 'Initial reviewed values-aligned catalog.', 'A reusable tote decorated in a union shop, with the union bug available.', 'sky', true, 10, 'migration:20261027010000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('product-profile-blues', 'sourced-product-fair-trade-chocolate', 'APPROVED', 100, 'Initial reviewed values-aligned catalog.', 'Farmer-owned Fair Trade chocolate whose premiums support cocoa-growing communities.', 'coral', true, 20, 'migration:20261027010000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('product-profile-blues', 'sourced-product-organic-coffee', 'APPROVED', 100, 'Verified values-aligned product reused across Commons.', 'A Fair Trade pantry staple that connects repeat spending to better labor standards.', 'coral', true, 30, 'migration:20261027010000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('product-profile-blues', 'sourced-product-paper-towels', 'APPROVED', 100, 'Verified values-aligned product reused across Commons.', 'A recycled household staple for members prioritizing climate-conscious purchasing.', 'lavender', true, 40, 'migration:20261027010000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
