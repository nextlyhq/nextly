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
  BeforeDocumentAction,
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
  before?: BeforeDocumentAction
) {
  const probe: Probe = {
    run: () => Promise.reject(new Error("not rendered")),
    bindings: {},
    track: () => {},
  };
  function Editor(): null {
    useBeforeDocumentAction((action, store) => before?.(action, store));
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
      // Stopped before any write, so nothing else says why.
      beforeWrite: true,
    });
    expect(onSaveDraft).not.toHaveBeenCalled();
  });

  it("cancels, storing nothing, when an editor's question is answered no", async () => {
    // An AbortError is a "no" to a question the editor asked, not a failure,
    // so the outcome is the one a dismissed confirmation has.
    const onPublish = vi.fn(() => Promise.resolve(saved));
    const probe = renderHost({ onPublish }, () => {
      throw new DOMException("Publishing was cancelled.", "AbortError");
    });

    await expect(runAction(probe, "publish")).resolves.toEqual({
      ok: false,
      reason: "cancelled",
      message: "Cancelled.",
    });
    expect(onPublish).not.toHaveBeenCalled();
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

  it("also waits for a write that starts while it is waiting", async () => {
    const onSaveDraft = vi.fn(() => Promise.resolve(saved));
    const probe = renderHost({ onSaveDraft });
    const first = deferred();
    const second = deferred();
    act(() => {
      probe.track("Site colours", first.promise);
    });

    let outcome: Promise<unknown> = Promise.resolve();
    act(() => {
      outcome = probe.run("save");
    });
    // The save is now waiting for the first change; a second starts.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    act(() => {
      probe.track("Site fonts", second.promise);
    });
    // The first lands, and the save is given every chance to go on.
    await act(async () => {
      first.resolve();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(onSaveDraft).not.toHaveBeenCalled();

    second.resolve();
    await act(async () => {
      await expect(outcome).resolves.toEqual(saved);
    });
    expect(onSaveDraft).toHaveBeenCalledTimes(1);
  });

  it("refuses, rather than waiting forever, while writes keep starting", async () => {
    const onSaveDraft = vi.fn(() => Promise.resolve(saved));
    const probe = renderHost({ onSaveDraft });
    // Each write, as it lands, is followed by another: twenty of them, far
    // more rounds than a store waits through, so the stream outlasts it.
    let left = 20;
    function keepWriting(): Promise<void> {
      return Promise.resolve().then(() => {
        left -= 1;
        if (left > 0) probe.track("Site colours", keepWriting());
      });
    }
    act(() => {
      probe.track("Site colours", keepWriting());
    });

    const outcome = await runAction(probe, "save");

    expect(onSaveDraft).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      ok: false,
      reason: "busy",
      message:
        "Changes on this page are still being saved. Try again in a moment.",
      beforeWrite: true,
    });
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
      beforeWrite: true,
    });
  });

  it("tells an editor's handler a tracked write failed, so it can hold off acting", async () => {
    // A handler that acts on the server for the store, as publishing the
    // parts a page needs does, asks first and must not act for a store that
    // will be refused.
    const onPublish = vi.fn(() => Promise.resolve(saved));
    const answers: boolean[] = [];
    const probe = renderHost({ onPublish }, async (_action, store) => {
      answers.push(await store.writesSettled());
    });
    const write = deferred();
    act(() => {
      probe.track("Site colours", write.promise);
    });
    await act(async () => {
      write.reject(new Error("The server is unreachable."));
      await write.promise.catch(() => {});
    });

    const outcome = await runAction(probe, "publish");

    expect(answers).toEqual([false]);
    expect(onPublish).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ ok: false, reason: "refused" });
  });

  it("tells it the writes landed once they have", async () => {
    const onPublish = vi.fn(() => Promise.resolve(saved));
    const answers: boolean[] = [];
    const probe = renderHost({ onPublish }, async (_action, store) => {
      answers.push(await store.writesSettled());
    });
    const write = deferred();
    act(() => {
      probe.track("Site colours", write.promise);
    });
    let outcome: Promise<unknown> = Promise.resolve();
    act(() => {
      outcome = probe.run("publish");
    });
    await act(async () => {
      write.resolve();
      await outcome;
    });
    expect(answers).toEqual([true]);
    expect(onPublish).toHaveBeenCalledTimes(1);
  });

  it("keeps the refusal it gave a handler, though the write lands before the store", async () => {
    // Told no, the handler did not act; the store must not go ahead because
    // the write was retried, and landed, before the store asked again.
    const onPublish = vi.fn(() => Promise.resolve(saved));
    // Called only once rendered, so the handler reads `probe` assigned.
    const probe: Probe = renderHost({ onPublish }, async (_action, store) => {
      if (await store.writesSettled()) return;
      const retried = Promise.resolve();
      probe.track("Site colours", retried);
      await retried;
    });
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
      beforeWrite: true,
    });
  });

  it("refuses a second store started while the first readies, and stores once", async () => {
    // Run twice before the first renders its control busy: the second would
    // ask the handlers again over the first's question, and store twice.
    const onPublish = vi.fn(() => Promise.resolve(saved));
    const asked = deferred();
    const before = vi.fn(() => asked.promise);
    const probe = renderHost({ onPublish }, before);

    let first: Promise<unknown> = Promise.resolve();
    let second: Promise<unknown> = Promise.resolve();
    act(() => {
      first = probe.run("publish");
      second = probe.run("publish");
    });
    await act(async () => {
      asked.resolve();
      await Promise.all([first, second]);
    });

    await expect(second).resolves.toMatchObject({
      ok: false,
      reason: "busy",
    });
    await expect(first).resolves.toEqual(saved);
    expect(before).toHaveBeenCalledTimes(1);
    expect(onPublish).toHaveBeenCalledTimes(1);
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
