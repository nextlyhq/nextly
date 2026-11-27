/**
 * History on a translation page, as a translator meets it: a real form, the
 * real panel and version, and the reads answered here. A version is read in
 * place of the live text, and a restore puts a translated value into the form
 * as unsaved work: nothing is sent, and no shared value is touched.
 */
import userEvent from "@testing-library/user-event";
import type { FieldConfig } from "nextly/config";
import { useEffect, type ReactElement } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

import { answerMediaQueries } from "@admin/__tests__/helpers/media-query";
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@admin/__tests__/utils";
import type { EditorRestore } from "@admin/components/features/versions/editor-restore";
import { useHistoryAddress } from "@admin/components/features/versions/history-address";
import { useFormRestore } from "@admin/components/features/versions/useEditorRestoreSurface";
// Loaded with this file, so the panel's own deferred load is answered at once.
import "@admin/components/features/versions/VersionHistorySheet";
import { protectedApi } from "@admin/lib/api/protectedApi";
import type {
  FieldDiff,
  VersionDetail,
  VersionDiff,
  VersionMeta,
  VersionScope,
} from "@admin/services/versionApi";

import {
  TranslationHistoryBody,
  TranslationHistoryControls,
  TranslationHistoryProvider,
} from "../TranslationHistory";
import { useTranslationHistory } from "../useTranslationHistory";

const { reads, markSeen, writes, canRequest, toastSuccess, localization } =
  vi.hoisted(() => {
    const locales = [
      { code: "en", label: "English", rtl: false, fallbackLocale: [] },
      { code: "es", label: "Spanish", rtl: false, fallbackLocale: ["en"] },
    ];
    return {
      reads: {
        list: vi.fn(),
        events: vi.fn(),
        get: vi.fn(),
        diff: vi.fn(),
      },
      // The one request showing a version may send.
      markSeen: vi.fn(),
      // Every write the panel or the page could make.
      writes: {
        setLabel: vi.fn(),
        discardWorkingDraft: vi.fn(),
        takeLiveSharedValues: vi.fn(),
        saveAutosave: vi.fn(),
        entryUpdate: vi.fn(),
        entryPublishParts: vi.fn(),
        singleUpdate: vi.fn(),
        singleUpdateDocument: vi.fn(),
        singlePublishParts: vi.fn(),
      },
      canRequest: vi.fn(),
      toastSuccess: vi.fn(),
      localization: {
        enabled: true,
        locales,
        defaultLocale: "en",
        fallback: true,
        getLocale: (code: string | undefined) =>
          locales.find(each => each.code === code),
      },
    };
  });

vi.mock("@admin/services/versionApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/versionApi")>();
  return {
    ...actual,
    versionApi: {
      ...actual.versionApi,
      ...reads,
      markSeen,
      setLabel: writes.setLabel,
      discardWorkingDraft: writes.discardWorkingDraft,
      takeLiveSharedValues: writes.takeLiveSharedValues,
      saveAutosave: writes.saveAutosave,
    },
  };
});
vi.mock("@admin/services/entryApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/entryApi")>();
  return {
    ...actual,
    entryApi: {
      ...actual.entryApi,
      update: writes.entryUpdate,
      publishParts: writes.entryPublishParts,
    },
  };
});
vi.mock("@admin/services/singleApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/singleApi")>();
  return {
    ...actual,
    singleApi: {
      ...actual.singleApi,
      update: writes.singleUpdate,
      updateDocument: writes.singleUpdateDocument,
      publishParts: writes.singlePublishParts,
    },
  };
});
vi.mock("@admin/hooks/useCanRequest", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/useCanRequest")>()),
  useCanRequest: canRequest,
}));
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => localization,
}));
vi.mock("@admin/components/ui", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/components/ui")>()),
  toast: { success: toastSuccess, error: vi.fn() },
}));
// A version drawn whole, where there is nothing to compare it with.
vi.mock(
  "@admin/components/features/entries/EntryForm/ReadOnlyDocumentForm",
  () => ({
    ReadOnlyDocumentForm: ({ fields: drawn }: { fields: FieldConfig[] }) => (
      <div data-testid="whole-version">
        {drawn.map(field => ("name" in field ? field.name : "")).join(" ")}
      </div>
    ),
  })
);

const scope: VersionScope = {
  kind: "collection",
  slug: "posts",
  entryId: "e1",
};

const fields = [
  { name: "title", type: "text", label: "Title", localized: true },
  { name: "summary", type: "text", label: "Summary", localized: true },
  { name: "price", type: "number", label: "Price", localized: false },
] as unknown as FieldConfig[];

/** The fields the page writes: the translated ones. */
const rows = [{ name: "title" }, { name: "summary" }];

/** The page's own address, with no history open. */
const PAGE = "/admin/collections/posts/e1/translations/es";

function meta(versionNo: number, locale: string | null): VersionMeta {
  const at = `2026-03-0${versionNo}T10:00:00.000Z`;
  return {
    id: `v${versionNo}`,
    versionNo,
    status: "draft",
    isAutosave: false,
    label: null,
    locale,
    sourceVersionNo: null,
    createdBy: "u1",
    author: { id: "u1", name: "Ada" },
    createdAt: at,
    updatedAt: at,
  };
}

/** Newest first: English, Spanish, the shared fields, then Spanish again. */
const VERSIONS: VersionMeta[] = [
  meta(4, "en"),
  meta(3, "es"),
  meta(2, null),
  meta(1, "es"),
];

/** What each version holds; the summary is as the page holds it. */
function detail(versionNo: number): VersionDetail {
  const found = VERSIONS.find(each => each.versionNo === versionNo);
  if (found === undefined) throw new Error(`no version ${versionNo}`);
  return {
    ...found,
    snapshot: { title: "Antes", summary: "Resumen", price: 5 },
    withheld: [],
  };
}

function changed(name: string, label: string): FieldDiff {
  return {
    kind: "text",
    name,
    label,
    type: "text",
    status: "changed",
    segments: [
      { op: -1, text: "before" },
      { op: 1, text: "after" },
    ],
  };
}

/** The title and the price changed from one version to the next. */
function diffOf(_scope: VersionScope, from: number, to: number) {
  const diff: VersionDiff = {
    from,
    to,
    locale: "es",
    hasChanges: true,
    fields: [changed("title", "Title"), changed("price", "Price")],
  };
  return Promise.resolve(diff);
}

interface PageProps {
  readOnly?: boolean;
  canRestore?: boolean;
  actionsDisabled?: boolean;
  writesRefused?: boolean;
  isSaving?: boolean;
}

/** The page's form and restore, as its save would read them. */
interface Held {
  form: UseFormReturn<Record<string, unknown>>;
  restore: EditorRestore;
}

const held: { current: Held | null } = { current: null };

/** A translation page: its header, its live text, and its history. */
function Page({
  readOnly = false,
  canRestore = true,
  actionsDisabled = false,
  writesRefused = false,
  isSaving = false,
}: PageProps): ReactElement {
  const form = useForm<Record<string, unknown>>({
    defaultValues: { title: "Ahora", summary: "Resumen", price: 10 },
  });
  const restore = useFormRestore(form);
  const { isDirty } = form.formState;
  const history = useTranslationHistory({
    scope,
    target: { code: "es", label: "Spanish" },
    form,
    restore,
    fields,
    rows,
    readOnly: readOnly || isSaving,
    historyEnabled: true,
  });
  useEffect(() => {
    held.current = { form, restore };
  }, [form, restore]);
  return (
    <TranslationHistoryProvider
      history={history}
      language="es"
      canRestore={canRestore}
      writesRefused={writesRefused}
      isSaving={isSaving}
      lifecycle
    >
      <div data-testid="header">
        <TranslationHistoryControls
          history={history}
          actionsDisabled={actionsDisabled}
        >
          <button type="button">Save Spanish</button>
        </TranslationHistoryControls>
      </div>
      <p data-testid="unsaved">
        {isDirty ? "Unsaved work" : "Nothing unsaved"}
      </p>
      <TranslationHistoryBody
        history={history}
        actionsDisabled={actionsDisabled}
      >
        <input aria-label="Spanish title" {...form.register("title")} />
      </TranslationHistoryBody>
    </TranslationHistoryProvider>
  );
}

const SHARED_NOTE = "Shared fields are changed in the editor.";

const header = () => within(screen.getByTestId("header"));
const liveTitle = () => screen.getByLabelText("Spanish title");
/** Whether the live text is taken from the screen, though still mounted. */
const liveHidden = () => liveTitle().closest("[aria-hidden='true']") !== null;
const search = () => new URLSearchParams(window.location.search);

/** The form and restore, with every value the form holds. */
function page(): Held & { values: Record<string, unknown> } {
  if (held.current === null) throw new Error("the page is not mounted");
  return { ...held.current, values: held.current.form.getValues() };
}

/** Draws the page with history open on a version, as a link to it does. */
function renderAt(versionNo: number, props: PageProps = {}) {
  window.history.replaceState(
    null,
    "",
    `${PAGE}?history=1&version=${versionNo}`
  );
  return render(<Page {...props} />);
}

/** Once a version compared with the one before it is drawn, with its changes. */
async function changesShown(): Promise<void> {
  expect(
    await screen.findByRole("region", { name: "Title, changed" })
  ).toBeInTheDocument();
}

/** A changed field's card in the version on screen. */
const changedField = (label: string) =>
  within(screen.getByRole("region", { name: `${label}, changed` }));

/** Opens the restore list from the version's own actions. */
async function openRestore(): Promise<HTMLElement> {
  const restore = await header().findByRole("button", { name: "Restore…" });
  await waitFor(() => expect(restore).toBeEnabled());
  await userEvent.click(restore);
  return screen.findByRole("alertdialog");
}

/** Runs the Undo the restore's toast offers. */
function undoRestore(): void {
  const options = toastSuccess.mock.calls.at(-1)?.[1] as {
    action: { label: string; onClick: () => void };
  };
  expect(options.action.label).toBe("Undo");
  act(() => options.action.onClick());
}

let fetchSpy: MockInstance<typeof fetch>;

/** Every request that writes, whichever service sent it. */
function sentWrites() {
  return fetchSpy.mock.calls.filter(
    ([, init]) => (init?.method ?? "GET").toUpperCase() !== "GET"
  );
}

function expectNothingWritten(): void {
  for (const write of Object.values(writes)) {
    expect(write).not.toHaveBeenCalled();
  }
  expect(sentWrites()).toEqual([]);
}

/** Announces each move of the address, as the admin's router does. */
function announceMoves(): void {
  for (const method of ["pushState", "replaceState"] as const) {
    const move = window.history[method].bind(window.history);
    vi.spyOn(window.history, method).mockImplementation(
      (data: unknown, unused: string, url?: string | URL | null) => {
        move(data, unused, url);
        queueMicrotask(() => window.dispatchEvent(new Event("locationchange")));
      }
    );
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  held.current = null;
  window.history.replaceState(null, "", PAGE);
  // Read closed once, so no test steps back off an entry an earlier one added.
  renderHook(() => useHistoryAddress()).unmount();
  announceMoves();
  // Wide enough for the panel to stand beside the page.
  answerMediaQueries(true);
  fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new TypeError("no network"));
  canRequest.mockReturnValue(true);
  reads.list.mockResolvedValue({ items: VERSIONS, meta: { hasNext: false } });
  reads.events.mockResolvedValue({ items: [], meta: { hasNext: false } });
  reads.get.mockImplementation((_scope: VersionScope, versionNo: number) =>
    Promise.resolve(detail(versionNo))
  );
  reads.diff.mockImplementation(diffOf);
  markSeen.mockResolvedValue({ message: "Marked as seen.", item: {} });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("opening a translation page's history", () => {
  it("opens the panel by the address, and closes it again", async () => {
    render(<Page />);
    const open = header().getByRole("button", { name: "History" });
    expect(open).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("heading", { name: "History" })).toBeNull();

    await userEvent.click(open);
    expect(
      await screen.findByRole("heading", { name: "History" })
    ).toBeInTheDocument();
    expect(search().get("history")).toBe("1");
    expect(open).toHaveAttribute("aria-expanded", "true");

    await userEvent.click(open);
    await waitFor(() => expect(search().get("history")).toBeNull());
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "History" })).toBeNull()
    );
    // Another address of the page is left as it was.
    expect(window.location.pathname).toBe(PAGE);
  });

  it("opens on what a link names", async () => {
    renderAt(3);
    await changesShown();
    expect(reads.get).toHaveBeenCalledWith(scope, 3);
  });

  it("has no history where none is offered, whatever the address names", async () => {
    canRequest.mockReturnValue(false);
    renderAt(3);
    expect(header().queryByRole("button", { name: "History" })).toBeNull();
    // The page's own actions and its live text, as without history.
    expect(
      header().getByRole("button", { name: "Save Spanish" })
    ).toBeInTheDocument();
    expect(liveHidden()).toBe(false);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole("heading", { name: "History" })).toBeNull();
    expect(reads.list).not.toHaveBeenCalled();
    expect(reads.get).not.toHaveBeenCalled();
  });

  it("lists the page's language with the shared fields, every language one choice away", async () => {
    window.history.replaceState(null, "", `${PAGE}?history=1`);
    render(<Page />);
    expect(
      await screen.findByRole("button", { name: /Version 3\b/ })
    ).toBeInTheDocument();
    const languages = screen.getByRole("combobox", { name: "Languages shown" });
    expect(languages).toHaveTextContent("Spanish and shared fields");
    expect(
      screen.getByRole("button", { name: /Version 2\b/ })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Version 1\b/ })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Version 4\b/ })).toBeNull();

    await userEvent.click(languages);
    await userEvent.click(
      await screen.findByRole("option", { name: "All languages" })
    );
    expect(
      await screen.findByRole("button", { name: /Version 4\b/ })
    ).toBeInTheDocument();
  });
});

describe("a past version on a translation page", () => {
  it("takes the place of the live text, which stays mounted with what was typed", async () => {
    render(<Page />);
    const title = liveTitle();
    await userEvent.type(title, " mismo");
    expect(liveHidden()).toBe(false);

    await userEvent.click(header().getByRole("button", { name: "History" }));
    await userEvent.click(
      await screen.findByRole("button", { name: /Version 3\b/ })
    );
    await changesShown();
    expect(search().get("version")).toBe("3");
    expect(liveHidden()).toBe(true);
    expect(liveTitle()).toBe(title);

    await userEvent.click(
      header().getByRole("button", { name: "Back to current" })
    );
    await waitFor(() => expect(liveHidden()).toBe(false));
    expect(screen.queryByRole("region", { name: "Title, changed" })).toBeNull();
    // The same field, with what was typed still in it.
    expect(liveTitle()).toBe(title);
    expect(title).toHaveValue("Ahora mismo");
    expect(page().values.title).toBe("Ahora mismo");
    expectNothingWritten();
  });

  it("swaps the page's actions for the version's, and back", async () => {
    renderAt(3);
    await changesShown();
    expect(header().queryByRole("button", { name: "Save Spanish" })).toBeNull();
    const compare = header().getByRole("link", { name: "Compare" });
    const address = new URL(
      compare.getAttribute("href") ?? "",
      window.location.origin
    );
    expect(Object.fromEntries(address.searchParams)).toEqual({
      from: "previous",
      to: "3",
      locale: "es",
    });
    expect(
      header().getByRole("button", { name: "Restore…" })
    ).toBeInTheDocument();
    // The way to the panel stays beside them.
    expect(
      header().getByRole("button", { name: "History" })
    ).toBeInTheDocument();

    await userEvent.click(
      header().getByRole("button", { name: "Back to current" })
    );
    expect(
      await header().findByRole("button", { name: "Save Spanish" })
    ).toBeInTheDocument();
    expect(header().queryByRole("button", { name: "Restore…" })).toBeNull();
    expect(header().queryByRole("link", { name: "Compare" })).toBeNull();
  });

  it("draws a version with nothing to compare it with whole, its title first", async () => {
    renderAt(1);
    expect(await screen.findByTestId("whole-version")).toHaveTextContent(
      "title summary price"
    );
  });

  it("says once that shared fields are changed in the editor, and not on the live page", async () => {
    renderAt(3);
    await changesShown();
    expect(screen.getAllByText(SHARED_NOTE)).toHaveLength(1);

    await userEvent.click(
      header().getByRole("button", { name: "Back to current" })
    );
    await header().findByRole("button", { name: "Save Spanish" });
    expect(screen.queryByText(SHARED_NOTE)).toBeNull();
  });
});

describe("restoring on a translation page", () => {
  it("sees a write that is sent, whichever service sends it", async () => {
    // What the tests below rely on: a write is seen here when there is one.
    await protectedApi.patch("/anything", {}).catch(() => undefined);
    expect(sentWrites()).toHaveLength(1);
  });

  it("lists a translated field chosen, and a shared one that can't be", async () => {
    renderAt(3);
    const dialog = within(await openRestore());

    const title = dialog.getByRole("checkbox", { name: "Title" });
    expect(title).toBeChecked();
    expect(title).toBeEnabled();
    expect(title).toHaveAccessibleDescription("Puts back “Antes”");

    const price = dialog.getByRole("checkbox", { name: "Price" });
    expect(price).not.toBeChecked();
    expect(price).toBeDisabled();
    expect(price).toHaveAccessibleDescription("You can't edit this field");
    expect(dialog.getByText("Shared · every language")).toBeInTheDocument();

    // The same in the version and on the page: not listed at all.
    expect(dialog.queryByRole("checkbox", { name: "Summary" })).toBeNull();
    expect(
      dialog.getByText(
        "Changes Spanish only. Other languages and shared fields stay as they are."
      )
    ).toBeInTheDocument();

    // Asking for the shared field anyway chooses nothing more.
    await userEvent.click(price);
    expect(price).not.toBeChecked();
    expect(
      dialog.getByRole("button", { name: "Restore 1 field" })
    ).toBeEnabled();
  });

  it("puts the value into the page as unsaved work, sends nothing, and puts it back on Undo", async () => {
    render(<Page />);
    expect(screen.getByTestId("unsaved")).toHaveTextContent("Nothing unsaved");
    await userEvent.click(header().getByRole("button", { name: "History" }));
    await userEvent.click(
      await screen.findByRole("button", { name: /Version 3\b/ })
    );
    const dialog = within(await openRestore());
    expect(page().restore.restoredFromForSave(page().values)).toBeUndefined();

    await userEvent.click(
      dialog.getByRole("button", { name: "Restore 1 field" })
    );

    await waitFor(() => expect(liveTitle()).toHaveValue("Antes"));
    // The live page again, the panel closed and the shared value as it was.
    await waitFor(() => expect(liveHidden()).toBe(false));
    await waitFor(() => expect(search().get("history")).toBeNull());
    expect(page().values).toEqual({
      title: "Antes",
      summary: "Resumen",
      price: 10,
    });
    expect(screen.getByTestId("unsaved")).toHaveTextContent("Unsaved work");
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith(
      expect.stringMatching(/^1 field restored into Spanish from /),
      expect.anything()
    );
    // The save names where each value came from.
    expect(page().restore.restoredFromForSave(page().values)).toEqual({
      title: 3,
    });
    // Showing the version marked it seen, and nothing else was sent.
    expect(markSeen.mock.calls).toEqual([[scope, 3]]);
    expectNothingWritten();

    undoRestore();
    expect(liveTitle()).toHaveValue("Ahora");
    expect(page().values).toEqual({
      title: "Ahora",
      summary: "Resumen",
      price: 10,
    });
    expect(screen.getByTestId("unsaved")).toHaveTextContent("Nothing unsaved");
    expect(page().restore.restoredFromForSave(page().values)).toBeUndefined();
    expectNothingWritten();
  });

  it("names the source of no value changed since it was restored", async () => {
    renderAt(3);
    const dialog = within(await openRestore());
    await userEvent.click(
      dialog.getByRole("button", { name: "Restore 1 field" })
    );
    await waitFor(() => expect(liveTitle()).toHaveValue("Antes"));
    await waitFor(() => expect(liveHidden()).toBe(false));
    expect(page().restore.restoredFromForSave(page().values)).toEqual({
      title: 3,
    });
    act(() =>
      page().form.setValue("title", "Antes de todo", { shouldDirty: true })
    );
    expect(page().restore.restoredFromForSave(page().values)).toBeUndefined();
  });

  it("says where it replaces unsaved work, which Undo gives back", async () => {
    renderAt(3);
    await changesShown();
    act(() =>
      page().form.setValue("title", "Escrito ahora", { shouldDirty: true })
    );
    const dialog = within(await openRestore());
    expect(dialog.getByText("Replaces your unsaved edit")).toBeInTheDocument();
    await userEvent.click(
      dialog.getByRole("button", { name: "Restore 1 field" })
    );
    await waitFor(() => expect(liveTitle()).toHaveValue("Antes"));

    undoRestore();
    expect(liveTitle()).toHaveValue("Escrito ahora");
    expect(screen.getByTestId("unsaved")).toHaveTextContent("Unsaved work");
  });

  it("changes nothing when it is cancelled", async () => {
    renderAt(3);
    const dialog = within(await openRestore());
    await userEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(page().values.title).toBe("Ahora");
    expect(toastSuccess).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  it("offers a changed field's own restore where it is translated, and says why not where it is shared", async () => {
    renderAt(3);
    await changesShown();
    const price = changedField("Price");
    expect(
      await price.findByText("You can't edit this field")
    ).toBeInTheDocument();
    expect(
      price.queryByRole("button", { name: /Restore this field/ })
    ).toBeNull();

    const title = changedField("Title");
    await userEvent.click(
      title.getByRole("button", { name: "Restore this field: Title" })
    );
    expect(page().values).toEqual({
      title: "Antes",
      summary: "Resumen",
      price: 10,
    });
    expectNothingWritten();
  });

  it("puts nothing back from a version that holds no language", async () => {
    renderAt(2);
    const dialog = within(await openRestore());
    const title = dialog.getByRole("checkbox", { name: "Title" });
    expect(title).toBeDisabled();
    expect(title).toHaveAccessibleDescription(
      "This version holds no language for this field"
    );
    expect(dialog.getByRole("checkbox", { name: "Price" })).toBeDisabled();
    expect(
      dialog.getByRole("button", { name: "Restore 0 fields" })
    ).toBeDisabled();
  });

  it("puts nothing in where a save starts while its list is open", async () => {
    const { rerender } = renderAt(3);
    const dialog = within(await openRestore());
    rerender(<Page isSaving actionsDisabled />);
    await userEvent.click(
      dialog.getByRole("button", { name: "Restore 1 field" })
    );
    expect(page().values.title).toBe("Ahora");
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

/** Every control that would restore the version on screen as a whole. */
function restoreControls(): HTMLElement[] {
  return [
    ...screen.queryAllByRole("button", { name: "Restore…" }),
    // The phone's own bar, drawn beside it.
    ...screen.queryAllByRole("button", { name: "Restore this version" }),
  ];
}

describe("where a translation page offers no restore", () => {
  it("offers one in both places where nothing stops it", async () => {
    renderAt(3);
    await changesShown();
    await waitFor(() => expect(restoreControls()).toHaveLength(2));
  });

  it("offers none of another language's version, which is still read", async () => {
    renderAt(4);
    expect(await screen.findByTestId("whole-version")).toBeInTheDocument();
    expect(
      header().getByRole("button", { name: "Back to current" })
    ).toBeInTheDocument();
    await waitFor(() => expect(restoreControls()).toEqual([]));
    expect(screen.queryByText(SHARED_NOTE)).toBeNull();
  });

  it.each<[string, PageProps]>([
    ["a person who may not change the language", { canRestore: false }],
    ["a read-only page", { readOnly: true, actionsDisabled: true }],
    ["a type whose writes are refused", { writesRefused: true }],
    ["a page that is saving", { isSaving: true, actionsDisabled: true }],
  ])("offers none to %s", async (_who, props) => {
    renderAt(3, props);
    await changesShown();
    expect(
      header().getByRole("button", { name: "Back to current" })
    ).toBeInTheDocument();
    expect(restoreControls()).toEqual([]);
    expect(screen.queryByText(SHARED_NOTE)).toBeNull();
  });

  it.each<[string, PageProps]>([
    ["a person who may not change the language", { canRestore: false }],
    ["a read-only page", { readOnly: true, actionsDisabled: true }],
    ["a type whose writes are refused", { writesRefused: true }],
    ["a page that is saving", { isSaving: true, actionsDisabled: true }],
  ])("offers no changed field's own restore to %s", async (_who, props) => {
    renderAt(3, props);
    await changesShown();
    expect(
      screen.queryByRole("button", { name: /Restore this field/ })
    ).toBeNull();
  });

  it("marks no version seen where writes are refused", async () => {
    renderAt(3, { writesRefused: true });
    await changesShown();
    expect(markSeen).not.toHaveBeenCalled();
    expectNothingWritten();
  });
});
