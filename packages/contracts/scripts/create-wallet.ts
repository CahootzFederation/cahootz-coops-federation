import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";

/**
 * Create a new Ethereum wallet for deployment
 *
 * This script generates a new wallet and saves it to a JSON file.
 * You can use this instead of MetaMask if you prefer.
 *
 * ⚠️ KEEP THE GENERATED WALLET FILE SECURE!
 */
async function main() {
  console.log("\n🔐 Creating New Ethereum Wallet...\n");

  // Generate random wallet
  const wallet = ethers.Wallet.createRandom();

  console.log("✅ Wallet created successfully!\n");
  console.log("=".repeat(60));
  console.log("📋 WALLET DETAILS:");
  console.log("=".repeat(60));
  console.log("Address:     ", wallet.address);
  console.log("Private Key: ", wallet.privateKey);
  console.log("Mnemonic:    ", wallet.mnemonic?.phrase);
  console.log("=".repeat(60));
  console.log("");

  // Create wallets directory if it doesn't exist
  const walletsDir = path.join(__dirname, "../wallets");
  if (!fs.existsSync(walletsDir)) {
    fs.mkdirSync(walletsDir, { recursive: true });
  }

  // Save wallet info
  const walletInfo = {
    address: wallet.address,
    privateKey: wallet.privateKey,
    mnemonic: wallet.mnemonic?.phrase,
    createdAt: new Date().toISOString(),
    purpose: "Cahootz Co-op Contract Deployment",
  };

  const filename = `deployer-wallet-${Date.now()}.json`;
  const filepath = path.join(walletsDir, filename);
  fs.writeFileSync(filepath, JSON.stringify(walletInfo, null, 2));

  console.log("💾 Wallet info saved to:", filepath);
  console.log("");
  console.log("⚠️  SECURITY WARNINGS:");
  console.log("1. NEVER share your private key or mnemonic");
  console.log("2. NEVER commit wallet files to Git (they're in .gitignore)");
  console.log("3. Back up your mnemonic phrase on paper");
  console.log("4. Delete the JSON file after copying to .env");
  console.log("");
  console.log("📝 NEXT STEPS:");
  console.log("1. Copy your private key (without 0x) to .env as DEPLOYER_PRIVATE_KEY");
  console.log("2. Fund this address with test ETH from Base Sepolia faucet");
  console.log("3. Run 'pnpm deploy:sepolia' to deploy contracts");
  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
