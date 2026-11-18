/**
 * Custom CSS, judged on the server on every write that adds or changes it,
 * the page's own and each block's: who may change it (never a key, only
 * someone with the site settings permission, or trusted code), and what the
 * one checker refuses, line by line.
 *
 * The properties a plausible implementation gets wrong: a block's CSS judged
 * by its block's id, which refuses a duplicate (a new id) or lets a changed
 * text through on the same id; a draft save compared with either stored
 * form, which lets the published CSS back over the draft's unasked; a placed
 * saved section's CSS refused, or let through when the section it names
 * holds other CSS; and a stored value that can't be read waving CSS through.
 */
import type {
  PluginFieldWrite,
  PluginFieldWriteCaller,
} from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import type { JudgedField, StoredForms } from "./added-undefined-ids";
import { CUSTOM_CSS_REFUSED, customCssIssues } from "./custom-css-judgement";

const PAGE_CSS = "h1 { color: rebeccapurple; }";
const BLOCK_CSS = "selector { border: 4px solid blue; }";
const OTHER_CSS = "selector { border: 4px solid red; }";

/** A block, with CSS where given, placed from a saved section where named. */
function block(
  id: string,
  css?: string,
  section?: string
): Record<string, unknown> {
  return {
    id,
    type: "core/text",
    version: 1,
    props: { text: id },
    ...(css === undefined ? {} : { customCss: css }),
    ...(section === undefined
      ? {}
      : { origin: { from: "pattern", id: section, digest: "d" } }),
  };
}

/** A page with these blocks, and its own CSS where given. */
function pageWith(
  nodes: Record<string, unknown>[],
  css?: string
): Record<string, unknown> {
  return {
    formatVersion: 1,
    kind: "page",
    nodes,
    ...(css === undefined ? {} : { settings: { customCss: css } }),
  };
}

/** A caller of `kind`, who may or may not change the site's settings. */
function caller(
  kind: PluginFieldWriteCaller["kind"],
  may: boolean
): PluginFieldWriteCaller & { asked: string[] } {
  const asked: string[] = [];
  return {
    kind,
    asked,
    can: (action, resource) => {
      asked.push(`${action}-${resource}`);
      return Promise.resolve(may);
    },
  };
}

/** The saved sections, or the components, the site keeps, by id. */
type Sections = Record<string, Record<string, unknown>>;

/**
 * The field's write, made as `who`, with these saved sections and component
 * definitions stored.
 */
function writeAs(
  who: PluginFieldWriteCaller | undefined,
  sections: Sections = {},
  components: Sections = {}
): JudgedField & { readsOfSections: string[][] } {
  const readsOfSections: string[][] = [];
  const write: PluginFieldWrite = {
    kind: "collection",
    slug: "pages",
    id: "p1",
    inTransaction: false,
    readStored: () => Promise.reject(new Error("not read here")),
    readStoredOf: target => {
      expect(["patterns", "components"]).toContain(target.collection);
      expect(target.field).toBe(
        target.collection === "patterns" ? "content" : "definition"
      );
      const held = target.collection === "patterns" ? sections : components;
      readsOfSections.push([...target.ids]);
      return Promise.resolve(
        new Map(
          target.ids.flatMap(id =>
            held[id] === undefined
              ? []
              : [[id, { kind: "value" as const, value: held[id] }]]
          )
        )
      );
    },
    ...(who === undefined ? {} : { caller: who }),
  };
  return { path: "content", write, readsOfSections };
}

/** The stored forms the write changes: these documents. */
function stored(...forms: Record<string, unknown>[]) {
  return (): Promise<StoredForms> =>
    Promise.resolve({ forms: forms as never, readable: true });
}

const LIBRARY = {
  patterns: { collection: "patterns", field: "content" },
  components: { collection: "components", field: "definition" },
};

const issuesOf = (
  value: unknown,
  who: PluginFieldWriteCaller | undefined,
  forms = stored(pageWith([block("a")])),
  sections: Sections = {},
  components: Sections = {}
) =>
  customCssIssues(
    value,
    writeAs(who, sections, components),
    "Content",
    forms,
    LIBRARY
  ).then(found => {
    for (const issue of found) expect(issue.code).toBe(CUSTOM_CSS_REFUSED);
    return found.map(issue => issue.message);
  });

const editor = () => caller("user", false);

describe("custom CSS, judged on every write that adds or changes it", () => {
  it("lets someone who may change the site's settings add page and block CSS, asking that permission", async () => {
    const manager = caller("user", true);
    expect(
      await issuesOf(pageWith([block("a", BLOCK_CSS)], PAGE_CSS), manager)
    ).toEqual([]);
    expect(manager.asked).toEqual(["manage-page-builder-site"]);
    // Trusted code, which the write's own access lets through.
    expect(
      await issuesOf(pageWith([], PAGE_CSS), caller("system", true))
    ).toEqual([]);
  });

  it("refuses anyone else, an API key whatever its scope, and a write that says nobody", async () => {
    const refusal =
      "Content: Only people who can change site settings can change custom CSS.";
    expect(await issuesOf(pageWith([], PAGE_CSS), editor())).toEqual([refusal]);
    expect(await issuesOf(pageWith([block("a", BLOCK_CSS)]), editor())).toEqual(
      [refusal]
    );
    expect(
      await issuesOf(pageWith([], PAGE_CSS), caller("apiKey", true))
    ).toEqual([
      "Content: An API key can't change custom CSS. Sign in as someone who can change the site's settings.",
    ]);
    expect((await issuesOf(pageWith([], PAGE_CSS), undefined))[0]).toMatch(
      /doesn't say who is making it/
    );
    // Removing the page's CSS is a change to it too.
    expect(
      await issuesOf(pageWith([]), editor(), stored(pageWith([], PAGE_CSS)))
    ).toEqual([refusal]);
  });

  it("refuses an editor changing a block's CSS text, on the same block", async () => {
    const before = stored(pageWith([block("a", BLOCK_CSS)]));
    expect(
      await issuesOf(pageWith([block("a", OTHER_CSS)]), editor(), before)
    ).toHaveLength(1);
  });

  it("lets an editor duplicate, move and delete blocks that have CSS, and save other changes", async () => {
    const before = stored(
      pageWith([block("a", BLOCK_CSS), block("b")], PAGE_CSS)
    );
    const asEditor = (after: Record<string, unknown>) =>
      issuesOf(after, editor(), before);
    // Duplicated: a new block holding the same CSS.
    expect(
      await asEditor(
        pageWith(
          [block("a", BLOCK_CSS), block("a2", BLOCK_CSS), block("b")],
          PAGE_CSS
        )
      )
    ).toEqual([]);
    // Moved: inside another block's slot.
    expect(
      await asEditor(
        pageWith(
          [{ ...block("b"), slots: { default: [block("a", BLOCK_CSS)] } }],
          PAGE_CSS
        )
      )
    ).toEqual([]);
    // Deleted.
    expect(await asEditor(pageWith([block("b")], PAGE_CSS))).toEqual([]);
  });

  it("compares a draft-only save with the draft alone, and a publish with both forms", async () => {
    // The published page holds PAGE_CSS; the draft has none. A draft save
    // putting it back is a change to the draft's CSS.
    expect(
      await issuesOf(pageWith([], PAGE_CSS), editor(), stored(pageWith([])))
    ).toHaveLength(1);
    // A publish, read against both forms, asks nothing.
    expect(
      await issuesOf(
        pageWith([], PAGE_CSS),
        editor(),
        stored(pageWith([]), pageWith([], PAGE_CSS))
      )
    ).toEqual([]);
  });

  it("lets an editor place a saved section whose blocks carry CSS, and refuses changing it after", async () => {
    const sections = { s1: pageWith([block("x", BLOCK_CSS)]) };
    // Placed: the section's root carries where it came from, and its CSS
    // sits on a block inside it.
    const placed = pageWith([
      block("a"),
      {
        ...block("root", undefined, "s1"),
        slots: { default: [block("x1", BLOCK_CSS)] },
      },
    ]);
    expect(await issuesOf(placed, editor(), undefined, sections)).toEqual([]);
    // CONTROL: the same CSS naming a section that doesn't hold it.
    expect(
      await issuesOf(
        pageWith([block("a"), block("x1", BLOCK_CSS, "s2")]),
        editor(),
        undefined,
        { s2: pageWith([block("y", OTHER_CSS)]) }
      )
    ).toHaveLength(1);
    // Then changing the placed CSS is the editor's own change.
    expect(
      await issuesOf(
        pageWith([block("a"), block("x1", OTHER_CSS, "s1")]),
        editor(),
        stored(placed),
        sections
      )
    ).toHaveLength(1);
  });

  it("lets an editor detach a component the page placed, keeping the CSS its definition holds", async () => {
    // The stored page places component k1, whose definition carries CSS.
    const placement = {
      id: "c1",
      type: "nextly/component-instance",
      version: 1,
      props: { componentId: "k1" },
    };
    const before = stored(pageWith([block("a"), placement]));
    const components = {
      k1: { ...pageWith([block("k-root", BLOCK_CSS)]), kind: "component" },
    };
    // Detached: the placement replaced by the blocks it drew, CSS and all.
    const detached = pageWith([block("a"), block("x1", BLOCK_CSS)]);
    expect(await issuesOf(detached, editor(), before, {}, components)).toEqual(
      []
    );
    // CONTROL: CSS that the placed component's definition doesn't hold is
    // the editor's own.
    expect(
      await issuesOf(
        pageWith([block("a"), block("x1", OTHER_CSS)]),
        editor(),
        before,
        {},
        components
      )
    ).toHaveLength(1);
    // CONTROL: a component the stored page never placed vouches for nothing.
    expect(
      await issuesOf(
        detached,
        editor(),
        stored(pageWith([block("a")])),
        {},
        components
      )
    ).toHaveLength(1);
  });

  it("judges every CSS a write holds where the stored value can't be read, and none where it holds none", async () => {
    const unreadable = (): Promise<StoredForms> =>
      Promise.resolve({ forms: [], readable: false });
    expect(
      await issuesOf(pageWith([block("a", BLOCK_CSS)]), editor(), unreadable)
    ).toHaveLength(1);
    expect(
      await issuesOf(pageWith([block("a")]), editor(), unreadable)
    ).toEqual([]);
  });

  it("reads nothing stored for a field below the top level whose write holds no CSS", async () => {
    // A group kept per language can't be read at all: a write there with no
    // CSS asks nothing, so it saves as it did before CSS was judged.
    const unreadable = (): Promise<StoredForms> =>
      Promise.reject(new Error("cannot be read here"));
    for (const path of ["hero.body", "rows[0].body"]) {
      expect(
        await customCssIssues(
          pageWith([block("a")]),
          { ...writeAs(editor()), path },
          "Content",
          unreadable,
          LIBRARY
        )
      ).toEqual([]);
    }
  });

  it("names each line the checker refuses, at the page's level and at a block's", async () => {
    const manager = caller("user", true);
    expect(
      await issuesOf(
        pageWith(
          [block("a", "h2 { color: red; }")],
          "p { color: red; }\n@import url(https://example.com/x.css);"
        ),
        manager
      )
    ).toEqual([
      "Content (page CSS): Line 2: @import isn't allowed.",
      expect.stringMatching(/^Content \(block CSS\): Line 1: /),
    ]);
    // A pasted style tag, and a url() to another site.
    const pasted = await issuesOf(
      pageWith([], "<style>p { color: red; }</style>"),
      manager
    );
    expect(pasted[0]).toBe(
      "Content (page CSS): Line 1: Paste the CSS without the <style> tags."
    );
    expect(
      await issuesOf(
        pageWith(
          [],
          "body {\n  background: url(https://example.com/a.png);\n}"
        ),
        manager
      )
    ).toEqual([
      'Content (page CSS): Line 2: Only pictures and fonts from this site can be used: "https://example.com/a.png" isn\'t a path on this site.',
    ]);
  });
});
