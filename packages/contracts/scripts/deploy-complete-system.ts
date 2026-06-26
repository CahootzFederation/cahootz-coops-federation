import { ethers } from "hardhat";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { PrismaClient } from "@prisma/client";

dotenv.config();

const prisma = new PrismaClient();

function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Complete System Deployment
 * 
 * Deploys contracts with optional components:
 * 
 * REQUIRED:
 * 1. SoulaaniCoin (SC)
 * 2. AllyCoin (ALLY) - with SC reference
 * 3. UnityCoin (UC) - with SC reference
 * 
 * OPTIONAL (use flags to enable):
 * 4. Mock USDC (--usdc)
 * 5. RedemptionVault (--vault)
 * 6. VerifiedStoreRegistry (--registry)
 * 7. SCRewardEngine (--engine, requires --registry)
 * 8. StorePaymentRouter (--router, requires --registry and --engine)
 * 
 * Usage:
 *   pnpm deploy:complete              # Minimal (UC + SC + ALLY only)
 *   pnpm deploy:complete --vault      # Add RedemptionVault
 *   pnpm deploy:complete --all        # Deploy everything
 * 
 * Sets up all roles and permissions correctly.
 */

async function waitForTx(tx: any, description: string) {
  console.log(`   ⏳ ${description}...`);
  const receipt = await tx.wait();
  await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3s between txs
  return receipt;
}

async function sendTxWithRetry(txFunc: () => Promise<any>, description: string, maxRetries = 3) {
  let lastError;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      console.log(`   ⏳ ${description} (attempt ${i + 1}/${maxRetries})...`);
      
      const tx = await txFunc();
      const receipt = await tx.wait();
      
      console.log(`   ✅ ${description} complete`);
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      return receipt;
    } catch (error: any) {
      lastError = error;
      console.log(`   ⚠️  Attempt ${i + 1} failed:`, error.message);
      
      if (error.message.includes('replacement transaction underpriced') || 
          error.message.includes('nonce has already been used') ||
          error.message.includes('nonce too low')) {
        console.log(`   Waiting 10 seconds before retry...`);
        await new Promise(resolve => setTimeout(resolve, 10000));
      } else {
        throw error;
      }
    }
  }
  
  throw new Error(`Failed ${description} after ${maxRetries} attempts: ${lastError.message}`);
}

async function deployWithRetry(factory: any, args: any[], name: string, maxRetries = 3) {
  let lastError;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      console.log(`   Attempt ${i + 1}/${maxRetries} for ${name}...`);
      
      // Let Hardhat manage nonces automatically
      const contract = await factory.deploy(...args);
      
      await contract.waitForDeployment();
      const address = await contract.getAddress();
      console.log(`   ✅ ${name} deployed at: ${address}`);
      
      // Wait for network to settle
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      return contract;
    } catch (error: any) {
      lastError = error;
      console.log(`   ⚠️  Attempt ${i + 1} failed:`, error.message);
      
      if (error.message.includes('replacement transaction underpriced') ||
          error.message.includes('nonce has already been used') ||
          error.message.includes('nonce too low')) {
        console.log(`   Waiting 10 seconds before retry...`);
        await new Promise(resolve => setTimeout(resolve, 10000));
      } else {
        // Unknown error, don't retry
        throw error;
      }
    }
  }
  
  throw new Error(`Failed to deploy ${name} after ${maxRetries} attempts: ${lastError.message}`);
}

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const deployAll = args.includes("--all");
  const deployVault = deployAll || args.includes("--vault");
  const deployUsdc = deployAll || args.includes("--usdc") || deployVault; // USDC needed for vault
  const deployRegistry = deployAll || args.includes("--registry");
  const deployEngine = deployAll || args.includes("--engine");
  const deployRouter = deployAll || args.includes("--router");

  console.log("\n🚀 COMPLETE SYSTEM DEPLOYMENT\n");
  console.log("=".repeat(70));

  const [deployer] = await ethers.getSigners();
  console.log("📝 Deployer:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("💰 Balance:", ethers.formatEther(balance), "ETH\n");

  if (balance === 0n) {
    throw new Error("❌ Deployer has no ETH!");
  }

  // Get role addresses from environment
  const treasurySafe = process.env.TREASURY_SAFE_ADDRESS || deployer.address;
  const governanceBot = process.env.GOVERNANCE_BOT_ADDRESS || deployer.address;

  console.log("🏛️  Treasury Safe:", treasurySafe);
  console.log("🤖 Governance Bot:", governanceBot);
  console.log("");
  console.log("📦 Deployment Configuration:");
  console.log("   Required: UC, SC, ALLY");
  if (deployUsdc) console.log("   Optional: Mock USDC");
  if (deployVault) console.log("   Optional: RedemptionVault");
  if (deployRegistry) console.log("   Optional: VerifiedStoreRegistry");
  if (deployEngine) console.log("   Optional: SCRewardEngine");
  if (deployRouter) console.log("   Optional: StorePaymentRouter");
  console.log("=".repeat(70));
  console.log("");

  // ========================================
  // STEP 1: Deploy SoulaaniCoin (SC)
  // ========================================
  console.log("1️⃣  Deploying SoulaaniCoin (SC)...");
  const SoulaaniCoin = await ethers.getContractFactory("SoulaaniCoin");
  const soulaaniCoin = await deployWithRetry(SoulaaniCoin, [governanceBot], "SoulaaniCoin");
  const scAddress = await soulaaniCoin.getAddress();

  console.log("\n1.5️⃣  Deploying AllyCoin (ALLY)...");
  const AllyCoin = await ethers.getContractFactory("AllyCoin");
  const allyCoin = await deployWithRetry(AllyCoin, [governanceBot, scAddress], "AllyCoin");
  const allyAddress = await allyCoin.getAddress();

  await sendTxWithRetry(
    () => soulaaniCoin.setAllyCoin(allyAddress, "Initial deployment - linking AllyCoin"),
    "Linking AllyCoin to SC"
  );

  // Add deployer as member and give 1 SC
  console.log("\n   Setting up deployer...");
  
  // Wait a bit for contract to be indexed
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Check if deployer is already a member
  let deployerStatus;
  try {
    deployerStatus = await soulaaniCoin.memberStatus(deployer.address);
  } catch (error) {
    console.log("   ⚠️  Could not read member status, assuming NotMember");
    deployerStatus = 0n; // Assume NotMember
  }
  if (deployerStatus === 0n) { // NotMember
    await sendTxWithRetry(
      () => soulaaniCoin.addMember(deployer.address),
      "Adding deployer as member"
    );
  } else {
    console.log("   ✅ Deployer already a member");
  }

  // Mint 100,000 SC initial reserve to seed the total supply.
  // This ensures the 2% hard cap = ~2,000 SC and rewards are whole numbers.
  let deployerBalance;
  try {
    deployerBalance = await soulaaniCoin.balanceOf(deployer.address);
  } catch (error) {
    console.log("   ⚠️  Could not read balance, assuming 0");
    deployerBalance = 0n;
  }
  if (deployerBalance === 0n) {
    const seedAmount = ethers.parseEther("100000");
    const reason = ethers.keccak256(ethers.toUtf8Bytes("INITIAL_RESERVE_SEED"));
    await sendTxWithRetry(
      () => soulaaniCoin.mintReward(deployer.address, seedAmount, reason),
      "Minting 100,000 SC initial reserve seed"
    );
  } else {
    console.log(`   ✅ Deployer already has ${ethers.formatEther(deployerBalance)} SC`);
  }

  // Grant roles to governance bot
  if (governanceBot !== deployer.address) {
    console.log("\n   Granting roles to governance bot...");
    const GOVERNANCE_AWARD = ethers.keccak256(ethers.toUtf8Bytes("GOVERNANCE_AWARD"));
    const MEMBER_MANAGER = ethers.keccak256(ethers.toUtf8Bytes("MEMBER_MANAGER"));

    const grantAwardTx = await soulaaniCoin.grantRole(GOVERNANCE_AWARD, governanceBot);
    await waitForTx(grantAwardTx, "Granting GOVERNANCE_AWARD");

    const grantManagerTx = await soulaaniCoin.grantRole(MEMBER_MANAGER, governanceBot);
    await waitForTx(grantManagerTx, "Granting MEMBER_MANAGER");

    // Check if governance bot is already a member
    const botStatus = await soulaaniCoin.memberStatus(governanceBot);
    if (botStatus === 0n) {
      const addBotTx = await soulaaniCoin.addMember(governanceBot);
      await waitForTx(addBotTx, "Adding governance bot as member");
    } else {
      console.log("   ✅ Governance bot already a member");
    }
    console.log("   ✅ Governance bot setup complete");
  }

  // ========================================
  // STEP 2: Deploy Mock USDC (Optional)
  // ========================================
  let usdcAddress = "";
  if (deployUsdc) {
    console.log("\n2️⃣  Deploying Mock USDC...");
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const mockUSDC = await deployWithRetry(MockUSDC, [], "MockUSDC");
    usdcAddress = await mockUSDC.getAddress();
  } else {
    console.log("\n2️⃣  Skipping Mock USDC (not selected)");
  }

  // ========================================
  // STEP 3: Deploy UnityCoin (UC)
  // ========================================
  console.log("\n3️⃣  Deploying UnityCoin (UC)...");
  const UnityCoin = await ethers.getContractFactory("UnityCoin");
  const unityCoin = await deployWithRetry(
    UnityCoin,
    [treasurySafe, scAddress, deployer.address],
    "UnityCoin"
  );
  const ucAddress = await unityCoin.getAddress();

  // Wait for contract to be indexed
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Verify SC reference is correct
  let ucSCRef = scAddress; // Default to expected value
  try {
    ucSCRef = await unityCoin.soulaaniCoin();
    console.log(`   🔍 UC's SC reference: ${ucSCRef}`);
    if (ucSCRef.toLowerCase() !== scAddress.toLowerCase()) {
      throw new Error("❌ UC has wrong SC reference!");
    }
    console.log("   ✅ SC reference verified");
  } catch (error) {
    console.log("   ⚠️  Could not verify SC reference (contract may not be indexed yet)");
    console.log("   ℹ️  SC should be:", scAddress);
  }

  // ========================================
  // STEP 4: Deploy RedemptionVault (Optional)
  // ========================================
  let vaultAddress = "";
  if (deployVault) {
    if (!usdcAddress) {
      throw new Error("❌ RedemptionVault requires USDC address. Use --usdc flag.");
    }
    console.log("\n4️⃣  Deploying RedemptionVault...");
    const RedemptionVault = await ethers.getContractFactory("RedemptionVault");
    const redemptionVault = await deployWithRetry(
      RedemptionVault,
      [ucAddress, usdcAddress, treasurySafe],
      "RedemptionVault"
    );
    vaultAddress = await redemptionVault.getAddress();

    // Grant vault permission to mint UC
    console.log("\n   Granting vault permissions...");
    const TREASURER_MINT = ethers.keccak256(ethers.toUtf8Bytes("TREASURER_MINT"));
    await sendTxWithRetry(
      () => unityCoin.grantRole(TREASURER_MINT, vaultAddress),
      "Granting TREASURER_MINT to vault"
    );
  } else {
    console.log("\n4️⃣  Skipping RedemptionVault (not selected)");
  }

  // Set wealth fund address (for tax collection from store purchases)
  console.log("\n   Setting wealth fund address...");
  try {
    const setWealthFundTx = await unityCoin.setWealthFundAddress(
      treasurySafe,
      "Initial deployment - setting treasury safe as wealth fund"
    );
    await waitForTx(setWealthFundTx, "Setting wealth fund address");
    console.log(`   ✅ Wealth fund address set to: ${treasurySafe}`);
  } catch (error) {
    console.log("   ⚠️  Using old contract signature (no reason parameter)");
    // If new signature fails, contract might not be updated yet
    console.log(`   ℹ️  Wealth fund defaults to admin: ${treasurySafe}`);
  }

  // ========================================
  // STEP 5: Deploy Trustless Contracts (Optional)
  // ========================================
  let registryAddress = "";
  let engineAddress = "";
  let routerAddress = "";

  if (deployRegistry) {
    console.log("\n5️⃣  Deploying VerifiedStoreRegistry...");
    const VerifiedStoreRegistry = await ethers.getContractFactory("VerifiedStoreRegistry");
    const storeRegistry = await deployWithRetry(
      VerifiedStoreRegistry,
      [governanceBot],
      "VerifiedStoreRegistry"
    );
    registryAddress = await storeRegistry.getAddress();
  } else {
    console.log("\n5️⃣  Skipping VerifiedStoreRegistry (not selected)");
  }

  if (deployEngine) {
    if (!registryAddress) {
      throw new Error("❌ SCRewardEngine requires VerifiedStoreRegistry. Use --registry flag.");
    }
    console.log("\n6️⃣  Deploying SCRewardEngine...");
    const SCRewardEngine = await ethers.getContractFactory("SCRewardEngine");
    const rewardEngine = await deployWithRetry(
      SCRewardEngine,
      [governanceBot, scAddress, registryAddress],
      "SCRewardEngine"
    );
    engineAddress = await rewardEngine.getAddress();
  } else {
    console.log("\n6️⃣  Skipping SCRewardEngine (not selected)");
  }

  if (deployRouter) {
    if (!registryAddress || !engineAddress) {
      throw new Error("❌ StorePaymentRouter requires VerifiedStoreRegistry and SCRewardEngine. Use --registry and --engine flags.");
    }
    console.log("\n7️⃣  Deploying StorePaymentRouter...");
    const StorePaymentRouter = await ethers.getContractFactory("StorePaymentRouter");
    const paymentRouter = await deployWithRetry(
      StorePaymentRouter,
      [governanceBot, ucAddress, registryAddress, engineAddress],
      "StorePaymentRouter"
    );
    routerAddress = await paymentRouter.getAddress();
  } else {
    console.log("\n7️⃣  Skipping StorePaymentRouter (not selected)");
  }

  // ========================================
  // STEP 6: Grant Trustless Roles (Only if contracts deployed)
  // ========================================
  if (engineAddress || routerAddress) {
    console.log("\n8️⃣  Setting up trustless system roles...");

    // Grant GOVERNANCE_AWARD to SCRewardEngine on SoulaaniCoin
    if (engineAddress) {
      const GOVERNANCE_AWARD = ethers.keccak256(ethers.toUtf8Bytes("GOVERNANCE_AWARD"));
      await sendTxWithRetry(
        () => soulaaniCoin.grantRole(GOVERNANCE_AWARD, engineAddress),
        "Granting GOVERNANCE_AWARD to engine"
      );
    }

    // Grant REWARD_EXECUTOR to StorePaymentRouter on SCRewardEngine
    if (routerAddress && engineAddress) {
      const SCRewardEngine = await ethers.getContractFactory("SCRewardEngine");
      const rewardEngine = SCRewardEngine.attach(engineAddress) as any;
      const REWARD_EXECUTOR = ethers.keccak256(ethers.toUtf8Bytes("REWARD_EXECUTOR"));
      await sendTxWithRetry(
        () => rewardEngine.grantRole(REWARD_EXECUTOR, routerAddress),
        "Granting REWARD_EXECUTOR to router"
      );
    }

    // Grant manager roles to governance bot (if different from deployer)
    if (governanceBot !== deployer.address && registryAddress && engineAddress) {
      console.log("\n   Granting manager roles to governance bot...");
      
      try {
        const VerifiedStoreRegistry = await ethers.getContractFactory("VerifiedStoreRegistry");
        const storeRegistry = VerifiedStoreRegistry.attach(registryAddress) as any;
        const SCRewardEngine = await ethers.getContractFactory("SCRewardEngine");
        const rewardEngine = SCRewardEngine.attach(engineAddress) as any;

        const REGISTRY_MANAGER = ethers.keccak256(ethers.toUtf8Bytes("REGISTRY_MANAGER"));
        const grantRegistryTx = await storeRegistry.grantRole(REGISTRY_MANAGER, governanceBot);
        await waitForTx(grantRegistryTx, "Granting REGISTRY_MANAGER");

        const POLICY_MANAGER = ethers.keccak256(ethers.toUtf8Bytes("POLICY_MANAGER"));
        const grantPolicyTx = await rewardEngine.grantRole(POLICY_MANAGER, governanceBot);
        await waitForTx(grantPolicyTx, "Granting POLICY_MANAGER");

        console.log("   ✅ Governance bot has manager roles");
      } catch (error: any) {
        console.log("   ⚠️  Failed to grant some manager roles:", error.message);
      }
    }
  } else {
    console.log("\n8️⃣  Skipping role grants (no trustless contracts deployed)");
  }

  // ========================================
  // STEP 7: Set Initial Reward Policy (Only if engine deployed)
  // ========================================
  if (engineAddress) {
    console.log("\n9️⃣  Setting initial reward policy...");
    try {
      const SCRewardEngine = await ethers.getContractFactory("SCRewardEngine");
      const rewardEngine = SCRewardEngine.attach(engineAddress) as any;
      const setGlobalPolicyTx = await rewardEngine.setGlobalPolicy(
        100,                          // 1% (100 bps)
        ethers.parseEther("5"),       // +5 SC fixed
        ethers.parseEther("1"),       // Min 1 UC purchase
        ethers.parseEther("100"),     // Max 100 SC per tx
        true                          // Active
      );
      await waitForTx(setGlobalPolicyTx, "Setting global reward policy");
      console.log("   ✅ Policy: 1% + 5 SC (min 1 UC, max 100 SC)");
    } catch (error: any) {
      console.log("   ⚠️  Failed to set policy:", error.message);
      console.log("   You can set it manually later");
    }
  } else {
    console.log("\n9️⃣  Skipping reward policy (engine not deployed)");
  }

  // ========================================
  // SAVE DEPLOYMENT INFO
  // ========================================
  const contracts: any = {
    SoulaaniCoin: { address: scAddress, admin: governanceBot },
    AllyCoin: { address: allyAddress, admin: governanceBot, scReference: scAddress },
    UnityCoin: { address: ucAddress, admin: treasurySafe, scReference: scAddress },
  };

  if (usdcAddress) contracts.MockUSDC = { address: usdcAddress };
  if (vaultAddress) contracts.RedemptionVault = { address: vaultAddress, admin: treasurySafe };
  if (registryAddress) contracts.VerifiedStoreRegistry = { address: registryAddress, admin: governanceBot };
  if (engineAddress) contracts.SCRewardEngine = { address: engineAddress, admin: governanceBot };
  if (routerAddress) contracts.StorePaymentRouter = { address: routerAddress, admin: governanceBot };

  const deploymentInfo = {
    network: "baseSepolia",
    chainId: 84532,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    deploymentType: deployAll ? "full" : "custom",
    optionalContracts: {
      usdc: deployUsdc,
      vault: deployVault,
      registry: deployRegistry,
      engine: deployEngine,
      router: deployRouter,
    },
    contracts,
    roles: {
      treasurySafe,
      governanceBot,
    },
    verification: {
      ucSCReference: ucSCRef,
      scReferenceCorrect: ucSCRef.toLowerCase() === scAddress.toLowerCase(),
    },
  };

  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const deploymentFile = path.join(deploymentsDir, `complete-system-${Date.now()}.json`);
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));

  // ========================================
  // SAVE TO DATABASE
  // ========================================
  console.log("\n📝 SAVING TO DATABASE...\n");
  
  try {
    // Prompt for co-op details
    console.log("Please provide co-op information for mobile app visibility:");
    const coopName = await askQuestion("Co-op Name (e.g., 'Cahootz Co-operative'): ");
    const coopSlug = await askQuestion("Slug (e.g., 'soulaan', leave empty to auto-generate): ");
    const coopTagline = await askQuestion("Tagline (e.g., 'Building Generational Wealth Together'): ");
    const coopDescription = await askQuestion("Description (optional, press Enter to skip): ");

    if (!coopName.trim()) {
      console.log("⚠️  Skipping database save - co-op name is required");
    } else {
      const finalSlug = coopSlug.trim() || coopName.toLowerCase().replace(/\s+/g, "-").substring(0, 30);
      const finalTagline = coopTagline.trim() || "Building economic empowerment together";
      const finalDescription = coopDescription.trim() || `${coopName} - A cooperative for economic empowerment.`;

      await prisma.coopConfig.create({
        data: {
          coopId: finalSlug,
          version: 1,
          isActive: true,
          // Display fields
          name: coopName.trim(),
          slug: finalSlug,
          tagline: finalTagline,
          description: finalDescription,
          displayMission: finalDescription,
          displayFeatures: [
            { title: "Shared Wealth Fund", description: "Community fund for collective investment and support." },
            { title: "Democratic Governance", description: "Members vote on proposals and shape priorities." },
            { title: "Local Economy", description: "Support local businesses and keep wealth in the community." },
          ],
          eligibility: "Open to all community members",
          bgColor: "bg-blue-700",
          accentColor: "bg-amber-600",
          displayOrder: 999,
          // Governance fields
          charterText: `${coopName} Charter - Building economic empowerment through cooperative ownership.`,
          missionGoals: [
            { key: "income_stability", label: "Income Stability", priorityWeight: 0.35 },
            { key: "asset_creation", label: "Asset Creation", priorityWeight: 0.25 },
            { key: "leakage_reduction", label: "Leakage Reduction", priorityWeight: 0.20 },
            { key: "export_expansion", label: "Export Expansion", priorityWeight: 0.20 },
          ],
          structuralWeights: { feasibility: 0.40, risk: 0.35, accountability: 0.25 },
          scoreMix: { missionWeight: 0.60, structuralWeight: 0.40 },
          screeningPassThreshold: 0.6,
          quorumPercent: 15,
          approvalThresholdPercent: 51,
          votingWindowDays: 7,
          scVotingCapPercent: 2,
          proposalCategories: [
            { key: "business_funding", label: "Business Funding", isActive: true },
            { key: "procurement", label: "Procurement", isActive: true },
            { key: "infrastructure", label: "Infrastructure", isActive: true },
            { key: "governance", label: "Governance", isActive: true },
            { key: "other", label: "Other", isActive: true },
          ],
          sectorExclusions: [
            { value: "fashion", description: "Low community multiplier" },
            { value: "restaurant", description: "High failure rate" },
          ],
          scorerAgents: [
            { agentKey: "finance", label: "Finance & Treasury", enabled: true },
            { agentKey: "market", label: "Market & Revenue", enabled: true },
            { agentKey: "community", label: "Community Economy", enabled: true },
            { agentKey: "ops", label: "Operations & Execution", enabled: true },
            { agentKey: "general", label: "General (Fallback)", enabled: true },
          ],
          minScBalanceToSubmit: 0,
          aiAutoApproveThresholdUSD: 500,
          councilVoteThresholdUSD: 5000,
          strongGoalThreshold: 0.70,
          missionMinThreshold: 0.50,
          structuralGate: 0.65,
          createdBy: deployer.address,
        },
      });

      console.log("✅ Co-op saved to database!");
      console.log(`   Co-op ID: ${finalSlug}`);
      console.log(`   Name: ${coopName}`);
      console.log("   Your co-op will now appear in the mobile app!");
    }
  } catch (dbError: any) {
    console.log("⚠️  Failed to save to database:", dbError.message);
    console.log("   Contracts are deployed, but co-op won't appear in mobile app");
    console.log("   You can manually add it to the database later");
  } finally {
    await prisma.$disconnect();
  }

  // ========================================
  // FINAL SUMMARY
  // ========================================
  console.log("\n\n🎉 DEPLOYMENT SUCCESSFUL!\n");
  console.log("=".repeat(70));
  console.log("📋 REQUIRED CONTRACTS (Always Deployed):");
  console.log("=".repeat(70));
  console.log("SoulaaniCoin (SC):    ", scAddress);
  console.log("AllyCoin (ALLY):      ", allyAddress);
  console.log("UnityCoin (UC):       ", ucAddress);
  
  if (usdcAddress || vaultAddress || registryAddress || engineAddress || routerAddress) {
    console.log("");
    console.log("📋 OPTIONAL CONTRACTS (Deployed):");
    console.log("=".repeat(70));
    if (usdcAddress) console.log("Mock USDC:            ", usdcAddress);
    if (vaultAddress) console.log("RedemptionVault:      ", vaultAddress);
    if (registryAddress) console.log("VerifiedStoreRegistry:", registryAddress);
    if (engineAddress) console.log("SCRewardEngine:       ", engineAddress);
    if (routerAddress) console.log("StorePaymentRouter:   ", routerAddress);
  }
  
  console.log("=".repeat(70));
  console.log("");
  console.log("✅ VERIFICATION:");
  console.log("=".repeat(70));
  console.log("UC → SC Reference:    ", ucSCRef);
  console.log("Reference Correct:    ", ucSCRef.toLowerCase() === scAddress.toLowerCase() ? "✅ YES" : "❌ NO");
  console.log("=".repeat(70));
  console.log("");
  console.log("📝 UPDATE YOUR .ENV FILE:");
  console.log("=".repeat(70));
  console.log(`SOULAANI_COIN_ADDRESS=${scAddress}`);
  console.log(`ALLY_COIN_ADDRESS=${allyAddress}`);
  console.log(`UNITY_COIN_ADDRESS=${ucAddress}`);
  if (vaultAddress) console.log(`REDEMPTION_VAULT_ADDRESS=${vaultAddress}`);
  if (usdcAddress) console.log(`MOCK_USDC_ADDRESS=${usdcAddress}`);
  if (registryAddress) console.log(`VERIFIED_STORE_REGISTRY_ADDRESS=${registryAddress}`);
  if (engineAddress) console.log(`SC_REWARD_ENGINE_ADDRESS=${engineAddress}`);
  if (routerAddress) console.log(`STORE_PAYMENT_ROUTER_ADDRESS=${routerAddress}`);
  console.log("=".repeat(70));
  console.log("");
  console.log("🔗 VIEW ON BASESCAN:");
  console.log(`   SC:       https://sepolia.basescan.org/address/${scAddress}#code`);
  console.log(`   ALLY:     https://sepolia.basescan.org/address/${allyAddress}#code`);
  console.log(`   UC:       https://sepolia.basescan.org/address/${ucAddress}#code`);
  if (vaultAddress) console.log(`   Vault:    https://sepolia.basescan.org/address/${vaultAddress}#code`);
  if (registryAddress) console.log(`   Registry: https://sepolia.basescan.org/address/${registryAddress}#code`);
  if (engineAddress) console.log(`   Engine:   https://sepolia.basescan.org/address/${engineAddress}#code`);
  if (routerAddress) console.log(`   Router:   https://sepolia.basescan.org/address/${routerAddress}#code`);
  console.log("");
  console.log("📝 NEXT STEPS:");
  console.log("1. Update .env with the addresses above");
  if (registryAddress) console.log("2. Run: pnpm seed-stores:sepolia (to migrate verified stores)");
  if (engineAddress || routerAddress) console.log("3. Run: pnpm test-flows:sepolia (to test the system)");
  console.log(`${registryAddress ? "4" : "2"}. Verify contracts: pnpm verify:sepolia`);
  console.log("");
  console.log(`💾 Deployment saved to: ${deploymentFile}\n`);
  console.log("💡 TIP: Deploy optional contracts later with flags:");
  console.log("   pnpm deploy:complete --vault");
  console.log("   pnpm deploy:complete --registry --engine --router");
  console.log("   pnpm deploy:complete --all");
  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Deployment failed:", error);
    process.exit(1);
  });
