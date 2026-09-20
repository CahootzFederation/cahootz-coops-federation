import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import config from "../trigger.config.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

// Use the same esbuild installation as Trigger without adding another dependency.
const requireFromTrigger = createRequire(
  import.meta.resolve("@trigger.dev/build"),
);
const { build } = requireFromTrigger("esbuild");

const resolver = config.build?.extensions?.find(
  (extension) => extension.name === "workspace-package-sources",
);
assert.ok(resolver, "Trigger workspace package resolver is missing");

let workspacePlugin;
await resolver.onBuildStart({
  registerPlugin(plugin, options) {
    workspacePlugin = plugin;
    assert.equal(options?.placement, "first");
  },
});
assert.ok(
  workspacePlugin,
  "Trigger workspace package resolver did not register",
);

const taskDir = join(root, "apps/api/src/trigger");
const entryPoints = readdirSync(taskDir)
  .filter((file) => file.endsWith(".ts"))
  .map((file) => join(taskDir, file));
assert.ok(entryPoints.length > 0, "No Trigger tasks found to bundle");

const result = await build({
  absWorkingDir: root,
  entryPoints,
  outdir: join(root, ".trigger/build-check"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  packages: "external",
  plugins: [workspacePlugin],
  metafile: true,
  write: false,
});

const inputs = Object.entries(result.metafile.inputs);
const bundledFiles = new Set(inputs.map(([file]) => resolve(root, file)));
for (const file of [
  "packages/db/index.ts",
  "packages/validators/src/index.ts",
  "packages/validators/src/notification.ts",
]) {
  assert.ok(bundledFiles.has(join(root, file)), `${file} was not bundled`);
}

const unresolvedWorkspaceImports = inputs.flatMap(([file, details]) =>
  details.imports
    .filter((item) => item.external && item.path.startsWith("@repo/"))
    .map((item) => `${file}: ${item.path}`),
);
assert.deepEqual(
  unresolvedWorkspaceImports,
  [],
  "Workspace imports were left external",
);

console.log(
  `Trigger bundle check passed for ${entryPoints.length} task files.`,
);
