const { withNativeWind } = require('nativewind/metro');
const os = require('os');
const {
  getSentryExpoConfig
} = require("@sentry/react-native/metro");

if (!os.availableParallelism) {
  os.availableParallelism = () => os.cpus().length;
}
 
const config = getSentryExpoConfig(__dirname)
 
module.exports = withNativeWind(config, { input: './global.css', inlineRem: 16  })