import { describe, expect, it, vi, beforeEach } from "vitest";

import { commonsRouter } from "../routers/commons.js";
import {
  sendApplicationSubmittedNotification,
  sendCommonsSuggestionNotification,
} from "../services/slack-notification-service.js";

vi.mock("../services/slack-notification-service.js", () => ({
  sendApplicationSubmittedNotification: vi.fn().mockResolvedValue(undefined),
  sendCommonsSuggestionNotification: vi.fn().mockResolvedValue(undefined),
}));

const ACTIVE_USER = {
  id: "user_1",
  email: "alice@example.com",
  name: "Alice",
  phone: "+15555550123",
  roles: ["member"],
  status: "ACTIVE",
  deletedAt: null,
};

function makeDb(overrides: Record<string, Partial<Record<string, any>>> = {}) {
  const db: any = {
    commonsPost: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn().mockResolvedValue({}),
      ...overrides.commonsPost,
    },
    commonsComment: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      upsert: vi.fn().mockResolvedValue({}),
      ...overrides.commonsComment,
    },
    commonsPostSupport: {
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      ...overrides.commonsPostSupport,
    },
    commonsSuggestion: {
      create: vi.fn(),
      ...overrides.commonsSuggestion,
    },
    coopConfig: {
      findFirst: vi.fn().mockResolvedValue({
        coopId: "cahootz",
        name: "Cahootz Commons",
        slug: "Cahootz",
        description: "The default social commons.",
        tagline: null,
        displayMission: null,
      }),
      findMany: vi.fn().mockResolvedValue([
        {
          coopId: "cahootz",
          name: "Cahootz Commons",
          slug: "Cahootz",
          tagline: "Main commons",
          description: "The default social commons.",
          displayMission: "Coordinate people, skills, businesses, resources, and capital.",
          eligibility: "Open to all members.",
        },
      ]),
      ...overrides.coopConfig,
    },
    application: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({
        id: "app_1",
        userId: ACTIVE_USER.id,
        coopId: "artists",
        status: "SUBMITTED",
      }),
      ...overrides.application,
    },
    directMessage: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      ...overrides.directMessage,
    },
    session: {
      findUnique: vi.fn().mockResolvedValue({
        id: "session_1",
        userId: ACTIVE_USER.id,
        token: "token_1",
        isRevoked: false,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      }),
      update: vi.fn().mockResolvedValue({}),
      ...overrides.session,
    },
    user: {
      findUnique: vi.fn().mockResolvedValue(ACTIVE_USER),
      update: vi.fn().mockResolvedValue(ACTIVE_USER),
      upsert: vi.fn().mockResolvedValue({ id: "commons_starter" }),
      ...overrides.user,
    },
    userCoopMembership: {
      upsert: vi.fn().mockResolvedValue({ id: "membership_1" }),
      findUnique: vi.fn().mockResolvedValue({ status: "ACTIVE" }),
      findMany: vi.fn().mockResolvedValue([]),
      ...overrides.userCoopMembership,
    },
    $transaction: vi.fn(async (callback: any) => callback(db)),
  };

  return db;
}

function callerFor(db: any, headers: Record<string, string> = {}) {
  return commonsRouter.createCaller({
    db,
    req: { headers } as any,
    res: {} as any,
    coopId: undefined,
  });
}

describe("commonsRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "";
  });

  it("lets anonymous visitors read an empty Commons feed", async () => {
    const db = makeDb();

    const result = await callerFor(db).listFeed();

    expect(result.posts).toEqual([]);
    expect(result.coop).toEqual({
      id: "cahootz",
      name: "Cahootz Commons",
      shortName: "Cahootz",
      description: "The default social commons.",
    });
    expect(db.commonsPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { coopId: "cahootz" },
      }),
    );
    expect(db.user.upsert).not.toHaveBeenCalled();
  });

  it("stores commons suggestions and sends Slack notifications", async () => {
    const createdAt = new Date();
    const db = makeDb({
      commonsSuggestion: {
        create: vi.fn().mockResolvedValue({
          id: "suggestion_1",
          coopId: "cahootz",
          name: "Artists",
          reason: "A place for artists to share gigs, studios, and supplies.",
          suggestedByEmail: "maya@example.com",
          suggestedByName: "Maya",
          userId: null,
          status: "NEW",
          createdAt,
          updatedAt: createdAt,
        }),
      },
    });

    const result = await callerFor(db).suggestCommons({
      name: "Artists",
      reason: "A place for artists to share gigs, studios, and supplies.",
      email: "maya@example.com",
      suggestedByName: "Maya",
    });

    expect(result).toEqual({ success: true, suggestionId: "suggestion_1" });
    expect(db.commonsSuggestion.create).toHaveBeenCalledWith({
      data: {
        coopId: "cahootz",
        name: "Artists",
        reason: "A place for artists to share gigs, studios, and supplies.",
        suggestedByEmail: "maya@example.com",
        suggestedByName: "Maya",
        userId: null,
      },
    });
    expect(sendCommonsSuggestionNotification).toHaveBeenCalledWith({
      suggestionId: "suggestion_1",
      coopId: "cahootz",
      commonsName: "Artists",
      reason: "A place for artists to share gigs, studios, and supplies.",
      suggestedByEmail: "maya@example.com",
      suggestedByName: "Maya",
    });
  });

  it("lists active coop configs with member access state", async () => {
    const db = makeDb({
      coopConfig: {
        findMany: vi.fn().mockResolvedValue([
          {
            coopId: "cahootz",
            name: "Cahootz Commons",
            slug: "Cahootz",
            tagline: "Main commons",
            description: "Everyone starts here.",
            displayMission: "Coordinate the whole network.",
            eligibility: "Open to all members.",
          },
          {
            coopId: "artists",
            name: "Artists Commons",
            slug: "Artists",
            tagline: "Creative work",
            description: "For artists and creative businesses.",
            displayMission: "Pool space, buyers, shows, and capital.",
            eligibility: "Artists and creative workers.",
          },
          {
            coopId: "neighborhood",
            name: "Neighborhood Commons",
            slug: "Neighborhood",
            tagline: "Local action",
            description: "A place-based commons.",
            displayMission: "Coordinate local resources.",
            eligibility: "Residents and local businesses.",
          },
        ]),
      },
      userCoopMembership: {
        findMany: vi.fn().mockResolvedValue([
          { coopId: "cahootz", status: "ACTIVE", roles: ["member"] },
        ]),
      },
      application: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "app_1",
            coopId: "artists",
            status: "SUBMITTED",
            createdAt: new Date(),
            reviewedAt: null,
          },
        ]),
      },
    });

    const result = await callerFor(db, {
      "x-session-token": "token_1",
    }).listDirectory();

    expect(result.coops).toEqual([
      expect.objectContaining({
        id: "cahootz",
        accessStatus: "ACTIVE",
        isMember: true,
        isLocked: false,
        canApply: false,
      }),
      expect.objectContaining({
        id: "artists",
        accessStatus: "PENDING",
        isMember: false,
        isLocked: true,
        canApply: false,
        applicationId: "app_1",
      }),
      expect.objectContaining({
        id: "neighborhood",
        accessStatus: "LOCKED",
        isMember: false,
        isLocked: true,
        canApply: true,
      }),
    ]);
  });

  it("lets logged-in users apply to locked commons with coop-config questions", async () => {
    const db = makeDb({
      coopConfig: {
        findFirst: vi.fn().mockResolvedValue({
          coopId: "artists",
          name: "Artists Commons",
          applicationQuestions: [
            {
              id: "email",
              type: "email",
              label: "Email",
              required: true,
            },
            {
              id: "practice",
              type: "textarea",
              label: "What do you make?",
              required: true,
            },
          ],
        }),
      },
    });

    const result = await callerFor(db, {
      "x-session-token": "token_1",
    }).applyToCommons({
      coopId: "artists",
      dynamicAnswers: {
        practice: "Murals and community workshops.",
      },
    });

    expect(result).toEqual({
      success: true,
      message: "Application submitted successfully.",
      applicationId: "app_1",
    });
    expect(db.application.findUnique).toHaveBeenCalledWith({
      where: {
        userId_coopId: {
          userId: ACTIVE_USER.id,
          coopId: "artists",
        },
      },
    });
    expect(db.application.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: ACTIVE_USER.id,
        coopId: "artists",
        status: "SUBMITTED",
        data: expect.objectContaining({
          email: ACTIVE_USER.email,
          dynamicAnswers: {
            practice: "Murals and community workshops.",
          },
        }),
      }),
    });
    expect(db.userCoopMembership.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          coopId: "artists",
          status: "PENDING",
        }),
      }),
    );
    expect(sendApplicationSubmittedNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        coopId: "artists",
        coopName: "Artists Commons",
        applicantEmail: ACTIVE_USER.email,
        applicationId: "app_1",
      }),
    );
  });

  it("requires an account session before publishing a post", async () => {
    const db = makeDb();

    await expect(
      callerFor(db).createPost({
        content: "We should coordinate weekend food support.",
      }),
    ).rejects.toThrow("Create an account to continue.");
  });

  it("creates posts as Cahootz Commons member actions", async () => {
    const db = makeDb({
      commonsPost: {
        create: vi.fn().mockResolvedValue({
          id: "post_1",
          coopId: "cahootz",
          author: { name: "Alice", email: "alice@example.com" },
          createdAt: new Date(),
          title: "Food support",
          content: "We should coordinate weekend food support.",
          tag: "Need",
          comments: [],
          _count: { comments: 0, supports: 0 },
        }),
      },
    });

    const result = await callerFor(db, {
      "x-session-token": "token_1",
    }).createPost({
      title: "Food support",
      content: "We should coordinate weekend food support.",
      tag: "Need",
    });

    expect(result.post.id).toBe("post_1");
    expect(db.userCoopMembership.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          coopId: "cahootz",
          status: "ACTIVE",
          roles: ["member"],
        }),
      }),
    );
    expect(db.commonsPost.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          coopId: "cahootz",
          authorId: ACTIVE_USER.id,
        }),
      }),
    );
  });

  it("lets members comment on real posts", async () => {
    const db = makeDb({
      commonsPost: {
        findUnique: vi.fn().mockResolvedValue({
          id: "post_1",
          coopId: "cahootz",
        }),
      },
      commonsComment: {
        create: vi.fn().mockResolvedValue({
          id: "comment_1",
          content: "I can help Thursday afternoon.",
          author: { name: "Alice", email: "alice@example.com" },
        }),
      },
    });

    const result = await callerFor(db, {
      "x-session-token": "token_1",
    }).createComment({
      postId: "post_1",
      content: "I can help Thursday afternoon.",
    });

    expect(result.comment.body).toBe("I can help Thursday afternoon.");
    expect(db.commonsPost.findUnique).toHaveBeenCalledWith({
      where: { id: "post_1" },
    });
    expect(db.commonsComment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          postId: "post_1",
          authorId: ACTIVE_USER.id,
        }),
      }),
    );
  });

  it("lets anonymous visitors ask the general Cahootz AI", async () => {
    const db = makeDb();

    const result = await callerFor(db).ask({
      prompt: "How do we turn this into a vote?",
    });

    expect(result.answer).toContain("decision");
  });

  it("lists active Commons members for starting real DMs", async () => {
    const db = makeDb({
      userCoopMembership: {
        findMany: vi.fn().mockResolvedValue([
          {
            user: {
              id: "user_2",
              name: "Maya R.",
              email: "maya@example.com",
            },
          },
        ]),
      },
    });

    const result = await callerFor(db, {
      "x-session-token": "token_1",
    }).listDirectMembers();

    expect(result.members).toEqual([
      {
        id: "user_2",
        name: "Maya R.",
        role: "Cahootz Commons",
      },
    ]);
    expect(db.userCoopMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          coopId: "cahootz",
          status: "ACTIVE",
          userId: { not: ACTIVE_USER.id },
        }),
      }),
    );
  });
});
