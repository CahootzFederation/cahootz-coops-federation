import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const nodeEnv = process.env.NODE_ENV || "development";

console.log("🔍 Environment validation starting...");
console.log(`📌 NODE_ENV: ${nodeEnv}`);
console.log(`📂 Working directory: ${process.cwd()}`);

const envFiles = [
  `.env.${nodeEnv}.local`,
  `.env.${nodeEnv}`,
  ".env.local",
  ".env",
  "../../.env",
];

console.log("\n📄 Loading environment files:");
envFiles.forEach((file, index) => {
  const fullPath = resolve(process.cwd(), file);
  const exists = existsSync(fullPath);
  const result = loadDotenv({ 
    path: fullPath, 
    override: index < envFiles.length - 1 
  });
  
  if (exists) {
    console.log(`  ✅ ${file} (found, ${result.parsed ? Object.keys(result.parsed).length : 0} vars)`);
  } else {
    console.log(`  ⏭️  ${file} (not found, skipping)`);
  }
});

console.log("\n🔐 Validating required environment variables...");

const requiredVars = {
  EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
  EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY,
};

const missing: string[] = [];
const loaded: Record<string, string> = {};

Object.entries(requiredVars).forEach(([varName, value]) => {
  if (!value) {
    missing.push(varName);
  } else {
    loaded[varName] = varName.includes('KEY') ? `${value.substring(0, 20)}...` : value;
  }
});

if (missing.length > 0) {
  console.error("\n❌ Missing required environment variables:");
  missing.forEach((varName) => console.error(`  - ${varName}`));
  console.error("\n💡 Make sure your .env file exists and contains these variables.");
  process.exit(1);
}

console.log("✅ All required variables present!");
console.log("\n🌐 Environment variables loaded:");
Object.entries(loaded).forEach(([key, value]) => {
  console.log(`  ${key}: ${value}`);
});

if (process.env.EXPO_PUBLIC_COOP_ID) {
  console.log(`  EXPO_PUBLIC_COOP_ID: ${process.env.EXPO_PUBLIC_COOP_ID}`);
}

console.log("\n✨ Environment setup complete!\n");
