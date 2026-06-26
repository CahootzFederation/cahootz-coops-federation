import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getIronSession } from 'iron-session';
import { validateCsrfToken } from './lib/csrf';
import type { AuthSession } from './lib/signature-verification';
import { env } from './env';

// Specify Node.js runtime for middleware
export const runtime = 'nodejs';

// Define protected API routes
const PROTECTED_API_ROUTES = [
  '/api/portal/',
  '/api/members/',
  '/api/redemptions/',
];

// Define state-changing methods that require CSRF protection
const STATE_CHANGING_METHODS = ['POST', 'PUT', 'DELETE', 'PATCH'];

// Session options
const sessionOptions = {
  password: env.SESSION_SECRET || 'complex_password_at_least_32_characters_long',
  cookieName: 'cahootz_auth_session',
  cookieOptions: {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    maxAge: 60 * 60 * 24 * 7, // 1 week
  },
};

// Rate limiting map (in-memory for development, should use Redis in production)
const rateLimitMap = new Map<string, { count: number, resetAt: number }>();

// Rate limit configuration
const RATE_LIMIT = 10; // requests per minute
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute in milliseconds

export async function middleware(request: NextRequest) {
  const response = NextResponse.next();
  
  // Check if the request is for a protected API route
  const isProtectedApiRoute = PROTECTED_API_ROUTES.some(route => 
    request.nextUrl.pathname.startsWith(route)
  );
  
  // Skip middleware for non-protected routes
  if (!isProtectedApiRoute) {
    return response;
  }
  
  // Apply rate limiting
  const clientIp = request.headers.get('x-forwarded-for') || 'unknown';
  const now = Date.now();
  
  // Get or create rate limit entry
  let rateLimit = rateLimitMap.get(clientIp);
  if (!rateLimit || rateLimit.resetAt < now) {
    rateLimit = { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
    rateLimitMap.set(clientIp, rateLimit);
  }
  
  // Increment count
  rateLimit.count++;
  
  // Check if rate limit exceeded
  if (rateLimit.count > RATE_LIMIT) {
    return new NextResponse(
      JSON.stringify({ error: 'Rate limit exceeded' }),
      { 
        status: 429, 
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(Math.ceil((rateLimit.resetAt - now) / 1000))
        }
      }
    );
  }
  
  // Check CSRF token for state-changing requests
  if (STATE_CHANGING_METHODS.includes(request.method)) {
    const isValidCsrf = validateCsrfToken(request);
    
    if (!isValidCsrf) {
      return new NextResponse(
        JSON.stringify({ error: 'Invalid CSRF token' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }
  
  // Get session
  const cookieStore = cookies();
  const session = await getIronSession<AuthSession>(cookieStore, sessionOptions);
  
  // Check if authenticated
  if (!session.isLoggedIn || !session.address) {
    return new NextResponse(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }
  
  // Add user info to request headers for downstream handlers
  // The actual role and profile checks should be done in the API routes
  response.headers.set('X-User-Address', session.address);
  if (session.roles) {
    response.headers.set('X-User-Roles', JSON.stringify(session.roles));
  }
  
  return response;
}

// Configure the middleware to run only for API routes
export const config = {
  matcher: ['/api/:path*'],
};