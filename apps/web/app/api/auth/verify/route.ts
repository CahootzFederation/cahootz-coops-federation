import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { verifySignature, createSession, checkSoulaaniCoinBalance } from '@/lib/signature-verification';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

// Initialize Prisma client
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const db = globalForPrisma.prisma ?? new PrismaClient();
if (typeof window === 'undefined' && !globalForPrisma.prisma) globalForPrisma.prisma = db;

// Schema for request validation
const requestSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address'),
  signature: z.string(),
  message: z.string(),
  coopId: z.string().trim().min(1, 'Coop ID is required'),
});

/**
 * Verify a signature and create a session
 * @route POST /api/auth/verify
 */
export async function POST(request: NextRequest) {
  try {
    // Parse and validate the request body
    const body = await request.json();
    const result = requestSchema.safeParse(body);
    
    if (!result.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: result.error.format() },
        { status: 400 }
      );
    }
    
    const { address, signature, message, coopId } = result.data;
    
    // Verify the signature
    const isValid = await verifySignature(address, signature, message);
    
    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }
    
    // Check if the wallet has SoulaaniCoin and is an active member
    const hasSoulaaniCoin = await checkSoulaaniCoinBalance(address, coopId);
    
    if (!hasSoulaaniCoin) {
      // Get the coin name from coopConfig for a better error message
      const coopConfig = await db.coopConfig.findFirst({
        where: { coopId, isActive: true },
        orderBy: { version: 'desc' },
        select: { scTokenName: true },
      });
      
      const coinName = coopConfig?.scTokenName ?? 'the required token';
      
      return NextResponse.json(
        { error: `Wallet does not have ${coinName} or is not an active member` },
        { status: 403 }
      );
    }
    
    // Create a session with coopId
    const session = await createSession(address, coopId);

    // Return the session info
    return NextResponse.json({
      success: true,
      address,
      userId: session.userId || null,
      email: session.email || null,
      loginMethod: session.loginMethod || 'wallet',
      hasProfile: session.hasProfile,
      activeCoopId: session.activeCoopId || null,
      isAdmin: session.isAdmin || false,
      adminRole: session.adminRole || null,
      isPlatformAdmin: session.isPlatformAdmin || false,
    });
  } catch (error) {
    console.error('Error verifying signature:', error);
    return NextResponse.json(
      { error: 'Failed to verify signature' },
      { status: 500 }
    );
  }
}
