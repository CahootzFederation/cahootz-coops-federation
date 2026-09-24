import { schedules, task, tasks } from "@trigger.dev/sdk";
import { db } from "../../../../packages/db/index.js";
import { processRideMatchWindow } from "../../../../packages/trpc/src/services/sage-ride-match-agent.js";
import { processTrendWindow } from "../../../../packages/trpc/src/services/sage-trend-agent.js";
import { executeSageAction } from "../../../../packages/trpc/src/services/commons-action-tools.js";

const WINDOW_INACTIVITY_MS = 10 * 60 * 1000;

// Closes circle windows that have gone quiet, then hands each off for detection.
export const sageCircleWindowSweep = schedules.task({
  id: "sage-circle-window-sweep",
  cron: "*/5 * * * *",
  maxDuration: 300,
  run: async () => {
    const stale = await db.circleAgentWindow.findMany({
      where: { status: "OPEN", lastMessageAt: { lt: new Date(Date.now() - WINDOW_INACTIVITY_MS) } },
    });
    for (const window of stale) {
      await db.circleAgentWindow.update({ where: { id: window.id }, data: { status: "CLOSED", closedAt: new Date() } });
      await tasks.trigger("sage-ride-match-detect", { windowId: window.id }, {
        idempotencyKey: `sage-ride-match-detect:${window.id}`,
        idempotencyKeyTTL: "24h",
      });
      await tasks.trigger("sage-trend-detect", { windowId: window.id }, {
        idempotencyKey: `sage-trend-detect:${window.id}`,
        idempotencyKeyTTL: "24h",
      });
    }
  },
});

export const sageRideMatchDetect = task({
  id: "sage-ride-match-detect",
  maxDuration: 300,
  run: async (payload: { windowId: string }) => processRideMatchWindow(payload.windowId),
});

export const sageTrendDetect = task({
  id: "sage-trend-detect",
  maxDuration: 300,
  run: async (payload: { windowId: string }) => processTrendWindow(payload.windowId),
});

export const sageActionExecute = task({
  id: "sage-action-execute",
  maxDuration: 300,
  run: async (payload: { actionId: string }) => executeSageAction(payload.actionId),
});
