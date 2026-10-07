const fs = require("fs");
const path = require("path");

// Android push needs Firebase's google-services.json. EAS builds get it from
// the GOOGLE_SERVICES_JSON file variable; locally it can sit next to this
// file. It is only set when the file exists so builds without Firebase (the
// Android E2E build, a fresh checkout) still prebuild.
function googleServicesFile() {
  const file =
    process.env.GOOGLE_SERVICES_JSON ||
    path.join(__dirname, "google-services.json");
  return fs.existsSync(file) ? file : undefined;
}

// The Android E2E build (.github/workflows/mobile-native-e2e.yml) talks to a
// local API over http and must run its own bundle, not an OTA update.
const isAndroidE2E = process.env.ANDROID_E2E === "1";

/** @type {import('@expo/config').ConfigContext} */
module.exports = ({ config }) => ({
  ...config,
  ...(isAndroidE2E && {
    updates: { ...config.updates, enabled: false },
    plugins: [...(config.plugins ?? []), "./expo-plugins/with-android-e2e.js"],
  }),
  android: {
    ...config.android,
    googleServicesFile: googleServicesFile(),
  },
  extra: {
    ...config.extra,
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL,
  },
});
