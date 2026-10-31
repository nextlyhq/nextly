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

  it("hands an action on the Publish arrow to a view as a menu action", () => {
    // The arrow is the editor's own placement, not one the published
    // contract names: a view handling the published placements must still
    // find the action, where the editor draws it with no arrow, in the menu.
    const { result } = renderHook(() => useDocumentActions(), {
      wrapper: hostedBy({
        onSaveDraft: () => Promise.resolve(saved),
        onPublish: () => Promise.resolve(saved),
        contributedActions: [
          {
            action: {
              id: "schedule-publish",
              label: "Schedule publish…",
              placement: "publish-menu",
            },
            binding: { onSelect: () => undefined },
          },
        ],
      }),
    });
    const schedule = result.current?.actions.find(
      action => action.id === "schedule-publish"
    );
    expect(schedule?.placement).toBe("menu");
    const placements = new Set(
      result.current?.actions.map(action => action.placement)
    );
    expect(
      [...placements].every(each =>
        ["primary", "toolbar", "menu"].includes(each)
      )
    ).toBe(true);
  });

  it("hands a way to publish to a view in the document group, where Add to release always was", () => {
    // A view that draws the published `document` and `danger` groups must
    // still find these: before the arrow, Add to release was a document row.
    const { result } = renderHook(() => useDocumentActions(), {
      wrapper: hostedBy({
        onSaveDraft: () => Promise.resolve(saved),
        onPublish: () => Promise.resolve(saved),
        contributedActions: [
          {
            action: {
              id: "add-to-release",
              label: "Add to release…",
              placement: "publish-menu",
            },
            binding: { onSelect: () => undefined },
          },
        ],
      }),
    });
    const add = result.current?.actions.find(
      action => action.id === "add-to-release"
    );
    expect(add?.placement).toBe("menu");
    expect(add?.group).toBe("document");
  });

  it("holds a way to publish while a colleague holds the document, as Publish is held", () => {
    // Scheduling or adding to a release publishes the document later, so it
    // is a write the lock withholds. Pinning, a menu action that writes
    // nothing of the document's, is the control: it stays usable.
    const { result } = renderHook(() => useDocumentActions(), {
      wrapper: hostedBy({
        documentLocked: true,
        onSaveDraft: () => Promise.resolve(saved),
        onPublish: () => Promise.resolve(saved),
        contributedActions: [
          {
            action: {
              id: "schedule-publish",
              label: "Schedule publish…",
              placement: "publish-menu",
            },
            binding: { onSelect: () => undefined },
          },
          {
            action: {
              id: "pin",
              label: "Pin to dashboard",
              placement: "menu",
              group: "document",
            },
            binding: { onSelect: () => undefined },
          },
        ],
      }),
    });
    const find = (id: string) =>
      result.current?.actions.find(action => action.id === id);
    expect(find("publish")?.disabledReason).toBe(
      "Someone else is editing this document"
    );
    expect(find("schedule-publish")?.disabledReason).toBe(
      "Someone else is editing this document"
    );
    expect(find("pin")?.disabledReason).toBeUndefined();
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
