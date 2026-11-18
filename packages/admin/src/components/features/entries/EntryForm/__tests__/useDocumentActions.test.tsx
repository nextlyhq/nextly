/**
 * The document's actions as a plugin's surface sees them.
 *
 * A document view replaces the form body and the header with it, so this is
 * the only way it can offer Save or Publish. What these pin is that it offers
 * exactly what the header would draw — no action the header would not, each
 * with the reason the header would show — rather than a second list that
 * agrees with the header only until one of them changes.
 */
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, it, expect, vi } from "vitest";

import {
  DocumentActionsHost,
  NoDocumentActions,
} from "../DocumentActionsContext";
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

  it("is null inside an editor drawn within another document's, such as a quick create", () => {
    // The surrounding document's actions are not this one's: a field in the
    // modal that ran them would save the document behind the modal.
    const Outer = hostedBy({ onSaveDraft: () => Promise.resolve(saved) });
    const { result } = renderHook(() => useDocumentActions(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <Outer>
          <NoDocumentActions>{children}</NoDocumentActions>
        </Outer>
      ),
    });
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
      "This document is being edited elsewhere"
    );
    expect(find("schedule-publish")?.disabledReason).toBe(
      "This document is being edited elsewhere"
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

  describe("saveWithoutPublishing", () => {
    const published = { id: "e1", title: "Hello", status: "published" };

    it("runs the bar's own Save on a draft, which keeps it a draft", async () => {
      const onSaveDraft = vi.fn(() => Promise.resolve(saved));
      const onPublish = vi.fn(() => Promise.resolve(saved));
      const { result } = renderHook(() => useDocumentActions(), {
        wrapper: hostedBy({ isDirty: true, onSaveDraft, onPublish }),
      });
      let outcome: unknown;
      await act(async () => {
        outcome = await result.current?.saveWithoutPublishing?.();
      });
      expect(outcome).toEqual(expect.objectContaining({ ok: true }));
      expect(onSaveDraft).toHaveBeenCalledTimes(1);
      expect(onPublish).not.toHaveBeenCalled();
    });

    it("stores a working draft on a published page whose collection keeps drafts", async () => {
      // The live page stays as it is: the edits wait in the working draft.
      const onSaveWorkingDraft = vi.fn(() => Promise.resolve(saved));
      const onSaveChanges = vi.fn(() => Promise.resolve(saved));
      const onPublish = vi.fn(() => Promise.resolve(saved));
      const { result } = renderHook(() => useDocumentActions(), {
        wrapper: hostedBy({
          entry: published,
          draftsEnabled: true,
          isDirty: true,
          onSaveWorkingDraft,
          onSaveChanges,
          onPublish,
        }),
      });
      await act(async () => {
        await result.current?.saveWithoutPublishing?.();
      });
      expect(onSaveWorkingDraft).toHaveBeenCalledTimes(1);
      expect(onSaveChanges).not.toHaveBeenCalled();
      expect(onPublish).not.toHaveBeenCalled();
    });

    it("answers stored without saving when the published page holds nothing new", async () => {
      // A refused Publish leaves the save state failed with nothing edited;
      // the stored draft already is the work, so a preview may open on it.
      const onSaveWorkingDraft = vi.fn(() => Promise.resolve(saved));
      const { result } = renderHook(() => useDocumentActions(), {
        wrapper: hostedBy({
          entry: published,
          draftsEnabled: true,
          isDirty: false,
          onSaveWorkingDraft,
          onPublish: () => Promise.resolve(saved),
        }),
      });
      let outcome: unknown;
      await act(async () => {
        outcome = await result.current?.saveWithoutPublishing?.();
      });
      expect(outcome).toEqual({ ok: true });
      expect(onSaveWorkingDraft).not.toHaveBeenCalled();
    });

    it("refuses while a colleague holds a published page with edits, saving nothing", async () => {
      // Any refusal but "nothing has changed" leaves work unstored.
      const onSaveWorkingDraft = vi.fn(() => Promise.resolve(saved));
      const { result } = renderHook(() => useDocumentActions(), {
        wrapper: hostedBy({
          entry: published,
          draftsEnabled: true,
          isDirty: true,
          documentLocked: true,
          onSaveWorkingDraft,
        }),
      });
      let outcome: unknown;
      await act(async () => {
        outcome = await result.current?.saveWithoutPublishing?.();
      });
      expect(outcome).toEqual(
        expect.objectContaining({
          ok: false,
          message: "This document is being edited elsewhere",
        })
      );
      expect(onSaveWorkingDraft).not.toHaveBeenCalled();
    });

    it("is absent on a published page whose collection keeps no drafts, where Save would publish", () => {
      // Save there writes the live page; a preview must never publish.
      const { result } = renderHook(() => useDocumentActions(), {
        wrapper: hostedBy({
          entry: published,
          draftsEnabled: false,
          isDirty: true,
          onSaveChanges: () => Promise.resolve(saved),
          onPublish: () => Promise.resolve(saved),
        }),
      });
      expect(result.current?.actions.map(action => action.id)).toContain(
        "save"
      );
      expect(result.current?.saveWithoutPublishing).toBeUndefined();
    });

    it("is absent for someone who may not change the document", () => {
      const { result } = renderHook(() => useDocumentActions(), {
        wrapper: hostedBy({
          canEdit: false,
          isDirty: true,
          onSaveDraft: () => Promise.resolve(saved),
        }),
      });
      expect(result.current?.saveWithoutPublishing).toBeUndefined();
    });

    it("is absent where the collection has no draft to keep", () => {
      const { result } = renderHook(() => useDocumentActions(), {
        wrapper: hostedBy({
          hasStatus: false,
          isDirty: true,
          onSubmit: () => Promise.resolve(saved),
        }),
      });
      expect(result.current?.saveWithoutPublishing).toBeUndefined();
    });

    it("refuses as Save does while a colleague holds the document, saving nothing", async () => {
      const onSaveDraft = vi.fn(() => Promise.resolve(saved));
      const { result } = renderHook(() => useDocumentActions(), {
        wrapper: hostedBy({ documentLocked: true, isDirty: true, onSaveDraft }),
      });
      let outcome: unknown;
      await act(async () => {
        outcome = await result.current?.saveWithoutPublishing?.();
      });
      expect(outcome).toEqual(
        expect.objectContaining({
          ok: false,
          message: "This document is being edited elsewhere",
        })
      );
      expect(onSaveDraft).not.toHaveBeenCalled();
    });
  });
});
