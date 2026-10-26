import { describe, expect, it, vi } from 'vitest';

import { ensureUserHandle } from '../lib/commons.js';
import { encodeMentions } from '../lib/mentions.js';

describe('reserved group-ping handles', () => {
  it('never resolves a member-typed @everyone to a user account', async () => {
    const db: any = {
      userCoopMembership: {
        findMany: vi.fn().mockResolvedValue([
          { user: { id: 'u_bob', handle: 'bob', isBot: false, roles: [] } },
        ]),
      },
    };

    const result = await encodeMentions(db, 'hey @everyone and @bob', {
      coopId: 'garden',
    });

    expect(db.userCoopMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          coopId: 'garden',
          status: 'ACTIVE',
          user: expect.objectContaining({
            handle: { in: ['bob'], mode: 'insensitive' },
          }),
        }),
      }),
    );
    expect(result.content).toBe('hey @everyone and [@bob]');
  });

  it('leaves handles from outside the Commons as plain text', async () => {
    const db: any = {
      userCoopMembership: {
        findMany: vi.fn().mockResolvedValue([
          { user: { id: 'u_bob', handle: 'bob', isBot: false, roles: [] } },
        ]),
      },
    };

    const result = await encodeMentions(db, 'Thanks @bob and @eve', {
      coopId: 'garden',
    });

    expect(result.content).toBe('Thanks [@bob] and @eve');
    expect(result.mentionedUsers.map((user) => user.handle)).toEqual(['bob']);
  });

  it("resolves bare @sage only to this Commons' Sage membership", async () => {
    const db: any = {
      userCoopMembership: {
        findMany: vi.fn().mockResolvedValue([
          {
            user: {
              id: 'sage_garden',
              handle: 'sage-garden',
              isBot: true,
              roles: ['member', 'sage'],
            },
          },
        ]),
      },
    };

    const result = await encodeMentions(db, 'Could you help, @sage?', {
      coopId: 'garden',
    });

    expect(result.content).toBe('Could you help, [@sage-garden]?');
    expect(result.mentionedUsers.map((user) => user.handle)).toEqual([
      'sage-garden',
    ]);
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
