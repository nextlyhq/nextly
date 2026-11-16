/**
 * Where a Single has autosave off, its editor makes no recovery point request
 * and shows no recording status. The server refuses a recording there, so an
 * editor that recorded anyway turned every editing session into a stream of
 * refused requests.
 *
 * Driven through the editor's REAL recording hooks: only the network layer and
 * the document bar are stubbed, so what is asserted is what would leave the
 * browser and what the bar is told, not the options one hook hands another.
 */
import { act, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { render } from "@admin/__tests__/utils";

const { saveAutosave, getAutosave, barProps } = vi.hoisted(() => ({
  saveAutosave: vi.fn(),
  getAutosave: vi.fn(),
  barProps: vi.fn(),
}));

// The bar is where the recording status is drawn; its props say whether it
// is told to draw one.
vi.mock("@admin/components/features/entries/EntryForm/DocumentBar", () => ({
  DocumentBar: (props: { autosaveEnabled?: boolean }) => {
    barProps(props);
    return null;
  },
}));
// The two recovery point requests, observed; every other call is the real one.
vi.mock("@admin/services/versionApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/versionApi")>();
  return {
    ...actual,
    versionApi: { ...actual.versionApi, saveAutosave, getAutosave },
  };
});

import {
  SingleForm,
  type SingleSchema,
  type SingleDocumentData,
} from "../SingleForm";

const DEBOUNCE = 50;
const document = {
  id: "homepage",
  updatedAt: "2026-01-01T00:00:00.000Z",
  title: "Homepage",
} as unknown as SingleDocumentData;

function schemaWithAutosave(enabled: boolean): SingleSchema {
  return {
    slug: "homepage",
    label: "Homepage",
    fields: [{ type: "text", name: "title", label: "Title" }],
    versions: {
      enabled: true,
      drafts: { enabled: true, autosave: { enabled, intervalMs: DEBOUNCE } },
    },
  } as unknown as SingleSchema;
}

/** Edits the title and lets the recording delay pass several times over. */
async function editTitle(container: HTMLElement): Promise<void> {
  const input = container.querySelector<HTMLInputElement>(
    'input[name="title"]'
  );
  if (!input) throw new Error("the title input did not render");
  fireEvent.change(input, { target: { value: "Changed" } });
  await act(async () => {
    vi.advanceTimersByTime(DEBOUNCE * 10);
    await Promise.resolve();
  });
}

function lastBarProps(): { autosaveEnabled?: boolean } {
  const calls = barProps.mock.calls as unknown as [
    { autosaveEnabled?: boolean },
  ][];
  if (calls.length === 0) throw new Error("the document bar did not render");
  return calls[calls.length - 1][0];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  saveAutosave.mockResolvedValue({
    updatedAt: "2026-11-12T09:00:00.000Z",
    locale: null,
  });
  getAutosave.mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SingleForm with autosave off", () => {
  it("makes no recovery point request and shows no recording status", async () => {
    const { container } = render(
      <SingleForm
        schema={schemaWithAutosave(false)}
        document={document}
        onSubmit={vi.fn()}
      />
    );

    await editTitle(container);

    expect(saveAutosave).not.toHaveBeenCalled();
    expect(getAutosave).not.toHaveBeenCalled();
    expect(lastBarProps().autosaveEnabled).toBe(false);
  });

  it("records and shows its status where autosave is on", async () => {
    // The same editor and edit with autosave on: the case above fails for the
    // setting, not because nothing could record in this setup.
    const { container } = render(
      <SingleForm
        schema={schemaWithAutosave(true)}
        document={document}
        onSubmit={vi.fn()}
      />
    );

    await editTitle(container);

    await waitFor(() => expect(saveAutosave).toHaveBeenCalled());
    expect(getAutosave).toHaveBeenCalled();
    expect(lastBarProps().autosaveEnabled).toBe(true);
  });
});
