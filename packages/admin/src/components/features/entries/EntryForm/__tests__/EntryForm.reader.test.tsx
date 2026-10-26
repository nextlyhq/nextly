/**
 * The entry editor writes nothing for a user who may read the entry but not
 * change it: no recovery point is read to offer back into the read-only form,
 * none is recorded from it, and a feature's toolbar control is told writes
 * are held.
 *
 * Each seam is observed through the options the editor hands it, against the
 * same editor for a user who may change the entry, so a seam the reader's
 * state never reaches shows as the two calls agreeing.
 */
import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render } from "@admin/__tests__/utils";

const hooks = vi.hoisted(() => ({
  readOnlyForReader: false,
  /** Whether a language switch's answer is on its way. */
  switching: false,
  useDocumentAutosave: vi.fn(() => ({ status: "idle", lastSavedAt: null })),
  useAutosaveRecovery: vi.fn(() => ({
    offer: null,
    accept: () => undefined,
    dismiss: () => undefined,
  })),
  versionAwareToolbarSlots: vi.fn(() => undefined),
  headerProps: vi.fn(),
  versionBodyProps: vi.fn(),
  previewPanesProps: vi.fn(),
}));

vi.mock("../EntrySystemHeader", () => ({
  EntrySystemHeader: (props: Record<string, unknown>) => {
    hooks.headerProps(props);
    return null;
  },
}));
vi.mock("../../PreviewMode/PreviewPanes", () => ({
  PreviewPanes: (props: { children?: unknown }) => {
    hooks.previewPanesProps(props);
    return props.children ?? null;
  },
}));
vi.mock("@admin/hooks/useUpdateAnswer", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/useUpdateAnswer")>()),
  useUpdateAnswer: () =>
    hooks.switching
      ? "switching"
      : hooks.readOnlyForReader
        ? "refused"
        : "allowed",
}));
vi.mock("@admin/hooks/useDocumentAutosave", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/useDocumentAutosave")
  >()),
  useDocumentAutosave: hooks.useDocumentAutosave,
}));
vi.mock("@admin/hooks/useAutosaveRecovery", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/useAutosaveRecovery")
  >()),
  useAutosaveRecovery: hooks.useAutosaveRecovery,
}));
vi.mock(
  "@admin/components/features/versions/viewed-version-host",
  async importOriginal => ({
    ...(await importOriginal<
      typeof import("@admin/components/features/versions/viewed-version-host")
    >()),
    versionAwareToolbarSlots: hooks.versionAwareToolbarSlots,
    ViewedVersionBody: (props: { children?: unknown }) => {
      hooks.versionBodyProps(props);
      return props.children ?? null;
    },
  })
);

import { EntryForm } from "../EntryForm";

const entry = { id: "e1", title: "Hello" } as never;
const collection = {
  name: "posts",
  label: "Posts",
  fields: [{ name: "title", type: "text", label: "Title" }],
  versions: {
    enabled: true,
    drafts: { enabled: true, autosave: { enabled: true } },
  },
  // A preview, so an editor is offered one and the reader's absence of it is
  // the permission.
  admin: { preview: { hasPreview: true } },
} as never;

/** The options the editor last handed `mock`. */
const lastOptions = (mock: { mock: { calls: unknown[][] } }) => {
  const call = mock.mock.calls.at(-1);
  expect(call).toBeDefined();
  return call!;
};

function renderAs(readOnlyForReader: boolean, switching = false) {
  hooks.readOnlyForReader = readOnlyForReader;
  hooks.switching = switching;
  render(<EntryForm collection={collection} entry={entry} mode="edit" />);
}

describe("the entry editor for a user who may only read the entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads no recovery point to offer", () => {
    renderAs(true);
    expect(lastOptions(hooks.useAutosaveRecovery)[0]).toMatchObject({
      scope: null,
    });
    // POPULATION CONTROL: a user who may change the entry is offered one.
    vi.clearAllMocks();
    renderAs(false);
    expect(lastOptions(hooks.useAutosaveRecovery)[0]).toMatchObject({
      scope: expect.objectContaining({ kind: "collection" }),
    });
  });

  it("records no recovery point", () => {
    renderAs(true);
    expect(lastOptions(hooks.useDocumentAutosave)[0]).toMatchObject({
      enabled: false,
    });
    vi.clearAllMocks();
    renderAs(false);
    expect(lastOptions(hooks.useDocumentAutosave)[0]).toMatchObject({
      enabled: true,
    });
  });

  it("tells a feature's toolbar control that writes are held", () => {
    renderAs(true);
    expect(lastOptions(hooks.versionAwareToolbarSlots)[1]).toBe(true);
    vi.clearAllMocks();
    renderAs(false);
    expect(lastOptions(hooks.versionAwareToolbarSlots)[1]).toBe(false);
  });

  it("holds restoring a past version, on every width", () => {
    // The version body carries the phone's Restore; the header's is held by
    // the same decision.
    renderAs(true);
    expect(lastOptions(hooks.versionBodyProps)[0]).toMatchObject({
      actionsDisabled: true,
    });
    vi.clearAllMocks();
    renderAs(false);
    expect(lastOptions(hooks.versionBodyProps)[0]).toMatchObject({
      actionsDisabled: false,
    });
  });

  it("hands the header no document to share, so no share popover can stay open", () => {
    renderAs(true);
    expect(lastOptions(hooks.headerProps)[0]).not.toHaveProperty(
      "shareDocument"
    );
    vi.clearAllMocks();
    renderAs(false);
    expect(lastOptions(hooks.headerProps)[0]).toHaveProperty("shareDocument");
  });

  it("closes an open preview once the user may only read the entry", async () => {
    hooks.readOnlyForReader = false;
    const view = render(
      <EntryForm collection={collection} entry={entry} mode="edit" />
    );
    const toggle = lastOptions(hooks.headerProps)[0] as {
      onTogglePreviewPane?: () => void;
    };
    // POPULATION CONTROL: the editor opens it, so the pane is open below
    // until the reader's state closes it.
    expect(toggle.onTogglePreviewPane).toEqual(expect.any(Function));
    await act(async () => toggle.onTogglePreviewPane?.());
    expect(lastOptions(hooks.previewPanesProps)[0]).toMatchObject({
      open: true,
    });
    hooks.readOnlyForReader = true;
    view.rerender(
      <EntryForm collection={collection} entry={entry} mode="edit" />
    );
    expect(lastOptions(hooks.previewPanesProps)[0]).toMatchObject({
      open: false,
    });
  });
});

describe("the entry editor while a language switch's answer is on its way", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("holds every write that changing the entry needs, as for a reader", () => {
    // The answer on screen is the language moved from, which grants nothing
    // in the new one: no preview to share, no restore, the toolbar's writes
    // held.
    renderAs(false, true);
    expect(lastOptions(hooks.headerProps)[0]).not.toHaveProperty(
      "shareDocument"
    );
    expect(lastOptions(hooks.versionBodyProps)[0]).toMatchObject({
      actionsDisabled: true,
    });
    expect(lastOptions(hooks.versionAwareToolbarSlots)[1]).toBe(true);
  });

  it("is not a reader's page meanwhile: its recovery point stays", () => {
    renderAs(false, true);
    expect(lastOptions(hooks.useAutosaveRecovery)[0]).not.toMatchObject({
      scope: null,
    });
  });
});
