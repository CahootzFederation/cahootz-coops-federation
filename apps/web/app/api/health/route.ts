import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { db } from '@repo/db';

/**
 * Health check endpoint for Railway and monitoring
 * @route GET /api/health
 */
export async function GET(_request: NextRequest) {
  try {
    // Check database connectivity
    await db.$queryRaw`SELECT 1`;
    
    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'cahootz-api',
      database: 'connected',
      uptime: process.uptime(),
    });
  } catch (error) {
    console.error('Health check failed:', error);
    return NextResponse.json(
      {
        status: 'error',
        timestamp: new Date().toISOString(),
        service: 'cahootz-api',
        database: 'disconnected',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 503 }
    );
  }
}
