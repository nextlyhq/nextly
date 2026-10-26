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
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render } from "@admin/__tests__/utils";

const hooks = vi.hoisted(() => ({
  readOnlyForReader: false,
  useDocumentAutosave: vi.fn(() => ({ status: "idle", lastSavedAt: null })),
  useAutosaveRecovery: vi.fn(() => ({
    offer: null,
    accept: () => undefined,
    dismiss: () => undefined,
  })),
  versionAwareToolbarSlots: vi.fn(() => undefined),
}));

vi.mock("../EntrySystemHeader", () => ({ EntrySystemHeader: () => null }));
vi.mock("@admin/hooks/useReadOnlyForReader", () => ({
  useReadOnlyForReader: () => hooks.readOnlyForReader,
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
} as never;

/** The options the editor last handed `mock`. */
const lastOptions = (mock: { mock: { calls: unknown[][] } }) => {
  const call = mock.mock.calls.at(-1);
  expect(call).toBeDefined();
  return call!;
};

function renderAs(readOnlyForReader: boolean) {
  hooks.readOnlyForReader = readOnlyForReader;
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
});
