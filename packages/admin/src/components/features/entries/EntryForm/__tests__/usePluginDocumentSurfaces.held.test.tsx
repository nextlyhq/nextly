/**
 * Running Delete or Unpublish before the admin knows what the collection's
 * plugins change refuses it in the words its row shows: loading while the
 * plugin list is on its way or asked for again, failed (naming the action)
 * once it never arrived. The property separating this from a broken hold is
 * that the built-in write never runs in either state.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { act, createTestQueryClient, render } from "@admin/__tests__/utils";

const { status } = vi.hoisted(() => ({
  status: {
    current: {
      isPending: false,
      isUnavailable: false,
      isBrandingUnavailable: false,
    },
  },
}));

vi.mock("@admin/context/providers/BrandingProvider", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/context/providers/BrandingProvider")
  >()),
  useBranding: () => ({ plugins: [] }),
  useBrandingStatus: () => ({ ...status.current, retry: () => {} }),
}));
vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));

import {
  DocumentActionsHost,
  useHostedDocumentActions,
} from "../DocumentActionsContext";
import type { DocumentActionBindings } from "../useDocumentActionBindings";
import { usePluginDocumentSurfaces } from "../usePluginDocumentSurfaces";

const LOADING = "Loading this collection's plugin actions…";
const failed = (label: string) =>
  `Couldn't load this collection's plugin actions, so ${label} is paused.`;

/** The editor's actions with the overrides the surfaces hook gives them. */
function renderHost(onDelete: () => Promise<{ ok: true }>) {
  const runner: { run?: DocumentActionBindings["run"] } = {};
  function Surface(): null {
    runner.run = useHostedDocumentActions().run;
    return null;
  }
  function Harness(): ReactElement {
    const surfaces = usePluginDocumentSurfaces({
      collectionSlug: "layouts",
      entryId: "l1",
      documentLock: { readOnly: false, actionsDisabled: false },
      mayWrite: () => true,
      onDeleted: undefined,
    });
    return (
      <DocumentActionsHost
        input={{
          mode: "edit",
          hasStatus: true,
          entry: { id: "l1", title: "Site", status: "published" },
          collectionSlug: "layouts",
          onDelete,
          onUnpublish: () =>
            Promise.resolve({ ok: true as const, item: { id: "l1" } }),
          actionOverrides: surfaces.actionOverrides,
        }}
      >
        <Surface />
      </DocumentActionsHost>
    );
  }
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <Harness />
    </QueryClientProvider>
  );
  return runner;
}

async function runOf(
  runner: { run?: DocumentActionBindings["run"] },
  id: string
): Promise<unknown> {
  let outcome: unknown;
  await act(async () => {
    outcome = await runner.run!(id);
  });
  return outcome;
}

beforeEach(() => {
  status.current = {
    isPending: false,
    isUnavailable: false,
    isBrandingUnavailable: false,
  };
});

describe("running an overridable action before the plugin list is known", () => {
  it("refuses as loading while it loads, or is asked for again", async () => {
    // A Retry reads as pending again, as on first load: one state.
    status.current = { ...status.current, isPending: true };
    const onDelete = vi.fn(() => Promise.resolve({ ok: true as const }));
    const runner = renderHost(onDelete);
    for (const id of ["delete", "unpublish"]) {
      expect(await runOf(runner, id)).toEqual({
        ok: false,
        reason: "refused",
        message: LOADING,
      });
    }
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("refuses as failed once it never arrived, naming each action", async () => {
    status.current = { ...status.current, isUnavailable: true };
    const onDelete = vi.fn(() => Promise.resolve({ ok: true as const }));
    const runner = renderHost(onDelete);
    expect(await runOf(runner, "delete")).toMatchObject({
      message: failed("Delete"),
    });
    expect(await runOf(runner, "unpublish")).toMatchObject({
      message: failed("Unpublish"),
    });
    expect(onDelete).not.toHaveBeenCalled();
  });
});
