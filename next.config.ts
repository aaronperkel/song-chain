import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Next blocks cross-origin requests to dev-only assets, trusting only the
   * hostname the dev server started on -- `localhost`. Spotify rejects the
   * `localhost` spelling for redirect URIs and requires the loopback IP, so
   * host auth has to be driven from 127.0.0.1, which Next then treats as a
   * foreign origin: the page server-renders but its client bundle and HMR
   * socket are blocked, so nothing hydrates and every button is dead.
   *
   * Development only; it has no effect on a deployed build.
   */
  allowedDevOrigins: [
    // Spotify requires the loopback IP for redirect URIs (see above).
    "127.0.0.1",
    // Testing with real phones means serving the dev build over the LAN, and
    // the same block applies to any origin that is not the one the dev server
    // booted on. Private ranges only, and development only.
    "192.168.1.184",
    "192.168.*.*",
    "10.*.*.*",
  ],

  images: {
    remotePatterns: [
      // Spotify album art.
      { protocol: "https", hostname: "i.scdn.co", pathname: "/image/**" },
    ],
  },
};

export default nextConfig;
