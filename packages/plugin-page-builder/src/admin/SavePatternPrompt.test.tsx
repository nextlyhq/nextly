// @vitest-environment jsdom
/**
 * Saving a section from the editor: the page's held component settings are
 * written first, since the saved section keeps the selection's bindings,
 * and nothing is stored when one is refused.
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const save = vi.hoisted(() => vi.fn(async () => ({ warnings: [] })));
vi.mock("./save-pattern-client", () => ({
  useSavePattern: () => ({ save, error: undefined }),
}));
vi.mock("./pattern-library-client", () => ({
  usePatternLibrary: () => ({ categories: [] }),
}));
// The dialog's own fields are its tests'; here only its Save is pressed.
vi.mock("./SavePatternDialog", () => ({
  SavePatternDialog: ({
    onSave,
  }: {
    onSave: (fields: { title: string }) => Promise<boolean>;
  }) => (
    <button type="button" onClick={() => void onSave({ title: "Hero" })}>
      Save section
    </button>
  ),
}));

import { SavePatternPrompt } from "./SavePatternPrompt";

const PAGE: BlockDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [{ id: "h", type: "core/heading", version: 1, props: { text: "Hi" } }],
} as BlockDocument;

afterEach(() => {
  cleanup();
  save.mockClear();
});

async function pressSave(beforeSave: () => Promise<boolean>): Promise<void> {
  render(
    <SavePatternPrompt
      document={PAGE}
      selectedIds={["h"]}
      onClose={() => undefined}
      beforeSave={beforeSave}
    />
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save section" }));
  });
}

describe("saving a section with held component settings", () => {
  it("stores nothing when a held setting is refused", async () => {
    const beforeSave = vi.fn(async () => false);
    await pressSave(beforeSave);
    expect(beforeSave).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });

  it("stores the section once the held settings are written", async () => {
    const beforeSave = vi.fn(async () => true);
    await pressSave(beforeSave);
    expect(beforeSave).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
