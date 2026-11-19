/**
 * "Approve all languages": each part waiting for the reviewer's approval is
 * listed with its changes, approved in one step for the versions shown; a
 * part that moved meanwhile refuses the step and is shown again; the parts it
 * leaves are named.
 */
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor, within } from "@admin/__tests__/utils";
import type { VersionMeta } from "@admin/services/versionApi";
import type { PartReview, ReviewStep } from "@admin/types/workflows";

const { stepSpy, toastSpy, versionsMock } = vi.hoisted(() => ({
  stepSpy: vi.fn(),
  toastSpy: { success: vi.fn(), error: vi.fn() },
  versionsMock: vi.fn(),
}));

vi.mock("@admin/services/workflowApi", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/services/workflowApi")>()),
  takeWorkflowStep: stepSpy,
}));
vi.mock("@admin/components/ui", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/components/ui")>()),
  toast: toastSpy,
}));
vi.mock("@admin/hooks/queries/useVersions", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/queries/useVersions")
  >()),
  useVersions: (...args: unknown[]) => versionsMock(...args),
}));
vi.mock("@admin/components/features/versions/diff/VersionDiffView", () => ({
  VersionDiffView: ({ from, to }: { from: number; to: number }) => (
    <p>
      comparing {from} with {to}
    </p>
  ),
}));
const LABELS: Record<string, string> = {
  en: "English",
  es: "Spanish",
  ar: "Arabic",
};
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({
    getLocale: (code: string | undefined) =>
      code === undefined || LABELS[code] === undefined
        ? undefined
        : { code, label: LABELS[code] },
  }),
}));

import { ReviewChanges } from "../ReviewChanges";

const SCOPE = { kind: "collection", slug: "posts", entryId: "e1" } as const;

function version(versionNo: number, status = "draft"): VersionMeta {
  return {
    id: `v${versionNo}`,
    versionNo,
    status,
    isAutosave: false,
    label: null,
    locale: null,
    sourceVersionNo: null,
    createdBy: null,
    author: null,
    createdAt: "2026-11-19T09:00:00.000Z",
    updatedAt: "2026-11-19T09:00:00.000Z",
  };
}

/** Each part's versions, newest first: a language's own, or the document's for the shared part. */
let versions: Record<string, VersionMeta[]> = {};

function approveStep(mayTake = true): ReviewStep {
  return {
    name: "approve",
    label: "Approve",
    kind: "approve",
    to: "approved",
    mayTake,
    primary: true,
    commentRequired: false,
  };
}

function inReview(
  part: string | null,
  over: Partial<PartReview> = {}
): PartReview {
  return {
    part,
    stage: "inReview",
    stageLabel: "In review",
    publishable: false,
    enteredAt: null,
    enteredBy: null,
    assignee: null,
    dueAt: null,
    approval: null,
    revision: 3,
    version: `t-${part ?? "shared"}`,
    steps: [approveStep()],
    waitingFor: null,
    lastMove: null,
    ...over,
  };
}

const approved = (part: string): PartReview =>
  inReview(part, {
    stage: "approved",
    stageLabel: "Approved",
    publishable: true,
    steps: [],
  });

function stale(parts: (string | null)[]): Error {
  return Object.assign(new Error("The resource has changed."), {
    status: 409,
    code: "CONFLICT",
    data: { reason: "stale", parts },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  versions = {
    en: [version(7), version(5, "published")],
    es: [version(9), version(6, "published")],
    shared: [version(4), version(2, "published")],
  };
  versionsMock.mockImplementation(({ locale }: { locale?: string }) => ({
    data: { pages: [{ items: versions[locale ?? "shared"], meta: {} }] },
    isError: false,
  }));
});

async function openDialog(
  parts: PartReview[]
): Promise<{ dialog: HTMLElement; rerender: (next: PartReview[]) => void }> {
  const view = render(
    <ReviewChanges scope={SCOPE} parts={parts.slice(0, 1)} allParts={parts} />
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Approve all languages…" })
  );
  return {
    dialog: await screen.findByRole("dialog", {
      name: "Approve all languages",
    }),
    rerender: next =>
      view.rerender(
        <ReviewChanges scope={SCOPE} parts={next.slice(0, 1)} allParts={next} />
      ),
  };
}

describe("Approve all languages", () => {
  it("lists each waiting part with its changes, collapsed, and names the parts left out", async () => {
    const { dialog } = await openDialog([
      inReview("en"),
      inReview(null),
      inReview("es"),
      approved("ar"),
    ]);

    const list = within(dialog).getByRole("list", { name: "Parts to approve" });
    const rows = within(list).getAllByRole("button");
    expect(rows.map(row => row.textContent)).toEqual([
      "EnglishChanges since the published version.",
      "Shared fieldsChanges since the published version.",
      "SpanishChanges since the published version.",
    ]);
    // Collapsed until opened, one part at a time.
    expect(within(dialog).queryByText(/^comparing/)).not.toBeInTheDocument();
    await userEvent.click(
      within(list).getByRole("button", { name: /Spanish/ })
    );
    expect(within(dialog).getByText("comparing 6 with 9")).toBeInTheDocument();
    expect(within(dialog).queryByText("comparing 5 with 7")).toBeNull();

    expect(dialog).toHaveTextContent("Arabic is already approved");
  });

  it("approves every listed part in one step, with what each showed, and names the parts it left", async () => {
    stepSpy.mockResolvedValue({
      message: "Step taken.",
      item: {
        step: "approve",
        moved: [],
        left: [{ part: "ar", stage: "approved", reason: "not-from-stage" }],
      },
    });
    const { dialog } = await openDialog([
      inReview("en", { revision: 5, version: "t-en-5" }),
      inReview(null),
      inReview("es"),
      approved("ar"),
    ]);

    await userEvent.click(
      within(dialog).getByRole("button", {
        name: "Approve English, shared fields and Spanish",
      })
    );

    await waitFor(() => expect(stepSpy).toHaveBeenCalledTimes(1));
    expect(stepSpy).toHaveBeenCalledWith({
      document: { collection: "posts", id: "e1" },
      step: "approve",
      // Every part the approval leaves from is listed, so the server names
      // the rest.
      parts: "all",
      seen: [
        { part: "en", revision: 5, version: "t-en-5" },
        { part: null, revision: 3, version: "t-shared" },
        { part: "es", revision: 3, version: "t-es" },
      ],
    });
    await waitFor(() =>
      expect(toastSpy.success).toHaveBeenCalledWith(
        "Approved English, shared fields and Spanish, each for the version you saw. Arabic is already approved."
      )
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Approve all languages" })
      ).not.toBeInTheDocument()
    );
  });

  it("names only its own parts where a part in review is not this person's to approve", async () => {
    stepSpy.mockResolvedValue({ message: "Step taken.", item: { left: [] } });
    const { dialog } = await openDialog([
      inReview("en"),
      inReview("es"),
      inReview("ar", { steps: [approveStep(false)] }),
    ]);

    expect(dialog).toHaveTextContent("Arabic is not yours to approve");
    await userEvent.click(
      within(dialog).getByRole("button", {
        name: "Approve English and Spanish",
      })
    );

    await waitFor(() =>
      expect(stepSpy).toHaveBeenCalledWith(
        expect.objectContaining({ parts: ["en", "es"] })
      )
    );
  });

  it("refuses a part that changed while the reviewer looked, and shows its changes again", async () => {
    stepSpy.mockRejectedValueOnce(stale(["en"]));
    const { dialog, rerender } = await openDialog([
      inReview("en"),
      inReview("es"),
    ]);

    await userEvent.click(
      within(dialog).getByRole("button", {
        name: "Approve English and Spanish",
      })
    );

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "English changed while you looked, so nothing was approved."
    );
    expect(toastSpy.success).not.toHaveBeenCalled();

    // The review state, read again, holds English's new version: the dialog
    // stays open over it, and approving again sends what it now shows.
    versions.en = [version(8), version(7), version(5, "published")];
    rerender([
      inReview("en", { revision: 4, version: "t-en-8" }),
      inReview("es"),
    ]);
    const reopened = screen.getByRole("dialog", {
      name: "Approve all languages",
    });
    expect(reopened).toHaveTextContent(
      "EnglishChanges since the published version."
    );
    await userEvent.click(
      within(
        within(reopened).getByRole("list", { name: "Parts to approve" })
      ).getByRole("button", { name: /English/ })
    );
    expect(within(reopened).getByText("comparing 5 with 8")).toBeVisible();

    stepSpy.mockResolvedValueOnce({ message: "Step taken.", item: {} });
    await userEvent.click(
      within(reopened).getByRole("button", {
        name: "Approve English and Spanish",
      })
    );
    await waitFor(() => expect(stepSpy).toHaveBeenCalledTimes(2));
    expect(stepSpy.mock.calls[1]?.[0]).toMatchObject({
      seen: [
        { part: "en", revision: 4, version: "t-en-8" },
        { part: "es", revision: 3, version: "t-es" },
      ],
    });
  });

  it("says in the dialog why the approval was refused, and who could approve", async () => {
    stepSpy.mockRejectedValueOnce(
      Object.assign(
        new Error("You don't have permission to perform this action."),
        {
          status: 403,
          code: "FORBIDDEN",
          data: {
            reason: "field-hidden",
            fields: ["price"],
            approvers: [{ kind: "user", id: "u-rita", name: "Rita" }],
          },
        }
      )
    );
    const { dialog } = await openDialog([inReview("en"), inReview("es")]);

    await userEvent.click(
      within(dialog).getByRole("button", {
        name: "Approve English and Spanish",
      })
    );

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "You can't approve this: it changes a field you can't read (price). It can be approved by Rita."
    );
  });
});
