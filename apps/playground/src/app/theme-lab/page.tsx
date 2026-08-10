/**
 * Side-by-side palette reference: Payload's verified achromatic base scale,
 * Strapi's violet-cast neutrals and primary, and Nextly's current Mono, read
 * directly off `NEXTLY_THEMES` rather than re-typed here. Competitor values
 * are quoted from their published sources so the comparison is verifiable
 * rather than remembered, and none of them is selectable as a Nextly theme --
 * this page only reads the theme set, it never imports or writes to it.
 *
 * The literal hex/rgb values below are a deliberate, scoped exception to the
 * project's token-driven styling rule: everywhere else a hardcoded color is
 * styling that should have come from a design token, but here the colors ARE
 * the data being compared -- swapping them for tokens would compare Nextly's
 * palette against itself.
 */
import { NEXTLY_THEMES } from "../../theme-lab/themes";

import { Gallery } from "./Gallery";

// Payload's base scale, fully achromatic (equal R/G/B at every step) --
// https://github.com/payloadcms/payload, packages/ui base color tokens.
const PAYLOAD_BASE = [
  "rgb(255,255,255)",
  "rgb(235,235,235)",
  "rgb(208,208,208)",
  "rgb(181,181,181)",
  "rgb(154,154,154)",
  "rgb(128,128,128)",
  "rgb(101,101,101)",
  "rgb(74,74,74)",
  "rgb(47,47,47)",
  "rgb(20,20,20)",
  "rgb(0,0,0)",
];

// Strapi's neutrals and primary. Unlike Payload's scale, these carry a
// visible violet cast even in the "neutral" steps --
// https://github.com/strapi/strapi, packages/design-system theme tokens.
const STRAPI = [
  "#f6f6f9",
  "#dcdce4",
  "#a5a5ba",
  "#8e8ea9",
  "#666687",
  "#4a4a6a",
  "#32324d",
  "#212134",
  "#4945ff",
  "#7b79ff",
  "#9736e8",
];

function Swatches({ label, colors }: { label: string; colors: string[] }) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ font: "600 14px system-ui", marginBottom: 8 }}>{label}</h2>
      <div style={{ display: "flex", flexWrap: "wrap" }}>
        {colors.map((c, i) => (
          // Keyed by POSITION, not by value. A palette legitimately repeats a
          // colour -- Mono's `background` and `card` are both pure white -- and
          // keying by value gives those two swatches the same key, so React
          // drops one. The row then renders fewer swatches than the palette
          // has, which reads as the palette being smaller than it is.
          <div
            key={i}
            title={c}
            style={{ width: 56, height: 56, background: c }}
          />
        ))}
      </div>
    </section>
  );
}

export default function ThemeLabBoard() {
  // MONO leads NEXTLY_THEMES as the unchanged control (see themes/index.ts),
  // so index 0 is always the right-hand comparison column regardless of how
  // many themes come after it.
  const mono = NEXTLY_THEMES[0];

  return (
    <main style={{ padding: 32, background: "#fff", color: "#111" }}>
      <h1 style={{ font: "700 20px system-ui", marginBottom: 8 }}>Theme lab</h1>
      <p
        style={{ font: "400 13px system-ui", marginBottom: 24, color: "#555" }}
      >
        The shortlisted themes, each shown on the admin primitives themes
        actually fail on. The competitor palettes that prompted the comparison
        are kept below.
      </p>

      <Gallery />

      {/* Collapsed rather than deleted: it is the evidence behind "why do
          Payload and Strapi look more colourful", and a claim quoted from
          source stays checkable only while the source values are here. */}
      <details style={{ marginTop: 8 }}>
        <summary
          style={{ font: "600 14px system-ui", cursor: "pointer", padding: 4 }}
        >
          Competitor palette reference (Payload / Strapi)
        </summary>
        <div style={{ marginTop: 16 }}>
          <Swatches
            label="Payload -- base scale (fully achromatic, 11 steps shown)"
            colors={PAYLOAD_BASE}
          />
          <Swatches
            label="Strapi -- neutrals and primary (violet cast)"
            colors={STRAPI}
          />
          <Swatches
            label="Nextly -- current Mono, light mode"
            colors={[
              mono.light.background,
              mono.light.card,
              mono.light.muted,
              mono.light["muted-foreground"],
              mono.light.accent,
              mono.light.foreground,
              mono.light.primary,
            ]}
          />
        </div>
      </details>
    </main>
  );
}
