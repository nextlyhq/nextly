/**
 * The side panel's Review section: each part's stage, who it waits for, who
 * it is assigned to (with one Assign… picker), when it is due, and its last
 * move. The steps themselves are the header's main button, so the section
 * draws none for the parts the header acts on.
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
const { usersSpy } = vi.hoisted(() => ({ usersSpy: vi.fn() }));
vi.mock("@admin/services/userApi", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/services/userApi")>()),
  fetchUsers: usersSpy,
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
  usersSpy.mockResolvedValue({ items: [], meta: {} });
});

/** The section's facts, as label and value pairs. */
function facts(section: HTMLElement): Record<string, string> {
  const out: Record<string, string> = {};
  for (const term of within(section).queryAllByRole("term")) {
    out[term.textContent ?? ""] =
      term.nextElementSibling?.textContent?.trim() ?? "";
  }
  return out;
}

/** Opens the one Assign… picker and returns its rows' names. */
async function openPicker(section: HTMLElement): Promise<string[]> {
  await userEvent.click(
    within(section).getByRole("button", { name: "Assign…" })
  );
  const menu = await screen.findByRole("menu");
  return within(menu)
    .getAllByRole("menuitem")
    .map(item => item.textContent ?? "");
}

/**
 * How long a case waits for the picker to list what the people read answered: each try opens the
 * menu again, which a loaded run can take longer than the default second to do.
 */
const PICKER_WAIT = { timeout: 5_000 };

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
    expect(facts(section)).toEqual({
      Stage: "In review",
      "Waiting for": "Editors",
      Assigned: "Nobody",
    });
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
    expect(facts(section)).toMatchObject({
      Assigned: "Rita",
      Due: "on 2026-11-20",
    });
  });

  it("assigns the part to the person, sent with the revision they saw", async () => {
    fetchSpy.mockResolvedValue(answer(part()));
    render(<ReviewSection document={post} />);
    const section = await screen.findByRole("region", { name: "Review" });
    await openPicker(section);
    await userEvent.click(screen.getByRole("menuitem", { name: "Me" }));
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
    await openPicker(section);
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Editors (the whole role)" })
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
    expect(await openPicker(section)).toEqual(["Unassign"]);
    await userEvent.click(screen.getByRole("menuitem", { name: "Unassign" }));
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

  it("offers one Assign… picker of people and roles, in place of a button per role", async () => {
    held.slugs = new Set(["read-users"]);
    usersSpy.mockResolvedValue({
      items: [
        {
          id: "sam",
          name: "Sam Okafor",
          email: "sam@x",
          roles: [{ id: "r-ed" }],
        },
        {
          id: "ana",
          name: "Ana Ruiz",
          email: "ana@x",
          roles: [{ id: "r-wr" }],
        },
      ],
      meta: {},
    });
    fetchSpy.mockResolvedValue(
      answer(
        part({
          waitingFor: {
            kind: "roles",
            roles: [
              { id: "r-ed", name: "Editors" },
              { id: "r-lg", name: "Legal" },
            ],
          },
        })
      )
    );
    render(<ReviewSection document={post} />);
    const section = await screen.findByRole("region", { name: "Review" });
    // One control, however many roles the part waits for.
    expect(within(section).getAllByRole("button")).toHaveLength(1);
    // People offered are those holding a role the part waits for: Ana holds
    // none of them, so the server would refuse her.
    await waitFor(async () => {
      expect(await openPicker(section)).toEqual([
        "Me",
        "Editors (the whole role)",
        "Legal (the whole role)",
        "Sam Okafor",
      ]);
    }, PICKER_WAIT);
    await userEvent.click(screen.getByRole("menuitem", { name: "Sam Okafor" }));
    await waitFor(() =>
      expect(assignSpy).toHaveBeenCalledWith([
        expect.objectContaining({ assignee: { kind: "user", id: "sam" } }),
      ])
    );
  });

  it("searches the people beyond the first page by name, as they type", async () => {
    // One page of people is not every one of them: the picker asks the same
    // list for the name typed, rather than treating its first page as all.
    held.slugs = new Set(["read-users"]);
    usersSpy.mockImplementation(
      async (params: { filters?: { search?: string } }) =>
        params.filters?.search === "zara"
          ? {
              items: [
                {
                  id: "zara",
                  name: "Zara Khan",
                  email: "zara@x",
                  roles: [{ id: "r-ed" }],
                },
              ],
              meta: {},
            }
          : { items: [], meta: {} }
    );
    fetchSpy.mockResolvedValue(answer(part()));
    render(<ReviewSection document={post} />);
    const section = await screen.findByRole("region", { name: "Review" });
    await userEvent.click(
      within(section).getByRole("button", { name: "Assign…" })
    );
    await userEvent.type(
      await screen.findByRole("searchbox", { name: "Find a person" }),
      "zara"
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Zara Khan" })
    );
    await waitFor(() =>
      expect(assignSpy).toHaveBeenCalledWith([
        expect.objectContaining({ assignee: { kind: "user", id: "zara" } }),
      ])
    );
  });

  it("offers no deactivated person, whom an assignment would be refused", async () => {
    held.slugs = new Set(["read-users"]);
    usersSpy.mockResolvedValue({
      items: [
        {
          id: "sam",
          name: "Sam Okafor",
          email: "sam@x",
          roles: [{ id: "r-ed" }],
          isActive: true,
        },
        {
          id: "old",
          name: "Former Editor",
          email: "old@x",
          roles: [{ id: "r-ed" }],
          isActive: false,
        },
      ],
      meta: {},
    });
    fetchSpy.mockResolvedValue(answer(part()));
    render(<ReviewSection document={post} />);
    const section = await screen.findByRole("region", { name: "Review" });
    await waitFor(async () => {
      expect(await openPicker(section)).toEqual([
        "Me",
        "Editors (the whole role)",
        "Sam Okafor",
      ]);
    }, PICKER_WAIT);
  });

  it("lists no people for a person who may not list them", async () => {
    fetchSpy.mockResolvedValue(answer(part()));
    render(<ReviewSection document={post} />);
    const section = await screen.findByRole("region", { name: "Review" });
    expect(await openPicker(section)).toEqual([
      "Me",
      "Editors (the whole role)",
    ]);
    expect(usersSpy).not.toHaveBeenCalled();
    // Nor a search for them.
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("draws no step for the parts the header's main button moves", async () => {
    // The language on screen and the shared fields wait in one stage, so the
    // header's Approve moves both: the panel repeating it would offer the
    // same act twice.
    fetchSpy.mockResolvedValue(
      answer(part({ part: "de" }), part({ part: null }))
    );
    render(<ReviewSection document={post} locale="de" />);
    const section = await screen.findByRole("region", { name: "Review" });
    expect(
      within(section).queryByRole("button", { name: "Approve" })
    ).toBeNull();
    // The control: the parts are drawn, with their picker.
    expect(
      within(section).getAllByRole("button", { name: "Assign…" })
    ).toHaveLength(2);
  });

  it("keeps on the panel a step the header can't offer: only one of the parts moved together may take it", async () => {
    // The language and the shared fields wait in one stage, but this person
    // may approve only the language. The header offers a step only where
    // every part it moves may take it, so it offers none: the panel must.
    stepSpy.mockResolvedValue({ message: "Step taken.", item: {} });
    const approve = (mayTake: boolean) => ({
      name: "approve",
      label: "Approve",
      kind: "approve" as const,
      to: "approved",
      mayTake,
      primary: true,
      commentRequired: false,
    });
    fetchSpy.mockResolvedValue(
      answer(
        part({ part: "de", steps: [approve(true)] }),
        part({ part: null, steps: [approve(false)] })
      )
    );
    render(<ReviewSection document={post} locale="de" />);
    const section = await screen.findByRole("region", { name: "Review" });
    const own = section.querySelector('[data-review-part="de"]') as HTMLElement;
    await userEvent.click(within(own).getByRole("button", { name: "Approve" }));
    await waitFor(() =>
      expect(stepSpy).toHaveBeenCalledWith(
        expect.objectContaining({ step: "approve", parts: ["de"] })
      )
    );
    // Nothing for the shared fields, which this person may not approve.
    const shared = section.querySelector(
      '[data-review-part=""]'
    ) as HTMLElement;
    expect(
      within(shared).queryByRole("button", { name: "Approve" })
    ).toBeNull();
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
});
