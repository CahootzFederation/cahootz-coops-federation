import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/signature-verification';

/**
 * Get the current session
 * @route GET /api/auth/session
 */
export async function GET(_request: NextRequest) {
  try {
    // Get the current session
    const session = await getSession();
    
    if (!session) {
      return NextResponse.json({
        isLoggedIn: false,
      });
    }
    
    // Return the session info
    return NextResponse.json({
      isLoggedIn: true,
      address: session.address,
      userId: session.userId || null,
      email: session.email || null,
      name: session.name || null,
      loginMethod: session.loginMethod || 'wallet',
      hasProfile: session.hasProfile,
      activeCoopId: session.activeCoopId || null,
      isAdmin: session.isAdmin || false,
      adminRole: session.adminRole || null,
    });
  } catch (error) {
    console.error('Error getting session:', error);
    return NextResponse.json(
      { error: 'Failed to get session' },
      { status: 500 }
    );
  }
}
