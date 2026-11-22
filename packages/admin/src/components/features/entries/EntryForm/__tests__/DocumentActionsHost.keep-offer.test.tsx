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
  const asked: { stillWanted: () => boolean } = { stillWanted: () => true };
  const restoreChecked = vi.fn(
    (stillWanted: () => boolean) =>
      new Promise<KeepOutcome>(resolve => {
        asked.stillWanted = stillWanted;
        answer = resolve;
      })
  );
  const offer: PendingRecovery = { restoreChecked, dismiss: vi.fn() };
  return { offer, asked, answer: (outcome: KeepOutcome) => answer(outcome) };
}

const onSaveWorkingDraft = vi.fn(async () => ({
  ok: true as const,
  item: { id: "e1" },
}));

function renderHost(offer: PendingRecovery, locale: string) {
  const probe: { hosted: DocumentActionBindings | null } = { hosted: null };
  function Surface(): ReactElement | null {
    probe.hosted = useHostedDocumentActions();
    // A view that makes the offer in its own chip.
    useOfferPendingRecovery(offer);
    useSaveChipDrawn();
    return null;
  }
  const input = (
    inLocale: string,
    isDirty = false
  ): DocumentActionBindingsInput => ({
    mode: "edit",
    hasStatus: true,
    draftsEnabled: true,
    entry: published,
    collectionSlug: "pages",
    locale: inLocale,
    isDirty,
    onSaveWorkingDraft,
  });
  const view = render(
    <DocumentActionsHost input={input(locale)}>
      <Surface />
    </DocumentActionsHost>
  );
  const switchTo = (next: string, isDirty = false) =>
    view.rerender(
      <DocumentActionsHost input={input(next, isDirty)}>
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

  it("writes nothing into the page now on screen once the page has changed", async () => {
    const { offer, asked, answer } = answeredLater();
    const { probe, switchTo } = renderHost(offer, "en");

    let saved: Promise<unknown> = Promise.resolve();
    act(() => {
      saved = probe.hosted?.run("save") ?? Promise.resolve();
    });
    expect(asked.stillWanted()).toBe(true);
    switchTo("fr");

    // Asked just before the restore writes: no longer wanted here.
    expect(asked.stillWanted()).toBe(false);
    await act(async () => {
      answer("edited");
      await saved;
    });
    expect(onSaveWorkingDraft).not.toHaveBeenCalled();
  });

  it("saves an edit made while the check failed, and reports no failure over it", async () => {
    const { offer, answer } = answeredLater();
    const { probe, switchTo } = renderHost(offer, "en");

    let saved: Promise<unknown> = Promise.resolve();
    act(() => {
      saved = probe.hosted?.run("save") ?? Promise.resolve();
    });
    // The author edits while the point is checked, and the read fails.
    switchTo("en", true);
    await act(async () => {
      answer("unchecked");
      await saved;
    });

    expect(onSaveWorkingDraft).toHaveBeenCalledTimes(1);
    expect(probe.hosted?.saveState.kind).not.toBe("failed");
  });
});
