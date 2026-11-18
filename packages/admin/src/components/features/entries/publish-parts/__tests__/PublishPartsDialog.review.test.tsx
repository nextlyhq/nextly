/**
 * "Choose what to publish" under a workflow: "Ready to publish?" lists what holds each chosen
 * part (not approved, a required field missing) with its fix or who can unblock it, and holds
 * Publish while anything does; a person who may publish without review is offered it, with a
 * required reason, sent on the publish body.
 *
 * The plausible broken dialogs: one that lets Publish go with a part not approved, one that
 * offers publishing without review to everyone, one that sends an empty or untrimmed reason, and
 * one that reports a refused publish without review nowhere near the part it names.
 */
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor, within } from "@admin/__tests__/utils";
import { parseApiError } from "@admin/lib/api/parseApiError";
import type {
  PublishPartsChoice,
  PublishPartsResult,
} from "@admin/services/publishParts";
import type { PartReview } from "@admin/types/workflows";

import { PublishPartsDialog, type PublishReview } from "../PublishPartsDialog";

const api = vi.hoisted(() => ({
  publishParts: vi.fn(),
  findByID: vi.fn(),
  takeStep: vi.fn(),
}));

vi.mock("@admin/services/entryApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/entryApi")>();
  return {
    ...actual,
    entryApi: {
      ...actual.entryApi,
      publishParts: api.publishParts,
      findByID: api.findByID,
    },
  };
});
vi.mock("@admin/services/workflowApi", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/services/workflowApi")>()),
  takeWorkflowStep: api.takeStep,
}));

const LANGUAGES = ["en", "es"];
const labelOf = (code: string) =>
  ({ en: "English", es: "Spanish" })[code] ?? code;

function describing(choice: PublishPartsChoice): PublishPartsResult {
  const locales = choice.locales === "all" ? LANGUAGES : choice.locales;
  return {
    id: "post-1",
    languages: locales.map(locale => ({ locale, outcome: "goes-live" })),
    shared: { changes: choice.shared === true, added: false },
  };
}

function part(over: Partial<PartReview>): PartReview {
  return {
    part: "es",
    stage: "drafting",
    stageLabel: "Drafting",
    publishable: false,
    enteredAt: null,
    enteredBy: null,
    assignee: null,
    dueAt: null,
    approval: null,
    revision: 3,
    version: "v3",
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

const APPROVED_SHARED = part({
  part: null,
  stage: "approved",
  stageLabel: "Approved",
  publishable: true,
  steps: [],
});

const IN_REVIEW_ES = part({
  stage: "inReview",
  stageLabel: "In review",
  steps: [
    {
      name: "approve",
      label: "Approve",
      kind: "approve",
      to: "approved",
      mayTake: false,
      primary: true,
    },
  ],
  waitingFor: { kind: "roles", roles: [{ id: "r1", name: "Editors" }] },
});

function review(
  parts: PartReview[],
  mayPublishWithoutReview = false
): PublishReview {
  return {
    document: {
      scopeKind: "collection",
      scopeSlug: "posts",
      entryId: "post-1",
    },
    parts,
    mayPublishWithoutReview,
  };
}

function open(withReview?: PublishReview) {
  return render(
    <PublishPartsDialog
      open
      onOpenChange={() => undefined}
      target={{ kind: "collection", slug: "posts", id: "post-1" }}
      direction="publish"
      languages={LANGUAGES}
      labelOf={labelOf}
      initialChoice={{ locales: ["es"], shared: false }}
      {...(withReview === undefined ? {} : { review: withReview })}
    />
  );
}

/** The moves sent, describes left out. */
const moves = () =>
  (
    api.publishParts.mock.calls as [
      string,
      string,
      string,
      PublishPartsChoice,
    ][]
  )
    .map(([, , , choice]) => choice)
    .filter(choice => choice.describe !== true);

function refusal(errors: { path: string; code: string; message: string }[]) {
  return parseApiError(
    {
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed.",
        requestId: "r1",
        data: { errors },
      },
    },
    400
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.publishParts.mockImplementation(
    (_s: string, _i: string, _d: string, choice: PublishPartsChoice) =>
      Promise.resolve(describing(choice))
  );
  api.findByID.mockResolvedValue({ id: "post-1", _rev: "7" });
  api.takeStep.mockResolvedValue({ message: "Step taken.", item: {} });
});

describe("Ready to publish?", () => {
  it("lists a part not approved, offers its next step, and holds Publish", async () => {
    const user = userEvent.setup();
    open(review([part({}), APPROVED_SHARED]));
    await screen.findByText("Goes live for the first time.");

    const ready = screen.getByRole("region", { name: "Ready to publish?" });
    expect(ready).toHaveTextContent("Spanish: not approved (Drafting)");
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();

    await user.click(
      within(ready).getByRole("button", { name: "Submit for review" })
    );
    await waitFor(() =>
      expect(api.takeStep).toHaveBeenCalledWith({
        document: { collection: "posts", id: "post-1" },
        step: "submit",
        parts: ["es"],
        seen: [{ part: "es", revision: 3, version: "v3" }],
      })
    );
  });

  it("says who can unblock a part the person cannot move", async () => {
    open(review([IN_REVIEW_ES, APPROVED_SHARED]));
    await screen.findByText("Goes live for the first time.");
    const ready = screen.getByRole("region", { name: "Ready to publish?" });
    expect(ready).toHaveTextContent("Spanish: not approved (In review)");
    expect(ready).toHaveTextContent("Waiting for Editors");
    expect(within(ready).queryByRole("button")).toBeNull();
  });

  it("lists a required field the describe refuses, and holds Publish", async () => {
    const missing = refusal([
      { path: "title", code: "REQUIRED", message: "This field is required." },
    ]);
    api.publishParts.mockRejectedValue(missing);
    open(review([part({ stage: "approved", publishable: true, steps: [] })]));
    const ready = await screen.findByRole("region", {
      name: "Ready to publish?",
    });
    await waitFor(() =>
      expect(ready).toHaveTextContent("title: This field is required.")
    );
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
  });

  it("says nothing, and lets Publish go, once every chosen part is approved", async () => {
    open(
      review([
        part({ stage: "approved", stageLabel: "Approved", publishable: true }),
        APPROVED_SHARED,
      ])
    );
    await screen.findByText("Goes live for the first time.");
    expect(
      screen.queryByRole("region", { name: "Ready to publish?" })
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled();
  });

  it("draws the dialog as before where no workflow is attached", async () => {
    open();
    await screen.findByText("Goes live for the first time.");
    expect(
      screen.queryByRole("region", { name: "Ready to publish?" })
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Publish without review…" })
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled();
  });
});

describe("Publish without review", () => {
  it("offers a holder publishing without review, with a required, trimmed reason", async () => {
    const user = userEvent.setup();
    open(review([IN_REVIEW_ES], true));
    await screen.findByText("Goes live for the first time.");

    await user.click(
      screen.getByRole("button", { name: "Publish without review…" })
    );
    const send = screen.getByRole("button", { name: "Publish without review" });
    // A reason is required: nothing is sent without one, nor with spaces alone.
    expect(send).toBeDisabled();
    const reason = screen.getByRole("textbox", { name: "Reason" });
    await user.type(reason, "   ");
    expect(send).toBeDisabled();
    await user.type(reason, " Legal deadline today. ");
    await user.click(send);

    await waitFor(() =>
      expect(moves()).toEqual([
        expect.objectContaining({
          locales: ["es"],
          withoutReview: { reason: "Legal deadline today." },
        }),
      ])
    );
  });

  it("does not offer it to a person who does not hold it", async () => {
    open(review([IN_REVIEW_ES], false));
    await screen.findByText("Goes live for the first time.");
    expect(
      screen.queryByRole("button", { name: "Publish without review…" })
    ).toBeNull();
  });

  it("does not offer it once every chosen part is approved", async () => {
    open(
      review(
        [
          part({
            stage: "approved",
            stageLabel: "Approved",
            publishable: true,
          }),
        ],
        true
      )
    );
    await screen.findByText("Goes live for the first time.");
    expect(
      screen.queryByRole("button", { name: "Publish without review…" })
    ).toBeNull();
  });

  it("shows a refused publish without review beside the part it names", async () => {
    const user = userEvent.setup();
    const refused = refusal([
      {
        path: "es",
        code: "WITHOUT_REVIEW_REFUSED",
        message: "Publishing without review was refused for Spanish.",
      },
    ]);
    api.publishParts.mockImplementation(
      (_s: string, _i: string, _d: string, choice: PublishPartsChoice) =>
        choice.describe === true
          ? Promise.resolve(describing(choice))
          : Promise.reject(refused)
    );
    open(review([IN_REVIEW_ES], true));
    await screen.findByText("Goes live for the first time.");
    await user.click(
      screen.getByRole("button", { name: "Publish without review…" })
    );
    await user.type(
      screen.getByRole("textbox", { name: "Reason" }),
      "Legal deadline today."
    );
    await user.click(
      screen.getByRole("button", { name: "Publish without review" })
    );

    const spanish = screen.getByRole("checkbox", { name: "Spanish" });
    await waitFor(() =>
      expect(spanish).toHaveAccessibleDescription(
        expect.stringContaining(
          "Publishing without review was refused for Spanish."
        )
      )
    );
  });
});
