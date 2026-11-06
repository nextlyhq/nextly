/**
 * A page update that brings a style or a per-device hide under a breakpoint
 * the site does not define is refused, and the author is told to reload; a
 * breakpoint the stored page already held still saves. The compiler leaves
 * such values unwritten, so this is the editor opened before a removal,
 * saving work that would never reach the page.
 */
import { DEFAULT_LIMITS, MAX_SCANNED_KEYS } from "@nextlyhq/blocks-engine";
import type { PluginFieldWrite } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import type { CompositionSetup } from "./blocks-composition";
import { blocksFieldType } from "./blocksField";

/** A text block, with what it stores under each breakpoint. */
function text(
  id: string,
  extra: { styles?: unknown; visibility?: unknown; slots?: unknown } = {}
) {
  return { id, type: "core/text", version: 1, props: {}, ...extra };
}

/** A page of `nodes`, with page styles when given. */
function page(nodes: unknown[], settingsStyles?: unknown) {
  return {
    formatVersion: 1,
    kind: "page",
    nodes,
    ...(settingsStyles === undefined
      ? {}
      : { settings: { styles: settingsStyles } }),
  };
}

/** A colour stored at `breakpoint` in the default state. */
const colourAt = (breakpoint: string) => ({
  styles: { base: { [breakpoint]: { color: "#1155cc" } } },
});

/** An entry write whose stored forms hold `published` and `draft`. */
function write(stored: { published?: unknown; draft?: unknown }) {
  const readStored = vi.fn(async (target: { form: string }) => {
    const value = target.form === "published" ? stored.published : stored.draft;
    return value === undefined
      ? { kind: "absent" as const }
      : { kind: "value" as const, value };
  });
  return {
    readStored,
    write: {
      kind: "collection",
      slug: "pages",
      id: "p1",
      inTransaction: false,
      readStored,
    } as unknown as PluginFieldWrite,
  };
}

/** The site's breakpoints: the base and Tablet. Mobile was removed. */
const SITE_BREAKPOINTS = new Set(["base", "tablet"]);

function setup() {
  const siteDefinitions = vi.fn(async () => ({
    classIds: new Set(["c-card"]),
    breakpointIds: SITE_BREAKPOINTS,
  }));
  const composition: CompositionSetup = {
    store: { collection: "components", field: "definition" },
    limits: DEFAULT_LIMITS,
    composesDocuments: false,
    siteDefinitions,
  };
  return {
    siteDefinitions,
    field: blocksFieldType(undefined, () => composition),
  };
}

async function validate(
  value: unknown,
  how: { mode: "create" | "update"; write?: PluginFieldWrite },
  field = setup().field
) {
  return field.validate?.(value, {
    path: "content",
    field: { name: "content", type: "blocks", label: "Content" },
    data: {},
    mode: how.mode,
    ...(how.write === undefined ? {} : { write: how.write }),
  } as never);
}

const codes = (result: unknown) =>
  Array.isArray(result)
    ? result.map((issue: { code: string }) => issue.code)
    : result;

const MOBILE_GONE =
  "Content: That breakpoint was removed from the site. Reload to keep editing.";

describe("a page update's styles and hides under the site's breakpoints", () => {
  it("refuses a style brought under a breakpoint the site does not define", async () => {
    const { write: stored } = write({ published: page([text("a")]) });
    const result = await validate(page([text("a", colourAt("mobile"))]), {
      mode: "update",
      write: stored,
    });
    expect(result).toEqual([
      { path: "content", code: "removed-breakpoint", message: MOBILE_GONE },
    ]);
  });

  it("refuses a hide brought under one, in any state of the cascade", async () => {
    const { write: stored } = write({ published: page([text("a")]) });
    expect(
      codes(
        await validate(
          page([text("a", { visibility: { devices: { mobile: false } } })]),
          { mode: "update", write: stored }
        )
      )
    ).toEqual(["removed-breakpoint"]);
    // A hover style is under a breakpoint as much as a default one.
    expect(
      codes(
        await validate(
          page([
            text("a", {
              styles: { hover: { mobile: { color: "#1155cc" } } },
            }),
          ]),
          { mode: "update", write: stored }
        )
      )
    ).toEqual(["removed-breakpoint"]);
  });

  it("refuses one in the page's own styles, and inside a slot", async () => {
    const { write: stored } = write({ published: page([text("a")]) });
    expect(
      codes(
        await validate(
          page([text("a")], { base: { mobile: { color: "#1155cc" } } }),
          { mode: "update", write: stored }
        )
      )
    ).toEqual(["removed-breakpoint"]);
    const section = {
      id: "s",
      type: "core/section",
      version: 1,
      props: {},
      slots: { children: [text("inner", colourAt("mobile"))] },
    };
    expect(
      codes(await validate(page([section]), { mode: "update", write: stored }))
    ).toEqual(["removed-breakpoint"]);
  });

  it("leaves a state the compiler does not write to its own rule", async () => {
    // Nothing under an unknown state is written at any breakpoint, so the
    // author is told about the state, not about the breakpoint it names.
    const { write: stored } = write({ published: page([text("a")]) });
    expect(
      codes(
        await validate(
          page([
            text("a", {
              styles: { pressed: { mobile: { color: "#1155cc" } } },
            }),
          ]),
          { mode: "update", write: stored }
        )
      )
    ).toEqual(["invalid-style-state"]);
  });

  it("keeps saving a breakpoint the stored page already held", async () => {
    /*
     * Removed from the site with the page still styled there: what the page
     * holds is its own to keep, and refusing it would make the page unsavable
     * for a change nobody made. A copy of that style onto another block is the
     * same breakpoint, and saves too.
     */
    const { write: stored } = write({
      published: page([text("a", colourAt("mobile"))]),
    });
    expect(
      await validate(
        page([text("a", colourAt("mobile")), text("b", colourAt("mobile"))]),
        { mode: "update", write: stored }
      )
    ).toBe(true);
  });

  it("counts a breakpoint held only by the draft as stored", async () => {
    const { write: stored } = write({
      published: page([text("a")]),
      draft: page([text("a", { visibility: { devices: { mobile: false } } })]),
    });
    expect(
      await validate(page([text("a", colourAt("mobile"))]), {
        mode: "update",
        write: stored,
      })
    ).toBe(true);
  });

  it("passes the site's own breakpoints, reading no more of the stored page", async () => {
    /*
     * Other judgements read the stored page on an update; a page styled only
     * at breakpoints the site defines adds no read of its own to theirs.
     */
    const unstyled = write({ published: page([]) });
    expect(
      await validate(page([text("a")]), {
        mode: "update",
        write: unstyled.write,
      })
    ).toBe(true);
    const styled = write({ published: page([]) });
    expect(
      await validate(page([text("a", colourAt("tablet"))]), {
        mode: "update",
        write: styled.write,
      })
    ).toBe(true);
    expect(styled.readStored.mock.calls.length).toBe(
      unstyled.readStored.mock.calls.length
    );
  });

  it("asks nothing about a page styled at the base alone", async () => {
    const { field, siteDefinitions } = setup();
    const { write: stored } = write({ published: page([]) });
    expect(
      await validate(
        page([text("a", colourAt("base"))]),
        { mode: "update", write: stored },
        field
      )
    ).toBe(true);
    expect(siteDefinitions).not.toHaveBeenCalled();
  });

  it("does not judge a write inside a transaction, nor read the site's breakpoints for it", async () => {
    /*
     * The site's breakpoints are read on another connection than the
     * transaction's, which it could wait behind; an editor's save is never
     * made in one.
     */
    const { field, siteDefinitions } = setup();
    const { write: stored } = write({ published: page([text("a")]) });
    expect(
      await validate(
        page([text("a", colourAt("mobile"))]),
        {
          mode: "update",
          write: { ...stored, inTransaction: true } as PluginFieldWrite,
        },
        field
      )
    ).toBe(true);
    expect(siteDefinitions).not.toHaveBeenCalled();
  });

  it("does not judge a create, which has no stored page to compare with", async () => {
    // A copy of a page still styled at a removed breakpoint is created whole.
    const { write: created } = write({});
    expect(
      await validate(page([text("a", colourAt("mobile"))]), {
        mode: "create",
        write: created,
      })
    ).toBe(true);
  });

  it("reports a removed breakpoint and an undefined shared style together, from one read", async () => {
    // Both judged on the one write, so one round fixes both, and against one
    // read of the site's style, so both see the same version of it.
    const { field, siteDefinitions } = setup();
    const { write: stored } = write({ published: page([text("a")]) });
    const result = await validate(
      page([{ ...text("a", colourAt("mobile")), classes: ["c-gone"] }]),
      { mode: "update", write: stored },
      field
    );
    expect(codes(result)).toEqual(["unknown-class", "removed-breakpoint"]);
    expect(siteDefinitions).toHaveBeenCalledTimes(1);
  });

  it("judges both against one read of the page as stored", async () => {
    /*
     * A page bringing an undefined shared style reads the stored forms once
     * for it; bringing a removed breakpoint as well reads them no more, so
     * both are judged against the same snapshot of the page.
     */
    const classOnly = write({ published: page([text("a")]) });
    await validate(page([{ ...text("a"), classes: ["c-gone"] }]), {
      mode: "update",
      write: classOnly.write,
    });
    const both = write({ published: page([text("a")]) });
    await validate(
      page([{ ...text("a", colourAt("mobile")), classes: ["c-gone"] }]),
      { mode: "update", write: both.write }
    );
    expect(both.readStored.mock.calls.length).toBe(
      classOnly.readStored.mock.calls.length
    );
  });

  it("takes an empty entry for no use of the breakpoint", async () => {
    // The compiler emits nothing for it, so nothing would be lost.
    const { write: stored } = write({ published: page([text("a")]) });
    expect(
      await validate(page([text("a", { styles: { base: { mobile: {} } } })]), {
        mode: "update",
        write: stored,
      })
    ).toBe(true);
  });

  it("leaves a per-device setting that is not one to its own rule", async () => {
    const { write: stored } = write({ published: page([text("a")]) });
    expect(
      codes(
        await validate(
          page([text("a", { visibility: { devices: { mobile: "hidden" } } })]),
          { mode: "update", write: stored }
        )
      )
    ).toEqual(["invalid-visibility"]);
  });

  it("reads every per-device setting, as the engine does", async () => {
    // Visibility is read whole by validation and by the compiler, so a hide
    // past the style maps' bound is still one the save brings.
    const devices: Record<string, unknown> = {};
    for (let i = 0; i < MAX_SCANNED_KEYS; i += 1) devices[`old-${i}`] = true;
    devices.mobile = false;
    const held: Record<string, unknown> = {};
    for (let i = 0; i < MAX_SCANNED_KEYS; i += 1) held[`old-${i}`] = true;
    const { write: stored } = write({
      published: page([text("a", { visibility: { devices: held } })]),
    });
    expect(
      codes(
        await validate(page([text("a", { visibility: { devices } })]), {
          mode: "update",
          write: stored,
        })
      )
    ).toContain("removed-breakpoint");
  });

  it("reads a style map no wider than the engine reads one", async () => {
    // A corrupt map with more keys than the engine's bound: the keys past it
    // are not read, here or by the compiler, so one there is not judged.
    const wide: Record<string, unknown> = {};
    for (let i = 0; i < MAX_SCANNED_KEYS; i += 1) wide[`empty-${i}`] = {};
    wide.mobile = { color: "#1155cc" };
    const { write: stored } = write({ published: page([text("a")]) });
    const result = codes(
      await validate(page([text("a", { styles: { base: wide } })]), {
        mode: "update",
        write: stored,
      })
    );
    // The rules refuse the map for its width; this check adds nothing.
    expect(result).not.toContain("removed-breakpoint");
    expect(result).toContain("style-issues-truncated");
  });
});
