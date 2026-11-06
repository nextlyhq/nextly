import type { NamedClass, NodeStyles } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { rebasedOnCode } from "./class-override-rebase";

const entry = (
  values: Record<string, unknown>,
  label = "Code"
): NamedClass => ({
  id: "c-code",
  slug: "code",
  label,
  orderIndex: 0,
  styles: { base: { base: values } } as unknown as NodeStyles,
});

describe("a stored override moved onto the code as it now is", () => {
  it("keeps the site's own values and follows the code for the rest", () => {
    const was = entry({ color: "#111111", padding: "4px" });
    const now = entry({ color: "#111111", padding: "8px", opacity: 0.5 });
    // The site changed the colour; the padding is the code's old value.
    const stored = entry({ color: "#222222", padding: "4px" });
    expect(rebasedOnCode(stored, was, now)).toEqual(
      entry({ color: "#222222", padding: "8px", opacity: 0.5 })
    );
  });

  it("keeps a property the site cleared cleared", () => {
    const was = entry({ color: "#111111", padding: "4px" });
    const stored = entry({ color: "#111111" });
    expect(
      rebasedOnCode(stored, was, entry({ color: "#333333", padding: "8px" }))
    ).toEqual(entry({ color: "#333333" }));
  });

  it("follows the code's new label unless the site renamed it", () => {
    const was = entry({ color: "#111111" });
    const now = entry({ color: "#111111" }, "Code v2");
    expect(rebasedOnCode(entry({ color: "#222222" }), was, now)?.label).toBe(
      "Code v2"
    );
    expect(
      rebasedOnCode(entry({ color: "#222222" }, "Mine"), was, now)?.label
    ).toBe("Mine");
  });

  it("is gone once the code dropped the style and nothing of the site's is left", () => {
    const was = entry({ color: "#111111" });
    expect(rebasedOnCode(entry({ color: "#111111" }), was, undefined)).toBe(
      undefined
    );
    // The site's own value outlives the code's style.
    expect(
      rebasedOnCode(entry({ color: "#222222" }), was, undefined)?.styles
    ).toEqual({ base: { base: { color: "#222222" } } });
  });

  it("decides each side of a composite value on its own", () => {
    // The site changed the top padding; the code then changed the bottom.
    const was = entry({ padding: { blockStart: "4px", blockEnd: "4px" } });
    const now = entry({ padding: { blockStart: "4px", blockEnd: "12px" } });
    const stored = entry({ padding: { blockStart: "20px", blockEnd: "4px" } });
    expect(rebasedOnCode(stored, was, now)).toEqual(
      entry({ padding: { blockStart: "20px", blockEnd: "12px" } })
    );
  });

  it("keeps a removed code style the site renamed or locked", () => {
    const was = entry({ color: "#111111" });
    // Only the label, or only the lock, is the site's own.
    expect(
      rebasedOnCode(entry({ color: "#111111" }, "CODE"), was, undefined)?.label
    ).toBe("CODE");
    expect(
      rebasedOnCode(
        { ...entry({ color: "#111111" }), locked: true },
        was,
        undefined
      )?.locked
    ).toBe(true);
  });

  it("follows the code's lock unless the site changed the lock itself", () => {
    const was = entry({ color: "#111111" });
    const now = { ...entry({ color: "#111111" }), locked: true as const };
    // The site changed only the colour: the code's new lock holds.
    expect(rebasedOnCode(entry({ color: "#222222" }), was, now)?.locked).toBe(
      true
    );
    // The code unlocks a style the site had not locked: no lock is kept.
    expect(
      rebasedOnCode(
        { ...entry({ color: "#222222" }), locked: true },
        { ...was, locked: true },
        entry({ color: "#111111" })
      )?.locked
    ).toBe(undefined);
  });

  it("leaves a style the code never supplied as it is", () => {
    const stored = entry({ color: "#222222" });
    expect(rebasedOnCode(stored, undefined, undefined)).toBe(stored);
  });
});
