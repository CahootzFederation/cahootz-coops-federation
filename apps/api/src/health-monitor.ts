/**
 * Health Monitoring Service
 * Periodically checks service health and sends alerts
 */

import { sendApiHealthNotification } from "@repo/trpc/services/slack-notification-service";
import { env } from "./env.js";

interface HealthStatus {
  lastCheck: Date;
  isHealthy: boolean;
  consecutiveFailures: number;
  lastNotificationSent?: Date;
}

const status: HealthStatus = {
  lastCheck: new Date(),
  isHealthy: true,
  consecutiveFailures: 0,
};

const startedAt = Date.now();
let healthCheckInProgress = false;

// Only send notifications if status changes or every N failures
const NOTIFICATION_COOLDOWN_MS = env.HEALTHCHECK_NOTIFICATION_COOLDOWN_MS;
const MAX_FAILURES_BEFORE_ALERT = env.HEALTHCHECK_FAILURES_BEFORE_ALERT;
const STARTUP_GRACE_MS = env.HEALTHCHECK_STARTUP_GRACE_MS;

/**
 * Check database health
 */
async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const { db } = await import("@repo/db");
    await db.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    console.error('Database health check failed:', error);
    return false;
  }
}

/**
 * Send health notification if needed
 */
async function sendHealthNotificationIfNeeded(isHealthy: boolean, error?: string) {
  const now = new Date();
  const timeSinceLastNotification = status.lastNotificationSent
    ? now.getTime() - status.lastNotificationSent.getTime()
    : Infinity;

  const withinStartupGrace = now.getTime() - startedAt < STARTUP_GRACE_MS;
  const recovered = isHealthy && !status.isHealthy;
  const cooldownExpired = timeSinceLastNotification > NOTIFICATION_COOLDOWN_MS;
  const reachedMaxFailures =
    !isHealthy &&
    !withinStartupGrace &&
    status.consecutiveFailures >= MAX_FAILURES_BEFORE_ALERT &&
    cooldownExpired;

  if (recovered || reachedMaxFailures) {
    try {
      await sendApiHealthNotification({
        status: isHealthy ? "up" : "down",
        service: "database",
        error: error,
        environment: env.NODE_ENV,
      });
      
      status.lastNotificationSent = now;
      console.log(`📨 Health notification sent: ${isHealthy ? "UP" : "DOWN"}`);
    } catch (notificationError) {
      console.error('Failed to send health notification:', notificationError);
    }
  }
}

/**
 * Perform health check
 */
async function performHealthCheck() {
  if (healthCheckInProgress) {
    console.warn("⚠️  Skipping database health check because the previous check is still running");
    return;
  }

  healthCheckInProgress = true;
  const dbHealthy = await checkDatabaseHealth().finally(() => {
    healthCheckInProgress = false;
  });
  
  status.lastCheck = new Date();

  if (dbHealthy) {
    // Reset failure counter if healthy
    if (status.consecutiveFailures > 0) {
      console.log(`✅ Service recovered after ${status.consecutiveFailures} failures`);
    }
    status.consecutiveFailures = 0;
    
    // Send notification if status changed from unhealthy to healthy
    if (!status.isHealthy) {
      await sendHealthNotificationIfNeeded(true);
    }
    
    status.isHealthy = true;
  } else {
    // Increment failure counter
    status.consecutiveFailures++;
    console.warn(`⚠️  Health check failed (${status.consecutiveFailures} consecutive failures)`);
    
    // Send notification based on failure count
    await sendHealthNotificationIfNeeded(false, 'Database connection failed');
    
    status.isHealthy = false;
  }
}

/**
 * Start health monitoring
 */
export function startHealthMonitoring(intervalMs: number = 60000) {
  console.log(`🏥 Starting health monitoring (interval: ${intervalMs / 1000}s)`);
  
  // Initial check
  performHealthCheck();
  
  // Periodic checks
  const interval = setInterval(() => {
    performHealthCheck();
  }, intervalMs);

  // Return cleanup function
  return () => {
    clearInterval(interval);
    console.log('🏥 Health monitoring stopped');
  };
}

/**
 * Get current health status
 */
export function getHealthStatus(): HealthStatus {
  return { ...status };
}
