// @vitest-environment jsdom
/**
 * The Settings place as the editor offers it: for a design, the collection
 * it draws and the one entry an own design draws; for a page, none; nothing
 * for a Layout or a component; held while who is looking is not known; and a
 * tab's change to the document's metadata applied as one `seo` edit, so the
 * editor's Undo takes it back.
 */
import { renderHook } from "@testing-library/react";
import type { BlockDocument, BuilderOp } from "@nextlyhq/blocks-engine";
import { beforeEach, describe, expect, it, vi } from "vitest";

const who = vi.hoisted(() => ({
  userId: "u1" as string | null,
  drawn: "posts" as string | undefined,
  own: undefined as string | undefined,
}));

/** The admin's answer, one value while the document is the same, as it is. */
const IDENTITY = vi.hoisted(() => ({
  kind: "collection",
  slug: "templates",
  documentId: "t1",
}));

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  useCurrentUserId: () => who.userId,
  useDocumentIdentity: () => IDENTITY,
}));
vi.mock("./template-preview-strip", () => ({
  useTemplateCollection: () => who.drawn,
  useOwnDesignEntry: () => who.own,
}));

const { useSettingsPlace } = await import("./settings-place");

const RULE = { title: [{ $bind: "title" }, " | Acme"] };

function editor(kind: BlockDocument["kind"]) {
  const applied: BuilderOp[] = [];
  const document = {
    formatVersion: 1,
    kind,
    nodes: [],
    settings: { seo: RULE },
  } as unknown as BlockDocument;
  return {
    applied,
    editor: {
      document,
      apply: (op: BuilderOp) => {
        applied.push(op);
        return document;
      },
    },
  };
}

beforeEach(() => {
  who.userId = "u1";
  who.drawn = "posts";
  who.own = undefined;
});

describe("the Settings place", () => {
  it("names a template's own collection and the collection it draws, and hands its metadata", () => {
    const { editor: e } = editor("template");
    const { result } = renderHook(() =>
      useSettingsPlace(e, {} as never, "template")
    );
    expect(result.current?.context).toEqual({
      userId: "u1",
      document: "template",
      collection: "templates",
      entryId: "t1",
      draws: { collection: "posts", entryId: null },
    });
    expect(result.current?.tabProps.seo.value).toEqual(RULE);
  });

  it("names the one entry an entry's own design draws", () => {
    who.own = "p7";
    const { editor: e } = editor("template");
    const { result } = renderHook(() =>
      useSettingsPlace(e, {} as never, "template")
    );
    expect(result.current?.context?.draws).toEqual({
      collection: "posts",
      entryId: "p7",
    });
  });

  it("names nothing drawn for a page, and offers no place for a Layout or a component", () => {
    const page = renderHook(() =>
      useSettingsPlace(editor("page").editor, {} as never, "page")
    );
    expect(page.result.current?.context?.draws).toBeNull();
    for (const kind of ["layout", "component"] as const) {
      const { result } = renderHook(() =>
        useSettingsPlace(editor(kind).editor, {} as never, kind)
      );
      expect(result.current).toBeNull();
    }
  });

  it("is one value across renders that change nothing in it, and a new one for an edit", () => {
    // Page settings is handed the place and drawn again only for a new one,
    // so a render beside it, a block selected, must hand it the same.
    const { editor: e } = editor("page");
    const control = {} as never;
    const { result, rerender } = renderHook(
      ({ ed }: { ed: typeof e }) => useSettingsPlace(ed, control, "page"),
      { initialProps: { ed: e } }
    );
    const first = result.current;
    // The control: there is a place to keep.
    expect(first).not.toBeNull();

    rerender({ ed: e });
    rerender({ ed: e });
    expect(result.current).toBe(first);

    // An edit hands the editor a new document, which the tabs show.
    const edited = {
      ...e,
      document: { ...e.document, settings: { seo: { title: ["Edited"] } } },
    } as typeof e;
    rerender({ ed: edited });
    expect(result.current).not.toBe(first);
    expect(result.current?.tabProps.seo.value).toEqual({ title: ["Edited"] });
  });

  it("holds its context while who is looking is not known", () => {
    who.userId = null;
    const { result } = renderHook(() =>
      useSettingsPlace(editor("template").editor, {} as never, "template")
    );
    expect(result.current?.context).toBeNull();
  });

  it("says whether the editor made a tab's change, and names the field the design is edited in", () => {
    const { editor: e } = editor("template");
    let refuse = false;
    e.apply = () => (refuse ? null : e.document);
    const { result } = renderHook(() =>
      useSettingsPlace(e, {} as never, "template", "content")
    );
    expect(result.current?.tabProps.seo.set({ title: ["New"] })).toBe(true);
    refuse = true;
    expect(
      result.current?.tabProps.seo.set({ title: ["x".repeat(2000)] })
    ).toBe(false);
    expect(result.current?.tabProps.designField).toBe("content");
  });

  it("applies a tab's change of the metadata as one seo edit", () => {
    const { editor: e, applied } = editor("template");
    const { result } = renderHook(() =>
      useSettingsPlace(e, {} as never, "template")
    );
    result.current?.tabProps.seo.set({ title: ["New"] });
    result.current?.tabProps.seo.set(null);
    expect(applied).toEqual([
      { kind: "seo", seo: { title: ["New"] } },
      { kind: "seo", seo: null },
    ]);
  });

  it("reads the page's own CSS, and applies a change of it as one customCss edit", () => {
    const { editor: e, applied } = editor("page");
    const styled = {
      ...e,
      document: {
        ...e.document,
        settings: { customCss: "h1 { color: teal; }" },
      } as BlockDocument,
    };
    const { result } = renderHook(() =>
      useSettingsPlace(styled, {} as never, "page")
    );
    expect(result.current?.pageCss.value).toBe("h1 { color: teal; }");
    expect(result.current?.pageCss.set("h1 { color: red; }")).toBe(true);
    result.current?.pageCss.set(null);
    expect(applied).toEqual([
      { kind: "customCss", customCss: "h1 { color: red; }" },
      { kind: "customCss", customCss: null },
    ]);
  });

  it("makes an edit a tab holds before the document is stored, and answers the document it made", () => {
    const { editor: e, applied } = editor("template");
    const made = { ...e.document, nodes: [] } as BlockDocument;
    e.apply = (op: BuilderOp) => {
      applied.push(op);
      return made;
    };
    const { result } = renderHook(() =>
      useSettingsPlace(e, {} as never, "template")
    );
    expect(result.current?.flushHeld()).toBeNull();

    const release = result.current?.tabProps.holdEdit(() =>
      result.current?.tabProps.seo.set({ title: ["Held"] })
    );
    expect(result.current?.flushHeld()).toBe(made);
    expect(applied).toEqual([{ kind: "seo", seo: { title: ["Held"] } }]);

    release?.();
    expect(result.current?.flushHeld()).toBeNull();
    expect(applied).toHaveLength(1);
  });
});
