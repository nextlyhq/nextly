/**
 * The blocks field judges a write's page code itself, whatever else it was
 * set up with:
 * - against the stored forms the write changes: a draft-only save against
 *   the draft, so it can't swap the draft's code for the published code
 *   unasked; a publish against both, so promoting an approved draft asks
 *   nothing;
 * - with no write behind the value, code is refused, as a write that says
 *   nobody is;
 * - before the plugin's setup is installed (a dev server's config reload
 *   builds the field again), a change to the code is refused rather than
 *   let through unjudged;
 * - only a page holds code of its own: a template's or a pattern's is
 *   refused.
 */
import { createBlockRegistry, DEFAULT_LIMITS } from "@nextlyhq/blocks-engine";
import type {
  PluginFieldWrite,
  PluginFieldWriteCaller,
} from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import type { CompositionSetup } from "./blocks-composition";
import { blocksFieldType } from "./blocksField";
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
  pageCode: { options: undefined, siteOrigin: () => "https://site.test" },
};

async function validate(
  value: unknown,
  how: {
    write?: PluginFieldWrite;
    status?: string;
    setup?: CompositionSetup | undefined;
  }
) {
  const field = blocksFieldType(
    undefined,
    () => ("setup" in how ? how.setup : composition),
    blocks
  );
  return field.validate?.(value, {
    path: "content",
    field: { name: "content", type: "blocks" },
    data: how.status === undefined ? {} : { status: how.status },
    mode: "update",
    ...(how.write === undefined ? {} : { write: how.write }),
  } as never);
}

const refused = (result: unknown): boolean =>
  Array.isArray(result) &&
  result.some((issue: { code?: string }) => issue.code === PAGE_CODE_REFUSED);

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

  it("refuses a change to the code before the plugin's setup is installed", async () => {
    const stored = { published: doc(), draft: doc() };
    expect(
      refused(
        await validate(doc(DRAFT), {
          write: write(caller(true), stored),
          setup: undefined,
        })
      )
    ).toBe(true);
    // CONTROL: a write that leaves the code alone still saves.
    expect(
      refused(
        await validate(doc(), {
          write: write(caller(true), stored),
          setup: undefined,
        })
      )
    ).toBe(false);
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
