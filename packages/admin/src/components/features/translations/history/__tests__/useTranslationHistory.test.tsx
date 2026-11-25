/**
 * A translation page's side of its document's history: which fields a restore
 * may put back, the language it goes into, and whether the history is offered.
 */
import type { FieldConfig } from "nextly/config";
import { useForm, type UseFormReturn } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { act, renderHook } from "@admin/__tests__/utils";
import type { EditorRestoreSurface } from "@admin/components/features/versions/document-history-context";
import {
  useEditorRestoreSurface,
  useFormRestore,
} from "@admin/components/features/versions/useEditorRestoreSurface";
import type { VersionScope } from "@admin/services/versionApi";

import {
  restoreInto,
  useTranslationHistory,
  type TranslationHistory,
} from "../useTranslationHistory";

const { canRequest } = vi.hoisted(() => ({ canRequest: vi.fn() }));

vi.mock("@admin/hooks/useCanRequest", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/useCanRequest")>()),
  useCanRequest: canRequest,
}));

const fields = [
  { name: "title", type: "text", localized: true },
  { name: "locked", type: "text", localized: true, admin: { readOnly: true } },
  {
    type: "row",
    admin: { readOnly: true },
    fields: [{ name: "boxed", type: "text", localized: true }],
  },
  {
    name: "caption",
    type: "text",
    localized: true,
    admin: {
      condition: { field: "kind", operator: "equals", value: "photo" },
    },
  },
  { name: "kind", type: "text", localized: false },
  { name: "price", type: "number", localized: false },
] as unknown as FieldConfig[];

/** The fields the page writes: every translated one. */
const rows = [
  { name: "title" },
  { name: "locked" },
  { name: "boxed" },
  { name: "caption" },
];

const post: VersionScope = { kind: "collection", slug: "posts", entryId: "e1" };
const home: VersionScope = { kind: "single", slug: "home", documentId: "s1" };

interface Input {
  scope?: VersionScope;
  readOnly?: boolean;
  historyEnabled?: boolean | undefined;
}

interface Output {
  form: UseFormReturn<Record<string, unknown>>;
  history: TranslationHistory;
  /** What a restore may put back on this page. */
  editor: EditorRestoreSurface;
  /** The editor's own answer over the same form, which the page's narrows. */
  own: EditorRestoreSurface;
}

const NOT_READ_ONLY = (): boolean => false;

function usePage({
  scope = post,
  readOnly = false,
  historyEnabled = true,
}: Input): Output {
  const form = useForm<Record<string, unknown>>({
    defaultValues: {
      title: "Ahora",
      locked: "Fijo",
      boxed: "Caja",
      caption: "Pie",
      kind: "photo",
      price: 10,
    },
  });
  const restore = useFormRestore(form);
  const own = useEditorRestoreSurface({
    restore,
    form,
    fields,
    readOnly: NOT_READ_ONLY,
    localized: true,
    language: "Spanish",
    locale: "es",
  });
  const history = useTranslationHistory({
    scope,
    target: { code: "es", label: "Spanish" },
    form,
    restore,
    fields,
    rows,
    readOnly,
    historyEnabled,
  });
  const editor = history.host.documentHistory.editor;
  if (editor === undefined) throw new Error("no editor to restore into");
  return { form, history, editor, own };
}

/** The page as a hook, which can be given another input. */
function page(input: Input = {}) {
  return renderHook((props: Input) => usePage(props), { initialProps: input });
}

beforeEach(() => {
  vi.clearAllMocks();
  canRequest.mockReturnValue(true);
});

describe("what a restore may put back on a translation page", () => {
  it("is a field the page writes, which the editor lets the person change", () => {
    const { result } = page();
    expect(result.current.editor.canEdit("title")).toBe(true);
    expect(result.current.editor.canEdit("caption")).toBe(true);
  });

  it("is never a field the page does not write, though the editor would let it be changed", () => {
    const { result } = page();
    // The same field, in the same form, in the editor: it may be changed.
    expect(result.current.own.canEdit("price")).toBe(true);
    expect(result.current.own.canEdit("kind")).toBe(true);

    expect(result.current.editor.canEdit("price")).toBe(false);
    expect(result.current.editor.canEdit("kind")).toBe(false);
  });

  it("is never a field the editor keeps shut, though the page writes it", () => {
    const { result } = page();
    expect(result.current.editor.canEdit("locked")).toBe(false);
    // Shut by the container around it.
    expect(result.current.editor.canEdit("boxed")).toBe(false);
  });

  it("is never a field that is in neither the form nor the rows", () => {
    const { result } = page();
    expect(result.current.editor.canEdit("gone")).toBe(false);
  });

  it("follows a field's condition as the form stands when it is asked", () => {
    const { result } = page();
    act(() => result.current.form.setValue("kind", "video"));
    expect(result.current.editor.canEdit("caption")).toBe(false);
    act(() => result.current.form.setValue("kind", "photo"));
    expect(result.current.editor.canEdit("caption")).toBe(true);
  });

  it("is nothing while the page is read-only, and what it was once it is not", () => {
    const { result, rerender } = page({ readOnly: true });
    expect(result.current.editor.canEdit("title")).toBe(false);
    rerender({ readOnly: false });
    expect(result.current.editor.canEdit("title")).toBe(true);
    rerender({ readOnly: true });
    expect(result.current.editor.canEdit("title")).toBe(false);
  });

  it("keeps every other part of the editor's own restore", () => {
    const { result } = page();
    const { editor, own } = result.current;
    expect(editor.restore).toBe(own.restore);
    expect(editor.fields).toBe(fields);
    expect(editor.currentValues()).toEqual(own.currentValues());
    expect(editor.currentValues()).toMatchObject({ title: "Ahora", price: 10 });
  });

  it("goes into the language the page writes, its translated fields told from the shared", () => {
    const { result } = page();
    const { editor } = result.current;
    expect(editor.language).toBe("Spanish");
    expect(editor.locale).toBe("es");
    expect([...(editor.translatable ?? [])]).toEqual([
      "title",
      "locked",
      "boxed",
      "caption",
    ]);
  });

  it("is the same surface from one render to the next, so nothing reading it is drawn again", () => {
    const { result, rerender } = page();
    const before = result.current.editor;
    rerender({});
    expect(result.current.editor).toBe(before);
  });
});

describe("the fields a past version is drawn with", () => {
  const view = (result: { current: Output }): void =>
    act(() =>
      result.current.history.host.documentHistory.setViewing({
        versionNo: 3,
        snapshot: { title: "Antes", kind: "photo" },
        locale: "es",
        withheld: [],
        isLoading: false,
        error: null,
        scope: post,
        comparedWith: { kind: "unknown" },
        about: null,
      })
    );

  it("are none while no version is on screen", () => {
    expect(page().result.current.history.versionFields).toEqual([]);
  });

  it("are led by the title, which the editor's own layout leaves to its header", () => {
    const { result } = page();
    view(result);
    const { versionFields, host } = result.current.history;
    // What the editor lays out, without it.
    expect(host.historicalFields).not.toContain(fields[0]);
    expect(versionFields[0]).toBe(fields[0]);
    expect(versionFields.slice(1)).toEqual(host.historicalFields);
  });
});

describe("an editor's restore kept to some fields", () => {
  const surface = (
    canEdit: (name: string) => boolean
  ): EditorRestoreSurface => ({
    restore: {
      apply: () => ({ undo: () => undefined }),
      restoredFromForSave: () => undefined,
      saved: () => undefined,
      formReset: () => undefined,
      holds: () => false,
    },
    fields: [],
    currentValues: () => ({}),
    dirtyFields: () => new Set<string>(),
    canEdit,
  });

  it.each([
    { named: true, editor: true, may: true },
    { named: true, editor: false, may: false },
    { named: false, editor: true, may: false },
    { named: false, editor: false, may: false },
  ])(
    "may change a field (named: $named, the editor lets it: $editor): $may",
    ({ named, editor, may }) => {
      const kept = restoreInto(
        surface(() => editor),
        new Set(named ? ["title"] : ["other"])
      );
      expect(kept.canEdit("title")).toBe(may);
    }
  );
});

describe("whether a translation page offers its document's history", () => {
  it("offers it where the type keeps versions and the person may read them", () => {
    const { result } = page();
    expect(result.current.history.offered).toBe(true);
    expect(canRequest).toHaveBeenCalledWith("posts", "readHistory");
    expect(result.current.history.scope).toEqual(post);
    // Nothing is on screen in place of the page until one is chosen.
    expect(result.current.history.host.viewingVersion).toBeNull();
  });

  it("offers it where the type does not say whether it keeps versions", () => {
    const { result } = renderHook(() => usePageWithUnknownVersions());
    expect(result.current.history.offered).toBe(true);
  });

  it("does not offer it to a person who may not read the history", () => {
    canRequest.mockReturnValue(false);
    expect(page().result.current.history.offered).toBe(false);
  });

  it("does not offer it where the type keeps no versions", () => {
    const { result } = page({ historyEnabled: false });
    expect(result.current.history.offered).toBe(false);
  });

  it.each<[string, VersionScope]>([
    ["an entry", { kind: "collection", slug: "posts", entryId: "" }],
    ["a Single", { kind: "single", slug: "home", documentId: "" }],
  ])("does not offer it for %s not saved yet", (_what, scope) => {
    expect(page({ scope }).result.current.history.offered).toBe(false);
  });

  it("offers a Single's by its document and its own slug", () => {
    const { result } = page({ scope: home });
    expect(result.current.history.offered).toBe(true);
    expect(canRequest).toHaveBeenCalledWith("home", "readHistory");
    expect(result.current.history.scope).toEqual(home);
  });
});

/** A page whose type says nothing of versions, said past `usePage`'s default. */
function usePageWithUnknownVersions(): { history: TranslationHistory } {
  const form = useForm<Record<string, unknown>>({ defaultValues: {} });
  const restore = useFormRestore(form);
  const history = useTranslationHistory({
    scope: post,
    target: { code: "es", label: "Spanish" },
    form,
    restore,
    fields,
    rows,
    readOnly: false,
    historyEnabled: undefined,
  });
  return { history };
}
