/**
 * Backfill script for coop scoping migration
 * 
 * This script:
 * 1. Creates UserCoopMembership records for existing users with approved applications
 * 2. Ensures all existing data has coopId = 'soulaan' (default)
 * 3. Backfills active CoopConfig chain fields for 'soulaan'
 */

import { db } from '../index';
import { privateKeyToAccount } from 'viem/accounts';

const DEFAULT_COOP_ID = 'soulaan';

function envValue(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
}

function deriveBackendWalletAddress(): string | undefined {
  const privateKey = envValue('BACKEND_WALLET_PRIVATE_KEY');
  if (!privateKey) return undefined;

  try {
    return privateKeyToAccount(privateKey as `0x${string}`).address;
  } catch {
    console.warn('⚠️  Could not derive backend wallet address from BACKEND_WALLET_PRIVATE_KEY');
    return undefined;
  }
}

async function backfillCoopScoping() {
  console.log('🚀 Starting coop scoping backfill...\n');

  try {
    // Step 1: Backfill active CoopConfig chain fields from legacy env values
    console.log('📝 Checking for active CoopConfig...');
    const activeConfig = await db.coopConfig.findFirst({
      where: { coopId: DEFAULT_COOP_ID, isActive: true },
      orderBy: { version: 'desc' },
    });

    const chainFields = {
      chainId: envValue('CHAIN_ID') ? Number(envValue('CHAIN_ID')) : 84532,
      chainName: envValue('CHAIN_NAME') ?? 'base-sepolia',
      rpcUrl: envValue('RPC_URL') ?? 'https://sepolia.base.org',
      scTokenAddress: envValue('SOULAANI_COIN_ADDRESS'),
      allyTokenAddress: envValue('ALLY_COIN_ADDRESS'),
      ucTokenAddress: envValue('UNITY_COIN_ADDRESS'),
      redemptionVaultAddress: envValue('REDEMPTION_VAULT_ADDRESS'),
      treasurySafeAddress: envValue('TREASURY_SAFE_ADDRESS'),
      verifiedStoreRegistryAddress: envValue('VERIFIED_STORE_REGISTRY_ADDRESS'),
      storePaymentRouterAddress: envValue('STORE_PAYMENT_ROUTER_ADDRESS'),
      rewardEngineAddress: envValue('SC_REWARD_ENGINE_ADDRESS'),
      backendWalletAddress: deriveBackendWalletAddress(),
      scTokenSymbol: envValue('SC_TOKEN_SYMBOL') ?? 'SC',
      scTokenName: envValue('SC_TOKEN_NAME') ?? 'SoulaaniCoin',
    };

    if (!activeConfig) {
      console.log('⚠️  No active CoopConfig found for soulaan, creating one...');

      await db.coopConfig.create({
        data: {
          coopId: DEFAULT_COOP_ID,
          version: 1,
          isActive: true,
          name: 'Cahootz',
          slug: DEFAULT_COOP_ID,
          tagline: 'Building Generational Wealth Together',
          description: 'Cahootz cooperative',
          displayMission: 'Build economic empowerment through cooperative ownership.',
          displayFeatures: [],
          eligibility: 'Open to all community members',
          charterText: 'Cahootz Co-op Charter',
          missionGoals: [],
          structuralWeights: { feasibility: 0.4, risk: 0.35, accountability: 0.25 },
          scoreMix: { missionWeight: 0.6, structuralWeight: 0.4 },
          proposalCategories: [],
          sectorExclusions: [],
          scorerAgents: [],
          createdBy: chainFields.backendWalletAddress ?? 'system-backfill',
          ...chainFields,
        },
      });

      console.log('✅ Created default CoopConfig for soulaan');
    } else {
      await db.coopConfig.update({
        where: { id: activeConfig.id },
        data: chainFields,
      });

      console.log('✅ Backfilled active CoopConfig chain fields for soulaan');
    }

    // Step 2: Create UserCoopMembership records for users with approved applications
    console.log('\n📝 Creating UserCoopMembership records...');
    
    const approvedApplications = await db.application.findMany({
      where: {
        status: 'APPROVED',
        coopId: DEFAULT_COOP_ID,
      },
      include: {
        user: true,
      },
    });

    console.log(`   Found ${approvedApplications.length} approved applications`);

    let created = 0;
    let skipped = 0;

    for (const application of approvedApplications) {
      // Check if membership already exists
      const existingMembership = await db.userCoopMembership.findUnique({
        where: {
          userId_coopId: {
            userId: application.userId,
            coopId: application.coopId,
          },
        },
      });

      if (existingMembership) {
        skipped++;
        continue;
      }

      // Create membership record
      await db.userCoopMembership.create({
        data: {
          userId: application.userId,
          coopId: application.coopId,
          status: 'ACTIVE',
          roles: application.user.roles,
          approvedBy: application.reviewedBy || 'system-backfill',
          approvedAt: application.reviewedAt || application.updatedAt,
          joinedAt: application.reviewedAt || application.updatedAt,
        },
      });

      created++;
    }

    console.log(`   ✅ Created ${created} membership records`);
    console.log(`   ⏭️  Skipped ${skipped} existing records`);

    // Step 3: Create membership records for rejected applications
    console.log('\n📝 Creating UserCoopMembership records for rejected applications...');
    
    const rejectedApplications = await db.application.findMany({
      where: {
        status: 'REJECTED',
        coopId: DEFAULT_COOP_ID,
      },
    });

    console.log(`   Found ${rejectedApplications.length} rejected applications`);

    let rejectedCreated = 0;
    let rejectedSkipped = 0;

    for (const application of rejectedApplications) {
      // Check if membership already exists
      const existingMembership = await db.userCoopMembership.findUnique({
        where: {
          userId_coopId: {
            userId: application.userId,
            coopId: application.coopId,
          },
        },
      });

      if (existingMembership) {
        rejectedSkipped++;
        continue;
      }

      // Create membership record
      await db.userCoopMembership.create({
        data: {
          userId: application.userId,
          coopId: application.coopId,
          status: 'REJECTED',
          rejectedBy: application.reviewedBy || 'system-backfill',
          rejectedAt: application.reviewedAt || application.updatedAt,
          rejectionReason: application.reviewNotes,
        },
      });

      rejectedCreated++;
    }

    console.log(`   ✅ Created ${rejectedCreated} rejected membership records`);
    console.log(`   ⏭️  Skipped ${rejectedSkipped} existing records`);

    // Step 4: Verify data integrity
    console.log('\n🔍 Verifying data integrity...');
    
    const totalApplications = await db.application.count();
    const totalMemberships = await db.userCoopMembership.count();

    console.log(`   Total applications: ${totalApplications}`);
    console.log(`   Total memberships: ${totalMemberships}`);

    console.log('\n✅ Backfill completed successfully!');
  } catch (error) {
    console.error('\n❌ Backfill failed:', error);
    throw error;
  }
}

// Run the backfill
backfillCoopScoping()
  .then(() => {
    console.log('\n🎉 Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Fatal error:', error);
    process.exit(1);
  });
