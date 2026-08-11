/**
 * The accessibility corrections layered over imported tweakcn presets.
 *
 * The property that matters is SURVIVAL: a correction has to outlive a
 * re-import of the preset it corrects. Editing `tweakcn.generated.ts` directly
 * would pass every other test in this suite and then be erased the next time
 * the importer runs, with nothing failing to say so.
 */
import { describe, expect, it } from "vitest";

import { TWEAKCN_THEMES } from "../themes";
import { TWEAKCN_THEMES as IMPORTED } from "../themes/tweakcn.generated";
import { TWEAKCN_OVERRIDES, withOverride } from "../themes/tweakcn-overrides";

describe("tweakcn accessibility overrides", () => {
  it("applies every corrected token to the exported preset", () => {
    for (const [id, override] of Object.entries(TWEAKCN_OVERRIDES)) {
      const exported = TWEAKCN_THEMES.find(t => t.id === id);
      expect(exported, `no exported preset "${id}"`).toBeDefined();
      for (const mode of ["light", "dark"] as const) {
        for (const [token, value] of Object.entries(override[mode] ?? {})) {
          expect(exported?.[mode][token], `${id}/${mode}/${token}`).toBe(value);
        }
      }
    }
  });

  it("leaves the imported file untouched, so a re-import composes", () => {
    // The corrections must NOT have been written into the generated file: if
    // they had, this passes for the wrong reason and the next importer run
    // silently reverts the fix.
    for (const [id, override] of Object.entries(TWEAKCN_OVERRIDES)) {
      const raw = IMPORTED.find(t => t.id === id);
      expect(raw, `no imported preset "${id}"`).toBeDefined();
      for (const mode of ["light", "dark"] as const) {
        for (const [token, value] of Object.entries(override[mode] ?? {})) {
          expect(raw?.[mode][token], `${id}/${mode}/${token}`).not.toBe(value);
        }
      }
    }
  });

  it("changes only lightness, never hue or chroma", () => {
    // A correction makes a preset legible; it must not make it a different
    // theme. Hue and chroma carry the identity, so both are held fixed.
    const parse = (v: string) =>
      /^oklch\(\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)/.exec(v);
    for (const [id, override] of Object.entries(TWEAKCN_OVERRIDES)) {
      const raw = IMPORTED.find(t => t.id === id);
      for (const mode of ["light", "dark"] as const) {
        for (const [token, value] of Object.entries(override[mode] ?? {})) {
          const before = parse(raw?.[mode][token] ?? "");
          const after = parse(value);
          if (!before || !after) continue;
          expect(after[2], `${id}/${mode}/${token} chroma`).toBe(before[2]);
          expect(after[3], `${id}/${mode}/${token} hue`).toBe(before[3]);
        }
      }
    }
  });

  it("returns the same object for a preset it does not correct", () => {
    const untouched = IMPORTED.find(t => !TWEAKCN_OVERRIDES[t.id]);
    expect(untouched).toBeDefined();
    if (untouched) expect(withOverride(untouched)).toBe(untouched);
  });
});
