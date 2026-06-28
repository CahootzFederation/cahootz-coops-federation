/**
 * Fill the hidden demo co-op with realistic fixture data for local testing,
 * App Store review, and guided demos.
 *
 * The script is intentionally repeatable: it deletes only deterministic demo
 * fixture records for coopId "demo", then recreates the same data set.
 */
import * as PrismaClientModule from "@prisma/client";

const PrismaClient =
  (PrismaClientModule as any).PrismaClient ?? (PrismaClientModule as any).default.PrismaClient;

const prisma = new PrismaClient();

const DEMO_COOP_ID = "demo";
const DEMO_LOGIN_EMAIL = "demo@cahootz.coop";
const DEMO_LOGIN_CODE = "000000";
const DEMO_WALLET_ADDRESS = "0x000000000000000000000000000000000000dE10";
const SEED_TAG = "demo-full-fixture-v1";

const demoUsers = [
  {
    key: "reviewer",
    email: DEMO_LOGIN_EMAIL,
    name: "Cahootz Demo Member",
    roles: ["member", "admin"],
    walletAddress: DEMO_WALLET_ADDRESS,
    balance: 2480,
  },
  {
    key: "maya",
    email: "demo+maya@cahootz.coop",
    name: "Maya Green",
    roles: ["member"],
    walletAddress: "0x0000000000000000000000000000000000000A11",
    balance: 620,
  },
  {
    key: "jordan",
    email: "demo+jordan@cahootz.coop",
    name: "Jordan Lee",
    roles: ["member", "business"],
    walletAddress: "0x0000000000000000000000000000000000000B12",
    balance: 1180,
  },
  {
    key: "nina",
    email: "demo+nina@cahootz.coop",
    name: "Nina Patel",
    roles: ["member", "business"],
    walletAddress: "0x0000000000000000000000000000000000000C13",
    balance: 940,
  },
  {
    key: "omar",
    email: "demo+omar@cahootz.coop",
    name: "Omar Williams",
    roles: ["member", "governor"],
    walletAddress: "0x0000000000000000000000000000000000000D14",
    balance: 1515,
  },
  {
    key: "avery",
    email: "demo+avery@cahootz.coop",
    name: "Avery Chen",
    roles: ["member"],
    walletAddress: "0x0000000000000000000000000000000000000E15",
    balance: 310,
  },
  {
    key: "rosa",
    email: "demo+rosa@cahootz.coop",
    name: "Rosa Martinez",
    roles: ["member", "governor"],
    walletAddress: "0x0000000000000000000000000000000000000F16",
    balance: 1740,
  },
];

const demoBusinesses = [
  {
    key: "harvest",
    ownerKey: "jordan",
    name: "Harvest Table Market",
    city: "Atlanta",
    category: "FOOD_BEVERAGE",
    productCategory: "FOOD",
    shortCode: "HARVEST",
    description: "Fresh grocery boxes, pantry staples, and prepared food from member-owned vendors.",
    imageUrl: "https://images.unsplash.com/photo-1542838132-92c53300491e?w=800",
    bannerUrl: "https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=1200",
    address: "204 Auburn Ave NE",
    products: [
      ["Seasonal Produce Box", 34, 20, "A rotating box of local vegetables, herbs, and fruit."],
      ["Community Pantry Bundle", 58, 14, "Rice, beans, flour, oil, and staple goods for a family kitchen."],
      ["Prepared Lunch Pack", 16.5, 45, "A ready-to-eat lunch with grain bowl, fruit, and tea."],
    ],
  },
  {
    key: "repair",
    ownerKey: "nina",
    name: "NeighborTech Repair",
    city: "Decatur",
    category: "TECH_ELECTRONICS",
    productCategory: "SERVICES",
    shortCode: "NTECH",
    description: "Device repair, refurbished equipment, and low-cost technical support.",
    imageUrl: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=800",
    bannerUrl: "https://images.unsplash.com/photo-1518770660439-4636190af475?w=1200",
    address: "88 Commerce Dr",
    products: [
      ["Phone Screen Repair", 89, 12, "Same-day glass replacement for common phone models."],
      ["Refurbished Tablet", 145, 8, "A tested tablet with charger and 90-day support."],
      ["Home Wi-Fi Tuneup", 55, 20, "Router placement, speed checks, and device setup support."],
    ],
  },
  {
    key: "studio",
    ownerKey: "maya",
    name: "Unity Print Studio",
    city: "East Point",
    category: "ARTS_CRAFTS",
    productCategory: "ART",
    shortCode: "UPRINT",
    description: "Member-made prints, campaign materials, and event merchandise.",
    imageUrl: "https://images.unsplash.com/photo-1513475382585-d06e58bcb0e0?w=800",
    bannerUrl: "https://images.unsplash.com/photo-1452860606245-08befc0ff44b?w=1200",
    address: "17 Main St",
    products: [
      ["Event Poster Pack", 28, 50, "Ten full-color posters for co-op events or campaigns."],
      ["Custom Tote Bag", 22, 40, "Canvas tote with a one-color member design."],
      ["Workshop Ticket", 18, 60, "Admission to a hands-on printmaking workshop."],
    ],
  },
];

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function demoTxHash(index: number) {
  return `0x${index.toString(16).padStart(64, "0")}`;
}

async function ensureDemoCoop() {
  await prisma.coopConfig.upsert({
    where: { coopId_version: { coopId: DEMO_COOP_ID, version: 1 } },
    update: {
      isActive: true,
      isDemo: true,
      name: "Cahootz Demo Co-op",
      slug: "cahootz-demo",
      tagline: "A safe sandbox for exploring Cahootz",
      displayOrder: 9999,
    },
    create: {
      coopId: DEMO_COOP_ID,
      version: 1,
      isActive: true,
      isDemo: true,
      name: "Cahootz Demo Co-op",
      slug: "cahootz-demo",
      tagline: "A safe sandbox for exploring Cahootz",
      description: "A hidden demo workspace with sample data for reviewers and guided demos.",
      displayMission: "Explore member commerce, governance, payments, and treasury activity.",
      displayFeatures: [],
      eligibility: "Demo access only.",
      bgColor: "bg-slate-800",
      accentColor: "bg-gold-600",
      displayOrder: 9999,
      charterText: "Demo charter for product review and testing.",
      missionGoals: [
        { key: "member_onboarding", label: "Member onboarding", priorityWeight: 0.35 },
        { key: "local_commerce", label: "Local commerce", priorityWeight: 0.4 },
        { key: "governance", label: "Governance", priorityWeight: 0.25 },
      ],
      structuralWeights: { feasibility: 0.4, risk: 0.3, accountability: 0.3 },
      scoreMix: { missionWeight: 0.6, structuralWeight: 0.4 },
      proposalCategories: [
        { key: "commerce", label: "Commerce", isActive: true },
        { key: "governance", label: "Governance", isActive: true },
        { key: "infrastructure", label: "Infrastructure", isActive: true },
      ],
      sectorExclusions: [],
      scorerAgents: [],
      applicationQuestions: [],
      createdBy: "system:demo-data-seed",
    },
  });

  await prisma.publicCoopInfo.upsert({
    where: { coopId: DEMO_COOP_ID },
    update: {
      isDemo: true,
      isPublished: false,
      showStatsBar: false,
      name: "Cahootz Demo Co-op",
      updatedBy: "system:demo-data-seed",
    },
    create: {
      coopId: DEMO_COOP_ID,
      isDemo: true,
      isPublished: false,
      showStatsBar: false,
      name: "Cahootz Demo Co-op",
      tagline: "A hidden sandbox for reviewers and guided demos.",
      heroTitle: "Cahootz Demo Co-op",
      heroSubtitle: "A hidden sandbox for reviewers and guided demos.",
      primaryColor: "#1f2937",
      accentColor: "#d4af37",
      backgroundColor: "#111827",
      createdBy: "system:demo-data-seed",
      updatedBy: "system:demo-data-seed",
    },
  });
}

async function clearDemoData() {
  const fakeEmails = demoUsers.filter((user) => user.email !== DEMO_LOGIN_EMAIL).map((user) => user.email);
  const seededUsers = await prisma.user.findMany({
    where: { email: { in: demoUsers.map((user) => user.email) } },
    select: { id: true },
  });
  const fakeUsers = await prisma.user.findMany({
    where: { email: { in: fakeEmails } },
    select: { id: true },
  });
  const seededUserIds = seededUsers.map((user) => user.id);
  const fakeUserIds = fakeUsers.map((user) => user.id);

  const stores = await prisma.store.findMany({
    where: { coopId: DEMO_COOP_ID },
    select: { id: true, businessId: true },
  });
  const storeIds = stores.map((store) => store.id);
  const businessIds = stores.flatMap((store) => (store.businessId ? [store.businessId] : []));

  const orders = await prisma.storeOrder.findMany({
    where: { storeId: { in: storeIds } },
    select: { id: true },
  });
  const orderIds = orders.map((order) => order.id);

  const proposals = await prisma.proposal.findMany({
    where: { coopId: DEMO_COOP_ID },
    select: { id: true },
  });
  const proposalIds = proposals.map((proposal) => proposal.id);

  const goalScores = await prisma.proposalGoalScore.findMany({
    where: { proposalId: { in: proposalIds } },
    select: { id: true },
  });

  const commerceTransactions = await prisma.commerceTransaction.findMany({
    where: { coopId: DEMO_COOP_ID },
    select: { id: true },
  });
  const commerceTransactionIds = commerceTransactions.map((transaction) => transaction.id);

  if (goalScores.length) {
    await prisma.proposalScoreAdjustmentLog.deleteMany({
      where: { goalScoreId: { in: goalScores.map((score) => score.id) } },
    });
  }
  if (proposalIds.length) {
    await prisma.proposalGoalScore.deleteMany({ where: { proposalId: { in: proposalIds } } });
    await prisma.proposal.deleteMany({ where: { id: { in: proposalIds } } });
  }

  await prisma.notification.deleteMany({ where: { coopId: DEMO_COOP_ID } });
  await prisma.receipt.deleteMany({ where: { coopId: DEMO_COOP_ID } });
  await prisma.pendingTransfer.deleteMany({ where: { coopId: DEMO_COOP_ID } });
  await prisma.storePaymentRequest.deleteMany({ where: { storeId: { in: storeIds } } });
  await prisma.p2PTransfer.deleteMany({ where: { coopId: DEMO_COOP_ID } });
  await prisma.sCRewardTransaction.deleteMany({ where: { coopId: DEMO_COOP_ID } });
  await prisma.treasuryReserveEntry.deleteMany({ where: { coopId: DEMO_COOP_ID } });
  await prisma.treasuryReservePolicy.deleteMany({ where: { coopId: DEMO_COOP_ID } });
  await prisma.sCMintEvent.deleteMany({ where: { idempotencyKey: { startsWith: "demo-seed-" } } });
  await prisma.sCBurnEvent.deleteMany({ where: { idempotencyKey: { startsWith: "demo-seed-" } } });
  await prisma.auditLog.deleteMany({ where: { actorId: "system:demo-data-seed" } });
  await prisma.stripePaymentEvent.deleteMany({ where: { stripeEventId: { startsWith: "evt_demo_seed_" } } });
  await prisma.feeConfig.deleteMany({ where: { createdBy: "system:demo-data-seed" } });
  await prisma.treasuryLedgerEntry.deleteMany({
    where: { sourceTransactionType: "DEMO_PROPOSAL_ALLOCATION" },
  });

  if (commerceTransactionIds.length) {
    await prisma.treasuryLedgerEntry.deleteMany({
      where: { sourceTransactionId: { in: commerceTransactionIds } },
    });
  }
  await prisma.commerceTransaction.deleteMany({ where: { coopId: DEMO_COOP_ID } });

  await prisma.storeOrderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.storeOrder.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.product.deleteMany({ where: { storeId: { in: storeIds } } });
  await prisma.sCVerificationApplication.deleteMany({ where: { storeId: { in: storeIds } } });
  await prisma.storeApplication.deleteMany({ where: { storeId: { in: storeIds } } });
  await prisma.store.deleteMany({ where: { id: { in: storeIds } } });

  if (businessIds.length) {
    await prisma.businessOnboardingEvent.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.stripeAccount.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
  }

  if (seededUserIds.length) {
    await prisma.transaction.deleteMany({ where: { fromUserId: { in: seededUserIds } } });
    await prisma.onrampTransaction.deleteMany({ where: { userId: { in: seededUserIds } } });
    await prisma.paymentMethod.deleteMany({ where: { userId: { in: seededUserIds } } });
    await prisma.withdrawal.deleteMany({ where: { userId: { in: seededUserIds } } });
    await prisma.bankAccount.deleteMany({ where: { userId: { in: seededUserIds } } });
    await prisma.walletChallenge.deleteMany({ where: { userId: { in: fakeUserIds } } });
    await prisma.wallet.deleteMany({ where: { userId: { in: fakeUserIds } } });
  }

  await prisma.application.deleteMany({ where: { coopId: DEMO_COOP_ID, userId: { in: fakeUserIds } } });
  await prisma.userCoopMembership.deleteMany({
    where: { coopId: DEMO_COOP_ID, userId: { in: fakeUserIds } },
  });
  await prisma.user.deleteMany({ where: { id: { in: fakeUserIds } } });
}

async function seedMembers() {
  const users = new Map<string, any>();
  const wallets = new Map<string, any>();

  for (const member of demoUsers) {
    const user = await prisma.user.upsert({
      where: { email: member.email },
      update: {
        name: member.name,
        roles: member.roles,
        status: "ACTIVE",
        walletAddress: member.walletAddress,
        profileCompleted: true,
      },
      create: {
        email: member.email,
        name: member.name,
        roles: member.roles,
        status: "ACTIVE",
        walletAddress: member.walletAddress,
        profileCompleted: true,
      },
    });

    const wallet = await prisma.wallet.upsert({
      where: { address: member.walletAddress },
      update: {
        userId: user.id,
        walletType: "EXTERNAL",
        isPrimary: true,
        verifiedAt: daysAgo(14),
        lastSeenAt: daysAgo(1),
      },
      create: {
        userId: user.id,
        address: member.walletAddress,
        chain: "base-sepolia",
        walletType: "EXTERNAL",
        isPrimary: true,
        verifiedAt: daysAgo(14),
        lastSeenAt: daysAgo(1),
      },
    });

    await prisma.sCBalanceCache.upsert({
      where: { walletId: wallet.id },
      update: { balance: member.balance, blockNumber: 1250000, syncedAt: daysAgo(1) },
      create: { walletId: wallet.id, balance: member.balance, blockNumber: 1250000, syncedAt: daysAgo(1) },
    });

    await prisma.userCoopMembership.upsert({
      where: { userId_coopId: { userId: user.id, coopId: DEMO_COOP_ID } },
      update: {
        status: "ACTIVE",
        roles: member.roles,
        permissions: member.key === "reviewer" ? ["demo", "admin"] : ["demo"],
        joinedAt: daysAgo(30),
        lastActiveAt: daysAgo(member.key === "reviewer" ? 0 : 2),
      },
      create: {
        userId: user.id,
        coopId: DEMO_COOP_ID,
        status: "ACTIVE",
        roles: member.roles,
        permissions: member.key === "reviewer" ? ["demo", "admin"] : ["demo"],
        joinedAt: daysAgo(30),
        lastActiveAt: daysAgo(member.key === "reviewer" ? 0 : 2),
      },
    });

    await prisma.application.upsert({
      where: { userId_coopId: { userId: user.id, coopId: DEMO_COOP_ID } },
      update: {
        status: "APPROVED",
        data: {
          seedTag: SEED_TAG,
          interests: ["commerce", "governance", "member support"],
          bio: `${member.name} is a seeded demo member.`,
        },
        reviewedBy: "system:demo-data-seed",
        reviewedAt: daysAgo(20),
        reviewNotes: "Approved by demo fixture seed.",
      },
      create: {
        userId: user.id,
        coopId: DEMO_COOP_ID,
        status: "APPROVED",
        data: {
          seedTag: SEED_TAG,
          interests: ["commerce", "governance", "member support"],
          bio: `${member.name} is a seeded demo member.`,
        },
        reviewedBy: "system:demo-data-seed",
        reviewedAt: daysAgo(20),
        reviewNotes: "Approved by demo fixture seed.",
      },
    });

    users.set(member.key, user);
    wallets.set(member.key, wallet);
  }

  await prisma.loginCode.deleteMany({ where: { email: DEMO_LOGIN_EMAIL, code: DEMO_LOGIN_CODE } });
  await prisma.loginCode.create({
    data: {
      email: DEMO_LOGIN_EMAIL,
      code: DEMO_LOGIN_CODE,
      expiresAt: daysAgo(-30),
      used: false,
    },
  });

  return { users, wallets };
}

async function seedStores(users: Map<string, any>) {
  const stores = new Map<string, any>();
  const productsByStore = new Map<string, any[]>();
  const businesses = new Map<string, any>();

  for (const businessSeed of demoBusinesses) {
    const owner = users.get(businessSeed.ownerKey);
    const business = await prisma.business.create({
      data: {
        ownerId: owner.id,
        coopId: DEMO_COOP_ID,
        name: businessSeed.name,
        city: businessSeed.city,
        isApproved: true,
      },
    });
    businesses.set(businessSeed.key, business);

    await prisma.stripeAccount.create({
      data: {
        businessId: business.id,
        stripeAccountId: `acct_demo_${businessSeed.key}`,
        accountType: "express",
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
        verificationStatus: "VERIFIED",
        onboardingStatus: "PAYOUTS_ENABLED",
      },
    });

    await prisma.businessOnboardingEvent.create({
      data: {
        businessId: business.id,
        status: "PAYOUTS_ENABLED",
        metadata: { seedTag: SEED_TAG, note: "Seeded as fully onboarded for demo." },
        occurredAt: daysAgo(18),
      },
    });

    const store = await prisma.store.create({
      data: {
        ownerId: owner.id,
        coopId: DEMO_COOP_ID,
        businessId: business.id,
        name: businessSeed.name,
        description: businessSeed.description,
        category: businessSeed.category,
        imageUrl: businessSeed.imageUrl,
        bannerUrl: businessSeed.bannerUrl,
        shortCode: businessSeed.shortCode,
        acceptsQuickPay: true,
        address: businessSeed.address,
        city: businessSeed.city,
        state: "GA",
        zipCode: "30303",
        phone: "+14045550100",
        email: `${businessSeed.key}@cahootz.coop`,
        website: `https://demo.cahootz.coop/${businessSeed.key}`,
        isScVerified: true,
        scVerifiedAt: daysAgo(16),
        scApplicationStatus: "APPROVED",
        acceptsUC: true,
        ucDiscountPercent: 20,
        status: "APPROVED",
        isFeatured: true,
        rating: 4.7,
        reviewCount: 18,
      },
    });

    await prisma.storeApplication.create({
      data: {
        storeId: store.id,
        businessName: businessSeed.name,
        businessAddress: businessSeed.address,
        businessCity: businessSeed.city,
        businessState: "GA",
        businessZip: "30303",
        ownerName: owner.name ?? "Demo Owner",
        ownerEmail: owner.email,
        ownerPhone: "+14045550199",
        storeDescription: businessSeed.description,
        communityBenefitStatement: "Keeps spending circulating inside the demo co-op.",
        estimatedMonthlyRevenue: "$15,000 - $25,000",
        websiteUrl: `https://demo.cahootz.coop/${businessSeed.key}`,
        socialMediaUrls: [],
        status: "APPROVED",
        reviewedBy: "system:demo-data-seed",
        reviewedAt: daysAgo(17),
        reviewNotes: "Approved demo merchant.",
      },
    });

    await prisma.sCVerificationApplication.create({
      data: {
        storeId: store.id,
        whyScEligible: "The store creates local member value and participates in demo treasury reporting.",
        expectedVolume: "$10,000 monthly",
        status: "APPROVED",
        reviewedBy: "system:demo-data-seed",
        reviewedAt: daysAgo(16),
      },
    });

    const products = [];
    for (const [index, productSeed] of businessSeed.products.entries()) {
      const [name, priceUSD, quantity, description] = productSeed;
      const product = await prisma.product.create({
        data: {
          storeId: store.id,
          name: String(name),
          description: String(description),
          category: businessSeed.productCategory,
          imageUrl: businessSeed.imageUrl,
          images: [businessSeed.imageUrl],
          priceUSD: Number(priceUSD),
          compareAtPrice: Number(priceUSD) * 1.15,
          ucDiscountPrice: Number(priceUSD) * 0.8,
          sku: `${businessSeed.shortCode}-${index + 1}`,
          quantity: Number(quantity),
          trackInventory: true,
          allowBackorder: false,
          isActive: true,
          isFeatured: index === 0,
          totalSold: 3 + index,
        },
      });
      products.push(product);
    }

    stores.set(businessSeed.key, store);
    productsByStore.set(businessSeed.key, products);
  }

  return { stores, productsByStore, businesses };
}

async function seedOrdersAndTransactions(params: {
  users: Map<string, any>;
  stores: Map<string, any>;
  productsByStore: Map<string, any[]>;
  businesses: Map<string, any>;
}) {
  const { users, stores, productsByStore, businesses } = params;
  const buyerKeys = ["reviewer", "maya", "omar"];
  const createdOrders = [];
  const createdRewards = [];

  let txIndex = 100;
  for (const [storeKey, store] of stores.entries()) {
    const products = productsByStore.get(storeKey) ?? [];
    let totalSales = 0;
    let totalOrders = 0;

    for (const [index, buyerKey] of buyerKeys.entries()) {
      const buyer = users.get(buyerKey);
      const product = products[index % products.length];
      const quantity = index === 0 ? 2 : 1;
      const subtotal = Number((product.priceUSD * quantity).toFixed(2));
      const discount = index === 1 ? Number((subtotal * 0.2).toFixed(2)) : 0;
      const total = Number((subtotal - discount).toFixed(2));
      const paidWithUc = index !== 2;
      const transactionHash = paidWithUc ? demoTxHash(txIndex++) : null;

      const order = await prisma.storeOrder.create({
        data: {
          storeId: store.id,
          buyerId: buyer.id,
          subtotalUSD: subtotal,
          discountUSD: discount,
          totalUSD: total,
          totalUC: paidWithUc ? total : null,
          paymentMethod: paidWithUc ? "UC_BALANCE" : "CARD",
          paymentStatus: "COMPLETED",
          transactionHash,
          fulfillmentStatus: index === 0 ? "DELIVERED" : index === 1 ? "SHIPPED" : "PROCESSING",
          shippingAddress: "123 Demo Lane, Atlanta, GA 30303",
          trackingNumber: index === 1 ? `DEMO${txIndex}` : null,
          note: `${SEED_TAG}: seeded order for ${store.name}`,
          createdAt: daysAgo(12 - index * 3),
        },
      });

      await prisma.storeOrderItem.create({
        data: {
          orderId: order.id,
          productId: product.id,
          quantity,
          priceUSD: product.priceUSD,
          totalUSD: subtotal,
        },
      });

      totalSales += total;
      totalOrders += 1;

      const business = businesses.get(storeKey);
      const chargedAmount = Number((total * 1.04).toFixed(2));
      const treasuryFeeAmount = Number((total * 0.04).toFixed(2));
      const commerceTransaction = await prisma.commerceTransaction.create({
        data: {
          customerId: buyer.id,
          businessId: business.id,
          coopId: DEMO_COOP_ID,
          listedAmount: total,
          chargedAmount,
          merchantSettlementAmount: total,
          treasuryFeeAmount,
          platformMarkupBps: 400,
          treasuryFeeBps: 400,
          stripePaymentIntentId: `pi_demo_${storeKey}_${index}`,
          stripeChargeId: `ch_demo_${storeKey}_${index}`,
          stripeDestinationAccountId: `acct_demo_${storeKey}`,
          status: "COMPLETED",
          sourceType: index === 2 ? "CHECKOUT" : "QUICK_PAY",
          metadata: {
            seedTag: SEED_TAG,
            orderId: order.id,
            storeId: store.id,
            productName: product.name,
          },
          createdAt: order.createdAt,
          completedAt: order.createdAt,
        },
      });

      await prisma.treasuryLedgerEntry.createMany({
        data: [
          {
            sourceTransactionId: commerceTransaction.id,
            sourceTransactionType: "COMMERCE_FEE",
            accountType: "PLATFORM_FEES",
            entryType: "FEE_COLLECTION",
            amount: Number((chargedAmount - total).toFixed(2)),
            direction: "CREDIT",
            description: `Platform fee from ${store.name}`,
            metadata: { seedTag: SEED_TAG, orderId: order.id },
            occurredAt: order.createdAt,
          },
          {
            sourceTransactionId: commerceTransaction.id,
            sourceTransactionType: "COMMERCE_FEE",
            accountType: "TREASURY_FEES",
            entryType: "FEE_COLLECTION",
            amount: treasuryFeeAmount,
            direction: "CREDIT",
            description: `Treasury fee from ${store.name}`,
            metadata: { seedTag: SEED_TAG, orderId: order.id },
            occurredAt: order.createdAt,
          },
        ],
      });

      const customerReward = await prisma.sCRewardTransaction.create({
        data: {
          userId: buyer.id,
          coopId: DEMO_COOP_ID,
          amountSC: Number((total * 0.05).toFixed(2)),
          reason: "STORE_PURCHASE_REWARD",
          status: "COMPLETED",
          txHash: demoTxHash(txIndex++),
          sourceUcTxHash: transactionHash,
          sourceType: "STORE_ORDER",
          sourceRecordId: order.id,
          relatedStoreId: store.id,
          relatedOrderId: order.id,
          metadata: { seedTag: SEED_TAG },
          createdAt: order.createdAt,
          completedAt: order.createdAt,
        },
      });
      createdRewards.push(customerReward);

      const ownerReward = await prisma.sCRewardTransaction.create({
        data: {
          userId: store.ownerId,
          coopId: DEMO_COOP_ID,
          amountSC: Number((total * 0.03).toFixed(2)),
          reason: "STORE_SALE_REWARD",
          status: "COMPLETED",
          txHash: demoTxHash(txIndex++),
          sourceUcTxHash: transactionHash,
          sourceType: "STORE_ORDER",
          sourceRecordId: order.id,
          relatedStoreId: store.id,
          relatedOrderId: order.id,
          metadata: { seedTag: SEED_TAG },
          createdAt: order.createdAt,
          completedAt: order.createdAt,
        },
      });
      createdRewards.push(ownerReward);

      if (transactionHash) {
        await prisma.treasuryReserveEntry.create({
          data: {
            coopId: DEMO_COOP_ID,
            sourceType: "STORE_ORDER",
            sourceRecordId: order.id,
            sourceUcTxHash: transactionHash,
            transactionAmountUC: total,
            reservePercentBps: 500,
            reserveAmountUC: Number((total * 0.05).toFixed(2)),
            treasuryTxHash: demoTxHash(txIndex++),
            status: "SETTLED",
            relatedScRewardIds: [customerReward.id, ownerReward.id],
            createdAt: order.createdAt,
            settledAt: order.createdAt,
          },
        });
      }

      await prisma.sCMintEvent.create({
        data: {
          idempotencyKey: `demo-seed-mint-${storeKey}-${index}`,
          userId: buyer.id,
          walletAddress: demoUsers.find((member) => member.key === buyerKey)?.walletAddress ?? DEMO_WALLET_ADDRESS,
          coopTokenClass: "demo",
          requestedAmount: customerReward.amountSC,
          actualAmount: customerReward.amountSC,
          sourceTransactionId: commerceTransaction.id,
          sourceType: "COMMERCE_REWARD",
          contractTxHash: demoTxHash(txIndex++),
          blockNumber: 1250000 + txIndex,
          status: "COMPLETED",
          metadata: { seedTag: SEED_TAG, rewardId: customerReward.id },
          createdAt: order.createdAt,
          completedAt: order.createdAt,
        },
      });

      createdOrders.push(order);
    }

    await prisma.store.update({
      where: { id: store.id },
      data: {
        totalSales: Number(totalSales.toFixed(2)),
        totalOrders,
      },
    });

    await prisma.storePaymentRequest.createMany({
      data: [
        {
          storeId: store.id,
          amount: 24.75,
          description: `Open counter sale at ${store.name}`,
          referenceId: `${store.shortCode}-OPEN-1`,
          token: `demo-${storeKey}-pending`,
          status: "PENDING",
          expiresAt: daysAgo(-3),
          createdAt: daysAgo(1),
        },
        {
          storeId: store.id,
          amount: 42,
          description: `Paid invoice at ${store.name}`,
          referenceId: `${store.shortCode}-PAID-1`,
          token: `demo-${storeKey}-paid`,
          status: "COMPLETED",
          paidByUserId: users.get("reviewer").id,
          paidAt: daysAgo(2),
          createdAt: daysAgo(3),
        },
      ],
    });
  }

  const firstStoreKey = Array.from(stores.keys())[0];
  const firstStore = stores.get(firstStoreKey);
  const firstBusiness = businesses.get(firstStoreKey);
  const firstProduct = productsByStore.get(firstStoreKey)?.[0];
  const failedBuyer = users.get("avery");
  const refundBuyer = users.get("rosa");

  if (firstStore && firstBusiness && firstProduct && failedBuyer && refundBuyer) {
    await prisma.storeOrder.create({
      data: {
        storeId: firstStore.id,
        buyerId: failedBuyer.id,
        subtotalUSD: firstProduct.priceUSD,
        discountUSD: 0,
        totalUSD: firstProduct.priceUSD,
        paymentMethod: "CARD",
        paymentStatus: "FAILED",
        fulfillmentStatus: "CANCELLED",
        shippingAddress: "123 Demo Lane, Atlanta, GA 30303",
        note: `${SEED_TAG}: seeded failed payment order`,
        createdAt: daysAgo(2),
      },
    });

    const refundedOrder = await prisma.storeOrder.create({
      data: {
        storeId: firstStore.id,
        buyerId: refundBuyer.id,
        subtotalUSD: firstProduct.priceUSD,
        discountUSD: 0,
        totalUSD: firstProduct.priceUSD,
        paymentMethod: "CARD",
        paymentStatus: "REFUNDED",
        fulfillmentStatus: "CANCELLED",
        shippingAddress: "123 Demo Lane, Atlanta, GA 30303",
        note: `${SEED_TAG}: seeded refunded order`,
        createdAt: daysAgo(6),
      },
    });

    await prisma.storeOrderItem.create({
      data: {
        orderId: refundedOrder.id,
        productId: firstProduct.id,
        quantity: 1,
        priceUSD: firstProduct.priceUSD,
        totalUSD: firstProduct.priceUSD,
      },
    });

    const refundedTransaction = await prisma.commerceTransaction.create({
      data: {
        customerId: refundBuyer.id,
        businessId: firstBusiness.id,
        coopId: DEMO_COOP_ID,
        listedAmount: firstProduct.priceUSD,
        chargedAmount: Number((firstProduct.priceUSD * 1.04).toFixed(2)),
        merchantSettlementAmount: 0,
        treasuryFeeAmount: 0,
        platformMarkupBps: 400,
        treasuryFeeBps: 400,
        stripePaymentIntentId: "pi_demo_refunded_001",
        stripeChargeId: "ch_demo_refunded_001",
        stripeDestinationAccountId: `acct_demo_${firstStoreKey}`,
        status: "REFUNDED",
        sourceType: "CHECKOUT",
        metadata: { seedTag: SEED_TAG, orderId: refundedOrder.id, refundReason: "Customer requested cancellation" },
        createdAt: refundedOrder.createdAt,
        completedAt: refundedOrder.createdAt,
      },
    });

    await prisma.treasuryLedgerEntry.create({
      data: {
        sourceTransactionId: refundedTransaction.id,
        sourceTransactionType: "REFUND",
        accountType: "PENDING_SETTLEMENT",
        entryType: "REFUND",
        amount: refundedTransaction.chargedAmount,
        direction: "DEBIT",
        description: `Refunded demo order at ${firstStore.name}`,
        metadata: { seedTag: SEED_TAG, orderId: refundedOrder.id },
        occurredAt: daysAgo(5),
      },
    });
  }

  await prisma.treasuryReservePolicy.create({
    data: {
      coopId: DEMO_COOP_ID,
      defaultReserveBps: 500,
      badgeReserveBps: 250,
      programReserveBps: { local_food: 600, repair_access: 450 },
      isActive: true,
      createdBy: DEMO_WALLET_ADDRESS,
    },
  });

  return { orders: createdOrders, rewards: createdRewards };
}

async function seedTransfersAndFinancials(users: Map<string, any>) {
  const reviewer = users.get("reviewer");
  const maya = users.get("maya");
  const omar = users.get("omar");

  await prisma.paymentMethod.create({
    data: {
      userId: reviewer.id,
      stripePaymentMethodId: "pm_demo_visa_4242",
      type: "card",
      last4: "4242",
      brand: "visa",
      expiryMonth: 12,
      expiryYear: 2030,
      isDefault: true,
    },
  });

  const bankAccount = await prisma.bankAccount.create({
    data: {
      userId: reviewer.id,
      stripeBankAccountId: "ba_demo_6789",
      accountHolderName: "Cahootz Demo Member",
      bankName: "Demo Community Bank",
      last4: "6789",
      routingLast4: "1101",
      isDefault: true,
      isVerified: true,
    },
  });

  await prisma.withdrawal.create({
    data: {
      userId: reviewer.id,
      bankAccountId: bankAccount.id,
      amountUSD: 125,
      amountUC: 125,
      stripePayoutId: "po_demo_001",
      status: "COMPLETED",
      createdAt: daysAgo(8),
      completedAt: daysAgo(7),
    },
  });

  await prisma.onrampTransaction.create({
    data: {
      userId: reviewer.id,
      amountUSD: 250,
      amountUC: 250,
      paymentIntentId: "pi_demo_onramp_001",
      processor: "stripe",
      status: "COMPLETED",
      mintTxHash: demoTxHash(500),
      processorChargeId: "ch_demo_onramp_001",
      createdAt: daysAgo(15),
      completedAt: daysAgo(15),
    },
  });

  const p2p = await prisma.p2PTransfer.create({
    data: {
      senderId: reviewer.id,
      recipientId: maya.id,
      coopId: DEMO_COOP_ID,
      amountUSD: 75,
      amountUC: 75,
      fundingSource: "BALANCE",
      blockchainTxHash: demoTxHash(501),
      status: "COMPLETED",
      transferType: "SERVICE",
      transferMetadata: { seedTag: SEED_TAG, service: "Event setup support" },
      note: "Thanks for helping with the member night setup.",
      createdAt: daysAgo(5),
      completedAt: daysAgo(5),
    },
  });

  await prisma.receipt.create({
    data: {
      p2pTransferId: p2p.id,
      senderId: reviewer.id,
      recipientId: maya.id,
      coopId: DEMO_COOP_ID,
      amountUSD: 75,
      transferType: "SERVICE",
      metadata: { seedTag: SEED_TAG, source: "p2p" },
      verificationStatus: "VERIFIED",
      verifiedAt: daysAgo(4),
      verifiedBy: maya.id,
      createdAt: daysAgo(5),
    },
  });

  const pending = await prisma.pendingTransfer.create({
    data: {
      senderId: omar.id,
      coopId: DEMO_COOP_ID,
      recipientPhone: "+14045550999",
      recipientEmail: "guest.vendor@example.com",
      amountUSD: 48,
      amountUC: 48,
      claimToken: "demo-pending-transfer-token",
      status: "PENDING_CLAIM",
      fundingSource: "CARD",
      stripePaymentIntentId: "pi_demo_pending_transfer",
      stripeChargeId: "ch_demo_pending_transfer",
      transferType: "STORE",
      transferMetadata: { seedTag: SEED_TAG, storeName: "Pop-up Vendor" },
      note: "Demo pending payment to an invited vendor.",
      expiresAt: daysAgo(-7),
      createdAt: daysAgo(1),
    },
  });

  await prisma.receipt.create({
    data: {
      pendingTransferId: pending.id,
      senderId: omar.id,
      recipientPhone: "+14045550999",
      coopId: DEMO_COOP_ID,
      amountUSD: 48,
      transferType: "STORE",
      metadata: { seedTag: SEED_TAG, source: "pending-transfer" },
      verificationStatus: "UNVERIFIED",
      createdAt: daysAgo(1),
    },
  });

  await prisma.transaction.createMany({
    data: [
      { fromUserId: reviewer.id, toUserId: maya.id, amount: 75, createdAt: daysAgo(5) },
      { fromUserId: omar.id, toUserId: reviewer.id, amount: 32, createdAt: daysAgo(9) },
    ],
  });
}

async function seedGovernance(users: Map<string, any>) {
  const reviewer = users.get("reviewer");
  const maya = users.get("maya");
  const omar = users.get("omar");
  const jordan = users.get("jordan");

  const proposals = [
    {
      title: "Fund shared cold storage for grocery vendors",
      summary: "Purchase shared refrigerated storage to reduce spoilage and improve food access.",
      category: "INFRASTRUCTURE",
      status: "APPROVED",
      proposer: jordan,
      budgetAmount: 4200,
      decision: "advance",
    },
    {
      title: "Launch member device repair credits",
      summary: "Offer repair credits for members who need phones or tablets for co-op work.",
      category: "WALLET_INCENTIVE",
      status: "VOTABLE",
      proposer: ninaOrFallback(users),
      budgetAmount: 1800,
      decision: "advance",
    },
    {
      title: "Pilot monthly governance orientation",
      summary: "Run a monthly onboarding session explaining proposals, votes, and treasury reports.",
      category: "GOVERNANCE",
      status: "FUNDED",
      proposer: omar,
      budgetAmount: 650,
      decision: "advance",
    },
  ];

  for (const [index, seed] of proposals.entries()) {
    const proposal = await prisma.proposal.create({
      data: {
        title: seed.title,
        summary: seed.summary,
        category: seed.category as any,
        status: seed.status as any,
        proposerWallet: seed.proposer.walletAddress ?? DEMO_WALLET_ADDRESS,
        proposerRole: seed.proposer.id === jordan.id ? "MERCHANT" : "MEMBER",
        proposerDisplayName: seed.proposer.name,
        regionCode: "ATL",
        regionName: "Atlanta Demo Region",
        budgetCurrency: "USD",
        budgetAmount: seed.budgetAmount,
        evaluation: {
          seedTag: SEED_TAG,
          computed_scores: { mission: 0.82 - index * 0.04, structural: 0.76 - index * 0.03 },
          llm_summary: "Seeded evaluation for demo governance workflow.",
        },
        quorumPercent: 20,
        approvalThresholdPercent: 60,
        votingWindowDays: 7,
        engineVersion: "demo-seed-v1",
        coopId: DEMO_COOP_ID,
        categoryKey: String(seed.category).toLowerCase(),
        alternatives: [],
        bestAlternative: null,
        decision: seed.decision,
        decisionReasons: ["Strong member value", "Fits demo mission goals"],
        missingData: [],
        rawText: `${seed.title}\n\n${seed.summary}`,
        councilRequired: seed.budgetAmount > 2500,
        createdAt: daysAgo(14 - index * 4),
      },
    });

    await prisma.proposalRevision.create({
      data: {
        proposalId: proposal.id,
        revisionNumber: 1,
        rawText: proposal.rawText,
        evaluation: proposal.evaluation ?? {},
        decision: seed.decision,
        decisionReasons: ["Strong member value", "Fits demo mission goals"],
        auditChecks: [
          { name: "Budget present", passed: true },
          { name: "Mission aligned", passed: true },
        ],
        status: seed.status,
        engineVersion: "demo-seed-v1",
        submittedAt: proposal.createdAt,
      },
    });

    await prisma.proposalKPI.createMany({
      data: [
        { proposalId: proposal.id, name: "Members reached", target: 40 + index * 10, unit: "COUNT" },
        { proposalId: proposal.id, name: "Cost savings", target: 12 + index * 3, unit: "PERCENT" },
      ],
    });

    await prisma.proposalAuditCheck.createMany({
      data: [
        { proposalId: proposal.id, name: "Budget included", passed: true, note: "Seeded check." },
        { proposalId: proposal.id, name: "Risk review", passed: index !== 1, note: "Demo risk note." },
      ],
    });

    await prisma.proposalVote.createMany({
      data: [
        { proposalId: proposal.id, voterWallet: DEMO_WALLET_ADDRESS, vote: "FOR", timestamp: daysAgo(10 - index) },
        { proposalId: proposal.id, voterWallet: maya.walletAddress, vote: "FOR", timestamp: daysAgo(9 - index) },
        { proposalId: proposal.id, voterWallet: omar.walletAddress, vote: index === 1 ? "ABSTAIN" : "FOR", timestamp: daysAgo(8 - index) },
      ],
    });

    const comment = await prisma.proposalComment.create({
      data: {
        proposalId: proposal.id,
        authorWallet: DEMO_WALLET_ADDRESS,
        authorName: "Cahootz Demo Member",
        content: "This seeded comment shows how members discuss proposals before voting.",
        createdAt: daysAgo(7 - index),
      },
    });

    await prisma.commentAIEvaluation.create({
      data: {
        commentId: comment.id,
        alignment: "ALIGNED",
        score: 0.86,
        analysis: "The comment is constructive and mission-aligned.",
        goalsImpacted: ["governance", "member_onboarding"],
      },
    });

    await prisma.proposalReaction.createMany({
      data: [
        { proposalId: proposal.id, voterWallet: DEMO_WALLET_ADDRESS, reaction: "SUPPORT" },
        { proposalId: proposal.id, voterWallet: maya.walletAddress, reaction: "SUPPORT" },
      ],
    });

    const goalScore = await prisma.proposalGoalScore.create({
      data: {
        proposalId: proposal.id,
        revisionNumber: 1,
        goalId: "local_commerce",
        domain: "commerce",
        aiScore: 0.78,
        finalScore: 0.78,
      },
    });

    await prisma.proposalScoreAdjustmentLog.create({
      data: {
        goalScoreId: goalScore.id,
        fromScore: 0.74,
        toScore: 0.78,
        reason: "Seeded expert adjustment for demo visibility.",
        expertWallet: DEMO_WALLET_ADDRESS,
      },
    });

    if (seed.status === "FUNDED") {
      await prisma.treasuryLedgerEntry.create({
        data: {
          sourceTransactionId: null,
          sourceTransactionType: "DEMO_PROPOSAL_ALLOCATION",
          accountType: "GRANTS",
          entryType: "ALLOCATION",
          amount: seed.budgetAmount,
          direction: "DEBIT",
          description: `Funded proposal: ${seed.title}`,
          metadata: { seedTag: SEED_TAG, proposalId: proposal.id },
          occurredAt: daysAgo(3),
        },
      });
    }
  }
}

function ninaOrFallback(users: Map<string, any>) {
  return users.get("nina") ?? users.get("reviewer");
}

async function seedPlatformAndTokenOps(users: Map<string, any>) {
  const reviewer = users.get("reviewer");
  const avery = users.get("avery");
  const rosa = users.get("rosa");

  await prisma.featureFlag.upsert({
    where: { key: "demo.quickPay" },
    update: {
      enabled: true,
      description: "Enable quick-pay flows in the demo co-op.",
      metadata: { seedTag: SEED_TAG, coopId: DEMO_COOP_ID },
    },
    create: {
      key: "demo.quickPay",
      enabled: true,
      description: "Enable quick-pay flows in the demo co-op.",
      metadata: { seedTag: SEED_TAG, coopId: DEMO_COOP_ID },
    },
  });

  await prisma.featureFlag.upsert({
    where: { key: "demo.scRewards" },
    update: {
      enabled: true,
      description: "Show seeded SC reward and minting flows.",
      metadata: { seedTag: SEED_TAG, coopId: DEMO_COOP_ID },
    },
    create: {
      key: "demo.scRewards",
      enabled: true,
      description: "Show seeded SC reward and minting flows.",
      metadata: { seedTag: SEED_TAG, coopId: DEMO_COOP_ID },
    },
  });

  await prisma.platformConfig.upsert({
    where: { key: "demo.coin.symbol" },
    update: { value: "DSC", updatedBy: "system:demo-data-seed" },
    create: { key: "demo.coin.symbol", value: "DSC", updatedBy: "system:demo-data-seed" },
  });

  await prisma.platformConfig.upsert({
    where: { key: "demo.coin.name" },
    update: { value: "Demo Share Coin", updatedBy: "system:demo-data-seed" },
    create: { key: "demo.coin.name", value: "Demo Share Coin", updatedBy: "system:demo-data-seed" },
  });

  await prisma.feeConfig.create({
    data: {
      platformMarkupBps: 400,
      merchantFeeBps: 0,
      treasuryFeeBps: 400,
      effectiveFrom: daysAgo(60),
      isActive: true,
      createdBy: "system:demo-data-seed",
      createdAt: daysAgo(60),
    },
  });

  if (reviewer) {
    await prisma.adminRole.upsert({
      where: { userId_coopId_role: { userId: reviewer.id, coopId: DEMO_COOP_ID, role: "SUPER_ADMIN" } },
      update: { grantedBy: "system:demo-data-seed", grantedAt: daysAgo(30), revokedAt: null, revokedBy: null },
      create: {
        userId: reviewer.id,
        coopId: DEMO_COOP_ID,
        role: "SUPER_ADMIN",
        grantedBy: "system:demo-data-seed",
        grantedAt: daysAgo(30),
      },
    });
  }

  if (rosa) {
    await prisma.adminRole.upsert({
      where: { userId_coopId_role: { userId: rosa.id, coopId: DEMO_COOP_ID, role: "GOVERNANCE_ADMIN" } },
      update: { grantedBy: "system:demo-data-seed", grantedAt: daysAgo(20), revokedAt: null, revokedBy: null },
      create: {
        userId: rosa.id,
        coopId: DEMO_COOP_ID,
        role: "GOVERNANCE_ADMIN",
        grantedBy: "system:demo-data-seed",
        grantedAt: daysAgo(20),
      },
    });
  }

  if (avery) {
    const manualMint = await prisma.sCMintEvent.create({
      data: {
        idempotencyKey: "demo-seed-manual-mint-avery",
        userId: avery.id,
        walletAddress: "0x0000000000000000000000000000000000000E15",
        coopTokenClass: "demo",
        requestedAmount: 150,
        actualAmount: 150,
        sourceType: "MANUAL_GRANT",
        contractTxHash: demoTxHash(900),
        blockNumber: 1250900,
        status: "COMPLETED",
        metadata: { seedTag: SEED_TAG, reason: "Welcome grant for demo member" },
        createdAt: daysAgo(4),
        completedAt: daysAgo(4),
      },
    });

    await prisma.sCRewardTransaction.create({
      data: {
        userId: avery.id,
        coopId: DEMO_COOP_ID,
        amountSC: 150,
        reason: "MANUAL_ADJUSTMENT",
        status: "COMPLETED",
        txHash: demoTxHash(901),
        sourceType: "MANUAL",
        sourceRecordId: manualMint.id,
        metadata: { seedTag: SEED_TAG, reason: "Welcome grant for demo member" },
        createdAt: daysAgo(4),
        completedAt: daysAgo(4),
      },
    });
  }

  if (reviewer) {
    const burn = await prisma.sCBurnEvent.create({
      data: {
        idempotencyKey: "demo-seed-manual-burn-reviewer",
        userId: reviewer.id,
        walletAddress: DEMO_WALLET_ADDRESS,
        requestedAmount: 12,
        actualAmount: 12,
        reason: "MANUAL_ADJUSTMENT",
        authorizedBy: DEMO_WALLET_ADDRESS,
        contractTxHash: demoTxHash(902),
        blockNumber: 1250902,
        status: "COMPLETED",
        metadata: { seedTag: SEED_TAG, note: "Seeded correction burn for audit screens." },
        createdAt: daysAgo(3),
        completedAt: daysAgo(3),
      },
    });

    await prisma.auditLog.createMany({
      data: [
        {
          actorId: "system:demo-data-seed",
          actorType: "SYSTEM",
          action: "SC_MINT",
          resource: "SCMintEvent",
          resourceId: "demo-seed-manual-mint-avery",
          ipAddress: "127.0.0.1",
          userAgent: "demo-seed",
          metadata: { seedTag: SEED_TAG, coopId: DEMO_COOP_ID },
          status: "SUCCESS",
          occurredAt: daysAgo(4),
        },
        {
          actorId: "system:demo-data-seed",
          actorType: "SYSTEM",
          action: "SC_BURN",
          resource: "SCBurnEvent",
          resourceId: burn.id,
          ipAddress: "127.0.0.1",
          userAgent: "demo-seed",
          metadata: { seedTag: SEED_TAG, coopId: DEMO_COOP_ID },
          status: "SUCCESS",
          occurredAt: daysAgo(3),
        },
        {
          actorId: "system:demo-data-seed",
          actorType: "SYSTEM",
          action: "BUSINESS_APPROVAL",
          resource: "StoreApplication",
          ipAddress: "127.0.0.1",
          userAgent: "demo-seed",
          metadata: { seedTag: SEED_TAG, coopId: DEMO_COOP_ID },
          status: "SUCCESS",
          occurredAt: daysAgo(17),
        },
      ],
    });
  }

  await prisma.stripePaymentEvent.createMany({
    data: [
      {
        stripeEventId: "evt_demo_seed_payment_succeeded",
        eventType: "payment_intent.succeeded",
        accountId: "acct_demo_harvest",
        payload: {
          id: "evt_demo_seed_payment_succeeded",
          type: "payment_intent.succeeded",
          data: { object: { id: "pi_demo_harvest_0", amount: 7072, currency: "usd" } },
        },
        processed: true,
        processedAt: daysAgo(8),
        createdAt: daysAgo(8),
      },
      {
        stripeEventId: "evt_demo_seed_charge_refunded",
        eventType: "charge.refunded",
        accountId: "acct_demo_harvest",
        payload: {
          id: "evt_demo_seed_charge_refunded",
          type: "charge.refunded",
          data: { object: { id: "ch_demo_refunded_001", amount_refunded: 3536, currency: "usd" } },
        },
        processed: true,
        processedAt: daysAgo(5),
        createdAt: daysAgo(5),
      },
      {
        stripeEventId: "evt_demo_seed_payment_failed",
        eventType: "payment_intent.payment_failed",
        payload: {
          id: "evt_demo_seed_payment_failed",
          type: "payment_intent.payment_failed",
          data: { object: { id: "pi_demo_failed_001", last_payment_error: { message: "Demo card declined" } } },
        },
        processed: false,
        createdAt: daysAgo(2),
      },
    ],
  });
}

async function seedNotifications(users: Map<string, any>) {
  const reviewer = users.get("reviewer");
  const maya = users.get("maya");
  const omar = users.get("omar");

  await prisma.notification.createMany({
    data: [
      {
        userId: reviewer.id,
        coopId: DEMO_COOP_ID,
        type: "PAYMENT_RECEIVED",
        title: "Payment received",
        body: "Harvest Table Market sent a seeded demo receipt.",
        data: { seedTag: SEED_TAG },
        read: false,
        createdAt: daysAgo(1),
      },
      {
        userId: maya.id,
        coopId: DEMO_COOP_ID,
        type: "PROPOSAL_COMMENT",
        title: "New proposal comment",
        body: "A member commented on the cold storage proposal.",
        data: { seedTag: SEED_TAG },
        read: true,
        createdAt: daysAgo(2),
      },
      {
        userId: omar.id,
        coopId: DEMO_COOP_ID,
        type: "TREASURY_UPDATE",
        title: "Treasury ledger updated",
        body: "Demo commerce fees were added to the treasury ledger.",
        data: { seedTag: SEED_TAG },
        read: false,
        createdAt: daysAgo(3),
      },
    ],
  });
}

async function main() {
  console.log("Seeding full demo data set...");
  await ensureDemoCoop();
  await clearDemoData();

  const { users } = await seedMembers();
  const { stores, productsByStore, businesses } = await seedStores(users);
  await seedOrdersAndTransactions({ users, stores, productsByStore, businesses });
  await seedTransfersAndFinancials(users);
  await seedGovernance(users);
  await seedPlatformAndTokenOps(users);
  await seedNotifications(users);

  console.log("Seeded full demo data set.");
  console.log(`Demo coop: ${DEMO_COOP_ID}`);
  console.log(`Demo email: ${DEMO_LOGIN_EMAIL}`);
  console.log(`Demo code: ${DEMO_LOGIN_CODE}`);
  console.log(`Stores: ${stores.size}`);
  console.log(`Products: ${Array.from(productsByStore.values()).reduce((count, products) => count + products.length, 0)}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
