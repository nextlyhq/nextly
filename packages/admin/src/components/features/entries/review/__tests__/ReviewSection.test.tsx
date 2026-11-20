/**
 * The side panel's Review section: each part's stage, who it is assigned to
 * (with a way to assign it), when it is due, and its last move.
 */
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor, within } from "@admin/__tests__/utils";
import type { PartReview } from "@admin/types/workflows";

import { ReviewSection } from "../ReviewSection";

const { fetchSpy, assignSpy, stepSpy, held } = vi.hoisted(() => ({
  fetchSpy: vi.fn(),
  assignSpy: vi.fn(),
  stepSpy: vi.fn(),
  held: { slugs: new Set<string>() },
}));

vi.mock("@admin/services/workflowApi", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/services/workflowApi")>()),
  fetchReviewState: fetchSpy,
  assignWorkflowParts: assignSpy,
  takeWorkflowStep: stepSpy,
}));
vi.mock("@admin/hooks/useHasPermission", () => ({
  useHasPermission: () => (slug: string) => held.slugs.has(slug),
}));
vi.mock("@admin/hooks/useCurrentUserId", () => ({
  useCurrentUserId: () => "me",
}));
vi.mock("@admin/hooks/useAdminDateFormatter", () => ({
  useAdminDateFormatter: () => ({
    formatDate: (value: string) => `on ${value.slice(0, 10)}`,
  }),
}));

const post = {
  scopeKind: "collection" as const,
  scopeSlug: "posts",
  entryId: "e1",
};

function part(over: Partial<PartReview> = {}): PartReview {
  return {
    part: null,
    reviewedVersionNo: null,
    stage: "inReview",
    stageLabel: "In review",
    stageColour: null,
    publishable: false,
    enteredAt: null,
    enteredBy: null,
    assignee: null,
    dueAt: null,
    approval: null,
    revision: 4,
    version: "v4",
    steps: [
      {
        name: "approve",
        label: "Approve",
        kind: "approve",
        to: "approved",
        mayTake: true,
        primary: true,
        commentRequired: false,
      },
    ],
    waitingFor: { kind: "roles", roles: [{ id: "r-ed", name: "Editors" }] },
    lastMove: {
      kind: "workflow-submit",
      actor: { kind: "person", id: "alice", name: "Alice" },
      at: "2026-11-17T09:00:00.000Z",
      from: "drafting",
      to: "inReview",
      comment: "Ready for a look",
    },
    ...over,
  };
}

function answer(...parts: PartReview[]) {
  return {
    attached: true,
    review: {
      workflow: { slug: "review", label: "Review" },
      parts,
      mayPublishWithoutReview: false,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Assigning follows the step the server says the person may take.
  held.slugs = new Set();
  assignSpy.mockResolvedValue({ message: "Assigned.", item: {} });
});

describe("ReviewSection", () => {
  it("draws nothing where no workflow is attached", async () => {
    fetchSpy.mockResolvedValue({ attached: false });
    const { container } = render(<ReviewSection document={post} />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("has its announcement region in the page, empty, before any step is taken", async () => {
    // A region left by an earlier case would make this pass on its own.
    document.getElementById("nextly-review-announcer")?.remove();
    fetchSpy.mockResolvedValue(answer(part()));

    render(<ReviewSection document={post} />);
    await screen.findByRole("region", { name: "Review" });

    const region = document.getElementById("nextly-review-announcer");
    expect(region).not.toBeNull();
    expect(region?.getAttribute("aria-live")).toBe("polite");
    expect(region?.textContent).toBe("");
  });

  it("can take focus back from a step dialog, as the place a step leaves the person", async () => {
    fetchSpy.mockResolvedValue(answer(part()));

    render(<ReviewSection document={post} />);
    const section = await screen.findByRole("region", { name: "Review" });

    expect(section).toHaveAttribute("data-review-focus");
    expect(section).toHaveAttribute("tabindex", "-1");
  });

  it("says the stage, who it waits for, and the last move", async () => {
    fetchSpy.mockResolvedValue(answer(part()));
    render(<ReviewSection document={post} />);
    const section = await screen.findByRole("region", { name: "Review" });
    expect(section).toHaveTextContent("In review");
    expect(section).toHaveTextContent("Not assigned, waiting for Editors");
    expect(section).toHaveTextContent("Alice moved it to In review");
    expect(section).toHaveTextContent("“Ready for a look”");
  });

  it("draws the stage as Settings names it: its label on its colour, a stage with none on the neutral swatch", async () => {
    fetchSpy.mockResolvedValue(
      answer(part({ stageLabel: "Waiting for review", stageColour: "#d97706" }))
    );
    render(<ReviewSection document={post} />);
    const section = await screen.findByRole("region", { name: "Review" });
    const shown = within(section).getByText("Waiting for review");
    expect(shown.closest(".bg-warning-surface")).not.toBeNull();
  });

  it("draws a stage with no colour on the neutral swatch, never a guessed one", async () => {
    fetchSpy.mockResolvedValue(answer(part()));
    render(<ReviewSection document={post} />);
    const section = await screen.findByRole("region", { name: "Review" });
    const shown = within(section).getByText("In review", { selector: "span" });
    expect(shown.closest(".bg-muted")).not.toBeNull();
  });

  it("names the assignee and the due date", async () => {
    fetchSpy.mockResolvedValue(
      answer(
        part({
          assignee: { kind: "user", id: "rita" },
          waitingFor: { kind: "user", id: "rita", name: "Rita" },
          dueAt: "2026-11-20T00:00:00.000Z",
        })
      )
    );
    render(<ReviewSection document={post} />);
    const section = await screen.findByRole("region", { name: "Review" });
    expect(section).toHaveTextContent("Assigned to Rita");
    expect(section).toHaveTextContent("Due on 2026-11-20");
  });

  it("assigns the part to the person, sent with the revision they saw", async () => {
    fetchSpy.mockResolvedValue(answer(part()));
    render(<ReviewSection document={post} />);
    const section = await screen.findByRole("region", { name: "Review" });
    await userEvent.click(
      within(section).getByRole("button", { name: "Assign to me" })
    );
    await waitFor(() =>
      expect(assignSpy).toHaveBeenCalledWith([
        {
          document: { collection: "posts", id: "e1" },
          part: null,
          revision: 4,
          assignee: { kind: "user", id: "me" },
        },
      ])
    );
  });

  it("assigns the part to a role it waits for", async () => {
    fetchSpy.mockResolvedValue(answer(part()));
    render(<ReviewSection document={post} />);
    const section = await screen.findByRole("region", { name: "Review" });
    await userEvent.click(
      within(section).getByRole("button", { name: "Assign to Editors" })
    );
    await waitFor(() =>
      expect(assignSpy).toHaveBeenCalledWith([
        expect.objectContaining({ assignee: { kind: "role", id: "r-ed" } }),
      ])
    );
  });

  it("unassigns a part assigned to the person, offering it to no one else", async () => {
    fetchSpy.mockResolvedValue(
      answer(
        part({
          assignee: { kind: "user", id: "me" },
          waitingFor: { kind: "user", id: "me", name: "Me" },
        })
      )
    );
    render(<ReviewSection document={post} />);
    const section = await screen.findByRole("region", { name: "Review" });
    expect(
      within(section).queryByRole("button", { name: "Assign to me" })
    ).not.toBeInTheDocument();
    await userEvent.click(
      within(section).getByRole("button", { name: "Unassign" })
    );
    await waitFor(() =>
      expect(assignSpy).toHaveBeenCalledWith([
        expect.objectContaining({ assignee: null }),
      ])
    );
  });

  it("offers no assigning to a person who may neither edit nor take the stage's step", async () => {
    held.slugs = new Set(["approve-posts"]);
    fetchSpy.mockResolvedValue(
      answer(
        part({
          steps: [
            {
              name: "approve",
              label: "Approve",
              kind: "approve",
              to: "approved",
              mayTake: false,
              primary: true,
              commentRequired: false,
            },
          ],
        })
      )
    );
    render(<ReviewSection document={post} />);
    const section = await screen.findByRole("region", { name: "Review" });
    expect(within(section).queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows the language on screen and the shared fields of a translated document", async () => {
    fetchSpy.mockResolvedValue(
      answer(
        part({ part: "de", stageLabel: "In review" }),
        part({ part: null, stage: "approved", stageLabel: "Approved" }),
        part({ part: "fr", stageLabel: "Legal check" })
      )
    );
    render(<ReviewSection document={post} locale="de" />);
    const section = await screen.findByRole("region", { name: "Review" });
    expect(section).toHaveTextContent("Shared fields");
    expect(section).toHaveTextContent("Approved");
    expect(section).not.toHaveTextContent("Legal check");
  });

  it("offers each part's own steps, so the shared fields waiting in another stage can be moved", async () => {
    stepSpy.mockResolvedValue({ message: "Step taken.", item: {} });
    fetchSpy.mockResolvedValue(
      answer(
        part({
          part: "de",
          steps: [
            {
              name: "approve",
              label: "Approve",
              kind: "approve",
              to: "approved",
              mayTake: false,
              primary: true,
              commentRequired: false,
            },
          ],
        }),
        part({
          part: null,
          stage: "drafting",
          stageLabel: "Drafting",
          revision: 2,
          version: "v2",
          steps: [
            {
              name: "submit",
              label: "Submit for review",
              kind: "submit",
              to: "inReview",
              mayTake: true,
              primary: true,
              commentRequired: false,
            },
          ],
        })
      )
    );
    render(<ReviewSection document={post} locale="de" />);
    const section = await screen.findByRole("region", { name: "Review" });
    expect(
      within(section).queryByRole("button", { name: "Approve" })
    ).toBeNull();
    await userEvent.click(
      within(section).getByRole("button", { name: "Submit for review" })
    );
    await waitFor(() =>
      expect(stepSpy).toHaveBeenCalledWith({
        document: { collection: "posts", id: "e1" },
        step: "submit",
        parts: [null],
        seen: [{ part: null, revision: 2, version: "v2" }],
      })
    );
  });

  it("draws each part's stage as words with a shape, never as a button", async () => {
    fetchSpy.mockResolvedValue(answer(part()));
    render(<ReviewSection document={post} />);
    const section = await screen.findByRole("region", { name: "Review" });
    const stage = section.querySelector("[data-stage-shape]");
    expect(stage).toHaveAttribute("data-stage-shape", "in-review");
    expect(stage).toHaveTextContent("In review");
    expect(stage?.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(stage?.closest("button")).toBeNull();
  });

  it("says a step taken to assistive technology, not only in a toast", async () => {
    stepSpy.mockResolvedValue({ message: "Step taken.", item: {} });
    fetchSpy.mockResolvedValue(answer(part()));
    render(<ReviewSection document={post} />);
    const section = await screen.findByRole("region", { name: "Review" });
    await userEvent.click(
      within(section).getByRole("button", { name: "Approve" })
    );
    await waitFor(() => expect(announced()).toContain("Approve: done."));
  });

  it("says a refused step to assistive technology once, through its alert in place", async () => {
    stepSpy.mockRejectedValue(new Error("Someone else moved it first."));
    fetchSpy.mockResolvedValue(answer(part()));
    render(<ReviewSection document={post} />);
    const section = await screen.findByRole("region", { name: "Review" });
    await userEvent.click(
      within(section).getByRole("button", { name: "Approve" })
    );
    // An alert is read at once, so the polite region does not say it again.
    await waitFor(() =>
      expect(within(section).getByRole("alert")).toHaveTextContent(
        "Someone else moved it first."
      )
    );
    // In the status text colour that reads at AA in both schemes.
    expect(within(section).getByRole("alert")).toHaveClass("text-danger-text");
    expect(
      announced().some(text => text.includes("Someone else moved it first."))
    ).toBe(false);
  });
});

/** What every polite status region on the page says now. */
function announced(): string[] {
  return Array.from(
    document.querySelectorAll('[role="status"][aria-live="polite"]')
  ).map(region => region.textContent?.trim() ?? "");
}
