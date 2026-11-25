/**
 * A translation page's header under a workflow, as a writer, a reviewer and a
 * publisher meet it: the language's review is read, its next step leads, and a
 * step moves the language alone. Where no workflow holds the language the
 * header is the one it has without one.
 */
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor, within } from "@admin/__tests__/utils";
import { StepRefusalNote } from "@admin/components/features/entries/review/StepRefusalNote";
import type { ReleaseDocumentRef } from "@admin/types/releases";
import type {
  DocumentReview,
  PartReview,
  ReviewStep,
} from "@admin/types/workflows";

import type { TranslationActionFacts } from "../translation-actions";
import { TranslationHeaderActions } from "../TranslationHeaderActions";
import {
  useTranslationReview,
  type TranslationReview,
} from "../useTranslationReview";

const { fetchSpy, stepSpy } = vi.hoisted(() => ({
  fetchSpy: vi.fn(),
  stepSpy: vi.fn(),
}));

vi.mock("@admin/services/workflowApi", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/services/workflowApi")>()),
  fetchReviewState: fetchSpy,
  takeWorkflowStep: stepSpy,
}));
// The versions this person may read, which the shared fields' approval is
// judged by: they can't be read, so that approval is held in the editor.
vi.mock("@admin/hooks/queries/useVersions", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/queries/useVersions")
  >()),
  useVersions: () => ({ data: undefined, isError: true }),
}));

const post: ReleaseDocumentRef = {
  scopeKind: "collection",
  scopeSlug: "posts",
  entryId: "e1",
};

const SUBMIT: ReviewStep = {
  name: "submit",
  label: "Submit for review",
  kind: "submit",
  to: "inReview",
  mayTake: true,
  primary: true,
  commentRequired: false,
};

const APPROVE: ReviewStep = {
  name: "approve",
  label: "Approve",
  kind: "approve",
  to: "approved",
  mayTake: true,
  primary: true,
  commentRequired: false,
};

const REQUEST_CHANGES: ReviewStep = {
  name: "requestChanges",
  label: "Request changes",
  kind: "request-changes",
  to: "drafting",
  mayTake: true,
  primary: false,
  commentRequired: false,
};

/** Spanish, being written, to a person who may submit it. */
function part(over: Partial<PartReview> = {}): PartReview {
  return {
    part: "es",
    stage: "drafting",
    stageLabel: "Drafting",
    stageColour: null,
    publishable: false,
    enteredAt: null,
    enteredBy: null,
    assignee: null,
    dueAt: null,
    approval: null,
    revision: 4,
    version: "v-es",
    steps: [SUBMIT],
    waitingFor: null,
    lastMove: null,
    reviewedVersionNo: null,
    ...over,
  };
}

/** Waiting for approval, with whether this person may take its steps. */
function inReview(mayTake: boolean): Partial<PartReview> {
  return {
    stage: "inReview",
    stageLabel: "In review",
    steps: [
      { ...APPROVE, mayTake },
      { ...REQUEST_CHANGES, mayTake },
    ],
    waitingFor: { kind: "roles", roles: [{ id: "r1", name: "Editors" }] },
  };
}

/** Approved: its stage allows publishing. */
const APPROVED: Partial<PartReview> = {
  stage: "approved",
  stageLabel: "Approved",
  publishable: true,
  steps: [{ ...REQUEST_CHANGES, mayTake: false }],
};

/** Live with nothing waiting: it stands in no stage. */
const LIVE: Partial<PartReview> = { stage: null, stageLabel: null, steps: [] };

/** The shared fields, with a version and a revision of their own. */
function shared(over: Partial<PartReview> = {}): PartReview {
  return part({ revision: 9, version: "v-shared", ...over, part: null });
}

function attached(...parts: PartReview[]): {
  attached: true;
  review: DocumentReview;
} {
  return {
    attached: true,
    review: {
      workflow: { slug: "review", label: "Review" },
      parts,
      mayPublishWithoutReview: false,
    },
  };
}

const onSave = vi.fn();
const onPublish = vi.fn();

type Facts = Omit<TranslationActionFacts, "review">;

/** A Spanish draft, to a person who may edit and publish it. */
function factsOf(over: Partial<Facts> = {}): Facts {
  return {
    languageLabel: "Spanish",
    hasStatus: true,
    holdsDrafts: true,
    status: "draft",
    pendingChange: false,
    canEdit: true,
    canPublish: true,
    isDirty: false,
    readingHistory: false,
    writesRefused: false,
    ...over,
  };
}

interface HeaderProps {
  facts?: Partial<Facts>;
  document?: ReleaseDocumentRef;
  held?: string;
  workflowExpected?: boolean;
  isSaving?: boolean;
  publishReason?: string;
}

function Drawn({
  review,
  facts = {},
  isSaving = false,
  publishReason,
}: Omit<HeaderProps, "document" | "held" | "workflowExpected"> & {
  review: TranslationReview;
}): ReactElement {
  return (
    <div data-testid="header">
      <TranslationHeaderActions
        facts={factsOf(facts)}
        review={review}
        isSaving={isSaving}
        onSave={onSave}
        onPublish={onPublish}
        publishReason={publishReason}
      />
      {/* The page says it, beside the work. */}
      <StepRefusalNote
        refusal={review.refusal}
        onDismiss={review.clearRefusal}
      />
    </div>
  );
}

/** The page's header with its own review, as the page mounts the two. */
function Header({
  document = post,
  held,
  workflowExpected,
  ...drawn
}: HeaderProps): ReactElement {
  const review = useTranslationReview({
    document,
    language: "es",
    isDirty: drawn.facts?.isDirty ?? false,
    held,
    ...(workflowExpected === undefined ? {} : { workflowExpected }),
  });
  return <Drawn review={review} {...drawn} />;
}

/** The header of a language no workflow holds, with no review read at all. */
const NO_REVIEW: TranslationReview = {
  binding: undefined,
  part: undefined,
  refusal: null,
  clearRefusal: () => undefined,
  dialog: null,
};

const WRITER: Partial<Facts> = { canPublish: false };
const REVIEWER: Partial<Facts> = { canEdit: false, canPublish: false };

const NEEDS_APPROVAL = "Needs approval: In review, waiting for Editors";

/** The control the page draws as the one to press. */
function leads(control: HTMLElement): boolean {
  return control.getAttribute("data-primary") === "true";
}

/**
 * Whether the leading control is held: drawn pressable, with a lock, and
 * described by why, never disabled.
 */
function expectHeld(control: HTMLElement, reason: string): void {
  expect(control).toBeEnabled();
  expect(control).toHaveAttribute("data-held");
  expect(control).toHaveAttribute("title", reason);
  expect(control).toHaveAccessibleDescription(reason);
}

const publish = (): HTMLElement =>
  screen.getByRole("button", { name: "Publish Spanish" });

/** Opens the menu on the leading control's arrow. */
async function openMenu(): Promise<HTMLElement> {
  await userEvent.click(
    screen.getByRole("button", { name: "More ways to publish" })
  );
  return screen.findByRole("menu");
}

/** The generated ids, which count up from one mount to the next, taken out. */
function withoutIds(html: string): string {
  return html.replace(/(radix-)?_r_[a-z0-9]+_/g, "<id>");
}

beforeEach(() => {
  vi.clearAllMocks();
  stepSpy.mockResolvedValue({ message: "Step taken.", item: {} });
});

describe("a writer's translation header under a workflow", () => {
  it("leads with Submit for review, the save in its menu and no publish", async () => {
    fetchSpy.mockResolvedValue(attached(part()));
    render(<Header facts={WRITER} />);

    const submit = await screen.findByRole("button", {
      name: "Submit for review",
    });
    expect(leads(submit)).toBe(true);
    expect(submit).not.toHaveAttribute("data-held");
    expect(
      screen.queryByRole("button", { name: "Publish Spanish" })
    ).toBeNull();

    const menu = await openMenu();
    expect(
      within(menu).getByRole("menuitem", { name: /^Save Spanish/ })
    ).toBeInTheDocument();
  });

  it("asks for the review of the document the page is on", async () => {
    fetchSpy.mockResolvedValue(attached(part()));
    render(<Header facts={WRITER} />);
    await screen.findByRole("button", { name: "Submit for review" });
    expect(fetchSpy).toHaveBeenCalledWith({ collection: "posts", id: "e1" });
  });

  it("holds the step while the page has unsaved work, sending nothing, and saves it from the menu", async () => {
    fetchSpy.mockResolvedValue(attached(part()));
    render(<Header facts={{ ...WRITER, isDirty: true }} />);

    const submit = await screen.findByRole("button", {
      name: "Submit for review",
    });
    expectHeld(submit, "Save your changes first.");
    await userEvent.click(submit);
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "Save your changes first."
    );
    expect(stepSpy).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    const menu = await openMenu();
    await userEvent.click(
      within(menu).getByRole("menuitem", { name: "Save Spanish" })
    );
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("holds the step while a version of the language is yet to be stored", async () => {
    fetchSpy.mockResolvedValue(attached(part({ version: null })));
    render(<Header facts={WRITER} />);
    const submit = await screen.findByRole("button", {
      name: "Submit for review",
    });
    expectHeld(submit, "Save the translation first.");
    await userEvent.click(submit);
    expect(stepSpy).not.toHaveBeenCalled();
  });

  it("holds the step for what the page says holds it", async () => {
    fetchSpy.mockResolvedValue(attached(part()));
    render(<Header facts={WRITER} held="A restore is on its way." />);
    expectHeld(
      await screen.findByRole("button", { name: "Submit for review" }),
      "A restore is on its way."
    );
  });

  it("holds the step while one is on its way, so a second press sends nothing", async () => {
    let answer: (value: unknown) => void = () => undefined;
    stepSpy.mockReturnValue(
      new Promise(resolve => {
        answer = resolve;
      })
    );
    fetchSpy.mockResolvedValue(attached(part()));
    render(<Header facts={WRITER} />);
    const submit = (): HTMLElement =>
      screen.getByRole("button", { name: "Submit for review" });

    await userEvent.click(
      await screen.findByRole("button", { name: "Submit for review" })
    );
    await waitFor(() => expectHeld(submit(), "Taking the step…"));
    await userEvent.click(submit());
    expect(stepSpy).toHaveBeenCalledTimes(1);

    answer({ message: "Step taken.", item: {} });
    await waitFor(() => expect(submit()).not.toHaveAttribute("data-held"));
  });
});

describe("a step taken from a translation page", () => {
  it("is sent for the language alone, with its own seen version, where the shared fields wait in the same stage", async () => {
    fetchSpy.mockResolvedValue(attached(part(), shared()));
    render(<Header facts={WRITER} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Submit for review" })
    );
    await waitFor(() => expect(stepSpy).toHaveBeenCalledTimes(1));
    expect(stepSpy).toHaveBeenCalledWith({
      document: { collection: "posts", id: "e1" },
      step: "submit",
      parts: ["es"],
      seen: [{ part: "es", revision: 4, version: "v-es" }],
    });
  });

  it("is offered to a reviewer refused it on the shared fields, who approves the language alone", async () => {
    fetchSpy.mockResolvedValue(
      attached(part(inReview(true)), shared(inReview(false)))
    );
    render(<Header facts={REVIEWER} />);
    const approve = await screen.findByRole("button", { name: "Approve" });
    expect(approve).not.toHaveAttribute("data-held");
    await userEvent.click(approve);
    await waitFor(() =>
      expect(stepSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          step: "approve",
          parts: ["es"],
          seen: [{ part: "es", revision: 4, version: "v-es" }],
        })
      )
    );
  });

  it("is not offered to a person refused it on the language, who may take it on the shared fields", async () => {
    fetchSpy.mockResolvedValue(
      attached(part(inReview(false)), shared(inReview(true)))
    );
    render(<Header />);
    await waitFor(() => expectHeld(publish(), NEEDS_APPROVAL));
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /^Request changes/ })
    ).toBeNull();
  });

  it("is not held with the shared fields' approval, whose version under review the person can't read", async () => {
    fetchSpy.mockResolvedValue(
      attached(
        part(inReview(true)),
        shared({ ...inReview(true), reviewedVersionNo: 9 })
      )
    );
    render(<Header facts={REVIEWER} />);
    const approve = await screen.findByRole("button", { name: "Approve" });
    expect(approve).not.toHaveAttribute("data-held");
    await userEvent.click(approve);
    await waitFor(() =>
      expect(stepSpy).toHaveBeenCalledWith(
        expect.objectContaining({ step: "approve", parts: ["es"] })
      )
    );
  });

  it("names a Single by its slug", async () => {
    fetchSpy.mockResolvedValue(attached(part()));
    render(
      <Header
        facts={WRITER}
        document={{ scopeKind: "single", scopeSlug: "home", entryId: "s1" }}
      />
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Submit for review" })
    );
    await waitFor(() =>
      expect(stepSpy).toHaveBeenCalledWith(
        expect.objectContaining({ document: { single: "home" } })
      )
    );
  });

  it("says why it was refused, until that is dismissed", async () => {
    stepSpy.mockRejectedValue(new Error("Someone else took this step."));
    fetchSpy.mockResolvedValue(attached(part()));
    render(<Header facts={WRITER} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Submit for review" })
    );
    const refusal = await screen.findByRole("alert");
    expect(refusal).toHaveTextContent("Someone else took this step.");

    await userEvent.click(
      within(refusal).getByRole("button", { name: "Dismiss" })
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("a reviewer's translation header", () => {
  it("leads with Approve, asks for changes beside it, and offers no save", async () => {
    fetchSpy.mockResolvedValue(attached(part(inReview(true))));
    render(<Header facts={REVIEWER} />);
    const approve = await screen.findByRole("button", { name: "Approve" });
    expect(leads(approve)).toBe(true);
    const request = screen.getByRole("button", { name: "Request changes…" });
    expect(request).toBeEnabled();
    expect(leads(request)).toBe(false);
    // Nothing on the arrow: the save is the writer's.
    expect(
      screen.queryByRole("button", { name: "More ways to publish" })
    ).toBeNull();
  });

  it("asks for a comment before it sends the language back", async () => {
    fetchSpy.mockResolvedValue(
      attached(part(inReview(true)), shared(inReview(true)))
    );
    render(<Header facts={REVIEWER} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Request changes…" })
    );
    const dialog = await screen.findByRole("dialog");
    const send = within(dialog).getByRole("button", {
      name: "Request changes",
    });
    expect(send).toBeDisabled();
    expect(stepSpy).not.toHaveBeenCalled();

    await userEvent.type(
      within(dialog).getByRole("textbox"),
      "  The intro reads oddly.  "
    );
    await userEvent.click(send);
    await waitFor(() =>
      expect(stepSpy).toHaveBeenCalledWith({
        document: { collection: "posts", id: "e1" },
        step: "requestChanges",
        parts: ["es"],
        seen: [{ part: "es", revision: 4, version: "v-es" }],
        comment: "The intro reads oddly.",
      })
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("a publisher's translation header", () => {
  it("holds the publish before approval, opening why and running nothing", async () => {
    fetchSpy.mockResolvedValue(attached(part(inReview(false))));
    render(<Header />);
    await waitFor(() => expectHeld(publish(), NEEDS_APPROVAL));
    expect(leads(publish())).toBe(true);

    await userEvent.click(publish());
    expect(await screen.findByRole("dialog")).toHaveTextContent(NEEDS_APPROVAL);
    expect(onPublish).not.toHaveBeenCalled();
  });

  it("publishes once the language is approved", async () => {
    fetchSpy.mockResolvedValue(attached(part(APPROVED)));
    render(<Header />);
    await waitFor(() => expect(publish()).not.toHaveAttribute("data-held"));
    expect(leads(publish())).toBe(true);
    await userEvent.click(publish());
    expect(onPublish).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("holds the publish while the review state is being read", async () => {
    fetchSpy.mockReturnValue(new Promise(() => undefined));
    render(<Header />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expectHeld(publish(), "Checking the review…");
    await userEvent.click(publish());
    expect(onPublish).not.toHaveBeenCalled();
  });

  it("holds the publish, saying so, where the review state can't be read", async () => {
    fetchSpy.mockRejectedValue(new Error("Service unavailable"));
    render(<Header />);
    await waitFor(() =>
      expectHeld(
        publish(),
        "The review state couldn't be read. Reload the page to try again."
      )
    );
  });

  it("offers the publish while the review state is read where the page knows no workflow is attached", async () => {
    fetchSpy.mockReturnValue(new Promise(() => undefined));
    render(<Header workflowExpected={false} />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(publish()).not.toHaveAttribute("data-held");
    await userEvent.click(publish());
    expect(onPublish).toHaveBeenCalledTimes(1);
  });

  it("holds the publish for the page's own reason", async () => {
    fetchSpy.mockResolvedValue({ attached: false });
    render(<Header publishReason="Save the translation first." />);
    await waitFor(() => expect(publish()).toBeDisabled());
    expect(publish()).toHaveAttribute("title", "Save the translation first.");
    await userEvent.click(publish());
    expect(onPublish).not.toHaveBeenCalled();
  });
});

describe("a language the workflow says nothing of", () => {
  it("has the header it has without a workflow, byte for byte, where none is attached", async () => {
    const without = render(<Drawn review={NO_REVIEW} />);
    const expected = withoutIds(without.getByTestId("header").innerHTML);
    without.unmount();

    fetchSpy.mockResolvedValue({ attached: false });
    render(<Header />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    await waitFor(() =>
      expect(withoutIds(screen.getByTestId("header").innerHTML)).toBe(expected)
    );
  });

  it.each([
    ["the shared fields alone wait", shared(inReview(true))],
    ["another language waits", part({ ...inReview(true), part: "fr" })],
  ])("offers no step and no hold where %s", async (_where, waiting) => {
    fetchSpy.mockResolvedValue(attached(part(LIVE), waiting));
    render(<Header />);
    // Held until the review is read, and free once it is.
    await waitFor(() => expect(publish()).not.toHaveAttribute("data-held"));
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /^Request changes/ })
    ).toBeNull();
    await userEvent.click(publish());
    expect(onPublish).toHaveBeenCalledTimes(1);
  });

  it("keeps its own step where another language stands in another stage", async () => {
    fetchSpy.mockResolvedValue(
      attached(
        part({ ...inReview(true), part: "fr", revision: 8, version: "v-fr" }),
        part()
      )
    );
    render(<Header facts={WRITER} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Submit for review" })
    );
    await waitFor(() =>
      expect(stepSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          step: "submit",
          parts: ["es"],
          seen: [{ part: "es", revision: 4, version: "v-es" }],
        })
      )
    );
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });
});

describe("a translation header at this moment", () => {
  it("waits with every step while the language is saved", async () => {
    fetchSpy.mockResolvedValue(attached(part(inReview(true))));
    render(<Header facts={REVIEWER} isSaving />);
    const approve = await screen.findByRole("button", { name: "Approve" });
    const request = screen.getByRole("button", { name: "Request changes…" });
    for (const control of [approve, request]) {
      expect(control).toBeDisabled();
      expect(control).toHaveAttribute("title", "Saving…");
    }
    await userEvent.click(approve);
    expect(stepSpy).not.toHaveBeenCalled();
  });

  it("waits with the publish and the save while the language is saved, ahead of any other reason", async () => {
    fetchSpy.mockResolvedValue({ attached: false });
    render(<Header isSaving publishReason="Save the translation first." />);
    await waitFor(() => expect(publish()).toBeDisabled());
    expect(publish()).toHaveAttribute("title", "Saving…");

    const menu = await openMenu();
    const save = within(menu).getByRole("menuitem", { name: /^Save Spanish/ });
    expect(save).toHaveAttribute("aria-disabled", "true");
    expect(save).toHaveAttribute("title", "Saving…");
  });

  it("holds the save where nothing changed, and frees it once something has", async () => {
    fetchSpy.mockResolvedValue({ attached: false });
    const live: Partial<Facts> = { status: "published" };
    const { rerender } = render(<Header facts={live} />);
    const save = (): HTMLElement =>
      screen.getByRole("button", { name: "Save Spanish" });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    // Nothing of a live language waits to be published, so its save leads.
    expect(leads(save())).toBe(true);
    expect(save()).toBeDisabled();
    expect(save()).toHaveAttribute("title", "Nothing has changed yet.");

    rerender(<Header facts={{ ...live, isDirty: true }} />);
    expect(save()).toBeEnabled();
    await userEvent.click(save());
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onPublish).not.toHaveBeenCalled();
  });

  it("draws nothing where every write is refused", async () => {
    fetchSpy.mockResolvedValue(attached(part(inReview(true))));
    render(<Header facts={{ writesRefused: true }} />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(
      within(screen.getByTestId("header")).queryAllByRole("button")
    ).toEqual([]);
  });
});
