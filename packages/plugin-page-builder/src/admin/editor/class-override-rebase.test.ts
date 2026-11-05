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

  it("leaves a style the code never supplied as it is", () => {
    const stored = entry({ color: "#222222" });
    expect(rebasedOnCode(stored, undefined, undefined)).toBe(stored);
  });
});
