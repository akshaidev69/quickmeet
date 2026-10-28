export const BUILD_VERSION =
  (import.meta.env.VITE_BUILD_VERSION as string | undefined) ||
  (import.meta.env.VITE_BUILD_ID as string | undefined) ||
  '1.1.0';

export const APP_NAME = 'LetsConnect';
