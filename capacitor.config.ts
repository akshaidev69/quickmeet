import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Native shell loads the live LetsConnect site so Google sign-in,
 * WebRTC, and signaling match the deployed web app.
 */
const config: CapacitorConfig = {
  appId: 'com.letsconnect.app',
  appName: 'LetsConnect',
  webDir: 'dist',
  server: {
    url: 'https://quickmeet-qi4p.onrender.com',
    cleartext: false,
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#0b1411',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: '#0b1411',
    },
  },
};

export default config;
