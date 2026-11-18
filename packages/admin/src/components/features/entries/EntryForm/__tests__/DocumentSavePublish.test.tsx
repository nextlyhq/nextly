/**
 * The status-carrying Save and Publish pair, drawn from the real document
 * actions host: what each button reads in each state, that the quiet states
 * stay reachable by keyboard, what is spoken and how, that Save leads alone
 * where Publish isn't offered, and that "Scheduled" comes from the read the
 * scheduled-release banner already sends.
 */
import { ShortcutProvider } from "@nextlyhq/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { act, createTestQueryClient } from "@admin/__tests__/utils";
import { ScheduledReleaseBanner } from "@admin/components/features/releases/ScheduledReleaseBanner";
import type { Release } from "@admin/types/releases";

import {
  DocumentActionsHost,
  useOfferPendingRecovery,
} from "../DocumentActionsContext";
import {
  DocumentSaveAndPublish,
  soonestPublish,
  useDocumentLifeStage,
} from "../DocumentSavePublish";
import {
  RecoveryOfferProvider,
  useRecoveryOfferHost,
  type HostedRecoveryOffer,
} from "../RecoveryOfferContext";
import { useTrackedWrite } from "../useDocumentActionHooks";
import type {
  DocumentActionBindingsInput,
  PendingRecovery,
} from "../useDocumentActionBindings";

const { can, fetchReleases, identity } = vi.hoisted(() => ({
  can: vi.fn((_permission: string) => true),
  fetchReleases: vi.fn(),
  identity: {
    current: null as null | {
      kind: "collection" | "single";
      slug: string;
      documentId?: string;
    },
  },
}));
vi.mock("@admin/hooks/useCan", () => ({
  useCan: (permission: string) => can(permission),
}));
vi.mock("@admin/services/releaseApi", async importOriginal => ({
  ...(await importOriginal<object>()),
  fetchReleases,
}));
vi.mock("../EntryFormContext", async importOriginal => ({
  ...(await importOriginal<object>()),
  useDocumentIdentity: () => identity.current,
}));

const ok = { ok: true as const, item: { id: "p1" } };
const draftPage = { id: "p1", title: "Pricing", status: "draft" };
const livePage = {
  id: "p1",
  title: "Pricing",
  status: "published",
  firstPublishedAt: "2026-11-01T09:00:00Z",
  updatedAt: "2026-11-10T09:00:00Z",
};
const unpublishedPage = {
  ...livePage,
  status: "draft",
};

function Providers({ children }: { children: ReactNode }): ReactElement {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <ShortcutProvider isApple={false}>{children}</ShortcutProvider>
    </QueryClientProvider>
  );
}

let stage: ReturnType<typeof useDocumentLifeStage> = null;
function Stage(): null {
  stage = useDocumentLifeStage();
  return null;
}

function input(
  over: Partial<DocumentActionBindingsInput> = {}
): DocumentActionBindingsInput {
  return {
    mode: "edit",
    hasStatus: true,
    draftsEnabled: true,
    entry: livePage,
    collectionSlug: "pages",
    onSaveDraft: vi.fn(async () => ok),
    onSaveWorkingDraft: vi.fn(async () => ok),
    onSaveChanges: vi.fn(async () => ok),
    onPublish: vi.fn(async () => ok),
    onUnpublish: vi.fn(async () => ok),
    ...over,
  };
}

function drawn(over: Partial<DocumentActionBindingsInput> = {}) {
  const view = render(
    <Providers>
      <DocumentActionsHost input={input(over)}>
        <DocumentSaveAndPublish />
        <Stage />
      </DocumentActionsHost>
    </Providers>
  );
  return {
    ...view,
    redraw: (next: Partial<DocumentActionBindingsInput>) =>
      view.rerender(
        <Providers>
          <DocumentActionsHost input={input({ ...over, ...next })}>
            <DocumentSaveAndPublish />
            <Stage />
          </DocumentActionsHost>
        </Providers>
      ),
  };
}

const saveButton = () =>
  document.querySelector<HTMLButtonElement>('[data-action="save"]');
const publishButton = () =>
  document.querySelector<HTMLButtonElement>('[data-action="publish"]');
const politely = () => screen.getByTestId("document-save-publish-status");
const assertively = () => screen.getByTestId("document-save-publish-failure");

beforeEach(() => {
  can.mockImplementation(() => true);
  fetchReleases.mockResolvedValue({ items: [], meta: {} });
  identity.current = null;
  stage = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Save and Publish say the page's state themselves", () => {
  it("a live page that matches: a quiet ✓ Saved and a quiet Published, the stage Published", () => {
    drawn();
    expect(saveButton()?.textContent).toBe("Saved");
    expect(saveButton()?.getAttribute("aria-disabled")).toBe("true");
    expect(publishButton()?.textContent).toBe("Published");
    expect(publishButton()?.getAttribute("aria-disabled")).toBe("true");
    expect(stage?.label).toBe("Published");
  });

  it("an edit on a live page: Save, and Publish changes; the stage stays Published", () => {
    drawn({ isDirty: true });
    expect(saveButton()?.textContent).toBe("Save");
    expect(saveButton()?.hasAttribute("aria-disabled")).toBe(false);
    expect(publishButton()?.textContent).toBe("Publish changes");
    expect(stage?.label).toBe("Published");
    // One unsaved signal: nothing reads "Unsaved changes", "Modified" or
    // "Changed".
    expect(document.body.textContent).not.toMatch(
      /Unsaved changes|Modified|Changed/
    );
  });

  it("a live page with a saved working draft: ✓ Saved, and Publish changes", () => {
    drawn({ entry: { ...livePage, _isWorkingDraft: true } });
    expect(saveButton()?.textContent).toBe("Saved");
    expect(publishButton()?.textContent).toBe("Publish changes");
    expect(stage?.label).toBe("Published");
  });

  it("a page never published: Publish, the stage Draft", () => {
    drawn({ entry: draftPage });
    expect(publishButton()?.textContent).toBe("Publish");
    expect(stage?.label).toBe("Draft");
  });

  it("a page unpublished since it was live: Publish and Draft, with and without a saved working draft", () => {
    const { redraw } = drawn({ entry: unpublishedPage });
    expect(publishButton()?.textContent).toBe("Publish");
    expect(stage?.label).toBe("Draft");
    redraw({ entry: { ...unpublishedPage, _isWorkingDraft: true } });
    expect(publishButton()?.textContent).toBe("Publish");
    expect(stage?.label).toBe("Draft");
  });

  it("publishes the page's unsaved edits from Publish changes, where the header saves them first", async () => {
    const onPublish = vi.fn(async () => ok);
    drawn({ isDirty: true, onPublish });
    await userEvent.click(publishButton() as HTMLButtonElement);
    await waitFor(() => expect(onPublish).toHaveBeenCalledTimes(1));
  });

  it("does nothing on a press of an inert state", async () => {
    const onPublish = vi.fn(async () => ok);
    const onSaveWorkingDraft = vi.fn(async () => ok);
    drawn({ onPublish, onSaveWorkingDraft });
    await userEvent.click(publishButton() as HTMLButtonElement);
    await userEvent.click(saveButton() as HTMLButtonElement);
    expect(onPublish).not.toHaveBeenCalled();
    expect(onSaveWorkingDraft).not.toHaveBeenCalled();
  });

  it("keeps the other ways to publish and Unpublish on Publish's arrow", async () => {
    drawn();
    await userEvent.click(
      screen.getByRole("button", { name: "More ways to publish" })
    );
    expect(
      await screen.findByRole("menuitem", { name: "Unpublish" })
    ).toBeTruthy();
  });
});

describe("what holds them", () => {
  it("a colleague's lock holds Save and Publish over unsaved work, saying why, and nothing is stored", async () => {
    const onSaveWorkingDraft = vi.fn(async () => ok);
    const onPublish = vi.fn(async () => ok);
    drawn({
      isDirty: true,
      documentLocked: true,
      onSaveWorkingDraft,
      onPublish,
    });
    expect(saveButton()?.textContent).toBe("Save");
    expect(saveButton()?.getAttribute("aria-disabled")).toBe("true");
    expect(saveButton()?.getAttribute("aria-description")).toBe(
      "This document is being edited elsewhere"
    );
    expect(publishButton()?.getAttribute("aria-disabled")).toBe("true");
    await userEvent.click(saveButton() as HTMLButtonElement);
    await userEvent.click(publishButton() as HTMLButtonElement);
    expect(onSaveWorkingDraft).not.toHaveBeenCalled();
    expect(onPublish).not.toHaveBeenCalled();
  });

  it("draws no Save for someone who may not change the page, and nothing claims to save", () => {
    drawn({ entry: draftPage, canEdit: false });
    expect(saveButton()).toBeNull();
    // A reader who may publish still finds Publish.
    expect(publishButton()?.textContent).toBe("Publish");
  });

  it("tries a failed publish of a live page's edits again as Publish ran it", async () => {
    const onPublish = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        reason: "failed",
        message: "Offline.",
      })
      .mockResolvedValue(ok);
    drawn({ isDirty: true, onPublish });
    await userEvent.click(publishButton() as HTMLButtonElement);
    const notice = await screen.findByTestId("document-save-publish-notice");
    expect(within(notice).getByText("Not published")).toBeTruthy();
    await userEvent.click(
      within(notice).getByRole("button", { name: "Retry" })
    );
    await waitFor(() => expect(onPublish).toHaveBeenCalledTimes(2));
  });
});

describe("what the model says along the way", () => {
  function Writes({ write }: { write: Promise<unknown> }): null {
    const track = useTrackedWrite();
    useEffect(() => {
      track("Site colours", write);
    }, [track, write]);
    return null;
  }

  it("a Design write on its way keeps Save at Saving…, and Publish waits for it", async () => {
    let land: () => void = () => undefined;
    const write = new Promise<void>(resolve => {
      land = resolve;
    });
    const onPublish = vi.fn(async () => ok);
    render(
      <Providers>
        <DocumentActionsHost
          input={input({
            entry: { ...livePage, _isWorkingDraft: true },
            onPublish,
          })}
        >
          <Writes write={write} />
          <DocumentSaveAndPublish />
        </DocumentActionsHost>
      </Providers>
    );
    await waitFor(() => expect(saveButton()?.textContent).toBe("Saving…"));
    await userEvent.click(publishButton() as HTMLButtonElement);
    await waitFor(() =>
      expect(publishButton()?.textContent).toBe("Publishing…")
    );
    expect(saveButton()?.textContent).toBe("Saving…");
    expect(onPublish).not.toHaveBeenCalled();
    await act(async () => {
      land();
    });
    await waitFor(() => expect(onPublish).toHaveBeenCalledTimes(1));
  });

  it("says Published politely once a publish lands", async () => {
    const onPublish = vi.fn(async () => ok);
    const { redraw } = drawn({
      entry: { ...livePage, _isWorkingDraft: true },
      onPublish,
    });
    await userEvent.click(publishButton() as HTMLButtonElement);
    await waitFor(() => expect(onPublish).toHaveBeenCalledTimes(1));
    // The editor reads the published row back.
    redraw({ entry: livePage, onPublish });
    await waitFor(() => expect(politely().textContent).toBe("Published"));
  });

  it("an Unpublish under way doesn't read Saving… on Save", () => {
    drawn({ isSubmitting: true });
    expect(saveButton()?.textContent).toBe("Saved");
  });

  it("draws Published and Scheduled quiet, without Publish's fill", () => {
    drawn();
    expect(publishButton()?.className).toContain("text-muted-foreground");
  });

  it("says why a held Publish waits, in its tooltip", async () => {
    drawn({ isDirty: true, documentLocked: true });
    await userEvent.tab();
    await userEvent.tab();
    expect(document.activeElement).toBe(publishButton());
    expect(
      (await screen.findAllByText("This document is being edited elsewhere"))
        .length
    ).toBeGreaterThan(0);
  });

  it("a draft page of a collection without drafts keeps Publish", () => {
    drawn({ draftsEnabled: false, entry: draftPage });
    expect(publishButton()?.textContent).toBe("Publish");
  });

  it("opens the notice again when the same failure comes back after Retry", async () => {
    const onSaveWorkingDraft = vi.fn(async () => ({
      ok: false as const,
      reason: "failed" as const,
      message: "Offline.",
    }));
    drawn({ isDirty: true, onSaveWorkingDraft });
    await userEvent.click(saveButton() as HTMLButtonElement);
    const notice = await screen.findByTestId("document-save-publish-notice");
    await userEvent.click(
      within(notice).getByRole("button", { name: "Retry" })
    );
    await waitFor(() => expect(onSaveWorkingDraft).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByTestId("document-save-publish-notice")
    ).toBeTruthy();
  });
});

describe("Save alone, where Publish isn't offered", () => {
  it("leads alone where the person may not publish", () => {
    can.mockImplementation(permission => !permission.startsWith("publish-"));
    drawn({ isDirty: true });
    expect(publishButton()).toBeNull();
    expect(saveButton()?.textContent).toBe("Save");
  });

  it("leads alone where the collection keeps no drafts", () => {
    drawn({ draftsEnabled: false, isDirty: true });
    expect(publishButton()).toBeNull();
    expect(saveButton()?.textContent).toBe("Save");
  });

  it("keeps the same states alone", () => {
    drawn({ draftsEnabled: false });
    expect(saveButton()?.textContent).toBe("Saved");
    expect(saveButton()?.getAttribute("aria-disabled")).toBe("true");
  });
});

describe("the quiet states, by keyboard", () => {
  it("✓ Saved and Published take focus, and their tooltips say when", async () => {
    drawn();
    await userEvent.tab();
    expect(document.activeElement).toBe(saveButton());
    expect(
      (await screen.findAllByText(/^(Saved .+ ago|Your changes are saved)$/))
        .length
    ).toBeGreaterThan(0);
    await userEvent.tab();
    expect(document.activeElement).toBe(publishButton());
    expect(
      (await screen.findAllByText(/^Live since .+ · the live page matches/))
        .length
    ).toBeGreaterThan(0);
  });

  it("⌘S with nothing to save says so, politely", () => {
    drawn();
    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "s",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
    });
    expect(politely().textContent).toBe("Nothing to save");
    expect(politely().getAttribute("aria-live")).toBe("polite");
  });

  it("⌘S with work to save leaves it to the document's own Save shortcut, saying nothing about nothing", async () => {
    // The editor's Save shortcut (DocumentSaveShortcuts) saves it; that one
    // is drawn by the editor, not here.
    const onSaveWorkingDraft = vi.fn(async () => ok);
    drawn({ isDirty: true, onSaveWorkingDraft });
    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "s",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
    });
    expect(politely().textContent).not.toBe("Nothing to save");
  });
});

describe("what is spoken", () => {
  it("a failed save: Retry save with a warning, said assertively with the reason, and a notice with Retry", async () => {
    const onSaveWorkingDraft = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        reason: "failed",
        message: "The network refused the request.",
      })
      .mockResolvedValue(ok);
    drawn({ isDirty: true, onSaveWorkingDraft });
    await userEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(saveButton()?.textContent).toBe("Retry save"));
    expect(assertively().getAttribute("aria-live")).toBe("assertive");
    expect(assertively().textContent).toBe(
      "Not saved. The network refused the request."
    );
    const notice = await screen.findByTestId("document-save-publish-notice");
    expect(within(notice).getByText("Not saved")).toBeTruthy();
    // The press tries again.
    await userEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(onSaveWorkingDraft).toHaveBeenCalledTimes(2));
  });

  it("a failed publish: Publish's label stays, Save's too, said assertively with the reason, with Retry", async () => {
    const onPublish = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        reason: "failed",
        message: "Offline.",
      })
      .mockResolvedValue(ok);
    drawn({ entry: { ...livePage, _isWorkingDraft: true }, onPublish });
    await userEvent.click(publishButton() as HTMLButtonElement);
    await waitFor(() =>
      expect(assertively().textContent).toBe("Not published. Offline.")
    );
    expect(publishButton()?.textContent).toBe("Publish changes");
    expect(saveButton()?.textContent).toBe("Saved");
    const notice = await screen.findByTestId("document-save-publish-notice");
    await userEvent.click(
      within(notice).getByRole("button", { name: "Retry" })
    );
    await waitFor(() => expect(onPublish).toHaveBeenCalledTimes(2));
  });

  it("Save after a failed publish saves the work, and never tries the publish again", async () => {
    const onPublish = vi.fn(async () => ({
      ok: false as const,
      reason: "failed" as const,
      message: "Offline.",
    }));
    const onSaveWorkingDraft = vi.fn(async () => ok);
    drawn({
      entry: { ...livePage, _isWorkingDraft: true },
      isDirty: true,
      onPublish,
      onSaveWorkingDraft,
    });
    await userEvent.click(publishButton() as HTMLButtonElement);
    await waitFor(() =>
      expect(assertively().textContent).toBe("Not published. Offline.")
    );
    expect(saveButton()?.textContent).toBe("Save");
    await userEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(onSaveWorkingDraft).toHaveBeenCalledTimes(1));
    expect(onPublish).toHaveBeenCalledTimes(1);
  });

  it("says Saving… to nobody, and the settled Saved politely", async () => {
    let finish: (value: typeof ok) => void = () => undefined;
    const onSaveWorkingDraft = vi.fn(
      () =>
        new Promise<typeof ok>(resolve => {
          finish = resolve;
        })
    );
    const { redraw } = drawn({ isDirty: true, onSaveWorkingDraft });
    await userEvent.click(saveButton() as HTMLButtonElement);
    await waitFor(() => expect(saveButton()?.textContent).toBe("Saving…"));
    expect(saveButton()?.getAttribute("aria-busy")).toBe("true");
    expect(politely().textContent).toBe("");
    expect(assertively().textContent).toBe("");
    await act(async () => {
      finish(ok);
    });
    redraw({ isDirty: false, onSaveWorkingDraft });
    await waitFor(() => expect(politely().textContent).toBe("Saved"));
  });

  it("says Publishing… on Publish, not Saving… on Save", async () => {
    let finish: (value: typeof ok) => void = () => undefined;
    const onPublish = vi.fn(
      () =>
        new Promise<typeof ok>(resolve => {
          finish = resolve;
        })
    );
    drawn({ entry: { ...livePage, _isWorkingDraft: true }, onPublish });
    await userEvent.click(publishButton() as HTMLButtonElement);
    await waitFor(() =>
      expect(publishButton()?.textContent).toBe("Publishing…")
    );
    expect(saveButton()?.textContent).toBe("Saved");
    await act(async () => {
      finish(ok);
    });
  });
});

describe("changes from the last visit", () => {
  function Offered({
    pending,
    hosted,
  }: {
    pending: PendingRecovery;
    hosted: HostedRecoveryOffer;
  }): ReactElement {
    useOfferPendingRecovery(pending);
    const { value } = useRecoveryOfferHost(hosted);
    return (
      <RecoveryOfferProvider value={value}>
        <DocumentSaveAndPublish />
      </RecoveryOfferProvider>
    );
  }

  it("enable Save, which says so and offers Save and Discard", async () => {
    const discard = vi.fn();
    const pending: PendingRecovery = {
      restoreChecked: vi.fn(async () => "restored" as const),
      dismiss: vi.fn(),
    };
    const hosted: HostedRecoveryOffer = {
      savedAt: new Date(Date.now() - 60 * 60 * 1000),
      restore: vi.fn(),
      dismiss: vi.fn(),
      discard,
    };
    render(
      <Providers>
        <DocumentActionsHost input={input()}>
          <Offered pending={pending} hosted={hosted} />
        </DocumentActionsHost>
      </Providers>
    );
    await waitFor(() => expect(saveButton()?.textContent).toBe("Save"));
    expect(saveButton()?.hasAttribute("aria-disabled")).toBe(false);
    expect(politely().textContent).toBe(
      "Changes from your last visit aren't saved yet"
    );
    await userEvent.click(saveButton() as HTMLButtonElement);
    expect(
      await screen.findByText("Changes from your last visit aren't saved yet.")
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(discard).toHaveBeenCalledTimes(1);
  });
});

describe("Scheduled", () => {
  const release = (over: Partial<Release>): Release =>
    ({
      id: "r1",
      title: "Launch",
      description: null,
      scheduledAt: "2026-12-03T09:00:00Z",
      timezone: "UTC",
      state: "scheduled",
      memberAction: "publish",
      ...over,
    }) as Release;

  it("reads Scheduled, quiet, and the stage Scheduled, for a page scheduled for its first publication", async () => {
    identity.current = { kind: "collection", slug: "pages", documentId: "p1" };
    fetchReleases.mockResolvedValue({ items: [release({})], meta: {} });
    drawn({ entry: draftPage });
    await waitFor(() => expect(publishButton()?.textContent).toBe("Scheduled"));
    expect(publishButton()?.getAttribute("aria-disabled")).toBe("true");
    expect(stage?.label).toBe("Scheduled");
    expect(stage?.detail).toMatch(/^Goes live /);
  });

  it("asks the scheduled-release banner's own read, so opening sends no request of its own", async () => {
    identity.current = { kind: "collection", slug: "pages", documentId: "p1" };
    // As the editor opens: the banner over the view, and the pair in it.
    render(
      <Providers>
        <ScheduledReleaseBanner
          document={{
            scopeKind: "collection",
            scopeSlug: "pages",
            entryId: "p1",
          }}
          onDefaultLocale
        />
        <DocumentActionsHost input={input()}>
          <DocumentSaveAndPublish />
          <Stage />
        </DocumentActionsHost>
      </Providers>
    );
    await waitFor(() => expect(stage).not.toBeNull());
    await act(async () => {});
    expect(fetchReleases).toHaveBeenCalledTimes(1);
    expect(fetchReleases).toHaveBeenCalledWith({
      containing: {
        scopeKind: "collection",
        scopeSlug: "pages",
        entryId: "p1",
      },
      limit: 200,
    });
  });

  it("asks nothing where the reader may not read releases", async () => {
    identity.current = { kind: "collection", slug: "pages", documentId: "p1" };
    can.mockImplementation(
      permission => permission !== "read-content-releases"
    );
    drawn();
    await act(async () => {});
    expect(fetchReleases).not.toHaveBeenCalled();
    expect(publishButton()?.textContent).toBe("Published");
  });

  it("counts only a scheduled release that publishes the page, the soonest first", () => {
    expect(
      soonestPublish([
        release({ memberAction: "unpublish" }),
        release({ state: "draft" } as Partial<Release>),
        release({ scheduledAt: null }),
      ])
    ).toBeNull();
    expect(
      soonestPublish([
        release({ scheduledAt: "2026-12-05T09:00:00Z" }),
        release({ scheduledAt: "2026-12-03T09:00:00Z" }),
      ])?.at.toISOString()
    ).toBe("2026-12-03T09:00:00.000Z");
  });
});
