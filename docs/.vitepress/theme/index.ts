import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";
import { theme, useOpenapi, usePlayground } from "vitepress-openapi/client";
import spec from "../openapi.json" with { type: "json" };

import "vitepress-openapi/dist/style.css";
import "./pixel.css";
import "./openapi.css";

export default {
  extends: DefaultTheme,
  async enhanceApp(ctx) {
    useOpenapi({
      spec,
      config: {
        // Schemas open on arrival rather than a tree to click through.
        schemaViewer: { deep: Number.POSITIVE_INFINITY },
        // The library's own attribution sits in the site footer instead of
        // between every operation and the next.
        operation: { hiddenSlots: ["branding"] },
      },
    });
    // Otherwise the samples invent credentials: an http-bearer scheme renders
    // as a bare "Token" and an apiKey as its own parameter name. Keys come from
    // the Pixelbar board, so show a placeholder that says so.
    usePlayground().setSecuritySchemeDefaultValues({
      "http-bearer": "Bearer <your-api-key>",
      apiKey: "<your-device-token>",
    });

    theme.enhanceApp(ctx);
  },
} satisfies Theme;
