import { ethers } from "hardhat";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

dotenv.config();

/**
 * Helper function to wait between transactions
 */
async function waitForTx(tx: any, description: string) {
  console.log(`   ⏳ Waiting for: ${description}...`);
  const receipt = await tx.wait();
  await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds between txs
  return receipt;
}

/**
 * Deploy all Cahootz co-op contracts to Base Sepolia
 *
 * This script deploys:
 * 1. AllyCoin (ALLY) - Non-transferable ally token
 * 2. UnityCoin (UC) - ERC-20 stablecoin
 * 3. SoulaaniCoin (SC) - Non-transferable governance token
 * 4. RedemptionVault - Vault for UC redemptions
 *
 * It then grants roles to appropriate addresses and saves deployment info.
 */
async function main() {
  console.log("\n🚀 Starting Cahootz Co-op Contract Deployment...\n");

  // Get deployer account
  const [deployer] = await ethers.getSigners();
  console.log("📝 Deploying contracts with account:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("💰 Account balance:", ethers.formatEther(balance), "ETH\n");

  if (balance === 0n) {
    throw new Error(
      "❌ Deployer account has no ETH! Get test ETH from: https://www.coinbase.com/faucets/base-ethereum-goerli-faucet"
    );
  }

  // Get role addresses from environment
  const treasurySafe = process.env.TREASURY_SAFE_ADDRESS || deployer.address;
  const governanceBot = process.env.GOVERNANCE_BOT_ADDRESS || deployer.address;

  console.log("🏛️  Treasury Safe address:", treasurySafe);
  console.log("🤖 Governance Bot address:", governanceBot);
  console.log("");

  if (treasurySafe === deployer.address || governanceBot === deployer.address) {
    console.log("⚠️  WARNING: Using deployer address for roles. You should update these later!\n");
  }

  // ========== DEPLOY SOULAANICOIN (SC) FIRST ==========
  console.log("1️⃣  Deploying SoulaaniCoin (SC)...");
  const SoulaaniCoin = await ethers.getContractFactory("SoulaaniCoin");
  const soulaaniCoin = await SoulaaniCoin.deploy(governanceBot);
  await soulaaniCoin.waitForDeployment();
  const scAddress = await soulaaniCoin.getAddress();
  console.log("✅ SoulaaniCoin deployed to:", scAddress);

  console.log("\n1.5️⃣  Deploying AllyCoin (ALLY)...");
  const AllyCoin = await ethers.getContractFactory("AllyCoin");
  const allyCoin = await AllyCoin.deploy(governanceBot, scAddress);
  await allyCoin.waitForDeployment();
  const allyAddress = await allyCoin.getAddress();
  console.log("✅ AllyCoin deployed to:", allyAddress);

  console.log("   Linking SC to AllyCoin...");
  const linkAllyTx = await soulaaniCoin.setAllyCoin(
    allyAddress,
    "Initial deployment - linking AllyCoin"
  );
  await waitForTx(linkAllyTx, "setAllyCoin");
  console.log("   ✅ SoulaaniCoin linked to AllyCoin");

  // ========== GIVE DEPLOYER 1 SC ==========
  console.log("\n2️⃣  Setting up deployer with 1 SC...");

  // Step 1: Add deployer as a member
  console.log("   Adding deployer as member...");
  const addMemberTx = await soulaaniCoin.addMember(deployer.address);
  await waitForTx(addMemberTx, "addMember");
  console.log("   ✅ Deployer added as member");

  // Step 2: Award 1 SC to deployer
  console.log("   Awarding 1 SC to deployer...");
  const oneToken = ethers.parseEther("1"); // 1 SC
  const reason = ethers.keccak256(ethers.toUtf8Bytes("INITIAL_ADMIN_ALLOCATION"));
  const awardTx = await soulaaniCoin.mintReward(deployer.address, oneToken, reason);
  await waitForTx(awardTx, "mintReward");
  console.log("   ✅ 1 SC awarded to deployer");

  // Verify the balance
  const deployerBalance = await soulaaniCoin.balanceOf(deployer.address);
  console.log("   💰 Deployer SC balance:", ethers.formatEther(deployerBalance), "SC");

  // ========== GRANT ROLES TO GOVERNANCE BOT ==========
  console.log("\n2.5️⃣  Granting roles to governance bot...");
  const GOVERNANCE_AWARD = ethers.keccak256(ethers.toUtf8Bytes("GOVERNANCE_AWARD"));
  const MEMBER_MANAGER = ethers.keccak256(ethers.toUtf8Bytes("MEMBER_MANAGER"));
  
  if (governanceBot !== deployer.address) {
    console.log("   Granting GOVERNANCE_AWARD to:", governanceBot);
    const grantAwardTx = await soulaaniCoin.grantRole(GOVERNANCE_AWARD, governanceBot);
    await waitForTx(grantAwardTx, "grantRole(GOVERNANCE_AWARD)");
    console.log("   ✅ Governance bot can now mint SC rewards");
    
    console.log("   Granting MEMBER_MANAGER to:", governanceBot);
    const grantManagerTx = await soulaaniCoin.grantRole(MEMBER_MANAGER, governanceBot);
    await waitForTx(grantManagerTx, "grantRole(MEMBER_MANAGER)");
    console.log("   ✅ Governance bot can now manage members");
    
    // Add governance bot as a member so it can receive SC if needed
    console.log("   Adding governance bot as member...");
    const addBotMemberTx = await soulaaniCoin.addMember(governanceBot);
    await waitForTx(addBotMemberTx, "addMember(governanceBot)");
    console.log("   ✅ Governance bot added as member");
  } else {
    console.log("   ⚠️  Governance bot is deployer - skipping (already has admin role)");
  }

  // ========== DEPLOY MOCK USDC FOR TESTING ==========
  console.log("\n3️⃣  Deploying Mock USDC (for testing)...");
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const mockUSDC = await MockUSDC.deploy();
  await mockUSDC.waitForDeployment();
  const usdcAddress = await mockUSDC.getAddress();
  console.log("✅ Mock USDC deployed to:", usdcAddress);

  // ========== DEPLOY UNITYCOIN (UC) WITH TEMPORARY VAULT ADDRESS ==========
  console.log("\n4️⃣  Deploying UnityCoin (UC) with temporary vault address...");
  const UnityCoin = await ethers.getContractFactory("UnityCoin");
  const unityCoin = await UnityCoin.deploy(
    treasurySafe,      // admin
    scAddress,         // SoulaaniCoin address
    deployer.address   // Temporary vault address (will be replaced)
  );
  await unityCoin.waitForDeployment();
  const ucAddress = await unityCoin.getAddress();
  console.log("✅ UnityCoin deployed to:", ucAddress);

  // ========== DEPLOY REDEMPTIONVAULT ==========
  console.log("\n5️⃣  Deploying RedemptionVault...");
  const RedemptionVault = await ethers.getContractFactory("RedemptionVault");
  const redemptionVault = await RedemptionVault.deploy(
    ucAddress,         // UC address
    usdcAddress,       // USDC address
    treasurySafe       // admin
  );
  await redemptionVault.waitForDeployment();
  const vaultAddress = await redemptionVault.getAddress();
  console.log("✅ RedemptionVault deployed to:", vaultAddress);

  // ========== GRANT VAULT PERMISSION TO MINT UC ==========
  console.log("\n6️⃣  Granting RedemptionVault permission to mint UC...");
  const TREASURER_MINT = ethers.keccak256(ethers.toUtf8Bytes("TREASURER_MINT"));
  const grantMintTx = await unityCoin.grantRole(TREASURER_MINT, vaultAddress);
  await waitForTx(grantMintTx, "grantRole");
  console.log("✅ RedemptionVault can now mint UC for USDC onboarding");

  // ========== SETUP COMPLETE ==========
  console.log("\n\n🎉 DEPLOYMENT COMPLETE!\n");
  console.log("=".repeat(60));
  console.log("📋 DEPLOYED CONTRACT ADDRESSES:");
  console.log("=".repeat(60));
  console.log("SoulaaniCoin (SC):   ", scAddress);
  console.log("Mock USDC:           ", usdcAddress);
  console.log("AllyCoin (ALLY):     ", allyAddress);
  console.log("RedemptionVault:     ", vaultAddress);
  console.log("UnityCoin (UC):      ", ucAddress);
  console.log("=".repeat(60));
  console.log("");
  console.log("🔑 ROLE ASSIGNMENTS:");
  console.log("=".repeat(60));
  console.log("UC Admin/Treasurer/Pauser:     ", treasurySafe);
  console.log("SC Admin:                      ", governanceBot);
  console.log("SC GOVERNANCE_MANAGER:         ", governanceBot);
  console.log("SC GOVERNANCE_AWARD (minting): ", governanceBot);
  console.log("SC MEMBER_MANAGER (add members):", governanceBot);
  console.log("ALLY Admin:                    ", governanceBot);
  console.log("Vault Admin/Treasurer:         ", treasurySafe);
  console.log("=".repeat(60));
  console.log("");
  console.log("📝 NEXT STEPS:");
  console.log("1. Verify contracts on BaseScan:");
  console.log("   pnpm verify:sepolia");
  console.log("");
  console.log("2. If you used your own address for roles, transfer them:");
  console.log("   - UC: grantRole() to Treasury Safe, then renounceRole()");
  console.log("   - SC: grantRole() to Governance Bot, then renounceRole()");
  console.log("");
  console.log("3. View on BaseScan:");
  console.log(`   https://sepolia.basescan.org/address/${ucAddress}`);
  console.log(`   https://sepolia.basescan.org/address/${scAddress}`);
  console.log(`   https://sepolia.basescan.org/address/${vaultAddress}`);
  console.log("");

  // Save deployment info to JSON file
  const deploymentInfo = {
    network: "baseSepolia",
    chainId: 84532,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      SoulaaniCoin: {
        address: scAddress,
        admin: governanceBot,
      },
      AllyCoin: {
        address: allyAddress,
        admin: governanceBot,
      },
      MockUSDC: {
        address: usdcAddress,
      },
      RedemptionVault: {
        address: vaultAddress,
        admin: treasurySafe,
      },
      UnityCoin: {
        address: ucAddress,
        admin: treasurySafe,
      },
    },
    roles: {
      treasurySafe,
      governanceBot,
    },
  };

  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const deploymentFile = path.join(deploymentsDir, `baseSepolia-${Date.now()}.json`);
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));
  console.log(`💾 Deployment info saved to: ${deploymentFile}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Deployment failed:", error);
    process.exit(1);
  });
