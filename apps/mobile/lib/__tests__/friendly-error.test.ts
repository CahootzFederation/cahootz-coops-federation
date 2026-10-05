import { describe, expect, it } from "@jest/globals";

import {
  ApiError,
  CONNECTION_MESSAGE,
  SIGN_IN_AGAIN_MESSAGE,
  TOO_MANY_TRIES_MESSAGE,
  apiError,
  friendlyError,
  httpError,
} from "../friendly-error";

describe("friendlyError", () => {
  it("shows a server message that was written for members", () => {
    const err = apiError(
      { message: "Store not found or not accepting quick payments", data: { code: "NOT_FOUND" } },
      "Failed to get store",
    );
    expect(friendlyError(err, "We couldn't find that store.")).toBe(
      "Store not found or not accepting quick payments.",
    );
  });

  it("replaces a raw validation dump with the screen's fallback", () => {
    const dump = JSON.stringify(
      [{ code: "invalid_type", expected: "string", received: "undefined", path: ["coopId"], message: "Required" }],
      null,
      2,
    );
    const err = apiError({ message: dump, data: { code: "BAD_REQUEST", httpStatus: 400 } }, "x");
    expect(friendlyError(err, "We couldn't load the store.")).toBe(
      "We couldn't load the store. Please try again.",
    );
  });

  it("hides developer details behind the screen's fallback and adds a next step", () => {
    const err = apiError(
      { message: "SC token address not configured for coop: cahootz", data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 } },
      "Failed to get balance",
    );
    expect(friendlyError(err, "We couldn't load your balance")).toBe(
      "We couldn't load your balance. Please try again.",
    );
    expect(friendlyError(new Error("Cannot read properties of undefined (reading 'id')"), "We couldn't save that.")).toBe(
      "We couldn't save that. Please try again.",
    );
    expect(friendlyError(httpError(502), "We couldn't load your orders.")).toBe(
      "We couldn't load your orders. Please try again.",
    );
  });

  it("explains connection problems", () => {
    expect(friendlyError(new TypeError("Network request failed"), "x")).toBe(CONNECTION_MESSAGE);
    expect(friendlyError(new TypeError("Failed to fetch"), "x")).toBe(CONNECTION_MESSAGE);
  });

  it("tells people to sign in again when the session expired", () => {
    const err = apiError(
      { message: "Your session expired. Sign in again to continue.", data: { code: "UNAUTHORIZED", httpStatus: 401 } },
      "x",
    );
    expect(friendlyError(err, "We couldn't load this.")).toBe(SIGN_IN_AGAIN_MESSAGE);
  });

  it("asks people to wait after too many tries", () => {
    const err = apiError({ message: "Rate limit exceeded", data: { code: "TOO_MANY_REQUESTS", httpStatus: 429 } }, "x");
    expect(friendlyError(err, "We couldn't send the code.")).toBe(TOO_MANY_TRIES_MESSAGE);
  });

  it("keeps a fallback that already says what to do next", () => {
    expect(friendlyError({}, "We couldn't send your code. Check the email address and try again.")).toBe(
      "We couldn't send your code. Check the email address and try again.",
    );
  });

  it("keeps the tRPC code and status on the thrown error", () => {
    const err = apiError({ message: "Nope", data: { code: "FORBIDDEN", httpStatus: 403 } }, "x");
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("FORBIDDEN");
    expect(err.httpStatus).toBe(403);
    expect(err.message).toBe("Nope");
  });

  it("reads the message from a tRPC v11 json envelope", () => {
    const err = apiError({ json: { message: "Already applied", data: { code: "CONFLICT" } } }, "x");
    expect(err.message).toBe("Already applied");
    expect(err.code).toBe("CONFLICT");
  });
});
