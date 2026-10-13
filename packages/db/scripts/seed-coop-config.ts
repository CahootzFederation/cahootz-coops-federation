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
