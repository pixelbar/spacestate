import { defineConfig } from "vitepress";
import { useSidebar } from "vitepress-openapi";
import spec from "./openapi.json" with { type: "json" };

// Generated from docs/openapi.yaml by scripts/build-docs.ts. `just docs-build`
// and `just docs-preview` refresh it; nothing here parses YAML.
const sidebar = useSidebar({ spec, linkPrefix: "/operations/" });

export default defineConfig({
  // Pages serves this repo under pixelbar.nl/spacestate/.
  base: "/spacestate/",
  lang: "en",
  title: "Pixelbar spacestate API",
  description: "HTTP API reference for Pixelbar's space-state and SpaceAPI service.",
  cleanUrls: true,
  appearance: "dark",
  head: [
    ["link", { rel: "preconnect", href: "https://fonts.googleapis.com" }],
    ["link", { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" }],
    [
      "link",
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&family=Pixelify+Sans:wght@400..700&display=swap",
      },
    ],
    ["meta", { name: "theme-color", content: "#06060b" }],
    [
      "link",
      {
        rel: "icon",
        href: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8'%3E%3Crect width='8' height='8' fill='%2306060b'/%3E%3Crect x='1' y='1' width='3' height='3' fill='%23ff3dd6'/%3E%3Crect x='4' y='4' width='3' height='3' fill='%2300e5ff'/%3E%3C/svg%3E",
      },
    ],
  ],
  themeConfig: {
    siteTitle: "spacestate",
    nav: [
      { text: "Single page", link: "/all" },
      { text: "openapi.yaml", link: "/openapi.yaml", target: "_blank" },
      { text: "Pixelbar", link: "https://pixelbar.nl/" },
    ],
    sidebar: [
      { text: "Introduction", link: "/" },
      { text: "Single-page reference", link: "/all" },
      ...sidebar.generateSidebarGroups({ linkPrefix: "/operations/" }),
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/pixelbar/spacestate" }],
    outline: [2, 3],
    search: { provider: "local" },
    footer: {
      message: "Rendered with vitepress-openapi · themed after pixelbar.nl/pixel",
      copyright: "Pixelbar — Rotterdam hackerspace",
    },
  },
});
