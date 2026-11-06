import { describe, expect, it } from "vitest";

import {
  REDACTED,
  isSensitiveKey,
  scrubExceptionEvent,
  scrubExceptionProperties,
  scrubText,
} from "../error-tracking.js";

describe("scrubText", () => {
  it("redacts values of sensitive keys in several formats", () => {
    expect(scrubText('{"password":"hunter2","coopId":"abc"}')).toBe(`{"password":"${REDACTED}","coopId":"abc"}`);
    expect(scrubText("token=abc123 status=ok")).toBe(`token=${REDACTED} status=ok`);
    expect(scrubText("where: { sessionToken: 'zzz' }")).toBe(`where: { sessionToken: '${REDACTED}' }`);
    expect(scrubText('{ body: "see you at 6, bring the keys" }')).toBe(`{ body: "${REDACTED}" }`);
    expect(scrubText("loginCode: 482913")).toBe(`loginCode: ${REDACTED}`);
  });

  it("keeps error codes and ordinary words", () => {
    expect(scrubText("code: P2002, status: 500")).toBe("code: P2002, status: 500");
    expect(scrubText("Cannot read properties of undefined (reading 'map')")).toBe(
      "Cannot read properties of undefined (reading 'map')",
    );
  });

  it("redacts one-time codes in prose", () => {
    expect(scrubText("Your code is 482913")).toBe(`Your code is ${REDACTED}`);
    expect(scrubText("OTP: 1234 expired")).toBe(`OTP: ${REDACTED} expired`);
  });

  it("redacts emails, phone numbers, wallets and private keys", () => {
    const key = `0x${"a".repeat(64)}`;
    const wallet = `0x${"b".repeat(40)}`;
    const text = scrubText(`No user for sam@example.com or +1 (415) 555-0134, wallet ${wallet}, key ${key}`);
    expect(text).not.toContain("sam@example.com");
    expect(text).not.toContain("555-0134");
    expect(text).not.toContain(wallet);
    expect(text).not.toContain("a".repeat(64));
  });

  it("keeps dates, which look a little like phone numbers", () => {
    expect(scrubText("expired at 2026-10-23")).toBe("expired at 2026-10-23");
  });

  it("redacts bearer tokens, JWTs and known secret key prefixes", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl";
    const text = scrubText(`Authorization failed: Bearer abc.def ${jwt} sk_live_1234567890abcdef`);
    expect(text).not.toContain("abc.def");
    expect(text).not.toContain(jwt);
    expect(text).not.toContain("sk_live_1234567890abcdef");
  });

  it("redacts long opaque tokens", () => {
    const token = "Qm9vbS1zZXNzaW9uLXRva2VuLXRoYXQtaXMtbG9uZy1lbm91Z2g";
    expect(scrubText(`invite ${token} not found`)).toBe(`invite ${REDACTED} not found`);
  });

  it("drops the argument dump from Prisma invocation errors", () => {
    const prisma = [
      "",
      "Invalid `prisma.directMessage.create()` invocation in",
      "/app/packages/trpc/src/routers/dm.ts:120:30",
      "",
      "  117 const msg = await db.directMessage.create({",
      "        data: {",
      '          body: "hey, here is my door code 4417"',
      "        }",
      "      })",
      "Foreign key constraint violated on the constraint: `DirectMessage_threadId_fkey`",
    ].join("\n");
    const text = scrubText(prisma);
    expect(text).toContain("prisma.directMessage.create()");
    expect(text).toContain("Foreign key constraint violated");
    expect(text).not.toContain("door code");
  });

  it("caps very long messages", () => {
    expect(scrubText("x ".repeat(2000)).length).toBeLessThanOrEqual(1001);
  });
});

describe("isSensitiveKey", () => {
  it.each(["password", "sessionToken", "verification_code", "privateKey", "email", "dmText", "messageBody", "walletAddress"])(
    "treats %s as sensitive",
    (key) => expect(isSensitiveKey(key)).toBe(true),
  );

  it.each(["code", "coopId", "path", "trpc_code", "task_id", "attempt"])("allows %s", (key) =>
    expect(isSensitiveKey(key)).toBe(false),
  );
});

describe("scrubExceptionProperties", () => {
  it("scrubs exception messages, drops frame variables and breadcrumbs, and keeps SDK metadata", () => {
    const result = scrubExceptionProperties({
      $exception_list: [
        {
          type: "Error",
          value: "No account for sam@example.com",
          stacktrace: {
            type: "raw",
            frames: [{ filename: "app.js", lineno: 3, vars: { body: "secret DM text" } }],
          },
        },
      ],
      $exception_message: "token=abc",
      $exception_steps: [{ $message: "typed a DM" }],
      $os: "iOS",
      $app_version: "1.1.6",
      trpc_path: "dm.send",
      input: undefined,
      email: "sam@example.com",
      note: "anything",
    });

    const entry = (result.$exception_list as Array<{ value: string; stacktrace: { frames: object[] } }>)[0]!;
    expect(entry.value).toBe(`No account for ${REDACTED}`);
    expect(entry.stacktrace.frames[0]).toEqual({ filename: "app.js", lineno: 3 });
    expect(result.$exception_message).toBe(`token=${REDACTED}`);
    expect(result).not.toHaveProperty("$exception_steps");
    expect(result.$os).toBe("iOS");
    expect(result.$app_version).toBe("1.1.6");
    expect(result.trpc_path).toBe("dm.send");
    expect(result).not.toHaveProperty("email");
    expect(result).not.toHaveProperty("note");
  });
});

describe("scrubExceptionEvent", () => {
  it("only touches $exception events", () => {
    const pageview = { event: "app_opened", properties: { email_count: 1 } };
    expect(scrubExceptionEvent(pageview)).toBe(pageview);
    expect(scrubExceptionEvent(null)).toBeNull();

    const exception = scrubExceptionEvent({
      event: "$exception",
      properties: { $exception_list: [{ type: "Error", value: "password: hunter2" }] },
    });
    expect((exception.properties?.$exception_list as Array<{ value: string }>)[0]!.value).toBe(
      `password: ${REDACTED}`,
    );
  });
});
