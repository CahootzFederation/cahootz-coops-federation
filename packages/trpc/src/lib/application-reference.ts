import { randomInt } from "node:crypto";

// No 0/O, 1/I/L or U, so a reference read aloud or copied by hand stays
// unambiguous.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const LENGTH = 6;
const PREFIX = "APP-";
const MAX_ATTEMPTS = 5;

export const APPLICATION_REFERENCE_PATTERN = /^APP-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/;

export function generateApplicationReference(): string {
  let code = "";
  for (let i = 0; i < LENGTH; i++) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return `${PREFIX}${code}`;
}

/**
 * Picks a reference no saved application uses yet. 30^6 (about 729 million)
 * codes make a clash very unlikely; the unique index on
 * Application.referenceCode is the backstop if two submissions race.
 */
export async function createUniqueApplicationReference(
  isTaken: (code: string) => Promise<boolean>,
): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = generateApplicationReference();
    if (!(await isTaken(code))) return code;
  }
  throw new Error("Could not create a unique application reference");
}
