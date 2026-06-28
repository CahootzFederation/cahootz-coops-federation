import { createExpressMiddleware } from "@trpc/server/adapters/express";
import cors from "cors";
import { trpcExpress } from "@repo/trpc/server";
import type { Application, Request, Response } from "express";
import express from "express";
import os from "os";
import { fileURLToPath } from "url";
import { resolve } from "path";
import { env } from "./env.js";
import { startHealthMonitoring } from "./health-monitor.js";

const app: Application = express();

const corsOrigins = [
  // Local development
  "http://localhost:3000",      // Web app (alternative port)
  "http://localhost:3001",      // Web app (main port)
  "http://localhost:8081",      // Expo dev server
  "http://localhost:19000",     // Alternative Expo port
  "http://localhost:19006",     // Expo web

  // Production domains
  "https://soulaan-api-production.up.railway.app",
  "https://www.soulaan.com",
  "https://cahootzcoop.com",
  "https://cahootzcoops.com",
  "https://www.cahootzcoops.com",
  "https://mobile.cahootzcoops.com",
];

// Import webhook handlers
import { handleStripeWebhookNew, handlePayPalWebhook, handleSquareWebhook } from './webhooks';
import uploadRouter from './routes/upload.js';
// IMPORTANT: Stripe webhooks need raw body for signature verification
// So we add this route BEFORE the general JSON parser
app.post('/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  handleStripeWebhookNew
);

// Parse JSON bodies (for non-tRPC routes only)
// tRPC has its own body parsing with SuperJSON transformer
app.use((req, res, next) => {
  if (req.path.startsWith('/trpc')) {
    // Skip JSON parsing for tRPC routes - tRPC handles its own body parsing
    return next();
  }
  express.json()(req, res, next);
});
app.use((req, res, next) => {
  if (req.path.startsWith('/trpc')) {
    return next();
  }
  express.urlencoded({ extended: true })(req, res, next);
});

// Enable CORS for all routes - allow web app, mobile app, and production origins
app.use(
  cors({
    origin: corsOrigins,
    credentials: true,
  }),
);

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();

  // Log incoming request
  console.log('\n' + '═'.repeat(80));
  console.log(`📨 ${req.method} ${req.path}`);
  console.log(`⏰ ${new Date().toISOString()}`);

  if ((req.method === 'POST' || req.method === 'PUT') && req.body) {
    console.log(`📦 Body:`, JSON.stringify(req.body, null, 2));
  }
  
  // Capture original res.json to log response
  const originalJson = res.json.bind(res);
  res.json = function(body: any) {
    const duration = Date.now() - start;
    
    console.log(`\n📤 RESPONSE`);
    console.log(`✅ Status: ${res.statusCode}`);
    console.log(`⏱️  Duration: ${duration}ms`);
    
    // Log response body (truncate if too large)
    const bodyStr = JSON.stringify(body, null, 2);
    if (bodyStr.length > 500) {
      console.log(`📄 Body: ${bodyStr.substring(0, 500)}... (truncated)`);
    } else {
      console.log(`📄 Body:`, bodyStr);
    }
    
    // Check for errors in tRPC response
    if (body.error) {
      console.log(`❌ ERROR DETECTED:`, body.error);
    }
    
    console.log('═'.repeat(80) + '\n');
    
    return originalJson(body);
  };
  
  next();
});

// Health check endpoint with database connectivity check
app.get("/health", async (req, res) => {
  try {
    // Dynamically import db to avoid circular dependency issues
    const { db } = await import("@repo/db");
    
    // Check database connectivity
    await db.$queryRaw`SELECT 1`;
    
    res.json({ 
      status: "OK",
      timestamp: new Date().toISOString(),
      database: "connected",
      uptime: process.uptime(),
    });
  } catch (error) {
    console.error("❌ Health check failed:", error);
    res.status(503).json({
      status: "error",
      timestamp: new Date().toISOString(),
      database: "disconnected",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.post("/api/test-email/order-confirmation", async (req: Request, res: Response) => {
  const testToken = req.headers["x-email-test-token"];
  const isProduction = env.NODE_ENV === "production";
  const hasValidToken =
    typeof testToken === "string" &&
    !!env.EMAIL_TEST_TOKEN &&
    testToken === env.EMAIL_TEST_TOKEN;

  if (isProduction && !hasValidToken) {
    return res.status(403).json({
      success: false,
      message: "Email test endpoint requires X-Email-Test-Token in production.",
    });
  }

  try {
    const { sendOrderConfirmationEmail } = await import("@repo/trpc/services/email-service");
    const recipient = "team@cahootzcoops.com";
    const now = new Date();

    await sendOrderConfirmationEmail({
      to: recipient,
      order: {
        orderId: `test-${now.getTime()}`,
        coopName: "Fake Co-ops Test",
        storeName: "Cahootz Demo Market",
        customerName: "Deon Robinson",
        customerEmail: recipient,
        subtotalUSD: 64,
        discountUSD: 0,
        totalUSD: 64,
        paymentMethod: "CARD",
        transactionHash: `test_${now.getTime()}`,
        shippingAddress: "123 Test Street, San Francisco, CA 94110",
        note: "This is a test order confirmation email from the API.",
        createdAt: now,
        items: [
          {
            productName: "Community Coffee Blend",
            quantity: 2,
            priceUSD: 18,
            totalUSD: 36,
          },
          {
            productName: "Founders Market Tote",
            quantity: 1,
            priceUSD: 28,
            totalUSD: 28,
          },
        ],
      },
    });

    return res.json({
      success: true,
      message: `Test order confirmation email sent to ${recipient}.`,
    });
  } catch (error) {
    console.error("❌ Test email failed:", error);
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Failed to send test email.",
    });
  }
});

// Webhook endpoints (PayPal and Square use JSON body)
app.post('/webhooks/paypal', handlePayPalWebhook);
app.post('/webhooks/square', handleSquareWebhook);

// File upload endpoints
app.use('/api/upload', uploadRouter);

app.use("/trpc", trpcExpress);

// TODO: Fix Sashimo middleware path-to-regexp compatibility issue
// Temporarily commented out - causing PathError with '*' route pattern
// app.use("/sashi", createMiddleware({
//   openAIKey: env.OPENAI_API_KEY || ""
// }));

// Error handling middleware (MUST be after all routes)
app.use((err: any, req: any, res: any, next: any) => {
  console.error('\n' + '🚨 '.repeat(40));
  console.error('❌ ERROR OCCURRED');
  console.error(`⏰ Time: ${new Date().toISOString()}`);
  console.error(`🔗 Path: ${req.path}`);
  console.error(`💥 Error:`, err);
  console.error(`📚 Stack:`, err.stack);
  console.error('🚨 '.repeat(40) + '\n');
  
  res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

const port = env.PORT;

// Helper function to get local IP address
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name];
    if (!iface) continue;
    for (const alias of iface) {
      if (alias.family === 'IPv4' && !alias.internal) {
        return alias.address;
      }
    }
  }
  return 'localhost';
}

// Test database connection before starting server
async function testDatabaseConnection() {
  try {
    console.log('🔍 Testing database connection...');
    const { db } = await import("@repo/db");
    await db.$queryRaw`SELECT 1`;
    console.log('✅ Database connection successful\n');
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    console.error('⚠️  Server will start but may not function correctly\n');
    
    // Send Slack notification about database connection failure
    try {
      const { sendApiHealthNotification } = await import("@repo/trpc/services/slack-notification-service");
      await sendApiHealthNotification({
        status: "down",
        service: "database",
        error: error instanceof Error ? error.message : "Unknown error",
        environment: process.env.NODE_ENV || "unknown",
      });
    } catch (slackError) {
      console.error('Failed to send Slack notification:', slackError);
    }
    
    return false;
  }
}

// Start server with database check
const server = app.listen(port, async () => {
  const localIp = getLocalIpAddress();
  console.log('\n🚀 API Server is running!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📡 Port: ${port}`);
  console.log(`🌐 Local:   http://localhost:${port}`);
  console.log(`📱 Network: http://${localIp}:${port}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  console.log('\n📋 Environment Variables:');
  console.log(`  BLOB_READ_WRITE_TOKEN: ${env.BLOB_READ_WRITE_TOKEN ? '✅ Set' : '❌ Not set'}`);
  console.log(`  WALLET_ENCRYPTION_KEY: ${env.WALLET_ENCRYPTION_KEY ? '✅ Set' : '❌ Not set'}`);
  console.log(`  DATABASE_URL: ${env.DATABASE_URL ? '✅ Set' : '❌ Not set'}`);
  console.log(`  STRIPE_SECRET_KEY: ${env.STRIPE_SECRET_KEY ? '✅ Set' : '❌ Not set'}`);

  console.log('\n💡 For mobile testing, update your mobile app config to:');
  console.log(`   API_BASE_URL: 'http://${localIp}:${port}'\n`);
  
  // Test database connection after server starts
  const dbConnected = await testDatabaseConnection();

  // Send startup notifications to Slack (production only)
  if (process.env.NODE_ENV === 'production') {
    try {
      const { sendApiStartupNotification, sendApiHealthNotification } = await import("@repo/trpc/services/slack-notification-service");

      await sendApiStartupNotification({
        service: "api",
        port: port,
        environment: process.env.NODE_ENV,
      });

      if (dbConnected) {
        await sendApiHealthNotification({
          status: "up",
          service: "api",
          uptime: 0,
          environment: process.env.NODE_ENV,
        });
      }
    } catch (error) {
      console.error('Failed to send startup notification:', error);
    }
  }

  // Start health monitoring (check every 60 seconds)
  startHealthMonitoring(60000);
});

// Graceful shutdown handling
const gracefulShutdown = async (signal: string) => {
  console.log(`\n⚠️  Received ${signal}, starting graceful shutdown...`);
  
  server.close(async () => {
    console.log('✅ HTTP server closed');
    
    try {
      // Close database connections
      const { db } = await import("@repo/db");
      await db.$disconnect();
      console.log('✅ Database connections closed');
    } catch (error) {
      console.error('❌ Error closing database:', error);
    }
    
    console.log('👋 Shutdown complete');
    process.exit(0);
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error('⚠️  Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', async (error) => {
  console.error('\n💥 UNCAUGHT EXCEPTION:');
  console.error(error);
  console.error('\n');
  
  // Send Slack notification
  try {
    const { sendApiErrorNotification } = await import("@repo/trpc/services/slack-notification-service");
    await sendApiErrorNotification({
      service: "api",
      error: error.message,
      stack: error.stack,
    });
  } catch (slackError) {
    console.error('Failed to send error notification:', slackError);
  }
  
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', async (reason, promise) => {
  console.error('\n💥 UNHANDLED REJECTION:');
  console.error('Promise:', promise);
  console.error('Reason:', reason);
  console.error('\n');
  
  // Send Slack notification
  try {
    const { sendApiErrorNotification } = await import("@repo/trpc/services/slack-notification-service");
    await sendApiErrorNotification({
      service: "api",
      error: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  } catch (slackError) {
    console.error('Failed to send error notification:', slackError);
  }
});

export default app;
