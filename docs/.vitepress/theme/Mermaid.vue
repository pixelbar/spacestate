<script setup lang="ts">
// Renders a ```mermaid fence (see `markdown.config` in config.mts). Mermaid
// needs a browser, so the page is built with the source in a <pre> and the
// diagram replaces it once mounted, then again whenever the colour mode flips.
import { onMounted, ref, watch } from "vue";
import { useData } from "vitepress";

const props = defineProps<{ code: string }>();
const source = decodeURIComponent(props.code);
const { isDark } = useData();
const svg = ref("");
const failed = ref(false);
let renders = 0;

// Mermaid derives shades from real colours, so pass the resolved Pixel tokens
// rather than var() references.
function tokens() {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(name).trim();
  return {
    darkMode: isDark.value,
    background: token("--bg"),
    fontFamily: token("--font-sans"),
    fontSize: "15px",
    primaryColor: token("--surface-raised"),
    primaryTextColor: token("--ink"),
    primaryBorderColor: token("--border-strong"),
    secondaryColor: token("--surface"),
    tertiaryColor: token("--surface"),
    lineColor: token("--spectrum-magenta"),
    textColor: token("--ink"),
    mainBkg: token("--surface-raised"),
    nodeBorder: token("--border-strong"),
    clusterBkg: token("--surface"),
    clusterBorder: token("--border"),
    edgeLabelBackground: token("--bg"),
    actorBkg: token("--surface-raised"),
    actorBorder: token("--border-strong"),
    actorTextColor: token("--ink"),
    signalColor: token("--ink"),
    signalTextColor: token("--ink"),
    labelBoxBkgColor: token("--surface-raised"),
    noteBkgColor: token("--surface"),
    noteBorderColor: token("--spectrum-magenta"),
    noteTextColor: token("--ink"),
  };
}

async function render() {
  // Mermaid sizes each box from the text it measures; measured in a fallback
  // font, the labels overflow once IBM Plex arrives.
  await document.fonts.ready;
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "base", themeVariables: tokens() });
  try {
    const id = `mermaid-${Math.random().toString(36).slice(2)}-${renders++}`;
    svg.value = (await mermaid.render(id, source)).svg;
    failed.value = false;
  } catch (error) {
    // Leave the source showing, so a broken diagram is still readable.
    console.error("Mermaid diagram failed to render", error);
    failed.value = true;
  }
}

onMounted(render);
watch(isDark, render);
</script>

<template>
  <div v-if="svg && !failed" class="px-mermaid" v-html="svg" />
  <pre v-else class="px-mermaid-source"><code>{{ source }}</code></pre>
</template>

<style scoped>
.px-mermaid {
  margin: var(--space-6) 0;
  padding: var(--space-6) var(--space-4);
  background: var(--surface);
  border: 1px solid var(--border);
  overflow-x: auto;
  text-align: center;
}
.px-mermaid :deep(svg) {
  max-width: 100%;
  height: auto;
}
/* Mermaid sizes labels by measuring them outside the page; inside .vp-doc the
   theme's paragraph line-height and margins would make them overflow. */
.px-mermaid :deep(foreignObject p),
.px-mermaid :deep(foreignObject div),
.px-mermaid :deep(foreignObject span) {
  margin: 0;
  line-height: 1.5;
}
.px-mermaid-source {
  margin: var(--space-6) 0;
  padding: var(--space-4);
  background: var(--surface);
  border: 1px solid var(--border);
  overflow-x: auto;
  font: 400 14px / 22px var(--font-mono);
}
</style>
