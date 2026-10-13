/**
 * Seed script for CoopConfig v1 (Cahootz)
 *
 * Run with: pnpm tsx scripts/seed-coop-config.ts
 */

import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { privateKeyToAccount } from "viem/accounts";

const prisma = new PrismaClient();

function envValue(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
}

function deriveBackendWalletAddress(): string | undefined {
  const privateKey = envValue("BACKEND_WALLET_PRIVATE_KEY");
  if (!privateKey) return undefined;

  try {
    return privateKeyToAccount(privateKey as `0x${string}`).address;
  } catch {
    console.warn("  Warning: Could not derive backend wallet address from BACKEND_WALLET_PRIVATE_KEY");
    return undefined;
  }
}

async function seedCoopConfig() {
  const coopId = "cahootz";

  // Read charter text from documents
  const charterPath = path.resolve(__dirname, "../../../documents/cahootz-charter.md");
  let charterText = "";
  try {
    charterText = fs.readFileSync(charterPath, "utf8");
    console.log(`  Read charter (${charterText.length} chars)`);
  } catch {
    console.warn("  Warning: Could not read charter file, using placeholder");
    charterText = "Cahootz Charter - placeholder";
  }

  const missionGoals = [
    {
      key: "member_benefit",
      label: "Member Benefit",
      priorityWeight: 0.35,
      description:
        "Does this proposal create clear value for Cahootz members? Score high when the benefit is specific, measurable, and shared across more than one participant.",
    },
    {
      key: "operational_value",
      label: "Operational Value",
      priorityWeight: 0.25,
      description:
        "Does this proposal improve the co-op's ability to operate, serve members, support businesses, or deliver reliable workflows?",
    },
    {
      key: "financial_clarity",
      label: "Financial Clarity",
      priorityWeight: 0.20,
      description:
        "Does this proposal include a realistic budget, funding request, revenue or cost impact, and enough detail to track outcomes?",
    },
    {
      key: "accountability",
      label: "Accountability",
      priorityWeight: 0.20,
      description:
        "Does this proposal identify owners, milestones, risks, and reporting expectations so members can understand whether it worked?",
    },
  ];

  // Structural weights must sum to 1
  const structuralWeights = {
    feasibility:    0.40,
    risk:           0.35,
    accountability: 0.25,
  };

  // Score mix must sum to 1
  const scoreMix = {
    missionWeight:    0.60,
    structuralWeight: 0.40,
  };

  const proposalCategories = [
    { key: "business_funding", label: "Business Funding", isActive: true, description: "Capital requests to start, expand, or stabilise a member-owned business. Includes equipment, working capital, licensing, and growth investment." },
    { key: "procurement",      label: "Procurement",      isActive: true, description: "Proposals to establish or formalise collective purchasing agreements, supplier contracts, or bulk-buying arrangements that reduce costs for members." },
    { key: "infrastructure",   label: "Infrastructure",   isActive: true, description: "Investment in shared physical or digital infrastructure — facilities, tools, platforms, or systems that multiple members or the coop as a whole relies on." },
    { key: "transport",        label: "Transport",        isActive: true, description: "Proposals covering logistics, delivery, fleet, or mobility solutions that support member business operations or reduce distribution costs." },
    { key: "wallet_incentive", label: "Wallet Incentive", isActive: true, description: "Programs that reward members for using the co-op's digital wallet." },
    { key: "governance",       label: "Governance",       isActive: true, description: "Changes to coop rules, policies, bylaws, voting structures, or operational procedures. Requires heightened scrutiny and broad member input." },
    { key: "other",            label: "Other",            isActive: true, description: "Proposals that don't fit an existing category. AI will apply general screening; the council may re-categorise before voting." },
  ];

  const sectorExclusions: { value: string; description: string }[] = [];

  // Check if config already exists
  const existing = await prisma.coopConfig.findFirst({
    where: { coopId, isActive: true },
  });

  if (existing) {
    console.log(`  CoopConfig already exists for "${coopId}" (v${existing.version}), skipping.`);
    return;
  }

  const config = await prisma.coopConfig.create({
    data: {
      coopId,
      version: 1,
      isActive: true,
      name: "Cahootz",
      slug: "cahootz",
      tagline: "Building the Infrastructure for Cooperative Economies",
      description:
        "The internal builder cooperative behind the Cahootz ecosystem. Cahootz Coop is made up of the people who build, operate, and maintain the technology and infrastructure that powers Cahootz coops.",
      displayMission:
        "To create and maintain the technology, tools, and systems that allow cooperative economies to function and grow.",
      displayFeatures: [
        {
          title: "Platform Development",
          description:
            "Build and maintain the Cahootz platform, developing software and internal tools that power the entire coop network.",
        },
        {
          title: "Technical Infrastructure",
          description:
            "Support operations and technical infrastructure for the coop network, ensuring reliability and scalability.",
        },
        {
          title: "Shared Systems",
          description:
            "Create shared systems that help coops launch and scale, giving builders and contributors ownership in the ecosystem they create.",
        },
      ],
      eligibility:
        "Open to software engineers, designers, product builders, operators, organizers, and technical contributors building the Cahootz ecosystem",
      bgColor: "bg-blue-700",
      accentColor: "bg-blue-600",
      displayOrder: 3,
      applicationQuestions: [
        {
          id: "technical_role",
          type: "select",
          label: "What's your primary role?",
          required: true,
          options: [
            { value: "engineer", label: "Software Engineer" },
            { value: "designer", label: "Designer" },
            { value: "product", label: "Product Manager" },
            { value: "operator", label: "Operator/Organizer" },
            { value: "other-tech", label: "Other Technical Role" },
          ],
        },
        {
          id: "experience_level",
          type: "select",
          label: "Years of professional experience?",
          required: true,
          options: [
            { value: "0-2", label: "0-2 years" },
            { value: "3-5", label: "3-5 years" },
            { value: "6-10", label: "6-10 years" },
            { value: "over-10", label: "Over 10 years" },
          ],
        },
        {
          id: "skills",
          type: "multiselect",
          label: "What skills can you contribute?",
          description: "Select all that apply",
          required: true,
          options: [
            { value: "frontend", label: "Frontend Development" },
            { value: "backend", label: "Backend Development" },
            { value: "mobile", label: "Mobile Development" },
            { value: "design", label: "UI/UX Design" },
            { value: "devops", label: "DevOps/Infrastructure" },
            { value: "product", label: "Product Management" },
            { value: "community", label: "Community Building" },
            { value: "other", label: "Other" },
          ],
        },
        {
          id: "time_commitment",
          type: "select",
          label: "How much time can you commit monthly?",
          required: true,
          options: [
            { value: "5-10", label: "5-10 hours" },
            { value: "10-20", label: "10-20 hours" },
            { value: "20-40", label: "20-40 hours" },
            { value: "full-time", label: "Full-time" },
          ],
        },
        {
          id: "coop_interest",
          type: "radio",
          label: "Why are you interested in cooperative ownership?",
          required: true,
          options: [
            { value: "ownership", label: "Want ownership in what I build" },
            { value: "mission", label: "Believe in the mission" },
            { value: "community", label: "Want to work with community" },
            { value: "all", label: "All of the above" },
          ],
        },
        {
          id: "motivation",
          type: "textarea",
          label: "Why do you want to join Cahootz? (Optional)",
          placeholder: "Tell us about your interest in building cooperative technology...",
          required: false,
          validation: { maxLength: 500 },
        },
      ],
      charterText,
      missionGoals,
      structuralWeights,
      scoreMix,
      screeningPassThreshold: 0.6,
      quorumPercent: 15,
      approvalThresholdPercent: 51,
      votingWindowDays: 7,
      scVotingCapPercent: 2,
      proposalCategories,
      sectorExclusions,
      minScBalanceToSubmit: 0,
      chainId: envValue("CHAIN_ID") ? Number(envValue("CHAIN_ID")) : undefined,
      chainName: envValue("CHAIN_NAME"),
      rpcUrl: envValue("RPC_URL"),
      scTokenAddress: envValue("SOULAANI_COIN_ADDRESS"),
      allyTokenAddress: envValue("ALLY_COIN_ADDRESS"),
      ucTokenAddress: envValue("UNITY_COIN_ADDRESS"),
      redemptionVaultAddress: envValue("REDEMPTION_VAULT_ADDRESS"),
      treasurySafeAddress: envValue("TREASURY_SAFE_ADDRESS"),
      verifiedStoreRegistryAddress: envValue("VERIFIED_STORE_REGISTRY_ADDRESS"),
      storePaymentRouterAddress: envValue("STORE_PAYMENT_ROUTER_ADDRESS"),
      rewardEngineAddress: envValue("SC_REWARD_ENGINE_ADDRESS"),
      backendWalletAddress: deriveBackendWalletAddress(),
      scTokenSymbol: envValue("SC_TOKEN_SYMBOL") ?? "SC",
      scTokenName: envValue("SC_TOKEN_NAME") ?? "CahootzCoin",
      createdBy: "system",
    },
  });

  console.log(`  Created CoopConfig v1 for "${coopId}" (id: ${config.id})`);
}

console.log("Seeding CoopConfig...");

seedCoopConfig()
  .then(() => {
    console.log("\nDone!");
  })
  .catch((e) => {
    console.error("Error seeding coop config:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
