import { describe, expect, it, vi } from "vitest";
import {
  APPLICATION_REFERENCE_PATTERN,
  createUniqueApplicationReference,
  generateApplicationReference,
} from "../lib/application-reference.js";

describe("application references", () => {
  it("are short, prefixed, and avoid look-alike characters", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateApplicationReference();
      expect(code).toMatch(APPLICATION_REFERENCE_PATTERN);
      expect(code.slice(4)).not.toMatch(/[01ILOU]/);
    }
  });

  it("skips a reference that is already taken", async () => {
    const taken = new Set<string>();
    const isTaken = vi.fn(async (code: string) => {
      if (taken.size === 0) {
        taken.add(code);
        return true;
      }
      return taken.has(code);
    });

    const code = await createUniqueApplicationReference(isTaken);

    expect(isTaken).toHaveBeenCalledTimes(2);
    expect(taken.has(code)).toBe(false);
    expect(code).toMatch(APPLICATION_REFERENCE_PATTERN);
  });

  it("gives up after repeated clashes instead of looping forever", async () => {
    await expect(createUniqueApplicationReference(async () => true)).rejects.toThrow(
      "Could not create a unique application reference",
    );
  });
});
