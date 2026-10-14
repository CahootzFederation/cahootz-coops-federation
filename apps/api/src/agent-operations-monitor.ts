import { getAgentOperationalSnapshot } from "@repo/trpc/services/agent-operations";
import { sendAgentOperationalAlert } from "@repo/trpc/services/slack-notification-service";

const FIRST_CHECK_DELAY_MS = 2 * 60 * 1000;
const CHECK_INTERVAL_MS = 70 * 60 * 1000;

let firstCheck: ReturnType<typeof setTimeout> | null = null;
let interval: ReturnType<typeof setInterval> | null = null;

async function checkAgentOperations() {
  try {
    const snapshot = await getAgentOperationalSnapshot();
    if (snapshot.healthy) return;
    const delivered = await sendAgentOperationalAlert({
      checkedAt: snapshot.checkedAt,
      issues: snapshot.issues,
      environment: process.env.NODE_ENV,
    });
    if (!delivered)
      console.error(
        "Agent operations monitor found issues, but Slack delivery failed",
      );
  } catch (error) {
    console.error("Agent operations monitor failed", error);
    const delivered = await sendAgentOperationalAlert({
      checkedAt: new Date(),
      environment: process.env.NODE_ENV,
      issues: [
        {
          agentId: "agent-health-inspection",
          state: "BROKEN",
          reason:
            "The API watchdog could not read agent health from the database. Check the API logs.",
        },
      ],
    }).catch(() => false);
    if (!delivered)
      console.error(
        "Agent operations monitor also failed to deliver its Slack alert",
      );
  }
}

/**
 * Redundant production monitor. Trigger.dev runs the primary hourly task; the
 * API repeats the check on a staggered interval so a Trigger outage does not
 * also silence agent-health alerts.
 */
export function startAgentOperationsMonitor() {
  if (process.env.NODE_ENV !== "production" || firstCheck || interval)
    return false;
  firstCheck = setTimeout(
    () => void checkAgentOperations(),
    FIRST_CHECK_DELAY_MS,
  );
  firstCheck.unref?.();
  interval = setInterval(() => void checkAgentOperations(), CHECK_INTERVAL_MS);
  interval.unref?.();
  return true;
}

export function stopAgentOperationsMonitor() {
  if (firstCheck) clearTimeout(firstCheck);
  if (interval) clearInterval(interval);
  firstCheck = null;
  interval = null;
}
