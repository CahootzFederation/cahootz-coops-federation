import { ethers } from "hardhat";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * Update SoulaaniCoin Reference in UnityCoin
 * 
 * This script allows you to update the SC contract reference in UC
 * after deploying a new SC contract. Useful when you need to upgrade SC independently.
 * 
 * Usage:
 *   1. Deploy new SC contract
 *   2. Update SOULAANI_COIN_ADDRESS in .env
 *   3. Run: npx hardhat run scripts/update-sc-reference.ts --network baseSepolia
 */

async function main() {
  console.log("\n🔄 UPDATE SOULAANI COIN REFERENCE IN UNITY COIN\n");
  console.log("=".repeat(70));
  
  const [deployer] = await ethers.getSigners();
  console.log("📝 Deployer account:", deployer.address);
  console.log("");

  const UC_ADDRESS = process.env.UNITY_COIN_ADDRESS;
  const NEW_SC_ADDRESS = process.env.SOULAANI_COIN_ADDRESS;

  if (!UC_ADDRESS || !NEW_SC_ADDRESS) {
    throw new Error("Missing UNITY_COIN_ADDRESS or SOULAANI_COIN_ADDRESS in .env");
  }

  console.log("📋 Contract Addresses:");
  console.log(`   UnityCoin: ${UC_ADDRESS}`);
  console.log(`   New SoulCoin: ${NEW_SC_ADDRESS}`);
  console.log("=".repeat(70));
  console.log("");

  // Connect to UC contract
  const unityCoin = await ethers.getContractAt("UnityCoin", UC_ADDRESS);

  // Check current SC address
  const currentSC = await unityCoin.soulaaniCoin();
  console.log("🔍 Current SC address in UC:", currentSC);
  
  if (currentSC.toLowerCase() === NEW_SC_ADDRESS.toLowerCase()) {
    console.log("✅ UC already points to the correct SC address. Nothing to update.\n");
    return;
  }

  console.log("🔄 Updating SC reference...\n");

  // Check if we have admin role
  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash; // 0x00...00
  const hasAdminRole = await unityCoin.hasRole(DEFAULT_ADMIN_ROLE, deployer.address);
  
  if (!hasAdminRole) {
    throw new Error("❌ Deployer does not have DEFAULT_ADMIN_ROLE on UnityCoin");
  }

  // Update the SC reference
  try {
    // Try to estimate gas first to get better error message
    const gasEstimate = await unityCoin.setSoulaaniCoinAddress.estimateGas(NEW_SC_ADDRESS);
    console.log(`   Gas estimate: ${gasEstimate}`);
    
    const tx = await unityCoin.setSoulaaniCoinAddress(NEW_SC_ADDRESS);
    console.log("   ⏳ Waiting for transaction...");
    console.log(`   TX hash: ${tx.hash}`);
    await tx.wait();
  } catch (error: any) {
    console.error("\n❌ Transaction failed:");
    console.error("   Error:", error.message);
    if (error.data) {
      console.error("   Data:", error.data);
    }
    throw error;
  }
  
  // Verify update
  const updatedSC = await unityCoin.soulaaniCoin();
  console.log(`\n✅ SC reference updated!`);
  console.log(`   Old: ${currentSC}`);
  console.log(`   New: ${updatedSC}`);
  console.log("");
  console.log("🔗 View on BaseScan:");
  console.log(`   https://sepolia.basescan.org/address/${UC_ADDRESS}`);
  console.log("");
  console.log("⚠️  IMPORTANT: You may need to migrate member data to the new SC contract!");
  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Update failed:", error);
    process.exit(1);
  });
