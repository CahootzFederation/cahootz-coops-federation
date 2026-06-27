/**
 * Seed a hidden demo co-op and member account for App Store review and sales demos.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEMO_COOP_ID = "demo";
const DEMO_LOGIN_EMAIL = "demo@cahootz.coop";
const DEMO_LOGIN_CODE = "000000";
const DEMO_WALLET_ADDRESS = "0x000000000000000000000000000000000000dE10";

const baseConfig = {
  charterText:
    "This hidden demo co-op exists only for product review and guided demos. It does not represent a live member economy.",
  missionGoals: [
    { key: "member_onboarding", label: "Member onboarding", priorityWeight: 0.4 },
    { key: "local_commerce", label: "Local commerce", priorityWeight: 0.3 },
    { key: "governance", label: "Governance", priorityWeight: 0.3 },
  ],
  structuralWeights: { feasibility: 0.4, risk: 0.3, accountability: 0.3 },
  scoreMix: { missionWeight: 0.6, structuralWeight: 0.4 },
  proposalCategories: [
    { key: "demo", label: "Demo", isActive: true },
    { key: "commerce", label: "Commerce", isActive: true },
    { key: "governance", label: "Governance", isActive: true },
  ],
  sectorExclusions: [],
  scorerAgents: [],
  applicationQuestions: [],
};

async function main() {
  const existingConfig = await prisma.coopConfig.findFirst({
    where: { coopId: DEMO_COOP_ID, version: 1 },
  });

  if (existingConfig) {
    await prisma.coopConfig.update({
      where: { id: existingConfig.id },
      data: {
        isActive: true,
        isDemo: true,
        name: "Cahootz Demo Co-op",
        slug: "cahootz-demo",
        tagline: "A safe sandbox for exploring Cahootz",
        description:
          "A hidden demo workspace with sample membership access for reviewers and guided product demos.",
        displayMission:
          "Show how Cahootz helps co-ops onboard members, coordinate commerce, and govern shared decisions.",
        displayFeatures: [
          {
            title: "Member Home",
            description: "Explore the member dashboard, profile, activity, and co-op context.",
          },
          {
            title: "Co-op Commerce",
            description: "See how stores, products, orders, and payments fit into one co-op workspace.",
          },
          {
            title: "Governance",
            description: "Review proposal and participation flows without touching live co-op data.",
          },
        ],
        eligibility: "Demo access only.",
        bgColor: "bg-slate-800",
        accentColor: "bg-gold-600",
        displayOrder: 9999,
        ...baseConfig,
      },
    });
  } else {
    await prisma.coopConfig.create({
      data: {
        coopId: DEMO_COOP_ID,
        version: 1,
        isActive: true,
        isDemo: true,
        name: "Cahootz Demo Co-op",
        slug: "cahootz-demo",
        tagline: "A safe sandbox for exploring Cahootz",
        description:
          "A hidden demo workspace with sample membership access for reviewers and guided product demos.",
        displayMission:
          "Show how Cahootz helps co-ops onboard members, coordinate commerce, and govern shared decisions.",
        displayFeatures: [
          {
            title: "Member Home",
            description: "Explore the member dashboard, profile, activity, and co-op context.",
          },
          {
            title: "Co-op Commerce",
            description: "See how stores, products, orders, and payments fit into one co-op workspace.",
          },
          {
            title: "Governance",
            description: "Review proposal and participation flows without touching live co-op data.",
          },
        ],
        eligibility: "Demo access only.",
        bgColor: "bg-slate-800",
        accentColor: "bg-gold-600",
        displayOrder: 9999,
        createdBy: "system:demo-seed",
        ...baseConfig,
      },
    });
  }

  await prisma.publicCoopInfo.upsert({
    where: { coopId: DEMO_COOP_ID },
    update: {
      isDemo: true,
      isPublished: false,
      name: "Cahootz Demo Co-op",
      tagline: "A safe sandbox for exploring Cahootz",
      updatedBy: "system:demo-seed",
    },
    create: {
      coopId: DEMO_COOP_ID,
      isDemo: true,
      isPublished: false,
      name: "Cahootz Demo Co-op",
      tagline: "A safe sandbox for exploring Cahootz",
      heroTitle: "Cahootz Demo Co-op",
      heroSubtitle: "A hidden sandbox for reviewers and guided demos.",
      primaryColor: "#1f2937",
      accentColor: "#d4af37",
      backgroundColor: "#111827",
      showStatsBar: false,
      createdBy: "system:demo-seed",
      updatedBy: "system:demo-seed",
    },
  });

  const user = await prisma.user.upsert({
    where: { email: DEMO_LOGIN_EMAIL },
    update: {
      name: "Cahootz Demo Member",
      status: "ACTIVE",
      roles: ["member"],
      walletAddress: DEMO_WALLET_ADDRESS,
      profileCompleted: true,
    },
    create: {
      email: DEMO_LOGIN_EMAIL,
      name: "Cahootz Demo Member",
      status: "ACTIVE",
      roles: ["member"],
      walletAddress: DEMO_WALLET_ADDRESS,
      profileCompleted: true,
    },
  });

  await prisma.wallet.upsert({
    where: { address: DEMO_WALLET_ADDRESS },
    update: {
      userId: user.id,
      isPrimary: true,
      verifiedAt: new Date(),
      lastSeenAt: new Date(),
    },
    create: {
      userId: user.id,
      address: DEMO_WALLET_ADDRESS,
      chain: "base-sepolia",
      walletType: "EXTERNAL",
      isPrimary: true,
      verifiedAt: new Date(),
      lastSeenAt: new Date(),
    },
  });

  await prisma.userCoopMembership.upsert({
    where: {
      userId_coopId: {
        userId: user.id,
        coopId: DEMO_COOP_ID,
      },
    },
    update: {
      status: "ACTIVE",
      roles: ["member", "admin"],
      permissions: ["demo"],
      joinedAt: new Date(),
      lastActiveAt: new Date(),
    },
    create: {
      userId: user.id,
      coopId: DEMO_COOP_ID,
      status: "ACTIVE",
      roles: ["member", "admin"],
      permissions: ["demo"],
      joinedAt: new Date(),
      lastActiveAt: new Date(),
    },
  });

  console.log(`Seeded hidden demo co-op: ${DEMO_COOP_ID}`);
  console.log(`Demo email: ${DEMO_LOGIN_EMAIL}`);
  console.log(`Demo code: ${DEMO_LOGIN_CODE}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
