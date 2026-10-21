/**
 * The document's actions as a plugin's surface sees them.
 *
 * A document view replaces the form body and the header with it, so this is
 * the only way it can offer Save or Publish. What these pin is that it offers
 * exactly what the header would draw — no action the header would not, each
 * with the reason the header would show — rather than a second list that
 * agrees with the header only until one of them changes.
 */
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, it, expect, vi } from "vitest";

import { DocumentActionsHost } from "../DocumentActionsContext";
import type { DocumentActionBindingsInput } from "../useDocumentActionBindings";
import { useDocumentActions } from "../useDocumentActionHooks";

vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));

const saved = { ok: true as const, item: { id: "e1" } };

function hostedBy(input: Partial<DocumentActionBindingsInput>) {
  return function Host({ children }: { children: ReactNode }) {
    return (
      <DocumentActionsHost
        input={{
          mode: "edit",
          hasStatus: true,
          entry: { id: "e1", title: "Hello", status: "draft" },
          collectionSlug: "posts",
          ...input,
        }}
      >
        {children}
      </DocumentActionsHost>
    );
  };
}

describe("useDocumentActions", () => {
  it("is null outside a document editor", () => {
    const { result } = renderHook(() => useDocumentActions());
    expect(result.current).toBeNull();
  });

  it("offers the actions the header draws, led by the same one", () => {
    const { result } = renderHook(() => useDocumentActions(), {
      wrapper: hostedBy({
        onSaveDraft: () => Promise.resolve(saved),
        onPublish: () => Promise.resolve(saved),
      }),
    });
    const ids = result.current?.actions.map(action => action.id);
    expect(ids).toEqual(expect.arrayContaining(["save", "publish"]));
    expect(result.current?.primary?.id).toBe("publish");
  });

  it("offers no action the editor gave no way to run", () => {
    // Publish is permitted, so the model lists it; this editor wires no
    // Publish, so the header draws none, and neither may a view.
    const { result } = renderHook(() => useDocumentActions(), {
      wrapper: hostedBy({ onSaveDraft: () => Promise.resolve(saved) }),
    });
    expect(result.current?.actions.map(action => action.id)).not.toContain(
      "publish"
    );
  });

  it("carries the reason the header would show for an action that cannot run now", () => {
    const { result } = renderHook(() => useDocumentActions(), {
      wrapper: hostedBy({
        isSubmitting: true,
        onSaveDraft: () => Promise.resolve(saved),
      }),
    });
    const save = result.current?.actions.find(action => action.id === "save");
    expect(save?.disabledReason).toBe("Saving…");
  });
});
