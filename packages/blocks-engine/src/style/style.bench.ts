import { bench, describe } from "vitest";

import { checkContrast } from "./contrast";
import { dtcgToTokens, tokensToDtcg } from "./dtcg";
import { emitFontFaces, emitTokenBlocks } from "./site-tokens";
import type { FontFaceDef, SiteToken } from "./site-tokens";

/**
 * Absolute numbers for the styling surface, run with `pnpm bench`.
 *
 * A report rather than a gate, for the same reason the document benchmarks are:
 * a wall-clock limit on a shared runner fails for reasons that have nothing to
 * do with the code. What is worth knowing here is the SHAPE of the cost, since
 * every one of these runs while somebody is typing — the token table is emitted
 * on each page compile, and the editor calls `checkContrast` as a colour picker
 * moves.
 *
 * Fixtures are built once, outside the measured function, so the numbers
 * describe the operation and not the generator.
 */

/** A token table the size a real site grows to, rather than the default six. */
function tokenTable(count: number): SiteToken[] {
  const tokens: SiteToken[] = [];
  for (let index = 0; index < count; index += 1) {
    // Deterministic, and spread across the kinds so the per-kind checks are all
    // exercised rather than one cheap branch being measured repeatedly.
    const hue = (index * 37) % 360;
    switch (index % 4) {
      case 0:
        tokens.push({
          name: `color.c${index}`,
          kind: "color",
          values: { light: `rgb(${hue % 256} 99 235)`, dark: "#60a5fa" },
        });
        break;
      case 1:
        tokens.push({
          name: `space.s${index}`,
          kind: "dimension",
          values: { light: `${index % 64}px` },
        });
        break;
      case 2:
        tokens.push({
          name: `motion.m${index}`,
          kind: "duration",
          values: { light: `${index % 500}ms` },
        });
        break;
      default:
        tokens.push({
          name: `font.f${index}`,
          kind: "fontFamily",
          values: { light: `"Family ${index}", serif` },
        });
    }
  }
  return tokens;
}

function faces(count: number): FontFaceDef[] {
  const list: FontFaceDef[] = [];
  for (let index = 0; index < count; index += 1) {
    list.push({
      family: `Family ${index}`,
      src: [{ url: `/fonts/f${index}.woff2`, format: "woff2" }],
      weight: index % 2 === 0 ? "400" : "700",
    });
  }
  return list;
}

const small = { tokens: tokenTable(24) };
const large = { tokens: tokenTable(500) };
const largeFaces = faces(50);
const exported = tokensToDtcg(large).document;

describe("emit token blocks", () => {
  bench("24 tokens, the size a site starts at", () => {
    emitTokenBlocks(small, ".nx-pb-d-abc");
  });

  bench("500 tokens, the size one grows to", () => {
    emitTokenBlocks(large, ".nx-pb-d-abc");
  });
});

describe("emit font faces", () => {
  bench("50 self-hosted faces", () => {
    emitFontFaces(largeFaces);
  });
});

describe("DTCG", () => {
  bench("export 500 tokens", () => {
    tokensToDtcg(large);
  });

  bench("import 500 tokens", () => {
    dtcgToTokens(exported);
  });

  bench("round trip 500 tokens", () => {
    dtcgToTokens(tokensToDtcg(large).document);
  });
});

describe("contrast", () => {
  // The one measured per keystroke rather than per compile.
  bench("one pair, hex", () => {
    checkContrast("#767676", "#ffffff");
  });

  bench("one pair, translucent rgb()", () => {
    checkContrast("rgb(0 0 0 / 50%)", "rgb(255 255 255)");
  });
});
