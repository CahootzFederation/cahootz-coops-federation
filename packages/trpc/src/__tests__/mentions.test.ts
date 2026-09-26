import { describe, expect, it, vi } from 'vitest';

import { ensureUserHandle } from '../lib/commons.js';
import { encodeMentions } from '../lib/mentions.js';

describe('reserved group-ping handles', () => {
  it('never resolves a member-typed @everyone to a user account', async () => {
    const db: any = {
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: 'u_bob', handle: 'bob', isBot: false, roles: [] }]),
      },
    };

    const result = await encodeMentions(db, 'hey @everyone and @bob');

    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ handle: { in: ['bob'], mode: 'insensitive' } }) }),
    );
    expect(result.content).toBe('hey @everyone and [@bob]');
  });

  it('does not hand out a reserved handle to a user named "Everyone"', async () => {
    const db: any = {
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({}),
      },
    };

    const handle = await ensureUserHandle(db, { id: 'u_1', handle: null, name: 'Everyone', email: 'e@example.com' });

    expect(handle).toBe('everyone1');
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 'u_1' }, data: { handle: 'everyone1' } });
  });
});
