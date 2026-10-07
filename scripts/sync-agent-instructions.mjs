#!/usr/bin/env node
// Keeps every coding agent's instruction file in step with AGENTS.md, the one
// file people edit:
//   - CLAUDE.md must only import AGENTS.md (Claude Code reads `@path` imports).
//   - .github/copilot-instructions.md is a generated copy, because Copilot
//     doesn't follow imports.
//
//   node scripts/sync-agent-instructions.mjs          rewrite the generated files
//   node scripts/sync-agent-instructions.mjs --check  fail if any have drifted (CI)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = "AGENTS.md";
const CLAUDE = "CLAUDE.md";
const COPILOT = ".github/copilot-instructions.md";
const CLAUDE_CONTENT = `@${SOURCE}\n`;

const read = (file) => {
  const full = path.join(root, file);
  return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null;
};

const source = read(SOURCE);
if (!source) {
  console.error(`${SOURCE} is missing.`);
  process.exit(1);
}

// Drop the "edit only this file" note, which only makes sense in AGENTS.md.
const body = source.replace(/<!--[\s\S]*?-->\n\n?/, "");
const expected = {
  [CLAUDE]: CLAUDE_CONTENT,
  [COPILOT]: `<!-- Generated from ${SOURCE} by \`pnpm agents:sync\`. Do not edit; change ${SOURCE} instead. -->\n\n${body}`,
};

if (process.argv.includes("--check")) {
  const drifted = Object.entries(expected).filter(([file, want]) => read(file) !== want);
  if (drifted.length === 0) {
    console.log(`Agent instructions match ${SOURCE}.`);
    process.exit(0);
  }
  for (const [file] of drifted) {
    const hint =
      file === CLAUDE
        ? `It must contain only "${CLAUDE_CONTENT.trim()}". Move any rules into ${SOURCE}.`
        : `It is generated. Change ${SOURCE} instead.`;
    console.error(`${file} is out of sync with ${SOURCE}. ${hint}`);
  }
  console.error(`Run \`pnpm agents:sync\` and commit the result.`);
  process.exit(1);
}

for (const [file, content] of Object.entries(expected)) {
  if (file === CLAUDE && read(file) !== content && read(file)?.trim() !== CLAUDE_CONTENT.trim()) {
    console.warn(`${CLAUDE} had its own content; it now only imports ${SOURCE}. Check that nothing was lost.`);
  }
  fs.writeFileSync(path.join(root, file), content);
  console.log(`Wrote ${file}`);
}
