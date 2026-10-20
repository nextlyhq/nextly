/**
 * What a storing action waits for before it stores.
 *
 * Two things can hold work the save has not got yet: a surface with an edit
 * still open (the page builder's inline text), and a side write the page
 * depends on that is still in flight or failed (a site-wide design change).
 * These pin that Save and Publish commit the first and wait for the second —
 * and refuse, naming the change, when the second failed, rather than storing a
 * page that points at something that never landed — while actions that store
 * none of the editor's work do neither.
 */
import { useState, type ReactElement } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { act, render, screen } from "@admin/__tests__/utils";

import {
  DocumentActionsHost,
  useHostedDocumentActions,
} from "../DocumentActionsContext";
import {
  useBeforeDocumentAction,
  useTrackedWrite,
} from "../useDocumentActionHooks";
import type {
  DocumentActionBindings,
  DocumentActionBindingsInput,
} from "../useDocumentActionBindings";

const { canFor } = vi.hoisted(() => ({
  canFor: vi.fn((_slug: string) => true),
}));
vi.mock("@admin/hooks/useCan", () => ({
  useCan: (slug: string) => canFor(slug),
}));

beforeEach(() => {
  canFor.mockReset();
  canFor.mockImplementation(() => true);
});

const saved = { ok: true as const, item: { id: "e1" } };
const draft = { id: "e1", title: "Hello", status: "draft" };
const published = { id: "e1", title: "Hello", status: "published" };

interface Probe {
  run: DocumentActionBindings["run"];
  bindings: DocumentActionBindings["bindings"];
  track: (label: string, write: Promise<unknown>) => void;
}

/**
 * The host with a surface inside it that registers `before` while it is
 * mounted, can be unmounted, and tracks writes.
 */
function renderHost(
  input: Partial<DocumentActionBindingsInput>,
  before?: (action: string) => void | Promise<void>
) {
  const probe: Probe = {
    run: () => Promise.reject(new Error("not rendered")),
    bindings: {},
    track: () => {},
  };
  function Editor(): null {
    useBeforeDocumentAction(action => before?.(action));
    return null;
  }
  function Surface(): ReactElement {
    const [editing, setEditing] = useState(true);
    const hosted = useHostedDocumentActions();
    probe.run = hosted.run;
    probe.bindings = hosted.bindings;
    probe.track = useTrackedWrite();
    return (
      <>
        {editing ? <Editor /> : null}
        <button type="button" onClick={() => setEditing(false)}>
          Close editor
        </button>
      </>
    );
  }
  render(
    <DocumentActionsHost
      input={{
        mode: "edit",
        hasStatus: true,
        entry: draft,
        collectionSlug: "posts",
        ...input,
      }}
    >
      <Surface />
    </DocumentActionsHost>
  );
  return probe;
}

async function runAction(probe: Probe, id: string): Promise<unknown> {
  let outcome: unknown;
  await act(async () => {
    outcome = await probe.run(id);
  });
  return outcome;
}

/** A write whose settling the test decides. */
function deferred() {
  let resolve: () => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("before a storing action", () => {
  it("commits what an open editor holds first, then saves", async () => {
    const order: string[] = [];
    const probe = renderHost(
      {
        onSaveDraft: () => {
          order.push("save");
          return Promise.resolve(saved);
        },
      },
      action => {
        order.push(`commit before ${action}`);
      }
    );

    await expect(runAction(probe, "save")).resolves.toEqual(saved);
    expect(order).toEqual(["commit before save", "save"]);
  });

  it("waits for an editor whose commit is asynchronous", async () => {
    const order: string[] = [];
    const commit = deferred();
    const probe = renderHost(
      {
        onPublish: () => {
          order.push("publish");
          return Promise.resolve(saved);
        },
      },
      async () => {
        await commit.promise;
        order.push("committed");
      }
    );

    let outcome: Promise<unknown> = Promise.resolve();
    act(() => {
      outcome = probe.run("publish");
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(order).toEqual([]);

    commit.resolve();
    await act(async () => {
      await outcome;
    });
    expect(order).toEqual(["committed", "publish"]);
  });

  it("stores nothing, and says so, when an editor cannot commit", async () => {
    const onSaveDraft = vi.fn(() => Promise.resolve(saved));
    const probe = renderHost({ onSaveDraft }, () => {
      throw new Error("The heading is still being written.");
    });

    await expect(runAction(probe, "save")).resolves.toEqual({
      ok: false,
      reason: "failed",
      message: "The heading is still being written.",
    });
    expect(onSaveDraft).not.toHaveBeenCalled();
  });

  it("no longer asks an editor that has closed", async () => {
    const before = vi.fn();
    const probe = renderHost(
      { onSaveDraft: () => Promise.resolve(saved) },
      before
    );

    await act(async () => {
      screen.getByRole("button", { name: "Close editor" }).click();
    });
    await runAction(probe, "save");

    expect(before).not.toHaveBeenCalled();
  });

  it("holds the save until a tracked write lands", async () => {
    const onSaveDraft = vi.fn(() => Promise.resolve(saved));
    const probe = renderHost({ onSaveDraft });
    const write = deferred();
    act(() => {
      probe.track("Site colours", write.promise);
    });

    let outcome: Promise<unknown> = Promise.resolve();
    act(() => {
      outcome = probe.run("save");
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(onSaveDraft).not.toHaveBeenCalled();

    write.resolve();
    await act(async () => {
      await expect(outcome).resolves.toEqual(saved);
    });
    expect(onSaveDraft).toHaveBeenCalledTimes(1);
  });

  it("refuses to store, naming the change, when a tracked write failed", async () => {
    const onPublish = vi.fn(() => Promise.resolve(saved));
    const probe = renderHost({ onPublish });
    const write = deferred();
    act(() => {
      probe.track("Site colours", write.promise);
    });
    await act(async () => {
      write.reject(new Error("The server is unreachable."));
      await write.promise.catch(() => {});
    });

    const outcome = await runAction(probe, "publish");

    expect(onPublish).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      ok: false,
      reason: "refused",
      message:
        "Site colours wasn't saved, so this page wasn't either: The server is unreachable.",
    });
  });

  it("stores again once the same change is written successfully", async () => {
    const onSaveDraft = vi.fn(() => Promise.resolve(saved));
    const probe = renderHost({ onSaveDraft });
    const first = deferred();
    act(() => {
      probe.track("Site colours", first.promise);
    });
    await act(async () => {
      first.reject(new Error("offline"));
      await first.promise.catch(() => {});
    });
    await act(async () => {
      probe.track("Site colours", Promise.resolve());
      await Promise.resolve();
    });

    await expect(runAction(probe, "save")).resolves.toEqual(saved);
  });
});

describe("which attempt counts", () => {
  it("lets a newer success stand when an older attempt fails after it", async () => {
    const onSaveDraft = vi.fn(() => Promise.resolve(saved));
    const probe = renderHost({ onSaveDraft });
    const older = deferred();
    act(() => {
      probe.track("Site colours", older.promise);
    });
    await act(async () => {
      probe.track("Site colours", Promise.resolve());
      await Promise.resolve();
    });
    await act(async () => {
      older.reject(new Error("timed out"));
      await older.promise.catch(() => {});
    });

    await expect(runAction(probe, "save")).resolves.toEqual(saved);
  });
});

describe("the Save control", () => {
  it("commits and waits exactly as running the action does", async () => {
    const order: string[] = [];
    const write = deferred();
    const probe = renderHost(
      {
        onSaveDraft: () => {
          order.push("save");
          return Promise.resolve(saved);
        },
      },
      () => {
        order.push("commit");
      }
    );
    act(() => {
      probe.track("Site colours", write.promise);
    });

    act(() => {
      probe.bindings.save?.onSelect();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(order).toEqual(["commit"]);

    await act(async () => {
      write.resolve();
      await write.promise;
      await Promise.resolve();
    });
    expect(order).toEqual(["commit", "save"]);
  });
});

describe("an action that stores none of the editor's work", () => {
  it("neither commits the editor nor waits for, or is refused by, a tracked write", async () => {
    const before = vi.fn();
    const onDelete = vi.fn(() => Promise.resolve({ ok: true as const }));
    const probe = renderHost({ entry: published, onDelete }, before);
    const write = deferred();
    act(() => {
      probe.track("Site colours", write.promise);
    });
    await act(async () => {
      write.reject(new Error("offline"));
      await write.promise.catch(() => {});
    });

    await expect(runAction(probe, "delete")).resolves.toEqual({ ok: true });
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(before).not.toHaveBeenCalled();
  });
});
