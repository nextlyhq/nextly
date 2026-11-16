/**
 * A write the document depends on, still on its way, is unsaved work: the
 * form's unsaved-changes guard then asks before the tab is closed or the
 * author navigates away, whichever surface started the write and whether or
 * not it is still mounted. The page builder's site style writes are the case
 * in hand: one released as the builder closes is still on its way after it.
 *
 * @module components/features/entries/EntryForm/__tests__/DocumentActionsHost.tracked-unsaved.test
 */
import { describe, expect, it, vi } from "vitest";

import { act, render, screen } from "@admin/__tests__/utils";

import { DocumentActionsHost } from "../DocumentActionsContext";
import { useTrackedWrite } from "../useDocumentActionHooks";
import { UnsavedWorkProvider, useUnsavedWork } from "../UnsavedWorkContext";

vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));

const draft = { id: "e1", title: "Hello", status: "draft" };

function deferred() {
  let resolve: () => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderForm() {
  const probe = { track: (_label: string, _write: Promise<unknown>) => {} };
  function Surface(): null {
    probe.track = useTrackedWrite();
    return null;
  }
  function Form() {
    const work = useUnsavedWork();
    return (
      <UnsavedWorkProvider report={work.report}>
        <output>{work.anyUnsaved ? "unsaved" : "clean"}</output>
        <DocumentActionsHost
          input={{
            mode: "edit",
            hasStatus: true,
            entry: draft,
            collectionSlug: "posts",
          }}
        >
          <Surface />
        </DocumentActionsHost>
      </UnsavedWorkProvider>
    );
  }
  render(<Form />);
  return probe;
}

const shown = () => screen.getByRole("status").textContent;

describe("a tracked write and unsaved work", () => {
  it("is unsaved work while it is on its way, and not once it lands", async () => {
    const probe = renderForm();
    expect(shown()).toBe("clean");
    const write = deferred();
    act(() => probe.track("A change to the site's variables", write.promise));
    expect(shown()).toBe("unsaved");
    await act(async () => {
      write.resolve();
      await write.promise;
    });
    expect(shown()).toBe("clean");
  });

  it("is no longer unsaved work once it fails, as nothing is left to lose", async () => {
    const probe = renderForm();
    const write = deferred();
    act(() => probe.track("A change to the site's variables", write.promise));
    await act(async () => {
      write.reject(new Error("refused"));
      await write.promise.catch(() => {});
    });
    expect(shown()).toBe("clean");
  });
});
