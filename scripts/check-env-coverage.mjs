import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

const sourceExtensions = new Set([".js", ".cjs", ".mjs", ".ts", ".tsx"]);
const ignoredDirectories = new Set([
  ".next",
  "__tests__",
  "dist",
  "node_modules",
]);

function sourceFiles(root) {
  const files = [];

  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const filePath = join(directory, entry.name);

      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) visit(filePath);
        continue;
      }

      if (
        sourceExtensions.has(extname(entry.name)) &&
        !entry.name.includes(".test.") &&
        !entry.name.includes(".spec.")
      ) {
        files.push(filePath);
      }
    }
  }

  visit(root);
  return files;
}

function matchesInFiles(files, pattern) {
  const matches = new Set();

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(pattern)) matches.add(match[1]);
  }

  return matches;
}

function schemaKeys(file) {
  return matchesInFiles([file], /^\s+([A-Z][A-Z0-9_]*)\s*:/gm);
}

function difference(left, right) {
  return [...left].filter((value) => !right.has(value)).sort();
}

const apiAppFiles = sourceFiles("apps/api/src");
const directProcessEnvFiles = [
  ...apiAppFiles.filter((file) => file !== "apps/api/src/env.ts"),
  ...sourceFiles("apps/web").filter(
    (file) => file !== "apps/web/env.ts" && file !== "apps/web/jest.setup.js",
  ),
];
const directProcessEnvUsages = matchesInFiles(
  directProcessEnvFiles,
  /process\.env\.([A-Z][A-Z0-9_]*)/g,
);

const apiRuntimeFiles = [
  ...apiAppFiles,
  ...sourceFiles("packages/trpc/src"),
  "packages/db/index.ts",
];
const apiRuntimeVariables = matchesInFiles(
  apiRuntimeFiles,
  /process\.env\.([A-Z][A-Z0-9_]*)/g,
);
apiRuntimeVariables.delete("SKIP_ENV_VALIDATION");

const webVariables = matchesInFiles(
  sourceFiles("apps/web").filter((file) => file !== "apps/web/env.ts"),
  /\benv\.([A-Z][A-Z0-9_]*)/g,
);

const missingApiVariables = difference(
  apiRuntimeVariables,
  schemaKeys("apps/api/src/env.ts"),
);
const missingWebVariables = difference(
  webVariables,
  schemaKeys("apps/web/env.ts"),
);
const errors = [];

if (directProcessEnvUsages.size > 0) {
  errors.push(
    `Use the typed env object instead of process.env for: ${[
      ...directProcessEnvUsages,
    ]
      .sort()
      .join(", ")}`,
  );
}
if (missingApiVariables.length > 0) {
  errors.push(
    `Missing from the API env schema: ${missingApiVariables.join(", ")}`,
  );
}
if (missingWebVariables.length > 0) {
  errors.push(
    `Missing from the web env schema: ${missingWebVariables.join(", ")}`,
  );
}

if (errors.length > 0) {
  console.error(`Environment coverage check failed:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}

console.log("Environment schemas cover all API and web runtime variables.");
