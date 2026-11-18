/**
 * The editor's header under a workflow, as an author sees it: the review state
 * is read, the next step leads, and each step is sent with what the person saw.
 * Where no workflow is attached the header is exactly today's.
 */
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor, within } from "@admin/__tests__/utils";
import type { DocumentReview, PartReview } from "@admin/types/workflows";

import { BarUnderTest } from "../../EntryForm/__tests__/bar-under-test";
import { useEditorReview } from "../useEditorReview";

const { fetchSpy, stepSpy, held } = vi.hoisted(() => ({
  fetchSpy: vi.fn(),
  stepSpy: vi.fn(),
  held: { slugs: new Set<string>() },
}));

vi.mock("@admin/services/workflowApi", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/services/workflowApi")>()),
  fetchReviewState: fetchSpy,
  takeWorkflowStep: stepSpy,
}));
vi.mock("@admin/hooks/useCan", () => ({
  useCan: (slug: string) => held.slugs.has(slug),
}));
vi.mock("@admin/hooks/useHasPermission", () => ({
  useHasPermission: () => (slug: string) => held.slugs.has(slug),
}));
vi.mock("@admin/hooks/useCurrentUserId", () => ({
  useCurrentUserId: () => "me",
}));

const post = {
  scopeKind: "collection" as const,
  scopeSlug: "posts",
  entryId: "e1",
};

function part(over: Partial<PartReview> = {}): PartReview {
  return {
    part: null,
    stage: "drafting",
    stageLabel: "Drafting",
    publishable: false,
    enteredAt: null,
    enteredBy: null,
    assignee: null,
    dueAt: null,
    approval: null,
    revision: 2,
    version: "v7",
    steps: [
      {
        name: "submit",
        label: "Submit for review",
        kind: "submit",
        to: "inReview",
        mayTake: true,
        primary: true,
      },
    ],
    waitingFor: null,
    lastMove: null,
    ...over,
  };
}

/** In review, with whether the server says this person may take its steps. */
function inReview(mayTake: boolean): Partial<PartReview> {
  return {
    stage: "inReview",
    stageLabel: "In review",
    steps: [
      {
        name: "approve",
        label: "Approve",
        kind: "approve",
        to: "approved",
        mayTake,
        primary: true,
      },
      {
        name: "requestChanges",
        label: "Request changes",
        kind: "request-changes",
        to: "drafting",
        mayTake,
        primary: false,
      },
    ],
    waitingFor: { kind: "roles", roles: [{ id: "r1", name: "Editors" }] },
  };
}

function attached(...parts: PartReview[]): {
  attached: true;
  review: DocumentReview;
} {
  return {
    attached: true,
    review: { workflow: { slug: "review", label: "Review" }, parts },
  };
}

function Editor({
  withReview = true,
  isDirty = false,
  canEdit = true,
}: {
  withReview?: boolean;
  isDirty?: boolean;
  canEdit?: boolean;
}): ReactElement {
  const methods = useForm({ defaultValues: { title: "Hello" } });
  const review = useEditorReview({
    document: post,
    locale: undefined,
    isDirty,
  });
  return (
    <FormProvider {...methods}>
      <div data-testid="header">
        <BarUnderTest
          mode="edit"
          hasStatus
          draftsEnabled
          isDirty={isDirty}
          canEdit={canEdit}
          entry={{ id: "e1", title: "Hello", status: "draft" }}
          collectionSlug="posts"
          onSaveDraft={vi.fn()}
          onPublish={vi.fn()}
          onSaveWorkingDraft={vi.fn()}
          onUnpublish={vi.fn()}
          {...(withReview && review.binding !== undefined
            ? { review: review.binding }
            : {})}
        />
        {withReview ? review.dialog : null}
      </div>
    </FormProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  held.slugs = new Set(["update-posts", "publish-posts"]);
  stepSpy.mockResolvedValue({ message: "Step taken.", item: {} });
});

describe("the editor's next step under a workflow", () => {
  it("draws today's header, byte for byte, where no workflow is attached", async () => {
    fetchSpy.mockResolvedValue({ attached: false });
    const today = render(<Editor withReview={false} />);
    const todayHtml = today.getByTestId("header").innerHTML;
    today.unmount();

    render(<Editor />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    // Settled: the answer is in, and still nothing of the review is drawn.
    await waitFor(() =>
      expect(screen.getByTestId("header").innerHTML).toBe(todayHtml)
    );
  });

  it("leads a writer in drafting with Submit for review, sent with what they saw", async () => {
    held.slugs = new Set(["update-posts"]);
    fetchSpy.mockResolvedValue(attached(part()));
    render(<Editor />);
    const submit = await screen.findByRole("button", {
      name: "Submit for review",
    });
    await userEvent.click(submit);
    await waitFor(() =>
      expect(stepSpy).toHaveBeenCalledWith({
        document: { collection: "posts", id: "e1" },
        step: "submit",
        parts: [null],
        seen: [{ part: null, revision: 2, version: "v7" }],
      })
    );
  });

  it("holds the step while the page has unsaved changes", async () => {
    fetchSpy.mockResolvedValue(attached(part()));
    render(<Editor isDirty />);
    const submit = await screen.findByRole("button", {
      name: "Submit for review",
    });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute("title", "Save your changes first.");
  });

  it("leads a reviewer with Approve, and asks a comment before requesting changes", async () => {
    held.slugs = new Set(["approve-posts"]);
    fetchSpy.mockResolvedValue(attached(part(inReview(true))));
    render(<Editor canEdit={false} />);
    expect(
      await screen.findByRole("button", { name: "Approve" })
    ).toBeEnabled();

    await userEvent.click(
      screen.getByRole("button", { name: "Request changes" })
    );
    const dialog = await screen.findByRole("dialog");
    const send = within(dialog).getByRole("button", {
      name: "Request changes",
    });
    // A comment is required: nothing is sent without one.
    expect(send).toBeDisabled();
    await userEvent.type(
      within(dialog).getByRole("textbox"),
      "  The intro needs a source.  "
    );
    await userEvent.click(send);
    await waitFor(() =>
      expect(stepSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          step: "requestChanges",
          comment: "The intro needs a source.",
        })
      )
    );
  });

  it("holds Publish for a publisher until the part is approved, saying who it waits for", async () => {
    held.slugs = new Set(["update-posts", "publish-posts"]);
    fetchSpy.mockResolvedValue(attached(part(inReview(false))));
    render(<Editor />);
    const publish = await screen.findByRole("button", { name: /^publish$/i });
    await waitFor(() => expect(publish).toBeDisabled());
    expect(publish).toHaveAttribute(
      "title",
      "Needs approval: In review, waiting for Editors"
    );
  });

  it("offers no step the server says the person may not take, whatever they hold", async () => {
    // The permission a step names is the server's to judge, with the step's
    // other checks (a refused self-approval): holding approve-posts is not
    // enough where it says no.
    held.slugs = new Set(["approve-posts", "publish-posts"]);
    fetchSpy.mockResolvedValue(attached(part(inReview(false))));
    render(<Editor canEdit={false} />);
    // Settled on the review state: Publish is held for approval.
    const publish = await screen.findByRole("button", { name: /^publish$/i });
    await waitFor(() =>
      expect(publish).toHaveAttribute(
        "title",
        "Needs approval: In review, waiting for Editors"
      )
    );
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Request changes" })
    ).toBeNull();
  });

  it("leads with the stage's primary step, whatever its kind", async () => {
    held.slugs = new Set(["approve-posts"]);
    fetchSpy.mockResolvedValue(
      attached(
        part({
          ...inReview(true),
          steps: [
            {
              name: "approve",
              label: "Approve",
              kind: "approve",
              to: "approved",
              mayTake: true,
              primary: false,
            },
            {
              name: "legal",
              label: "Send to legal",
              kind: "move",
              to: "legal",
              mayTake: true,
              primary: true,
            },
          ],
        })
      )
    );
    render(<Editor canEdit={false} />);
    const lead = await screen.findByRole("button", { name: "Send to legal" });
    // The move leads, drawn as the primary control; Approve sits beside it.
    expect(lead).toHaveAttribute("data-primary", "true");
    expect(screen.getByRole("button", { name: "Approve" })).not.toHaveAttribute(
      "data-primary"
    );
  });

  it("works for a Single from its review state alone", async () => {
    held.slugs = new Set(["update-home"]);
    fetchSpy.mockResolvedValue(attached(part()));
    function SingleEditor(): ReactElement {
      const methods = useForm();
      const review = useEditorReview({
        document: { scopeKind: "single", scopeSlug: "home", entryId: "s1" },
        locale: undefined,
        isDirty: false,
      });
      return (
        <FormProvider {...methods}>
          <BarUnderTest
            mode="edit"
            hasStatus
            entry={{ id: "s1", status: "draft" }}
            collectionSlug="home"
            onSaveDraft={vi.fn()}
            onPublish={vi.fn()}
            {...(review.binding === undefined
              ? {}
              : { review: review.binding })}
          />
        </FormProvider>
      );
    }
    render(<SingleEditor />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Submit for review" })
    );
    await waitFor(() =>
      expect(stepSpy).toHaveBeenCalledWith(
        expect.objectContaining({ document: { single: "home" } })
      )
    );
  });
});
