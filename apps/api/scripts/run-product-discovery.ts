import { runProductDiscoveryForProfile } from "../../../packages/trpc/src/services/product-discovery.js";

const profileKey = process.argv[2]?.trim();

if (!profileKey) {
  console.error(
    "Usage: pnpm -F @cahootz/api product-discovery:run <profile-key>",
  );
  process.exitCode = 1;
} else {
  runProductDiscoveryForProfile({
    profileKey,
    trigger: "manual",
  })
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(
        error instanceof Error ? error.message : "Product discovery failed.",
      );
      process.exitCode = 1;
    });
}
