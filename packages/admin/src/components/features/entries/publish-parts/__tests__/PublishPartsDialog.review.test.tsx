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

import { pressConfirm } from "./press-confirm";

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

/** What Spanish's row says, once the server has described it. */
const FIRST_TIME_IN_SPANISH =
  "Goes live for the first time: readers of Spanish see it.";

/** What the dialog says while the server describes the parts chosen. */
const CHECKING = "Checking what this does to each part…";

/** The server's answer for a post whose shared fields are live. */
function describing(choice: PublishPartsChoice): PublishPartsResult {
  const locales = choice.locales === "all" ? LANGUAGES : choice.locales;
  return {
    id: "post-1",
    languages: locales.map(locale => ({ locale, outcome: "goes-live" })),
    shared: { changes: false, added: false },
  };
}

function part(over: Partial<PartReview>): PartReview {
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
        commentRequired: false,
      },
    ],
    waitingFor: null,
    lastMove: null,
    reviewedVersionNo: null,
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
      commentRequired: false,
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

function dialog(withReview?: PublishReview) {
  return (
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

const open = (withReview?: PublishReview) => render(dialog(withReview));

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

function refusal(
  errors: { path: string; code: string; message: string }[],
  described?: { _rev: string; marks: unknown }
) {
  return parseApiError(
    {
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed.",
        requestId: "r1",
        data: { errors, ...(described === undefined ? {} : { described }) },
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
    await screen.findByText(FIRST_TIME_IN_SPANISH);

    const ready = screen.getByRole("region", { name: "Ready to publish?" });
    expect(ready).toHaveTextContent("Spanish: not approved (Drafting)");
    expect(
      screen.getByRole("button", { name: "Publish selected" })
    ).toBeDisabled();

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

  it("asks what the parts do again once a step listed there is taken, so an approved part can be published", async () => {
    const user = userEvent.setup();
    const unapproved = refusal([
      { path: "es", code: "NOT_APPROVED", message: "Not approved." },
    ]);
    api.publishParts.mockImplementation(
      (_s: string, _i: string, _d: string, choice: PublishPartsChoice) =>
        choice.locales !== "all" && api.takeStep.mock.calls.length === 0
          ? Promise.reject(unapproved)
          : Promise.resolve(describing(choice))
    );
    const drawn = open(review([part({}), APPROVED_SHARED]));
    await screen.findByText("Not approved.");
    const publish = screen.getByRole("button", { name: "Publish selected" });
    expect(publish).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Submit for review" }));
    await waitFor(() => expect(api.takeStep).toHaveBeenCalledTimes(1));
    // The review state, read again by the page, approves the part.
    drawn.rerender(
      dialog(
        review([
          part({
            stage: "approved",
            stageLabel: "Approved",
            publishable: true,
            steps: [],
          }),
          APPROVED_SHARED,
        ])
      )
    );

    await pressConfirm(publish);
    await waitFor(() =>
      expect(moves().map(move => move.locales)).toEqual([["es"]])
    );
  });

  it("asks nothing again when the step is refused", async () => {
    const user = userEvent.setup();
    api.takeStep.mockRejectedValue(new Error("Not yours to take."));
    open(review([part({}), APPROVED_SHARED]));
    await screen.findByText(FIRST_TIME_IN_SPANISH);
    await waitFor(() => expect(screen.queryByText(CHECKING)).toBeNull());
    const asked = api.publishParts.mock.calls.length;

    await user.click(screen.getByRole("button", { name: "Submit for review" }));
    await waitFor(() => expect(api.takeStep).toHaveBeenCalledTimes(1));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(api.publishParts.mock.calls).toHaveLength(asked);
  });

  it("asks the comment a fix's step requires before taking it, and sends it with the step", async () => {
    const user = userEvent.setup();
    open(
      review([
        part({
          steps: [
            {
              name: "submit",
              label: "Submit for review",
              kind: "submit",
              to: "inReview",
              mayTake: true,
              primary: true,
              commentRequired: true,
            },
          ],
        }),
        APPROVED_SHARED,
      ])
    );
    await screen.findByText(FIRST_TIME_IN_SPANISH);
    const ready = screen.getByRole("region", { name: "Ready to publish?" });
    await user.click(
      within(ready).getByRole("button", { name: "Submit for review" })
    );

    // Nothing is sent until the comment the step requires is written.
    const asked = await screen.findByRole("dialog", {
      name: /submit for review/i,
    });
    expect(api.takeStep).not.toHaveBeenCalled();
    await user.type(within(asked).getByRole("textbox"), "Ready for the desk.");
    await user.click(
      within(asked).getByRole("button", { name: "Submit for review" })
    );
    await waitFor(() =>
      expect(api.takeStep).toHaveBeenCalledWith({
        document: { collection: "posts", id: "post-1" },
        step: "submit",
        parts: ["es"],
        seen: [{ part: "es", revision: 3, version: "v3" }],
        comment: "Ready for the desk.",
      })
    );
  });

  it("says who can unblock a part the person cannot move", async () => {
    open(review([IN_REVIEW_ES, APPROVED_SHARED]));
    await screen.findByText(FIRST_TIME_IN_SPANISH);
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
    expect(
      screen.getByRole("button", { name: "Publish selected" })
    ).toBeDisabled();
  });

  it("says nothing, and lets Publish go, once every chosen part is approved", async () => {
    open(
      review([
        part({ stage: "approved", stageLabel: "Approved", publishable: true }),
        APPROVED_SHARED,
      ])
    );
    await screen.findByText(FIRST_TIME_IN_SPANISH);
    expect(
      screen.queryByRole("region", { name: "Ready to publish?" })
    ).toBeNull();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Publish selected" })
      ).toBeEnabled()
    );
  });

  it("draws the dialog as before where no workflow is attached", async () => {
    open();
    await screen.findByText(FIRST_TIME_IN_SPANISH);
    expect(
      screen.queryByRole("region", { name: "Ready to publish?" })
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Publish without review…" })
    ).toBeNull();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Publish selected" })
      ).toBeEnabled()
    );
  });
});

describe("Publish without review", () => {
  it("offers a holder publishing without review, with a required, trimmed reason", async () => {
    const user = userEvent.setup();
    open(review([IN_REVIEW_ES], true));
    await screen.findByText(FIRST_TIME_IN_SPANISH);

    await pressConfirm(
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

  it("publishes as usual, with no reason, once the parts chosen no longer need it", async () => {
    const user = userEvent.setup();
    const english = part({
      part: "en",
      stage: "approved",
      stageLabel: "Approved",
      publishable: true,
      steps: [],
    });
    open(review([IN_REVIEW_ES, english], true));
    await screen.findByText(FIRST_TIME_IN_SPANISH);
    await pressConfirm(
      screen.getByRole("button", { name: "Publish without review…" })
    );
    await user.type(
      screen.getByRole("textbox", { name: "Reason" }),
      "Legal deadline today."
    );
    // The part that needed it is no longer chosen: an approved one is.
    await user.click(screen.getByRole("checkbox", { name: "Spanish" }));
    await user.click(screen.getByRole("checkbox", { name: "English" }));
    await waitFor(() => expect(screen.queryByText(CHECKING)).toBeNull());
    await pressConfirm(
      screen.getByRole("button", { name: "Publish without review" })
    );

    await waitFor(() => expect(moves()).toHaveLength(1));
    expect(moves()[0]).toMatchObject({ locales: ["en"] });
    expect(moves()[0]).not.toHaveProperty("withoutReview");
  });

  it("waits for the description of the parts chosen since, then publishes them as usual", async () => {
    const user = userEvent.setup();
    const english = part({
      part: "en",
      stage: "approved",
      stageLabel: "Approved",
      publishable: true,
      steps: [],
    });
    let describeEnglish: () => void = () => undefined;
    api.publishParts.mockImplementation(
      (_s: string, _i: string, _d: string, choice: PublishPartsChoice) =>
        new Promise(resolve => {
          const answer = () => resolve(describing(choice));
          if (choice.describe === true && String(choice.locales) === "en") {
            describeEnglish = answer;
          } else {
            answer();
          }
        })
    );
    open(review([IN_REVIEW_ES, english], true));
    await pressConfirm(
      await screen.findByRole("button", { name: "Publish without review…" })
    );
    await user.type(
      screen.getByRole("textbox", { name: "Reason" }),
      "Legal deadline today."
    );
    await user.click(screen.getByRole("checkbox", { name: "Spanish" }));
    await user.click(screen.getByRole("checkbox", { name: "English" }));
    const send = screen.getByRole("button", { name: "Publish without review" });
    expect(send).toBeDisabled();
    await user.click(send);
    expect(moves()).toEqual([]);

    describeEnglish();
    await pressConfirm(send);
    await waitFor(() => expect(moves()).toHaveLength(1));
    expect(moves()[0]).not.toHaveProperty("withoutReview");
  });

  it("waits for the server to describe the parts before it is offered for them", async () => {
    let describeParts: () => void = () => undefined;
    api.publishParts.mockImplementation(
      (_s: string, _i: string, _d: string, choice: PublishPartsChoice) =>
        new Promise(resolve => {
          const answer = () => resolve(describing(choice));
          if (choice.locales === "all") answer();
          else describeParts = answer;
        })
    );
    open(review([IN_REVIEW_ES], true));
    await screen.findByText(FIRST_TIME_IN_SPANISH);
    const past = screen.getByRole("button", {
      name: "Publish without review…",
    });
    expect(past).toBeDisabled();

    describeParts();
    await waitFor(() => expect(past).toBeEnabled());
  });

  it.each([
    ["does not answer", new Error("Network down.")],
    [
      "refuses them for another reason as well",
      refusal([
        { path: "es", code: "NOT_APPROVED", message: "Not approved." },
        { path: "title", code: "REQUIRED", message: "This field is required." },
      ]),
    ],
  ])("is held where the server %s", async (_how, error) => {
    api.publishParts.mockImplementation(
      (_s: string, _i: string, _d: string, choice: PublishPartsChoice) =>
        choice.locales === "all"
          ? Promise.resolve(describing(choice))
          : Promise.reject(error)
    );
    open(review([IN_REVIEW_ES], true));
    const past = await screen.findByRole("button", {
      name: "Publish without review…",
    });
    await waitFor(() => expect(screen.queryByText(CHECKING)).toBeNull());
    expect(past).toBeDisabled();
  });

  it("stays usable while the description is refused for want of approval, which it goes past", async () => {
    const user = userEvent.setup();
    const unapproved = refusal([
      { path: "es", code: "NOT_APPROVED", message: "Not approved." },
    ]);
    api.publishParts.mockImplementation(
      (_s: string, _i: string, _d: string, choice: PublishPartsChoice) =>
        choice.describe === true
          ? Promise.reject(unapproved)
          : Promise.resolve(describing(choice))
    );
    open(review([IN_REVIEW_ES], true));
    await screen.findByText("Not approved.");
    expect(
      screen.getByRole("button", { name: "Publish selected" })
    ).toBeDisabled();

    await pressConfirm(
      screen.getByRole("button", { name: "Publish without review…" })
    );
    await user.type(
      screen.getByRole("textbox", { name: "Reason" }),
      "Legal deadline today."
    );
    await pressConfirm(
      screen.getByRole("button", { name: "Publish without review" })
    );

    await waitFor(() =>
      expect(moves()).toEqual([
        expect.objectContaining({
          locales: ["es"],
          withoutReview: { reason: "Legal deadline today." },
        }),
      ])
    );
  });

  it("sends what the description refused for want of approval was made from, and reads no version", async () => {
    const user = userEvent.setup();
    const unapproved = refusal(
      [{ path: "es", code: "NOT_APPROVED", message: "Not approved." }],
      { _rev: "9.es:4", marks: { languages: { es: "m" }, rest: "r" } }
    );
    api.publishParts.mockImplementation(
      (_s: string, _i: string, _d: string, choice: PublishPartsChoice) =>
        choice.describe === true
          ? Promise.reject(unapproved)
          : Promise.resolve(describing(choice))
    );
    open(review([IN_REVIEW_ES], true));
    await screen.findByText("Not approved.");

    await pressConfirm(
      screen.getByRole("button", { name: "Publish without review…" })
    );
    await user.type(
      screen.getByRole("textbox", { name: "Reason" }),
      "Legal deadline today."
    );
    await pressConfirm(
      screen.getByRole("button", { name: "Publish without review" })
    );

    await waitFor(() =>
      expect(moves()).toEqual([
        expect.objectContaining({
          version: "9.es:4",
          withoutReview: { reason: "Legal deadline today." },
        }),
      ])
    );
    expect(api.findByID).not.toHaveBeenCalled();
  });

  it("does not offer it to a person who does not hold it", async () => {
    open(review([IN_REVIEW_ES], false));
    await screen.findByText(FIRST_TIME_IN_SPANISH);
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
    await screen.findByText(FIRST_TIME_IN_SPANISH);
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
    await screen.findByText(FIRST_TIME_IN_SPANISH);
    await pressConfirm(
      screen.getByRole("button", { name: "Publish without review…" })
    );
    await user.type(
      screen.getByRole("textbox", { name: "Reason" }),
      "Legal deadline today."
    );
    await pressConfirm(
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

describe("the shared fields a first publish takes", () => {
  const APPROVED_ES = part({
    stage: "approved",
    stageLabel: "Approved",
    publishable: true,
    steps: [],
  });
  const DRAFTED_SHARED = part({ part: null });
  const SHARED_PROBLEM = "Shared fields: not approved (Drafting)";
  const readyList = () =>
    screen.findByRole("region", { name: "Ready to publish?" });

  /** The gate's refusal of a publish that takes the shared fields, described or made. */
  const heldBack = refusal([
    {
      path: "shared",
      code: "NOT_APPROVED",
      message: "The shared fields have no current approval.",
    },
  ]);

  it("are listed with their next step where the server refuses the publish for their approval", async () => {
    const user = userEvent.setup();
    api.publishParts.mockRejectedValue(heldBack);
    open(review([APPROVED_ES, DRAFTED_SHARED]));

    const ready = await readyList();
    await waitFor(() => expect(ready).toHaveTextContent(SHARED_PROBLEM));
    // Said once, with its step, and not again as a field called "shared".
    expect(ready).not.toHaveTextContent("shared: ");
    await user.click(
      within(ready).getByRole("button", { name: /Submit for review/ })
    );
    await waitFor(() => expect(api.takeStep).toHaveBeenCalled());
  });

  it("can be published without review by a person who may", async () => {
    const user = userEvent.setup();
    api.publishParts.mockImplementation(
      (_s: string, _i: string, _d: string, choice: PublishPartsChoice) =>
        choice.describe === true
          ? Promise.reject(heldBack)
          : Promise.resolve(describing(choice))
    );
    open(review([APPROVED_ES, DRAFTED_SHARED], true));

    await pressConfirm(
      await screen.findByRole("button", { name: "Publish without review…" })
    );
    await user.type(
      screen.getByRole("textbox", { name: "Reason" }),
      "Legal deadline today."
    );
    await pressConfirm(
      screen.getByRole("button", { name: "Publish without review" })
    );

    // The server adds the shared fields itself.
    await waitFor(() =>
      expect(moves()).toEqual([
        expect.objectContaining({
          locales: ["es"],
          shared: false,
          withoutReview: { reason: "Legal deadline today." },
        }),
      ])
    );
  });

  it("are listed where the description says it takes them", async () => {
    api.publishParts.mockImplementation(
      (_s: string, _i: string, _d: string, choice: PublishPartsChoice) =>
        Promise.resolve({
          ...describing(choice),
          shared: { changes: true, added: choice.locales !== "all" },
        })
    );
    open(review([APPROVED_ES, DRAFTED_SHARED]));

    await waitFor(async () =>
      expect(await readyList()).toHaveTextContent(SHARED_PROBLEM)
    );
    expect(
      screen.getByRole("button", { name: "Publish selected" })
    ).toBeDisabled();
  });

  it("are not listed where they are live and left alone", async () => {
    open(review([APPROVED_ES, DRAFTED_SHARED]));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Publish selected" })
      ).toBeEnabled()
    );
    expect(screen.queryByText(SHARED_PROBLEM)).toBeNull();
  });
});

describe("a refused publish", () => {
  const approved = (name: string) =>
    part({
      part: name,
      stage: "approved",
      stageLabel: "Approved",
      publishable: true,
      steps: [],
    });
  const PROBLEM = "title: This field is required.";

  it("holds the parts it was of, and no others", async () => {
    const user = userEvent.setup();
    const missing = refusal([
      { path: "title", code: "REQUIRED", message: "This field is required." },
    ]);
    api.publishParts.mockImplementation(
      (_s: string, _i: string, _d: string, choice: PublishPartsChoice) =>
        choice.describe !== true && String(choice.locales) === "es"
          ? Promise.reject(missing)
          : Promise.resolve(describing(choice))
    );
    open(review([approved("es"), approved("en"), APPROVED_SHARED]));
    const publish = screen.getByRole("button", { name: "Publish selected" });
    await pressConfirm(publish);
    await screen.findByText(PROBLEM);
    expect(publish).toBeDisabled();

    // Another part: the refusal was not of it.
    await user.click(screen.getByRole("checkbox", { name: "Spanish" }));
    await user.click(screen.getByRole("checkbox", { name: "English" }));
    await waitFor(() => expect(publish).toBeEnabled());
    expect(screen.queryByText(PROBLEM)).toBeNull();

    // The same part again: it is still the one refused.
    await user.click(screen.getByRole("checkbox", { name: "English" }));
    await user.click(screen.getByRole("checkbox", { name: "Spanish" }));
    expect(await screen.findByText(PROBLEM)).toBeInTheDocument();
    expect(publish).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: "Spanish" }));
    await user.click(screen.getByRole("checkbox", { name: "English" }));
    await pressConfirm(publish);
    await waitFor(() =>
      expect(moves().map(move => move.locales)).toEqual([["es"], ["en"]])
    );
  });
});
