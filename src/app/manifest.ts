import type { MetadataRoute } from "next";

/**
 * Web app manifest, served at `/manifest.webmanifest` (Next links it from
 * every page). Replaces the static `public/manifest.webmanifest`, which had
 * three defects an installed app inherits for good:
 *
 * - `start_url: "/"` landed on a redirect; the app now opens on Overview.
 * - No `id`. The id is what makes an installed app the same app across
 *   manifest changes, and without one browsers derive it from `start_url` —
 *   so moving `start_url` would have orphaned every existing install. `"/"`
 *   is exactly the id those installs already have.
 * - `orientation: "portrait-primary"` locked tablets to portrait in a
 *   dashboard built for wide screens.
 *
 * The maskable icons are full-bleed (no transparent corners for Android's
 * adaptive mask to expose) with the mark inside the 40% safe zone; the `any`
 * icons keep their own rounded tile.
 *
 * Named "Zunia", the public name the site, its title template and its share
 * cards use, and no longer "Zunia Wallet": this app holds no keys (the wallet
 * is the Zunia extension, Keplr or the phone, which sign), and an installed
 * "wallet" that lives at a web address invites exactly the confusion phishing
 * pages feed on. `short_name` is the same word, so the home-screen label and
 * the install prompt agree. The `id` stays "/": it is what keeps an installed
 * copy the same app when its name or `start_url` changes.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Zunia",
    short_name: "Zunia",
    description:
      "Balances, staking, governance, swaps and IBC across Cosmos chains. Your keys stay in your wallet.",
    start_url: "/overview",
    scope: "/",
    display: "standalone",
    background_color: "#0B0A09",
    theme_color: "#0B0A09",
    categories: ["finance"],
    lang: "en",
    dir: "ltr",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Overview",
        url: "/overview",
        description: "Net worth, allocation and what needs your attention",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Swap",
        url: "/swap",
        description: "Swap any pair Osmosis trades",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Activity",
        url: "/activity",
        description: "History, flows and fees",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
