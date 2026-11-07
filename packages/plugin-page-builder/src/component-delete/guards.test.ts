/**
 * The component guards on a store whose ids are numbers: the delete action's
 * own delete is let through, and an unpublish is judged, rather than either
 * being read as naming no component.
 */
import { describe, expect, it } from "vitest";

import { registerComponentGuards } from "./guards";
import { COMPONENT_DELETE_CONTEXT_KEY } from "./job";

/** The guards as registered, by hook phase. */
function guards(runPhase: string, unused = true) {
  const handlers = new Map<string, (context: unknown) => unknown>();
  const asked: string[] = [];
  registerComponentGuards({
    ctx: {
      hooks: {
        on: (type, _collection, handler) => handlers.set(type, handler),
      },
    },
    components: "components",
    runs: () => ({
      runFor: async (componentId: string) => {
        asked.push(componentId);
        return {
          id: "run-1",
          componentId,
          purpose: "delete" as const,
          startedBy: "user:1",
          phase: runPhase as "deleting",
          cursor: null,
        };
      },
    }),
    confirmUnused: async () =>
      unused ? { kind: "unused" as const } : { kind: "unsure" as const },
  });
  return { handlers, asked };
}

describe("the component guards with numeric ids", () => {
  it("lets the delete action's own delete through for a numeric id", async () => {
    const { handlers, asked } = guards("deleting");

    await expect(
      handlers.get("beforeDelete")?.({
        data: { id: 7 },
        context: { [COMPONENT_DELETE_CONTEXT_KEY]: "run-1" },
      })
    ).resolves.toBeUndefined();
    expect(asked).toEqual(["7"]);
  });

  it("judges an unpublish of a numeric id rather than letting it through unread", async () => {
    const { handlers } = guards("deleting", false);

    await expect(
      handlers.get("beforeChange")?.({
        operation: "update",
        originalData: { id: 7, status: "published" },
        data: { status: "draft" },
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

/**
 * A store that keeps its status per language: core names the status stored in
 * the language the write names as `storedStatus`, and the guard judges the
 * unpublish from that rather than from the main row's.
 */
describe("the unpublish guard on a store that keeps its status per language", () => {
  const save = (storedStatus: unknown, mainStatus: string) => ({
    operation: "update",
    originalData: { id: 7, status: mainStatus },
    storedStatus,
    data: { status: "draft" },
  });

  it("judges a published translation saved as a draft while the main row is a draft", async () => {
    const { handlers } = guards("idle", false);

    await expect(
      handlers.get("beforeChange")?.(save("published", "draft"))
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("lets a draft translation's draft save through while the main row is published", async () => {
    const { handlers } = guards("idle", false);

    await expect(
      handlers.get("beforeChange")?.(save("draft", "published"))
    ).resolves.toBeUndefined();
  });

  it("runs the check when the language's status cannot be read", async () => {
    const { handlers } = guards("idle", false);

    await expect(
      handlers.get("beforeChange")?.(save(1, "draft"))
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
