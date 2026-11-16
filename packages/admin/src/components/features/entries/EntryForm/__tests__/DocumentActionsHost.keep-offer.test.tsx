/**
 * Save keeping changes on offer from a last visit, at the actions host.
 *
 * The answer to a restore arrives after a round trip, and the author may have
 * moved to another document or language meanwhile. That answer is about the
 * one left behind, so it must not be reported, or offered for Retry, on the
 * one on screen now.
 */
import type { ReactElement } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { act, render } from "@admin/__tests__/utils";

import {
  DocumentActionsHost,
  useHostedDocumentActions,
  useOfferPendingRecovery,
  useSaveChipDrawn,
} from "../DocumentActionsContext";
import type {
  DocumentActionBindings,
  DocumentActionBindingsInput,
  KeepOutcome,
  PendingRecovery,
} from "../useDocumentActionBindings";

vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));

const published = { id: "e1", title: "Hello", status: "published" };

/** A checked restore that answers only when told to. */
function answeredLater() {
  let answer: (outcome: KeepOutcome) => void = () => undefined;
  const restoreChecked = vi.fn(
    () =>
      new Promise<KeepOutcome>(resolve => {
        answer = resolve;
      })
  );
  const offer: PendingRecovery = { restoreChecked, dismiss: vi.fn() };
  return { offer, answer: (outcome: KeepOutcome) => answer(outcome) };
}

function renderHost(offer: PendingRecovery, locale: string) {
  const probe: { hosted: DocumentActionBindings | null } = { hosted: null };
  function Surface(): ReactElement | null {
    probe.hosted = useHostedDocumentActions();
    // A view that makes the offer in its own chip.
    useOfferPendingRecovery(offer);
    useSaveChipDrawn();
    return null;
  }
  const input = (inLocale: string): DocumentActionBindingsInput => ({
    mode: "edit",
    hasStatus: true,
    draftsEnabled: true,
    entry: published,
    collectionSlug: "pages",
    locale: inLocale,
    onSaveWorkingDraft: vi.fn(async () => ({
      ok: true as const,
      item: { id: "e1" },
    })),
  });
  const view = render(
    <DocumentActionsHost input={input(locale)}>
      <Surface />
    </DocumentActionsHost>
  );
  const switchTo = (next: string) =>
    view.rerender(
      <DocumentActionsHost input={input(next)}>
        <Surface />
      </DocumentActionsHost>
    );
  return { probe, switchTo };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("a Save keeping changes from a last visit", () => {
  it("says nothing on another language when its answer arrives after the switch", async () => {
    const { offer, answer } = answeredLater();
    const { probe, switchTo } = renderHost(offer, "en");
    expect(probe.hosted?.keepsOffer).toBe(true);

    let saved: Promise<unknown> = Promise.resolve();
    act(() => {
      saved = probe.hosted?.run("save") ?? Promise.resolve();
    });
    switchTo("fr");
    await act(async () => {
      answer("unchecked");
      await saved;
    });

    // Not the English page's failure, and no Retry that would save French.
    expect(probe.hosted?.saveState.kind).not.toBe("failed");
  });

  it("reports the answer on the page it was asked for, which is the control", async () => {
    const { offer, answer } = answeredLater();
    const { probe } = renderHost(offer, "en");

    let saved: Promise<unknown> = Promise.resolve();
    act(() => {
      saved = probe.hosted?.run("save") ?? Promise.resolve();
    });
    await act(async () => {
      answer("unchecked");
      await saved;
    });

    expect(probe.hosted?.saveState).toMatchObject({
      kind: "failed",
      message:
        "Couldn't check your earlier changes, so nothing was saved. Try again.",
    });
  });
});
