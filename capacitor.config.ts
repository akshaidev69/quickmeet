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
    // Land on the app shell, not the marketing website.
    url: 'https://quickmeet-qi4p.onrender.com/app',
    cleartext: false,
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#f3f5f7',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: '#f3f5f7',
      launchShowDuration: 800,
    },
  },
};

export default config;
