/**
 * Seed script to create:
 * 1. Cahootz Official Store (owned by backend wallet user)
 * 2. Founder Badge product category configuration
 * 3. Six Founder Badge products at specified prices
 */

import { PrismaClient } from '@prisma/client';
import { privateKeyToAccount } from 'viem/accounts';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

// Founder Badge products with prices
const FOUNDER_BADGES = [
  { name: 'Seed Founder Badge', priceUSD: 500 },
  { name: 'Growth Founder Badge', priceUSD: 1000 },
  { name: 'Builder Founder Badge', priceUSD: 5000 },
  { name: 'Pillar Founder Badge', priceUSD: 25000 },
  { name: 'Cornerstone Founder Badge', priceUSD: 100000 },
  { name: 'Legacy Founder Badge', priceUSD: 500000 },
];

async function main() {
  console.log('🚀 Starting Founder Badges seed script...\n');

  // 1. Get backend wallet address from private key
  const privateKey = process.env.BACKEND_WALLET_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('BACKEND_WALLET_PRIVATE_KEY not found in environment');
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const walletAddress = account.address.toLowerCase();
  console.log(`📍 Backend wallet address: ${walletAddress}`);

  // 2. Find or create the backend wallet user
  let user = await prisma.user.findUnique({
    where: { walletAddress },
  });

  if (!user) {
    console.log('👤 Backend wallet user not found, creating...');
    user = await prisma.user.create({
      data: {
        walletAddress,
        email: 'backend@cahootz.coop',
        name: 'Cahootz Backend',
        status: 'ACTIVE',
        roles: ['admin'],
        profileCompleted: true,
      },
    });
    console.log(`✅ Created backend user: ${user.id}`);
  } else {
    console.log(`✅ Found user: ${user.id} (${user.email || user.name || 'No name'})`);
  }
  console.log();

  // 3. Ensure Founder Badges product category exists in config
  console.log('📦 Ensuring Founder Badges category exists...');
  const founderBadgeCategory = await prisma.productCategoryConfig.upsert({
    where: { key: 'FOUNDER_BADGES' },
    update: {
      label: 'Founder Badges',
      isAdminOnly: true,
      isActive: true,
      sortOrder: 100,
    },
    create: {
      key: 'FOUNDER_BADGES',
      label: 'Founder Badges',
      isAdminOnly: true,
      isActive: true,
      sortOrder: 100,
    },
  });
  console.log(`✅ Founder Badges category: ${founderBadgeCategory.id}\n`);

  // 4. Check if Cahootz Official Store already exists
  let store = await prisma.store.findFirst({
    where: {
      ownerId: user.id,
      name: 'Cahootz Official Store',
    },
  });

  if (store) {
    console.log(`✅ Cahootz Official Store already exists: ${store.id}\n`);
  } else {
    // Create the Cahootz Official Store
    console.log('🏪 Creating Cahootz Official Store...');
    store = await prisma.store.create({
      data: {
        ownerId: user.id,
        name: 'Cahootz Official Store',
        description: 'Official Cahootz cooperative store offering Founder Badges and exclusive items.',
        category: 'OTHER',
        status: 'APPROVED',
        acceptsUC: true,
        ucDiscountPercent: 0, // No discount on founder badges
        communityCommitmentPercent: 100, // 100% goes back to the coop
        isScVerified: true,
        isFeatured: true,
      },
    });
    console.log(`✅ Created Cahootz Official Store: ${store.id}\n`);
  }

  // 5. Create Founder Badge products
  console.log('🎖️  Creating Founder Badge products...');
  for (const badge of FOUNDER_BADGES) {
    // Check if product already exists
    const existingProduct = await prisma.product.findFirst({
      where: {
        storeId: store.id,
        name: badge.name,
      },
    });

    if (existingProduct) {
      console.log(`   ⏭️  ${badge.name} already exists (${existingProduct.id})`);
      continue;
    }

    const product = await prisma.product.create({
      data: {
        storeId: store.id,
        name: badge.name,
        description: `Become a ${badge.name.replace(' Badge', '')} and support the Cahootz cooperative with a founding contribution of $${badge.priceUSD.toLocaleString()}.`,
        category: 'FOUNDER_BADGES',
        priceUSD: badge.priceUSD,
        ucDiscountPrice: null, // No UC discount
        quantity: 999999, // Unlimited supply
        trackInventory: false,
        allowBackorder: false,
        isActive: true,
        isFeatured: true,
      },
    });

    console.log(`   ✅ Created: ${badge.name} - $${badge.priceUSD.toLocaleString()} (${product.id})`);
  }

  console.log('\n🎉 Seed script completed successfully!');
  console.log(`\n📊 Summary:`);
  console.log(`   - Store: ${store.name} (${store.id})`);
  console.log(`   - Owner: ${user.email || user.name || user.id}`);
  console.log(`   - Products: ${FOUNDER_BADGES.length} Founder Badges`);
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
