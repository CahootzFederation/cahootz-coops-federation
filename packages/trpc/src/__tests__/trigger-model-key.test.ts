import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import {
  MISSING_PRODUCTION_KEY_MESSAGE,
  MODEL_TASK_IDS,
  MissingOpenAIKeyError,
  checkTriggerModelKey,
} from '../services/trigger-model-key.js';

const triggerDir = join(dirname(fileURLToPath(import.meta.url)), '../../../../apps/api/src/trigger');

function taskIdsInTriggerDir() {
  return readdirSync(triggerDir)
    .filter((file) => file.endsWith('.ts'))
    .flatMap((file) => [...readFileSync(join(triggerDir, file), 'utf8').matchAll(/\bid: "([^"]+)"/g)].map((m) => m[1]!));
}

describe('Trigger.dev OpenAI key check', () => {
  it('fails a production model task when the key is missing', () => {
    const warn = vi.fn();
    expect(() => checkTriggerModelKey({ taskId: 'sage-wake-sweep', environmentType: 'PRODUCTION', apiKey: undefined, warn }))
      .toThrow(MissingOpenAIKeyError);
    expect(() => checkTriggerModelKey({ taskId: 'sage-wake-sweep', environmentType: 'PRODUCTION', apiKey: '   ', warn }))
      .toThrow(MISSING_PRODUCTION_KEY_MESSAGE);
    expect(warn).not.toHaveBeenCalled();
  });

  it('says what is missing and where to set it', () => {
    expect(MISSING_PRODUCTION_KEY_MESSAGE).toBe(
      "OPENAI_API_KEY isn't set in the Trigger.dev production environment. Add it under Environment Variables, then redeploy.",
    );
  });

  it('lets a production model task run when the key is set, without logging it', () => {
    const warn = vi.fn();
    const result = checkTriggerModelKey({ taskId: 'sage-weekly-outreach-sweep', environmentType: 'PRODUCTION', apiKey: 'sk-test-value', warn });
    expect(result).toBe('ok');
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(['DEVELOPMENT', 'STAGING', 'PREVIEW'] as const)('warns and keeps the fallback in %s', (environmentType) => {
    const warn = vi.fn();
    const result = checkTriggerModelKey({ taskId: 'sage-wake-sweep', environmentType, apiKey: '', warn });
    expect(result).toBe('missing-warned');
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![1]).toEqual({ taskId: 'sage-wake-sweep', environment: environmentType });
  });

  it('leaves tasks that never call a model alone', () => {
    const warn = vi.fn();
    for (const taskId of ['event-reminder-sweep', 'push-receipt-check', 'onboarding-drip-sweep', 'agent-operations-watchdog']) {
      expect(checkTriggerModelKey({ taskId, environmentType: 'PRODUCTION', apiKey: undefined, warn })).toBe('not-a-model-task');
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('only lists task ids that exist in apps/api/src/trigger', () => {
    const ids = new Set(taskIdsInTriggerDir());
    expect([...MODEL_TASK_IDS].filter((id) => !ids.has(id))).toEqual([]);
  });

  it('never echoes the key value', () => {
    const warn = vi.fn();
    const secret = 'sk-should-never-appear';
    checkTriggerModelKey({ taskId: 'sage-trend-detect', environmentType: 'PRODUCTION', apiKey: secret, warn });
    checkTriggerModelKey({ taskId: 'event-reminder-sweep', environmentType: 'DEVELOPMENT', apiKey: secret, warn });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(secret);
  });
});

describe('Trigger.dev init hook', () => {
  async function loadHook() {
    vi.resetModules();
    let hook: ((params: { ctx: { environment: { type: string } }; task: string }) => Promise<void>) | undefined;
    const logger = { warn: vi.fn(), error: vi.fn() };
    class AbortTaskRunError extends Error {
      constructor(message: string) { super(message); this.name = 'AbortTaskRunError'; }
    }
    vi.doMock('@trigger.dev/sdk', () => ({
      AbortTaskRunError,
      logger,
      tasks: { onStartAttempt: (_name: string, fn: typeof hook) => { hook = fn; } },
    }));
    await import('../../../../apps/api/src/trigger/init.js');
    return { hook: hook!, logger };
  }

  it('aborts a production model run without retries when the key is missing', async () => {
    const saved = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const { hook, logger } = await loadHook();
      await expect(hook({ ctx: { environment: { type: 'PRODUCTION' } }, task: 'sage-wake-sweep' }))
        .rejects.toMatchObject({ name: 'AbortTaskRunError', message: MISSING_PRODUCTION_KEY_MESSAGE });
      expect(logger.error).toHaveBeenCalledOnce();
      await expect(hook({ ctx: { environment: { type: 'DEVELOPMENT' } }, task: 'sage-wake-sweep' })).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledOnce();
      await expect(hook({ ctx: { environment: { type: 'PRODUCTION' } }, task: 'event-reminder-sweep' })).resolves.toBeUndefined();
    } finally {
      if (saved !== undefined) process.env.OPENAI_API_KEY = saved;
    }
  });
});
