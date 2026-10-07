// Only applied when ANDROID_E2E=1 (see app.config.js), for the release APK the
// Android E2E workflow builds. That APK talks to the API on the CI machine over
// plain http (http://10.0.2.2:3001 from the emulator), which Android release
// builds block unless cleartext traffic is allowed. Store builds never set it.

/** @type {import("@expo/config-plugins").ConfigPlugin} */
const withAndroidE2E = (config) =>
  require("@expo/config-plugins").withAndroidManifest(config, (config) => {
    const app = config.modResults.manifest.application?.[0];
    if (app) app.$["android:usesCleartextTraffic"] = "true";
    return config;
  });

module.exports = withAndroidE2E;
