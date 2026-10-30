-- The first two group deals: Cahootz does the work, so there's no outside
-- vendor to pay. Both are open to every Commons and repeat on their own: a
-- fresh copy goes up as soon as 20 commit, or when 30 days pass without 20.

INSERT INTO "MarketplaceOffer" (
  "id", "offerType", "coopId", "vendorName", "title", "description",
  "regularPriceCents", "regularPriceSource", "memberPriceCents", "vendorPayoutCents", "commonsSplitBps",
  "minimumCommitments", "minimumPaidOrders", "quantityPerMember",
  "commitmentDeadline", "paymentWindowHours", "fulfillmentMethod",
  "redemptionRules", "refundPolicy", "terms",
  "status", "createdById", "publishedAt", "repeats", "roundDays", "updatedAt"
) VALUES (
  'cahootz-tech-help-r1', 'GROUP_BUY', NULL, 'Cahootz', 'Tech help for your business',
  'Get hands-on help with the tech side of your business: your email, website, online payments, social media, Google listing, spreadsheets, or a computer that''s acting up. Pick how many hours you want. You pay $30 an hour instead of $50.',
  5000, 'Cahootz''s regular hourly rate', 3000, 0, 5000,
  20, 1, 10,
  NOW() + INTERVAL '30 days', 48, 'SERVICE',
  'Once your card is charged, we''ll text or email you to book your first session. Sessions are by phone or video call.',
  'If we can''t get your hours scheduled, we''ll refund the hours you didn''t use.',
  NULL,
  'LIVE', 'system:starter-deals', NOW(), true, 30, NOW()
), (
  'cahootz-website-r1', 'GROUP_BUY', NULL, 'Cahootz', 'A free website for your business',
  'We build your business a website for free. You just pay $30 a month to keep it online and up to date, instead of $50.',
  5000, 'Cahootz''s regular monthly price', 3000, 0, 5000,
  20, 1, 1,
  NOW() + INTERVAL '30 days', 48, 'SERVICE',
  'Once your card is charged, we''ll reach out to learn about your business and start building.',
  'If we haven''t started your website yet, you can get a full refund.',
  'This deal pays for your first month. After that it''s $30 a month, and we''ll set that up with you directly. You can stop any time.',
  'LIVE', 'system:starter-deals', NOW(), true, 30, NOW()
)
ON CONFLICT ("id") DO NOTHING;
