/**
 * The Single editor consumes what its history panel publishes.
 *
 * The panel is mounted from the system header for collections and singles
 * alike, and it hands the chosen version to the document area through shared
 * context. The entry editor answers by swapping the document for the version;
 * these tests establish that the Single editor consumes the same publication —
 * the banner over a read-only snapshot — rather than leaving the live document
 * on screen while the panel reports a selection nothing answers.
 *
 * The arrival states share one file on purpose, mirroring the entry editor's
 * suite: the defect class is the panel and the document disagreeing about
 * whether a version is being read, so covering only the arrived state would
 * leave the other states free to drift.
 */
import { useEffect } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import userEvent from "@testing-library/user-event";

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@admin/__tests__/utils";
import { useDocumentHistory } from "@admin/components/features/versions/document-history-context";
import type { ViewedVersion } from "@admin/components/features/versions/document-history-context";

const {
  viewed,
  sidebarProps,
  useDocumentLock,
  useDocumentAutosave,
  useAutosaveRecovery,
} = vi.hoisted(() => ({
  viewed: { current: null as ViewedVersion | null },
  sidebarProps: {
    current: null as { actionsDisabled?: boolean } | null,
  },
  useDocumentLock: vi.fn(),
  useDocumentAutosave: vi.fn(() => ({ status: "idle", lastSavedAt: null })),
  useAutosaveRecovery: vi.fn<
    () => {
      offer: { savedAt: Date } | null;
      restore: () => void;
      dismiss: () => void;
    }
  >(() => ({
    offer: null,
    restore: vi.fn(),
    dismiss: vi.fn(),
  })),
}));

vi.mock("@admin/hooks/queries/useDocumentLock", () => ({ useDocumentLock }));
vi.mock("@admin/hooks/useDocumentAutosave", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/useDocumentAutosave")
  >()),
  useDocumentAutosave,
}));
vi.mock("@admin/hooks/useAutosaveRecovery", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/useAutosaveRecovery")
  >()),
  useAutosaveRecovery,
}));

// The rail is where the withheld-write decision has to LAND: a prop passed to
// the wrong component type-checks perfectly, so the stand-in records what the
// editor actually handed it rather than what the code looks like it hands it.
vi.mock(
  "@admin/components/features/entries/EntryForm/EntryFormSidebar",
  () => ({
    EntryFormSidebar: (props: { actionsDisabled?: boolean }) => {
      sidebarProps.current = props;
      return null;
    },
  })
);

// The header is where the history panel normally mounts and publishes both the
// chosen version and the restore affordance. Standing in for it lets a test
// name the arrival state directly, which no fixture of the real panel can.
vi.mock(
  "@admin/components/features/entries/EntryForm/EntrySystemHeader",
  () => ({
    EntrySystemHeader: () => {
      const { setViewing, setRestore } = useDocumentHistory();
      useEffect(() => {
        setViewing(viewed.current);
        setRestore({
          canRestore: true,
          request: vi.fn(),
          returnToCurrent: vi.fn(),
        });
      }, [setViewing, setRestore]);
      return null;
    },
  })
);

vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({
    enabled: false,
    locales: [],
    defaultLocale: "en",
    fallback: true,
    getLocale: () => undefined,
  }),
}));

vi.mock("@admin/components/features/versions/VersionSnapshotForm", () => ({
  VersionSnapshotForm: () => <div data-testid="snapshot-form" />,
}));

import {
  SingleForm,
  type SingleSchema,
  type SingleDocumentData,
} from "../SingleForm";

const schema = {
  slug: "homepage",
  label: "Homepage",
  fields: [
    { type: "text", name: "title", label: "Title", required: true },
    { type: "text", name: "slug", label: "Slug", required: true, unique: true },
    { type: "text", name: "heroTitle", label: "Hero Title" },
  ],
} as unknown as SingleSchema;

const document = {
  id: "homepage",
  updatedAt: "2026-01-01T00:00:00.000Z",
  title: "Homepage",
  slug: "homepage",
  heroTitle: "",
} as unknown as SingleDocumentData;

/** The real DOM document, since `document` here is the single being edited. */
const document_ = globalThis.document;

beforeEach(() => {
  vi.clearAllMocks();
  // The module-level holder outlives a test; a version published by the
  // previous test would leak into this one's first render.
  viewed.current = null;
  sidebarProps.current = null;
  useDocumentLock.mockReturnValue({
    state: { status: "held-by-me" },
    takeOver: vi.fn(),
  });
});

function renderViewing(version: ViewedVersion) {
  viewed.current = version;
  return render(
    <SingleForm schema={schema} document={document} onSubmit={vi.fn()} />
  );
}

describe("SingleForm — a published version replaces the document", () => {
  it("shows the banner and the snapshot once the read has returned", () => {
    // The positive control. Without it the assertions below are satisfied by a
    // document area that renders nothing under any circumstances.
    renderViewing({
      versionNo: 7,
      snapshot: { heroTitle: "as it was" },
      locale: null,
      isLoading: false,
      error: null,
    });

    expect(
      screen.getByText(/you are reading a past version/i)
    ).toBeInTheDocument();
    expect(screen.getByTestId("snapshot-form")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /restore this version/i })
    ).toBeEnabled();
    // The live editor's own fields stay mounted behind the version so their
    // rich state (undo, selection) survives the round trip — but they are
    // inert: removed from the accessibility tree and from every pointer.
    const live = screen.getByLabelText("Hero Title");
    expect(live).toBeInTheDocument();
    expect(live.closest("[aria-hidden='true']")).not.toBeNull();
  });

  it("holds the snapshot back while the read has not returned", () => {
    renderViewing({
      versionNo: 7,
      // No snapshot, and the query reports neither progress nor failure —
      // which is what a disabled or paused read looks like.
      snapshot: undefined,
      locale: null,
      isLoading: false,
      error: null,
    });

    // An absent snapshot must not render as an empty version.
    expect(screen.queryByTestId("snapshot-form")).toBeNull();
    expect(screen.getByText(/loading version 7/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /restore this version/i })
    ).toBeDisabled();
  });

  it("reports a failed read instead of rendering it as the version", () => {
    renderViewing({
      versionNo: 7,
      snapshot: undefined,
      locale: null,
      isLoading: false,
      error: new Error("boom"),
    });

    expect(
      screen.getByText(/this version could not be loaded/i)
    ).toBeInTheDocument();
    expect(screen.queryByTestId("snapshot-form")).toBeNull();
  });

  it("keeps the editor's autosave off while a version is on screen", async () => {
    // Reading is not editing, and the recovery point is a write. While the
    // version stands in for the document, no recovery point may be recorded.
    render(
      <SingleForm schema={schema} document={document} onSubmit={vi.fn()} />
    );
    await waitFor(() =>
      expect(useDocumentAutosave).toHaveBeenLastCalledWith(
        expect.objectContaining({ enabled: true })
      )
    );

    renderViewing({
      versionNo: 7,
      snapshot: { heroTitle: "as it was" },
      locale: null,
      isLoading: false,
      error: null,
    });

    expect(useDocumentAutosave).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false })
    );
  });

  it("withholds the rail's document actions while a version is on screen", () => {
    // The rail's actions act on the LIVE document, which is not what is on
    // screen. Asserted on the props the editor HANDS the rail, not on what
    // the code looks like it hands it — the wiring was once connected to a
    // context read that sat above the provider and always read the default.
    renderViewing({
      versionNo: 7,
      snapshot: { heroTitle: "as it was" },
      locale: null,
      isLoading: false,
      error: null,
    });
    expect(sidebarProps.current?.actionsDisabled).toBe(true);
  });

  it("leaves the rail's document actions alone while the live document is on screen", () => {
    // The other direction, so the gate cannot be satisfied by refusing always.
    render(
      <SingleForm schema={schema} document={document} onSubmit={vi.fn()} />
    );
    expect(sidebarProps.current?.actionsDisabled).toBe(false);
  });

  it("refuses the native submit path while a version is on screen", async () => {
    // 🔴 Settled, not polled: the submit is asynchronous, so it is given time
    // to happen and then found not to have. The shortcut and the disabled
    // header buttons are not the only writers — a native form submit reaches
    // the handler with no control standing in front of it.
    const onSubmit = vi.fn();
    viewed.current = {
      versionNo: 7,
      snapshot: { heroTitle: "as it was" },
      locale: null,
      isLoading: false,
      error: null,
    };
    render(
      <SingleForm schema={schema} document={document} onSubmit={onSubmit} />
    );

    const form = document_.querySelector("form");
    expect(form, "the editor renders a form to submit").not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("collapses two same-turn submits into one write", async () => {
    // Two native submits in the same turn both pass a render-derived guard,
    // because the in-flight state publishes a render behind the mutation.
    // The synchronous latch is what makes the second a no-op.
    const onSubmit = vi.fn();
    render(
      <SingleForm schema={schema} document={document} onSubmit={onSubmit} />
    );

    const form = document_.querySelector("form");
    expect(form, "the editor renders a form to submit").not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);
    fireEvent.submit(form as HTMLFormElement);
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("keeps the submit path working while the live document is on screen", async () => {
    // The other direction, so the gate cannot be satisfied by refusing always.
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <SingleForm schema={schema} document={document} onSubmit={onSubmit} />
    );

    await user.type(screen.getByLabelText("Hero Title"), "work");
    const form = document_.querySelector("form");
    expect(form, "the editor renders a form to submit").not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  });

  it("refuses the native submit path while a save is already in flight", async () => {
    // The single's update mutations run in parallel, so a second write racing
    // a first one would let completion order decide which contents survive.
    const onSubmit = vi.fn();
    render(
      <SingleForm
        schema={schema}
        document={document}
        onSubmit={onSubmit}
        isSubmitting
      />
    );

    const form = document_.querySelector("form");
    expect(form, "the editor renders a form to submit").not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("withholds the recovery offer while a version is on screen", () => {
    // The recovery offer restores work into the LIVE form. Doing that while
    // the author is looking at a past version changes values nobody can see,
    // under a banner saying the page cannot be edited.
    useAutosaveRecovery.mockReturnValue({
      offer: { savedAt: new Date("2026-01-01T00:00:00.000Z") },
      restore: vi.fn(),
      dismiss: vi.fn(),
    });
    const live = render(
      <SingleForm schema={schema} document={document} onSubmit={vi.fn()} />
    );
    expect(
      screen.getByRole("button", { name: /restore/i })
    ).toBeInTheDocument();

    // The live editor is unmounted so the only restore on screen during the
    // reading is the banner's — the recovery offer must be gone with the
    // live document it would act on.
    live.unmount();
    renderViewing({
      versionNo: 7,
      snapshot: { heroTitle: "as it was" },
      locale: null,
      isLoading: false,
      error: null,
    });
    expect(screen.getAllByRole("button", { name: /restore/i })).toHaveLength(1);
  });

  it("withholds restore from the banner while a submit is in flight", () => {
    // A restore racing the ordinary save would let completion order decide
    // which contents survive, so the banner offers no restore mid-submit.
    viewed.current = {
      versionNo: 7,
      snapshot: { heroTitle: "as it was" },
      locale: null,
      isLoading: false,
      error: null,
    };
    render(
      <SingleForm
        schema={schema}
        document={document}
        onSubmit={vi.fn()}
        isSubmitting
      />
    );

    expect(
      screen.queryByRole("button", { name: /restore this version/i })
    ).not.toBeInTheDocument();
  });
});
