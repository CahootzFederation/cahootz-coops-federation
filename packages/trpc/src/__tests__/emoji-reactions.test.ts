import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/comment-reactions.js', () => ({
  notifyNewCommentReaction: vi.fn().mockResolvedValue('like'),
  notifyNewPostReaction: vi.fn().mockReturnValue(true),
}));
vi.mock('../services/push-notification-service.js', () => ({
  createNotificationAndPush: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@openai/agents', () => {
  class MockAgent {
    constructor(_opts: any) {}
  }
  return { Agent: MockAgent, run: vi.fn(), webSearchTool: vi.fn().mockReturnValue({}) };
});

import { commonsRouter } from '../routers/commons.js';
import { notifyNewCommentReaction, notifyNewPostReaction } from '../services/comment-reactions.js';
import { createNotificationAndPush } from '../services/push-notification-service.js';
import {
  LIKE_EMOJI,
  MAX_REACTIONS_PER_MEMBER,
  isReactionEmoji,
  summarizeReactions,
} from '../services/emoji-reactions.js';

const commentNotify = vi.mocked(notifyNewCommentReaction);
const postNotify = vi.mocked(notifyNewPostReaction);
const push = vi.mocked(createNotificationAndPush);

const VIEWER = {
  id: 'viewer_1',
  email: 'viewer@example.com',
  name: 'Vi',
  roles: ['member'],
  status: 'ACTIVE',
  deletedAt: null,
};
const POST = { id: 'post_1', coopId: 'artists', circleId: null, authorId: 'author_1' };
const COMMENT = { id: 'c_1', authorId: 'author_1', author: { isBot: false }, post: POST };

function makeDb(state: {
  commentRows?: Array<{ id: string; emoji: string; userId: string }>;
  postRows?: Array<{ id: string; emoji: string; userId: string }>;
  supported?: boolean;
} = {}) {
  const commentRows = [...(state.commentRows ?? [])];
  const postRows = [...(state.postRows ?? [])];
  let supported = state.supported ?? false;
  const table = (rows: typeof commentRows, key: 'commentId' | 'postId') => ({
    findMany: vi.fn(async ({ where }: any) =>
      rows.filter((row) => !where.userId || row.userId === where.userId),
    ),
    create: vi.fn(async ({ data }: any) => {
      const row = { id: `r_${rows.length + 1}`, emoji: data.emoji ?? LIKE_EMOJI, userId: data.userId };
      rows.push(row);
      return { ...row, [key]: data[key] };
    }),
    delete: vi.fn(async ({ where }: any) => {
      rows.splice(rows.findIndex((row) => row.id === where.id), 1);
    }),
  });
  return {
    commentRows,
    postRows,
    session: {
      findUnique: vi.fn().mockResolvedValue({
        id: 's_1',
        userId: VIEWER.id,
        token: 'token_1',
        isRevoked: false,
        expiresAt: new Date(Date.now() + 3_600_000),
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    user: { findUnique: vi.fn().mockResolvedValue(VIEWER), update: vi.fn().mockResolvedValue(VIEWER) },
    userCoopMembership: { findUnique: vi.fn().mockResolvedValue({ status: 'ACTIVE' }) },
    commonsComment: { findUnique: vi.fn().mockResolvedValue(COMMENT) },
    commonsPost: { findUnique: vi.fn().mockResolvedValue(POST) },
    commonsCommentReaction: table(commentRows, 'commentId'),
    commonsPostReaction: table(postRows, 'postId'),
    commonsPostSupport: {
      findUnique: vi.fn(async () => (supported ? { id: 'support_1' } : null)),
      create: vi.fn(async () => {
        supported = true;
      }),
      delete: vi.fn(async () => {
        supported = false;
      }),
      count: vi.fn(async () => (supported ? 1 : 0)),
    },
  } as any;
}

const callerFor = (db: any) =>
  commonsRouter.createCaller({
    db,
    req: { headers: { 'x-session-token': 'token_1' } } as any,
    res: {} as any,
    coopId: undefined,
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isReactionEmoji', () => {
  it('accepts single emoji of every shape', () => {
    for (const emoji of ['👍', '❤️', '🎉', '👍🏽', '🧑‍🤝‍🧑', '👨‍👩‍👧‍👦', '🏳️‍🌈', '🇺🇸', '1️⃣', '#️⃣', '🏴󠁧󠁢󠁳󠁣󠁴󠁿', '©️', '☕']) {
      expect(isReactionEmoji(emoji), emoji).toBe(true);
    }
  });

  it('rejects text, several emoji, and empty values', () => {
    for (const value of ['', 'like', ':tada:', '👍👍', '👍 ', 'a👍', '1', '<b>']) {
      expect(isReactionEmoji(value), value).toBe(false);
    }
  });
});

describe('summarizeReactions', () => {
  it('groups rows by emoji in first-used order and marks the viewer', () => {
    expect(
      summarizeReactions(
        [
          { emoji: '🎉', userId: 'a' },
          { emoji: '❤️', userId: 'b' },
          { emoji: '🎉', userId: 'viewer' },
        ],
        'viewer',
      ),
    ).toEqual([
      { emoji: '🎉', count: 2, viewerReacted: true },
      { emoji: '❤️', count: 1, viewerReacted: false },
    ]);
    expect(summarizeReactions([{ emoji: '🎉', userId: 'a' }], null)[0]?.viewerReacted).toBe(false);
  });
});

describe('toggleCommentReaction', () => {
  it('adds a second emoji alongside an existing like without a second alert', async () => {
    const db = makeDb({ commentRows: [{ id: 'r_0', emoji: LIKE_EMOJI, userId: VIEWER.id }] });

    const result = await callerFor(db).toggleCommentReaction({ commentId: 'c_1', emoji: '🎉' });

    expect(db.commonsCommentReaction.create).toHaveBeenCalledWith({
      data: { commentId: 'c_1', userId: VIEWER.id, emoji: '🎉' },
    });
    expect(result).toMatchObject({
      emoji: '🎉',
      reacted: true,
      reactionCount: 1,
      viewerReacted: true,
      reactions: [
        { emoji: LIKE_EMOJI, count: 1, viewerReacted: true },
        { emoji: '🎉', count: 1, viewerReacted: true },
      ],
    });
    expect(commentNotify).not.toHaveBeenCalled();
  });

  it("alerts on a member's first reaction and defaults to the like for older builds", async () => {
    const db = makeDb();

    const first = await callerFor(db).toggleCommentReaction({ commentId: 'c_1', emoji: '🙏' });
    expect(commentNotify).toHaveBeenCalledWith(db, expect.objectContaining({ emoji: '🙏' }));
    expect(first.reactionCount).toBe(0);

    const like = await callerFor(db).toggleCommentReaction({ commentId: 'c_1' });
    expect(like).toMatchObject({ emoji: LIKE_EMOJI, reacted: true, reactionCount: 1 });
    expect(commentNotify).toHaveBeenCalledTimes(1);
  });

  it('removes an emoji the member already used', async () => {
    const db = makeDb({ commentRows: [{ id: 'r_0', emoji: '🔥', userId: VIEWER.id }] });

    const result = await callerFor(db).toggleCommentReaction({ commentId: 'c_1', emoji: '🔥' });

    expect(result).toMatchObject({ reacted: false, reactions: [] });
    expect(db.commonsCommentReaction.delete).toHaveBeenCalledWith({ where: { id: 'r_0' } });
  });

  it('rejects text and caps how many emoji one member leaves', async () => {
    await expect(
      callerFor(makeDb()).toggleCommentReaction({ commentId: 'c_1', emoji: 'nice' }),
    ).rejects.toThrow('Choose a single emoji.');

    const full = Array.from({ length: MAX_REACTIONS_PER_MEMBER }, (_, index) => ({
      id: `r_${index}`,
      emoji: `e${index}`,
      userId: VIEWER.id,
    }));
    const db = makeDb({ commentRows: full });
    await expect(
      callerFor(db).toggleCommentReaction({ commentId: 'c_1', emoji: '🎉' }),
    ).rejects.toThrow(`up to ${MAX_REACTIONS_PER_MEMBER} reactions`);
    expect(db.commonsCommentReaction.create).not.toHaveBeenCalled();
  });
});

describe('togglePostReaction', () => {
  it('stores other emoji as post reactions and alerts once per member', async () => {
    const db = makeDb();

    const first = await callerFor(db).togglePostReaction({ postId: 'post_1', emoji: '🎉' });
    await callerFor(db).togglePostReaction({ postId: 'post_1', emoji: '🔥' });

    expect(first).toEqual({
      emoji: '🎉',
      reacted: true,
      support: 0,
      reactions: [{ emoji: '🎉', count: 1, viewerReacted: true }],
    });
    expect(postNotify).toHaveBeenCalledTimes(1);
    expect(db.commonsPostSupport.create).not.toHaveBeenCalled();
  });

  it('treats ❤️ as the post like, keeping support counts and the like alert', async () => {
    const db = makeDb();

    const result = await callerFor(db).togglePostReaction({ postId: 'post_1', emoji: LIKE_EMOJI });

    expect(result).toMatchObject({ reacted: true, support: 1, reactions: [] });
    expect(db.commonsPostReaction.create).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith(db, expect.objectContaining({ title: 'Someone liked your post' }));
  });
});
