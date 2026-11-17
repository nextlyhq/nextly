/**
 * The side panel's Review section: each part's stage, who it is assigned to
 * (with a way to assign it), when it is due, and its last move.
 */
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor, within } from "@admin/__tests__/utils";
import type { PartReview } from "@admin/types/workflows";

import { ReviewSection } from "../ReviewSection";

const { fetchSpy, assignSpy, held } = vi.hoisted(() => ({
  fetchSpy: vi.fn(),
  assignSpy: vi.fn(),
  held: { slugs: new Set<string>() },
}));

vi.mock("@admin/services/workflowApi", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/services/workflowApi")>()),
  fetchReviewState: fetchSpy,
  assignWorkflowParts: assignSpy,
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
    stage: "inReview",
    stageLabel: "In review",
    publishable: false,
    enteredAt: null,
    enteredBy: null,
    assignee: null,
    dueAt: null,
    approval: null,
    revision: 4,
    version: "v4",
    steps: [
      { name: "approve", label: "Approve", kind: "approve", to: "approved" },
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
    review: { workflow: { slug: "review", label: "Review" }, parts },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  held.slugs = new Set(["approve-posts"]);
  assignSpy.mockResolvedValue({ message: "Assigned.", item: {} });
});

describe("ReviewSection", () => {
  it("draws nothing where no workflow is attached", async () => {
    fetchSpy.mockResolvedValue({ attached: false });
    const { container } = render(<ReviewSection document={post} />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
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
    held.slugs = new Set();
    fetchSpy.mockResolvedValue(answer(part()));
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
});
