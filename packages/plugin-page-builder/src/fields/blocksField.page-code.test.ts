/**
 * The blocks field judges a write's page code itself, whatever else it was
 * set up with:
 * - against the stored forms the write changes: a draft-only save against
 *   the draft, so it can't swap the draft's code for the published code
 *   unasked; a publish against both, so promoting an approved draft asks
 *   nothing;
 * - with no write behind the value, code is refused, as a write that says
 *   nobody is;
 * - after a dev server's config reload, which builds the field again from a
 *   definition whose setup is never installed, the code is still judged, by
 *   the deps the field was built with; built with none, a change to it is
 *   refused rather than let through unjudged;
 * - only a page holds code of its own: a template's or a pattern's is
 *   refused;
 * - custom CSS, the page's and each block's, is judged on the same write,
 *   setup or none.
 */
import { createBlockRegistry, DEFAULT_LIMITS } from "@nextlyhq/blocks-engine";
import type {
  PluginFieldWrite,
  PluginFieldWriteCaller,
} from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import type { CompositionSetup } from "./blocks-composition";
import { blocksFieldType } from "./blocksField";
import { CUSTOM_CSS_REFUSED } from "./custom-css-judgement";
import { PAGE_CODE_REFUSED } from "./page-code-judgement";

const blocks = createBlockRegistry();

const LIVE = { head: "<meta name=live content=1>", body: "" };
const DRAFT = { head: "<meta name=draft content=2>", body: "" };

const doc = (code?: { head: string; body: string }, kind = "page") => ({
  formatVersion: 1,
  kind,
  nodes: [],
  ...(code === undefined ? {} : { settings: { code } }),
});

/** A caller who may, or may not, change the site's settings. */
const caller = (may: boolean): PluginFieldWriteCaller => ({
  kind: "user",
  can: async () => may,
});

/** An entry write made as `who`, whose stored forms are these. */
function write(
  who: PluginFieldWriteCaller,
  stored: { published?: unknown; draft?: unknown }
): PluginFieldWrite {
  return {
    kind: "collection",
    slug: "pages",
    id: "p1",
    inTransaction: false,
    caller: who,
    readStored: async target => {
      const value =
        target.form === "published" ? stored.published : stored.draft;
      return value === undefined
        ? { kind: "absent" }
        : { kind: "value", value };
    },
    readStoredOf: async () => new Map(),
  } as PluginFieldWrite;
}

const composition: CompositionSetup = {
  store: { collection: "components", field: "definition" },
  limits: DEFAULT_LIMITS,
  blocks,
  composesDocuments: false,
};

/** What page code is judged with, handed to the field when it is built. */
const PAGE_CODE_DEPS = {
  options: undefined,
  siteOrigin: () => "https://site.test",
};

async function validate(
  value: unknown,
  how: {
    write?: PluginFieldWrite;
    status?: string;
    setup?: CompositionSetup | undefined;
    /** Built without page code's deps, as the bare field type is. */
    bare?: boolean;
  }
) {
  const field = blocksFieldType(
    undefined,
    () => ("setup" in how ? how.setup : composition),
    blocks,
    how.bare === true ? undefined : PAGE_CODE_DEPS
  );
  return field.validate?.(value, {
    path: "content",
    field: { name: "content", type: "blocks" },
    data: how.status === undefined ? {} : { status: how.status },
    mode: "update",
    ...(how.write === undefined ? {} : { write: how.write }),
  } as never);
}

const refusedAs = (code: string) => (result: unknown) =>
  Array.isArray(result) &&
  result.some((issue: { code?: string }) => issue.code === code);
const refused = refusedAs(PAGE_CODE_REFUSED);
const cssRefused = refusedAs(CUSTOM_CSS_REFUSED);

describe("the blocks field's judgement of a write's page code", () => {
  it("judges a draft-only save against the draft alone, and a publish against both forms", async () => {
    const stored = { published: doc(LIVE), draft: doc(DRAFT) };
    // An editor's draft save putting the published code back over the
    // draft's own: a change to the draft's code, so it is refused.
    expect(
      refused(
        await validate(doc(LIVE), { write: write(caller(false), stored) })
      )
    ).toBe(true);
    // CONTROL: the draft's code kept as it is asks nothing.
    expect(
      refused(
        await validate(doc(DRAFT), { write: write(caller(false), stored) })
      )
    ).toBe(false);
    // Publishing the approved draft's code asks nothing either.
    expect(
      refused(
        await validate(doc(DRAFT), {
          write: write(caller(false), stored),
          status: "published",
        })
      )
    ).toBe(false);
  });

  it("refuses code where no write says who is making it", async () => {
    expect(refused(await validate(doc(DRAFT), {}))).toBe(true);
    // CONTROL: a value with no code is judged by the other rules alone.
    expect(refused(await validate(doc(), {}))).toBe(false);
  });

  it("keeps judging the code after a dev config reload, by the deps it was built with", async () => {
    const stored = { published: doc(), draft: doc() };
    // The setup was never installed on the rebuilt field: a manager's change
    // is still judged, and saves.
    expect(
      refused(
        await validate(doc(DRAFT), {
          write: write(caller(true), stored),
          setup: undefined,
        })
      )
    ).toBe(false);
    // And an editor's is still refused.
    expect(
      refused(
        await validate(doc(DRAFT), {
          write: write(caller(false), stored),
          setup: undefined,
        })
      )
    ).toBe(true);
  });

  it("refuses a change to the code where the field was built without page code's deps", async () => {
    const stored = { published: doc(), draft: doc() };
    expect(
      refused(
        await validate(doc(DRAFT), {
          write: write(caller(true), stored),
          bare: true,
        })
      )
    ).toBe(true);
    // CONTROL: a write that leaves the code alone still saves.
    expect(
      refused(
        await validate(doc(), {
          write: write(caller(true), stored),
          bare: true,
        })
      )
    ).toBe(false);
  });

  it("judges the page's and each block's CSS on the same write, setup or none", async () => {
    const withCss = {
      ...doc(),
      settings: { customCss: "h1 { color: rebeccapurple; }" },
      nodes: [
        {
          id: "t1",
          type: "core/text",
          version: 1,
          props: { text: "Hi" },
          customCss: "selector { color: blue; }",
        },
      ],
    };
    const stored = { published: doc(), draft: doc() };
    for (const setup of [composition, undefined]) {
      expect(
        cssRefused(
          await validate(withCss, {
            write: write(caller(false), stored),
            setup,
          })
        )
      ).toBe(true);
      expect(
        cssRefused(
          await validate(withCss, { write: write(caller(true), stored), setup })
        )
      ).toBe(false);
    }
    // With no write behind it, CSS is refused as from nobody.
    expect(cssRefused(await validate(withCss, {}))).toBe(true);
  });

  it("keeps code only on a page, not on a template or a pattern", async () => {
    for (const kind of ["template", "pattern", "component"]) {
      const stored = { published: doc(undefined, kind) };
      expect(
        refused(
          await validate(doc(DRAFT, kind), {
            write: write(caller(true), stored),
          })
        )
      ).toBe(true);
    }
    // CONTROL: the same write on a page saves.
    expect(
      refused(
        await validate(doc(DRAFT), {
          write: write(caller(true), { published: doc() }),
        })
      )
    ).toBe(false);
  });
});
