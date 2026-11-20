/**
 * The document's Save shortcut on a Mac, from inside a field.
 *
 * Command+S is how a Mac author saves, mid-sentence, without leaving the
 * field: the shortcut fires there, runs the document's own Save through the
 * host, and that Save runs every before-action first, so an editor holding
 * work the form does not have yet can write it before the store. Control+S
 * is not the Mac's save. Driven through the real shortcut, the real host and
 * the real before-action hook, on a platform that reads as macOS.
 */
import { ShortcutProvider } from "@nextlyhq/ui";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@admin/__tests__/utils";

import {
  DocumentActionsHost,
  DocumentSaveShortcuts,
} from "../DocumentActionsContext";
import { useBeforeDocumentAction } from "../useDocumentActionHooks";

vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));

const saved = { ok: true as const, item: { id: "e1" } };
const draft = { id: "e1", title: "Hello", status: "draft" };

/** `navigator.platform` decides what `mod` is; restored after each case. */
let restorePlatform: (() => void) | undefined;
beforeEach(() => {
  const original = Object.getOwnPropertyDescriptor(
    window.navigator,
    "platform"
  );
  Object.defineProperty(window.navigator, "platform", {
    value: "MacIntel",
    configurable: true,
  });
  restorePlatform = () => {
    if (original === undefined) {
      Reflect.deleteProperty(window.navigator, "platform");
    } else {
      Object.defineProperty(window.navigator, "platform", original);
    }
  };
});
afterEach(() => {
  restorePlatform?.();
});

/**
 * An editor inside the document: a field, and a before-action that writes
 * what the field holds, as an editor finishing an open edit does.
 */
function renderEditor(
  onSaveDraft: () => Promise<typeof saved>,
  order: string[]
): HTMLElement {
  function Editor(): ReactElement {
    useBeforeDocumentAction(() => {
      order.push("before");
    });
    return <input aria-label="Label" />;
  }
  render(
    <ShortcutProvider>
      <DocumentActionsHost
        input={{
          mode: "edit",
          hasStatus: true,
          entry: draft,
          collectionSlug: "posts",
          onSaveDraft,
        }}
      >
        <DocumentSaveShortcuts hasUnsavedWork isSubmitting={false} />
        <Editor />
      </DocumentActionsHost>
    </ShortcutProvider>
  );
  const field = screen.getByLabelText("Label");
  act(() => field.focus());
  return field;
}

describe("the Save shortcut on a Mac", () => {
  it("Command+S inside a field runs the Save, with the before-actions first", async () => {
    const order: string[] = [];
    const onSaveDraft = vi.fn(() => {
      order.push("save");
      return Promise.resolve(saved);
    });
    const field = renderEditor(onSaveDraft, order);

    fireEvent.keyDown(field, { key: "s", metaKey: true });

    await waitFor(() => expect(onSaveDraft).toHaveBeenCalledTimes(1));
    expect(order).toEqual(["before", "save"]);
  });

  it("Control+S is not the Mac's Save", async () => {
    // The control for the case above: a binding matched on any modifier, or
    // spelled with Control, would pass it.
    const order: string[] = [];
    const onSaveDraft = vi.fn(() => Promise.resolve(saved));
    const field = renderEditor(onSaveDraft, order);

    fireEvent.keyDown(field, { key: "s", ctrlKey: true });

    await act(async () => {
      await Promise.resolve();
    });
    expect(onSaveDraft).not.toHaveBeenCalled();
    expect(order).toEqual([]);
  });
});
