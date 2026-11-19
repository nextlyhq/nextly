/**
 * A create that copies a stored entry (`write.copiedFrom`) keeps the custom
 * CSS and page code that entry holds without asking the site settings
 * permission: copying it places text someone allowed already wrote.
 *
 * The properties a plausible implementation gets wrong: reading a form of
 * the source the caller's read could not see (a draft-only text vouching for
 * someone never shown the draft); vouching from a field the caller's read
 * did not return; matching across kinds (the page's CSS text accepted on a
 * block); and letting a changed text through because the source holds some
 * other CSS.
 */
import type {
  PluginFieldWrite,
  PluginFieldWriteCaller,
} from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import type { JudgedField, StoredForms } from "./added-undefined-ids";
import { customCssIssues } from "./custom-css-judgement";
import { pageCodeIssues } from "./page-code-judgement";

const PAGE_CSS = "h1 { color: rebeccapurple; }";
const BLOCK_CSS = "selector { border: 4px solid blue; }";
const DRAFT_CSS = "selector { border: 4px dashed green; }";
const OTHER_CSS = "selector { border: 4px solid red; }";
const CODE = { head: "<script>window.copied = 1</script>", body: "" };

/** A page with one block of `blockCss`, and the page's own settings. */
function pageWith(
  blockCss: string | undefined,
  settings: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "a",
        type: "core/text",
        version: 1,
        props: { text: "a" },
        ...(blockCss === undefined ? {} : { customCss: blockCss }),
      },
    ],
    ...(Object.keys(settings).length === 0 ? {} : { settings }),
  };
}

/** The source as stored: live, and its pending draft. */
const LIVE = pageWith(BLOCK_CSS, { customCss: PAGE_CSS, code: CODE });
const DRAFT = pageWith(DRAFT_CSS, { customCss: PAGE_CSS, code: CODE });

/** Someone without the site settings permission, or a key. */
function caller(kind: PluginFieldWriteCaller["kind"]): PluginFieldWriteCaller {
  return { kind, can: () => Promise.resolve(false) };
}

type Copy = NonNullable<PluginFieldWrite["copiedFrom"]>;

/** A create of `content` that copies the source, and what it read of it. */
function copying(
  copy: Copy | undefined,
  kind: PluginFieldWriteCaller["kind"] = "user"
): JudgedField & { asked: string[] } {
  const asked: string[] = [];
  const write: PluginFieldWrite = {
    kind: "collection",
    slug: "pages",
    inTransaction: false,
    readStored: () => Promise.reject(new Error("not read here")),
    readStoredOf: target => {
      asked.push(`${target.collection}/${target.field}/${target.form}`);
      const value = target.form === "draft" ? DRAFT : LIVE;
      return Promise.resolve(
        new Map(target.ids.map(id => [id, { kind: "value" as const, value }]))
      );
    },
    caller: caller(kind),
    ...(copy === undefined ? {} : { copiedFrom: copy }),
  };
  return { path: "content", write, asked };
}

const COPY: Copy = {
  collection: "pages",
  id: "src",
  forms: ["published"],
  fields: ["title", "content"],
};

/** A create stores nothing yet. */
const NOTHING_STORED = (): Promise<StoredForms> =>
  Promise.resolve({ forms: [], readable: true });

const cssOf = (value: unknown, args: JudgedField) =>
  customCssIssues(value, args, "Content", NOTHING_STORED);

describe("CSS and page code a create copies", () => {
  it("keeps what the source holds, and refuses what it doesn't", async () => {
    expect(await cssOf(LIVE, copying(COPY))).toEqual([]);
    expect(
      await cssOf(pageWith(OTHER_CSS, { customCss: PAGE_CSS }), copying(COPY))
    ).toHaveLength(1);
    expect(
      await cssOf(pageWith(BLOCK_CSS, { customCss: OTHER_CSS }), copying(COPY))
    ).toHaveLength(1);
    // CONTROL: the same create copying nothing is refused.
    expect(await cssOf(LIVE, copying(undefined))).not.toEqual([]);
  });

  it("matches each text against its own kind", async () => {
    // The page's CSS text, put on a block.
    const moved = pageWith(PAGE_CSS, { customCss: PAGE_CSS });
    expect(await cssOf(moved, copying(COPY))).toHaveLength(1);
    // A block's CSS text, made the page's.
    const raised = pageWith(BLOCK_CSS, { customCss: BLOCK_CSS });
    expect(await cssOf(raised, copying(COPY))).toHaveLength(1);
  });

  it("reads only the forms the caller's read could see", async () => {
    const live = copying(COPY);
    expect(await cssOf(DRAFT, live)).toHaveLength(1);
    expect(live.asked).toEqual(["pages/content/published"]);
    const shown = copying({ ...COPY, forms: ["published", "draft"] });
    expect(await cssOf(DRAFT, shown)).toEqual([]);
  });

  it("reads nothing from a field the caller's read didn't return", async () => {
    const hidden = copying({ ...COPY, fields: ["title"] });
    expect(await cssOf(LIVE, hidden)).not.toEqual([]);
    expect(hidden.asked).toEqual([]);
    // A field the create names, where the read returned it.
    const named = copying({ ...COPY, fields: ["body"], field: "body" });
    expect(await cssOf(LIVE, named)).toEqual([]);
    expect(named.asked).toEqual(["pages/body/published"]);
  });

  it("lets an API key copy byte for byte, and refuses its change", async () => {
    expect(await cssOf(LIVE, copying(COPY, "apiKey"))).toEqual([]);
    const changed = await cssOf(
      pageWith(OTHER_CSS, { customCss: PAGE_CSS }),
      copying(COPY, "apiKey")
    );
    expect(changed[0]?.message).toContain(
      "An API key can't change custom CSS."
    );
  });

  it("keeps page code the source holds, and refuses other code", async () => {
    const code = (value: unknown, args: JudgedField) =>
      pageCodeIssues(value, args, "Content", undefined, NOTHING_STORED);
    expect(await code(LIVE, copying(COPY))).toEqual([]);
    const other = pageWith(BLOCK_CSS, {
      code: { head: "<script>window.other = 1</script>", body: "" },
    });
    expect(await code(other, copying(COPY))).toHaveLength(1);
    // CONTROL: copying nothing, the same code is a change.
    expect(await code(LIVE, copying(undefined))).toHaveLength(1);
  });

  it("reads the source once for both judgements of one value", async () => {
    const args = copying(COPY);
    await cssOf(LIVE, args);
    await pageCodeIssues(LIVE, args, "Content", undefined, NOTHING_STORED);
    expect(args.asked).toEqual(["pages/content/published"]);
  });
});
