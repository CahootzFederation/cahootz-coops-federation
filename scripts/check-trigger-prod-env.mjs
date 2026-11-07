// Fails the Trigger.dev deploy when the production environment has no
// OPENAI_API_KEY. It only reads variable names: Trigger returns secret values
// redacted, and this script never prints any value.
import { configure, envvars } from "@trigger.dev/sdk";

const REQUIRED = ["OPENAI_API_KEY"];
const accessToken = process.env.TRIGGER_ACCESS_TOKEN;
const projectRef = process.env.TRIGGER_PROJECT_REF;

if (!accessToken || !projectRef) {
  console.log("::error::TRIGGER_ACCESS_TOKEN and TRIGGER_PROJECT_REF are both needed to check production env vars.");
  process.exit(1);
}

configure({ accessToken });

let names;
try {
  names = new Set((await envvars.list(projectRef, "prod")).map((variable) => variable.name));
} catch (error) {
  // The run-time check in apps/api/src/trigger/init.ts still fails model tasks,
  // so a Trigger API hiccup shouldn't block the deploy.
  const reason = error instanceof Error ? error.message : String(error);
  console.log(`::warning::Couldn't read Trigger.dev production env vars (${reason}), so OPENAI_API_KEY wasn't checked before deploy. Sage tasks will still fail loudly if it's missing.`);
  process.exit(0);
}

const missing = REQUIRED.filter((name) => !names.has(name));
if (missing.length > 0) {
  for (const name of missing) {
    console.log(`::error::${name} isn't set in the Trigger.dev production environment. Add it under Environment Variables, then redeploy.`);
  }
  process.exit(1);
}

console.log(`Trigger.dev production has ${REQUIRED.join(", ")} set.`);
