import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

/**
 * Setup script to add admins after contract deployment
 * 
 * This script:
 * 1. Loads the latest deployment info
 * 2. Prompts for admin wallet addresses
 * 3. Adds them as members
 * 4. Awards them 1 SC each
 * 
 * Usage:
 *   pnpm hardhat run scripts/setup-admins.ts --network baseSepolia
 */

interface AdminInfo {
  address: string;
  name?: string;
  note?: string;
}

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (query: string): Promise<string> => {
    return new Promise((resolve) => rl.question(query, resolve));
  };

  console.log("\n🔐 Cahootz Co-op Admin Setup");
  console.log("================================\n");

  // Load latest deployment
  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    console.error("❌ No deployments found. Run deploy.ts first.");
    rl.close();
    return;
  }

  const files = fs.readdirSync(deploymentsDir);
  const deploymentFiles = files
    .filter((f) => f.endsWith(".json") && f.includes(network.name))
    .sort();

  if (deploymentFiles.length === 0) {
    console.error(`❌ No deployment found for network: ${network.name}`);
    rl.close();
    return;
  }

  const latestDeployment = deploymentFiles[deploymentFiles.length - 1];
  const deployment = JSON.parse(
    fs.readFileSync(path.join(deploymentsDir, latestDeployment), "utf8")
  );

  console.log("📋 Deployment Info:");
  console.log("Network:", deployment.network);
  console.log("Deployed:", new Date(deployment.deployedAt).toLocaleString());
  console.log("SoulaaniCoin:", deployment.contracts.SoulaaniCoin.address);
  console.log("");

  // Connect to SoulaaniCoin
  const [signer] = await ethers.getSigners();
  console.log("🔑 Using account:", signer.address);

  const SC = await ethers.getContractFactory("SoulaaniCoin");
  const sc = await SC.attach(deployment.contracts.SoulaaniCoin.address);

  // Check if signer has governance role
  const GOVERNANCE_ROLE = await sc.GOVERNANCE_ROLE();
  const hasGovernanceRole = await sc.hasRole(GOVERNANCE_ROLE, signer.address);

  if (!hasGovernanceRole) {
    console.error("❌ Your account does not have GOVERNANCE_ROLE");
    console.error("   Only governance accounts can add admins.");
    rl.close();
    return;
  }

  console.log("✅ You have GOVERNANCE_ROLE\n");

  // Load config file if it exists
  const configPath = path.join(__dirname, "../deployment-config.json");
  let configAdmins: AdminInfo[] = [];

  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const networkConfig = config[network.name];
    if (networkConfig?.initialAdmins) {
      configAdmins = networkConfig.initialAdmins.filter(
        (admin: AdminInfo) => admin.address && ethers.isAddress(admin.address)
      );
      if (configAdmins.length > 0) {
        console.log("📝 Found admins in config file:");
        configAdmins.forEach((admin, i) => {
          console.log(`   ${i + 1}. ${admin.name || "Admin"}: ${admin.address}`);
        });
        console.log("");
      }
    }
  }

  // Ask if user wants to use config or enter manually
  let adminAddresses: AdminInfo[] = [];

  if (configAdmins.length > 0) {
    const useConfig = await question(
      "Use admins from config file? (yes/no): "
    );
    if (useConfig.toLowerCase() === "yes") {
      adminAddresses = configAdmins;
    }
  }

  // If not using config, prompt for addresses
  if (adminAddresses.length === 0) {
    console.log("Enter admin wallet addresses (press Enter with empty input to finish):\n");
    let index = 1;
    while (true) {
      const address = await question(`Admin ${index} address: `);
      if (!address.trim()) break;

      if (!ethers.isAddress(address.trim())) {
        console.log("⚠️  Invalid address, please try again.");
        continue;
      }

      const name = await question(`Admin ${index} name (optional): `);
      adminAddresses.push({
        address: address.trim(),
        name: name.trim() || `Admin ${index}`,
      });
      index++;
    }
  }

  if (adminAddresses.length === 0) {
    console.log("No admins to add.");
    rl.close();
    return;
  }

  // Confirm
  console.log(`\n📋 Summary: Adding ${adminAddresses.length} admin(s):`);
  adminAddresses.forEach((admin, i) => {
    console.log(`   ${i + 1}. ${admin.name}: ${admin.address}`);
  });

  const confirm = await question("\nProceed? (yes/no): ");
  if (confirm.toLowerCase() !== "yes") {
    console.log("Cancelled.");
    rl.close();
    return;
  }

  console.log("\n🚀 Starting admin setup...\n");

  // Process each admin
  const results: Array<{
    address: string;
    name?: string;
    success: boolean;
    error?: string;
  }> = [];

  for (const admin of adminAddresses) {
    console.log(`\n➕ Processing: ${admin.name} (${admin.address})`);

    try {
      // Check if already a member
      const isMember = await sc.isActiveMember(admin.address);
      if (!isMember) {
        console.log("   Adding as member...");
        const addTx = await sc.addMember(admin.address);
        await addTx.wait();
        console.log("   ✅ Added as member");
      } else {
        console.log("   ℹ️  Already a member");
      }

      // Check current balance
      const currentBalance = await sc.balanceOf(admin.address);
      console.log(
        `   Current SC balance: ${ethers.formatEther(currentBalance)} SC`
      );

      // Award 1 SC if they don't have any
      if (currentBalance === 0n) {
        console.log("   Awarding 1 SC...");
        const oneToken = ethers.parseEther("1");
        const reason = ethers.keccak256(
          ethers.toUtf8Bytes("ADMIN_ALLOCATION")
        );
        const awardTx = await sc.award(admin.address, oneToken, reason);
        await awardTx.wait();
        console.log("   ✅ Awarded 1 SC");
      } else {
        console.log("   ℹ️  Already has SC, skipping award");
      }

      // Verify final balance
      const finalBalance = await sc.balanceOf(admin.address);
      console.log(
        `   Final SC balance: ${ethers.formatEther(finalBalance)} SC`
      );

      // Grant all 3 governance roles to make them full governors
      console.log("   Granting governance roles...");

      const GOVERNANCE_AWARD = await sc.GOVERNANCE_AWARD();
      const GOVERNANCE_SLASH = await sc.GOVERNANCE_SLASH();
      const MEMBER_MANAGER = await sc.MEMBER_MANAGER();

      const grantAwardTx = await sc.grantRole(GOVERNANCE_AWARD, admin.address);
      await grantAwardTx.wait();
      console.log("   ✅ Granted GOVERNANCE_AWARD role");

      const grantSlashTx = await sc.grantRole(GOVERNANCE_SLASH, admin.address);
      await grantSlashTx.wait();
      console.log("   ✅ Granted GOVERNANCE_SLASH role");

      const grantManagerTx = await sc.grantRole(MEMBER_MANAGER, admin.address);
      await grantManagerTx.wait();
      console.log("   ✅ Granted MEMBER_MANAGER role");

      results.push({
        address: admin.address,
        name: admin.name,
        success: true,
      });
    } catch (error: any) {
      console.error(`   ❌ Error: ${error.message}`);
      results.push({
        address: admin.address,
        name: admin.name,
        success: false,
        error: error.message,
      });
    }
  }

  // Summary
  console.log("\n\n" + "=".repeat(60));
  console.log("📊 ADMIN SETUP SUMMARY");
  console.log("=".repeat(60));

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  console.log(`✅ Successful: ${successful.length}`);
  successful.forEach((r) => {
    console.log(`   - ${r.name}: ${r.address}`);
  });

  if (failed.length > 0) {
    console.log(`\n❌ Failed: ${failed.length}`);
    failed.forEach((r) => {
      console.log(`   - ${r.name}: ${r.address}`);
      console.log(`     Error: ${r.error}`);
    });
  }

  console.log("\n" + "=".repeat(60));
  console.log("\n🎉 Admin setup complete!");
  console.log("\nNext steps:");
  console.log("1. Verify admins can log in to the admin panel");
  console.log("2. Test admin functionality");
  console.log("3. Consider transferring GOVERNANCE_ROLE to a multi-sig\n");

  rl.close();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Setup failed:", error);
    process.exit(1);
  });

