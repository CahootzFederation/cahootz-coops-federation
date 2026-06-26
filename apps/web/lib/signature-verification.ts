import { SiweMessage } from 'siwe';
import { generateNonce } from 'siwe';
import { verifyMessage } from 'viem';
import { PrismaClient } from '@prisma/client';
import { cookies } from 'next/headers';
import { getIronSession } from 'iron-session';
import { config, getServerConfig } from './config';
import { env } from '~/env';
// Import admin verification from API server (server-side only, secure)
import { checkPortalAccess } from '@repo/trpc/services/admin-verification';

// Initialize Prisma client directly since @repo/db exports aren't working in Next.js
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (env.NODE_ENV !== 'production') globalForPrisma.prisma = db;

// Session type definition
export interface AuthSession {
  address: string;
  userId?: string;
  email?: string;
  name?: string;
  loginMethod?: 'wallet' | 'email';
  isLoggedIn: boolean;
  hasProfile: boolean;
  activeCoopId?: string;
  isAdmin?: boolean;
  adminRole?: string;
  nonce?: string;
  expiresAt?: Date;
  save: () => Promise<void>;
  destroy: () => void;
};

function getAdminRoleFromRoles(roles: string[]): string | undefined {
  return roles.find((role) => ['owner', 'admin', 'governor'].includes(role));
}

async function findUserByWalletAddress(address: string, coopId?: string) {
  return db.user.findFirst({
    where: {
      OR: [
        { walletAddress: { equals: address, mode: 'insensitive' } },
        {
          wallets: {
            some: {
              address: { equals: address, mode: 'insensitive' },
            },
          },
        },
      ],
    },
    include: {
      wallets: {
        where: { isPrimary: true },
        take: 1,
      },
      memberships: coopId
        ? {
            where: { coopId },
            take: 1,
            select: {
              coopId: true,
              status: true,
              roles: true,
            },
          }
        : {
            select: {
              coopId: true,
              status: true,
              roles: true,
            },
          },
    },
  });
}

async function checkDatabasePortalAccess(address: string, coopId?: string) {
  if (!coopId) {
    return { hasAccess: false, isAdmin: false, role: undefined as string | undefined, user: null };
  }

  const user = await findUserByWalletAddress(address, coopId);
  const membership = user?.memberships[0];
  const role = membership ? getAdminRoleFromRoles(membership.roles) : undefined;
  const hasAccess = user?.status === 'ACTIVE' && membership?.status === 'ACTIVE';

  return {
    hasAccess,
    isAdmin: Boolean(hasAccess && role),
    role,
    user,
  };
}

// Iron session configuration (server-side only)
function getSessionOptions() {
  const serverConfig = getServerConfig();
  // Use 'lax' in development to allow cookies across localhost ports (3000 -> 3001)
  const sameSite = env.NODE_ENV === 'production' ? 'strict' : 'lax';

  return {
    password: serverConfig.session.secret,
    cookieName: serverConfig.session.cookieName,
    cookieOptions: {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: sameSite,
      maxAge: serverConfig.session.maxAge,
    },
  };
}

/**
 * Generate a challenge for the user to sign
 * @param address - The wallet address requesting the challenge
 * @returns The challenge message
 */
export async function generateChallenge(address: string, requestOrigin?: string): Promise<string> {
  // Generate a random nonce
  const nonce = generateNonce();
  
  // Create expiration date (10 minutes from now)
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 10);
  
  const uri = requestOrigin || config.app.uri;
  const domain = requestOrigin ? new URL(requestOrigin).host : config.app.domain;

  // Create a SIWE message
  const message = new SiweMessage({
    domain,
    address,
    statement: 'Sign in to Cahootz Admin Panel',
    uri,
    version: '1',
    chainId: 84532, // Base Sepolia
    nonce,
  });
  
  // Store the challenge in the database
  await db.authChallenge.create({
    data: {
      address,
      nonce,
      expiresAt,
    },
  });
  
  console.log(`🔐 Generated challenge for ${address}`);
  
  // Return the message to be signed
  return message.prepareMessage();
}

/**
 * Verify a signature against a challenge
 * @param address - The wallet address that signed the message
 * @param signature - The signature to verify
 * @param message - The original message that was signed
 * @returns Boolean indicating if the signature is valid
 */
export async function verifySignature(
  address: string,
  signature: string,
  message: string
): Promise<boolean> {
  try {
    // Parse the SIWE message
    const siweMessage = new SiweMessage(message);
    
    // Get the nonce from the message
    const { nonce } = siweMessage;
    
    // Find the challenge in the database
    const challenge = await db.authChallenge.findFirst({
      where: {
        address,
        nonce,
        used: false,
        expiresAt: {
          gt: new Date(),
        },
      },
    });
    
    // If no challenge is found or it's expired, return false
    if (!challenge) {
      console.error(`❌ No valid challenge found for ${address}`);
      return false;
    }
    
    // Verify the signature using viem
    const isValid = await verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
    
    if (!isValid) {
      console.error(`❌ Invalid signature for ${address}`);
      return false;
    }
    
    // Mark the challenge as used
    await db.authChallenge.update({
      where: { id: challenge.id },
      data: { used: true },
    });
    
    console.log(`✅ Signature verified for ${address}`);
    
    return true;
  } catch (error) {
    console.error('❌ Error verifying signature:', error);
    return false;
  }
}

/**
 * Check if a wallet has portal access (calls API server - secure!)
 * @param address - The wallet address to check
 * @param coopId - The coop ID to check access for
 * @returns Boolean indicating if the wallet has portal access
 */
export async function checkSoulaaniCoinBalance(address: string, coopId?: string): Promise<boolean> {
  try {
    console.log(`🔒 Checking portal access via API server for ${address}...`);
    // Call the API server function (server-side only, secure!)
    const result = await checkPortalAccess(address as `0x${string}`, coopId);
    console.log(`🔒 Portal access result: hasAccess=${result.hasAccess}, isAdmin=${result.isAdmin}`);
    if (result.hasAccess) {
      return true;
    }

    const databaseAccess = await checkDatabasePortalAccess(address, coopId);
    console.log(
      `🔒 Database portal access result: hasAccess=${databaseAccess.hasAccess}, isAdmin=${databaseAccess.isAdmin}`
    );
    return databaseAccess.hasAccess;
  } catch (error) {
    console.error('❌ Error checking portal access:', error);
    try {
      const databaseAccess = await checkDatabasePortalAccess(address, coopId);
      return databaseAccess.hasAccess;
    } catch (databaseError) {
      console.error('❌ Error checking database portal access:', databaseError);
      return false;
    }
  }
}

/**
 * Get the current session
 * @returns The current session or null if not authenticated
 */
export async function getSession(): Promise<AuthSession | null> {
  const cookieStore = await cookies();
  const session = await getIronSession<AuthSession>(cookieStore, getSessionOptions());
  
  if (!session.isLoggedIn) {
    return null;
  }
  
  return session;
}

/**
 * Create a new session for an authenticated user
 * @param address - The wallet address of the authenticated user
 * @param coopId - The coop ID for this session
 * @returns The created session
 */
export async function createSession(address: string, coopId?: string): Promise<AuthSession> {
  const cookieStore = await cookies();
  const session = await getIronSession<AuthSession>(cookieStore, getSessionOptions());

  console.log(`\n🔐 Creating session for ${address}${coopId ? ` (coop: ${coopId})` : ''}`);
  if(!coopId) {
    throw new Error('Coop ID is required');
  }

  // Check if the user has a membership and profile data for this coop
  let hasProfile = false;
  let user = null;
  let membershipAdminRole: string | undefined = undefined;
  if (coopId) {
    user = await findUserByWalletAddress(address, coopId);
    const membership = user?.memberships[0];
    membershipAdminRole = membership ? getAdminRoleFromRoles(membership.roles) : undefined;
    if (user && !user.walletAddress) {
      await db.user.update({
        where: { id: user.id },
        data: { walletAddress: address },
      });
    }
    // User has profile if they have a User record with name and a membership for this coop
    hasProfile = !!user && !!user.name && membership?.status === 'ACTIVE';
    console.log('🔒 Has profile:', hasProfile, 'User name:', user?.name, 'Memberships:', user?.memberships.length);
  }


  // Check admin status using API server (secure server-side check)
  let isAdmin = false;
  let adminRole: string | undefined = undefined;

  try {
    console.log('🔒 Checking portal access via API server (includes admin check)...');
    // Call the API server function (server-side only, secure!)
    // This checks BOTH admin status AND coin balance
    const accessCheck = await checkPortalAccess(address as `0x${string}`, coopId);

    isAdmin = accessCheck.isAdmin || Boolean(membershipAdminRole);
    adminRole = accessCheck.role || membershipAdminRole;

    if (isAdmin) {
      console.log(`✅ Admin status confirmed: ${address} is ${adminRole}`);
    } else if (accessCheck.hasAccess) {
      console.log(`✅ Portal access granted (regular member)`);
    } else {
      console.log(`❌ No portal access`);
    }
  } catch (error) {
    console.error('❌ Error checking portal access:', error);
  }

  // Update the session
  session.address = address;
  session.userId = user?.id;
  session.email = user?.email;
  session.name = user?.name ?? undefined;
  session.loginMethod = 'wallet';
  session.isLoggedIn = true;
  session.hasProfile = hasProfile;
  session.activeCoopId = coopId;
  session.isAdmin = isAdmin;
  session.adminRole = adminRole;

  // Update last login time if profile exists
  if (hasProfile && coopId && user) {
    await db.userCoopMembership.updateMany({
      where: {
        userId: user.id,
        coopId: coopId,
      },
      data: {
        lastLogin: new Date(),
        lastActiveAt: new Date(),
      },
    });
  }

  // Save the session
  await session.save();

  console.log(`✅ Session created for ${address}, hasProfile: ${hasProfile}, isAdmin: ${isAdmin}, role: ${adminRole || 'N/A'}`);

  return session;
}

/**
 * Create a portal session for an existing user without requiring a browser wallet.
 * The session still carries the user's linked wallet address so existing portal
 * authorization paths continue to work.
 */
export async function createUserSession(userId: string, coopId: string): Promise<AuthSession> {
  const cookieStore = await cookies();
  const session = await getIronSession<AuthSession>(cookieStore, getSessionOptions());

  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      wallets: {
        where: { isPrimary: true },
        take: 1,
      },
      memberships: {
        where: { coopId },
        take: 1,
        select: {
          coopId: true,
          status: true,
          roles: true,
        },
      },
    },
  });

  if (!user) {
    throw new Error('User not found');
  }

  const membership = user.memberships[0];
  if (membership?.status !== 'ACTIVE' || user.status !== 'ACTIVE') {
    throw new Error('No active portal membership found');
  }

  const walletAddress = user.walletAddress || user.wallets[0]?.address;
  if (!walletAddress) {
    throw new Error('No wallet is linked to this account');
  }

  if (!user.walletAddress) {
    await db.user.update({
      where: { id: user.id },
      data: { walletAddress },
    });
  }

  const membershipAdminRole = getAdminRoleFromRoles(membership.roles);
  let isAdmin = !!membershipAdminRole;
  let adminRole = membershipAdminRole;

  try {
    const accessCheck = await checkPortalAccess(walletAddress as `0x${string}`, coopId);
    isAdmin = accessCheck.isAdmin || isAdmin;
    adminRole = accessCheck.role || adminRole;
  } catch (error) {
    console.error('❌ Error checking portal access for email session:', error);
  }

  session.address = walletAddress;
  session.userId = user.id;
  session.email = user.email;
  session.name = user.name ?? undefined;
  session.loginMethod = 'email';
  session.isLoggedIn = true;
  session.hasProfile = !!user.name;
  session.activeCoopId = coopId;
  session.isAdmin = isAdmin;
  session.adminRole = adminRole;

  await db.userCoopMembership.update({
    where: {
      userId_coopId: {
        userId: user.id,
        coopId,
      },
    },
    data: {
      lastLogin: new Date(),
      lastActiveAt: new Date(),
    },
  });

  await session.save();

  console.log(`✅ Email session created for ${user.email} (${walletAddress}), isAdmin: ${isAdmin}, role: ${adminRole || 'N/A'}`);

  return session;
}

/**
 * Destroy the current session (logout)
 */
export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const session = await getIronSession<AuthSession>(cookieStore, getSessionOptions());
  
  const address = session.address;
  session.destroy();
  
  console.log(`🚪 Session destroyed for ${address}`);
}
