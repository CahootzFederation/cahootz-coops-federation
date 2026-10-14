import { createHash } from "node:crypto";

/** Hash of a Sage suggestion's payload; a review is only valid for the payload it was asked about. */
export function payloadHash(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload ?? {})).digest("hex");
}
