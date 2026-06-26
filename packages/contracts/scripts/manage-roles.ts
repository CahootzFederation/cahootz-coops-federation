import { ethers } from "hardhat";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * Manage roles for UC and SC contracts
 *
 * This script helps you:
 * - Grant roles to new addresses
 * - Revoke roles from addresses
 * - Check who has which roles
 * - Renounce your own roles (give up admin power)
 */

// Role definitions (must match contracts)
const ROLES = {
  // UC (UnityCoin) roles
  UC: {
    DEFAULT_ADMIN: ethers.ZeroHash, // 0x000...
    TREASURER_MINT: ethers.id("TREASURER_MINT"),
    PAUSER: ethers.id("PAUSER"),
  },
  // SC (SoulaaniCoin) roles
  SC: {
    DEFAULT_ADMIN: ethers.ZeroHash,
    GOVERNANCE_AWARD: ethers.id("GOVERNANCE_AWARD"), // This is the minting role
    GOVERNANCE_SLASH: ethers.id("GOVERNANCE_SLASH"),
    MEMBER_MANAGER: ethers.id("MEMBER_MANAGER"),
  },
  // Vault roles
  VAULT: {
    DEFAULT_ADMIN: ethers.ZeroHash,
    REDEMPTION_PROCESSOR: ethers.id("REDEMPTION_PROCESSOR"),
    TREASURER: ethers.id("TREASURER"),
  },
};

async function main() {
  console.log("\n🔐 Cahootz Co-op Role Management\n");

  // Get signer
  const [signer] = await ethers.getSigners();
  console.log("Managing roles with account:", signer.address);
  console.log("");

  // TODO: Update these addresses after deployment
  const UC_ADDRESS = process.env.UNITY_COIN_ADDRESS || "";
  const SC_ADDRESS = process.env.SOULAANI_COIN_ADDRESS || "";
  const VAULT_ADDRESS = process.env.VAULT_CONTRACT_ADDRESS || "";

  if (!UC_ADDRESS || !SC_ADDRESS || !VAULT_ADDRESS) {
    console.log("❌ Please set contract addresses in .env:");
    console.log("   UNITY_COIN_ADDRESS=0x...");
    console.log("   SOULAANI_COIN_ADDRESS=0x...");
    console.log("   VAULT_CONTRACT_ADDRESS=0x...");
    process.exit(1);
  }

  // Get contract instances
  const ucContract = await ethers.getContractAt("UnityCoin", UC_ADDRESS);
  const scContract = await ethers.getContractAt("SoulaaniCoin", SC_ADDRESS);
  const vaultContract = await ethers.getContractAt("RedemptionVault", VAULT_ADDRESS);

  // Display menu
  console.log("=".repeat(60));
  console.log("ROLE HASHES (copy these for manual role management):");
  console.log("=".repeat(60));
  console.log("\nUnityCoin (UC):");
  console.log("  DEFAULT_ADMIN:   ", ROLES.UC.DEFAULT_ADMIN);
  console.log("  TREASURER_MINT:  ", ROLES.UC.TREASURER_MINT);
  console.log("  PAUSER:          ", ROLES.UC.PAUSER);
  console.log("\nSoulaaniCoin (SC):");
  console.log("  DEFAULT_ADMIN:    ", ROLES.SC.DEFAULT_ADMIN);
  console.log("  GOVERNANCE_AWARD: ", ROLES.SC.GOVERNANCE_AWARD, "(minting role)");
  console.log("  GOVERNANCE_SLASH: ", ROLES.SC.GOVERNANCE_SLASH);
  console.log("  MEMBER_MANAGER:   ", ROLES.SC.MEMBER_MANAGER);
  console.log("\nRedemptionVault:");
  console.log("  DEFAULT_ADMIN:        ", ROLES.VAULT.DEFAULT_ADMIN);
  console.log("  REDEMPTION_PROCESSOR: ", ROLES.VAULT.REDEMPTION_PROCESSOR);
  console.log("  TREASURER:            ", ROLES.VAULT.TREASURER);
  console.log("=".repeat(60));
  console.log("");

  // Check current roles
  console.log("📋 CURRENT ROLE HOLDERS:\n");

  // UC roles
  console.log("UnityCoin (UC) - " + UC_ADDRESS);
  const ucTreasurerMint = await ucContract.hasRole(ROLES.UC.TREASURER_MINT, signer.address);
  const ucPauser = await ucContract.hasRole(ROLES.UC.PAUSER, signer.address);
  const ucAdmin = await ucContract.hasRole(ROLES.UC.DEFAULT_ADMIN, signer.address);
  console.log("  Your address has:");
  console.log("    TREASURER_MINT: ", ucTreasurerMint ? "✓ YES" : "✗ NO");
  console.log("    PAUSER:         ", ucPauser ? "✓ YES" : "✗ NO");
  console.log("    DEFAULT_ADMIN:  ", ucAdmin ? "✓ YES" : "✗ NO");
  console.log("");

  // SC roles
  console.log("SoulaaniCoin (SC) - " + SC_ADDRESS);
  const scAward = await scContract.hasRole(ROLES.SC.GOVERNANCE_AWARD, signer.address);
  const scSlash = await scContract.hasRole(ROLES.SC.GOVERNANCE_SLASH, signer.address);
  const scMemberManager = await scContract.hasRole(ROLES.SC.MEMBER_MANAGER, signer.address);
  const scAdmin = await scContract.hasRole(ROLES.SC.DEFAULT_ADMIN, signer.address);
  console.log("  Your address has:");
  console.log("    GOVERNANCE_AWARD: ", scAward ? "✓ YES (can mint SC)" : "✗ NO");
  console.log("    GOVERNANCE_SLASH: ", scSlash ? "✓ YES" : "✗ NO");
  console.log("    MEMBER_MANAGER:   ", scMemberManager ? "✓ YES" : "✗ NO");
  console.log("    DEFAULT_ADMIN:    ", scAdmin ? "✓ YES" : "✗ NO");
  console.log("");

  // Vault roles
  console.log("RedemptionVault - " + VAULT_ADDRESS);
  const vaultProcessor = await vaultContract.hasRole(
    ROLES.VAULT.REDEMPTION_PROCESSOR,
    signer.address
  );
  const vaultTreasurer = await vaultContract.hasRole(ROLES.VAULT.TREASURER, signer.address);
  const vaultAdmin = await vaultContract.hasRole(ROLES.VAULT.DEFAULT_ADMIN, signer.address);
  console.log("  Your address has:");
  console.log("    REDEMPTION_PROCESSOR: ", vaultProcessor ? "✓ YES" : "✗ NO");
  console.log("    TREASURER:            ", vaultTreasurer ? "✓ YES" : "✗ NO");
  console.log("    DEFAULT_ADMIN:        ", vaultAdmin ? "✓ YES" : "✗ NO");
  console.log("");

  console.log("=".repeat(60));
  console.log("📝 TO GRANT A ROLE:");
  console.log("=".repeat(60));
  console.log("1. Uncomment the grantRole section below");
  console.log("2. Set the contract, role, and address");
  console.log("3. Run: pnpm manage-roles");
  console.log("");

  console.log("=".repeat(60));
  console.log("📝 TO REVOKE A ROLE:");
  console.log("=".repeat(60));
  console.log("1. Uncomment the revokeRole section below");
  console.log("2. Set the contract, role, and address");
  console.log("3. Run: pnpm manage-roles");
  console.log("");

  // ========== GRANT ROLE EXAMPLE ==========
  // Uncomment and modify to grant a role:
  /*
  const addressToGrantTo = "0x..."; // Address to receive role
  const tx = await scContract.grantRole(
    ROLES.SC.GOVERNANCE_AWARD,
    addressToGrantTo
  );
  await tx.wait();
  console.log("✅ Role granted!");
  */

  // ========== REVOKE ROLE EXAMPLE ==========
  // Uncomment and modify to revoke a role:
  /*
  const addressToRevokeFrom = "0x..."; // Address to remove role from
  const tx = await scContract.revokeRole(
    ROLES.SC.GOVERNANCE_AWARD,
    addressToRevokeFrom
  );
  await tx.wait();
  console.log("✅ Role revoked!");
  */

  // ========== RENOUNCE ROLE EXAMPLE ==========
  // Uncomment to give up your own role (can't be undone!):
  /*
  const tx = await scContract.renounceRole(
    ROLES.SC.DEFAULT_ADMIN,
    signer.address
  );
  await tx.wait();
  console.log("✅ Role renounced! You no longer have this power.");
  */
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
