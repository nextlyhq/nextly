/**
 * The publish dialog's parts, as the server describes them: every part says what it changes for
 * its readers whether or not it is chosen, a part with nothing to publish cannot be chosen and is
 * never sent, and what the publish means beyond its parts is said before it is made.
 *
 * The plausible broken dialogs: one that offers, describes or sends a language with nothing to
 * publish; one that lets a choice be confirmed before it is known which parts have anything, or
 * before the server has described it; one that blocks on an answer about every language that the
 * server refuses; one that leaves the shared fields out of reach when
 * the server says a language cannot go without them; one that draws publishing as a danger; and
 * one that tells its page a language went live that did not.
 */
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { act, render, screen, waitFor } from "@admin/__tests__/utils";
import { parseApiError } from "@admin/lib/api/parseApiError";
import type {
  PartsLanguageOutcome,
  PublishPartsChoice,
  PublishPartsResult,
} from "@admin/services/publishParts";

import { PublishPartsDialog } from "../PublishPartsDialog";

import { pressConfirm } from "./press-confirm";

const api = vi.hoisted(() => ({
  publishParts: vi.fn(),
  findByID: vi.fn(),
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

const LANGUAGES = ["en", "es", "ar"];
const labelOf = (code: string) =>
  ({ en: "English", es: "Spanish", ar: "Arabic" })[code] ?? code;

const ENGLISH_PENDING =
  "Its unpublished changes go live for readers of English.";
const SHARED_FACT = "Shared fields change every language.";

/** English holds a change; Spanish is live with nothing new; Arabic is not started. */
const ENGLISH_ALONE: PartsLanguageOutcome[] = [
  { locale: "en", outcome: "goes-live-with-pending-change" },
  { locale: "es", outcome: "stays-published" },
  { locale: "ar", outcome: "shows-fallback", fallback: "en" },
];

/** The route's answer to `choice`, for a post whose languages stand as `outcomes`. */
function answerTo(
  choice: PublishPartsChoice,
  outcomes: readonly PartsLanguageOutcome[],
  sharedLive: boolean
): PublishPartsResult {
  const every = choice.locales === "all";
  const asked = choice.locales === "all" ? LANGUAGES : choice.locales;
  const added =
    !every && asked.length > 0 && !sharedLive && choice.shared !== true;
  const moves = every || choice.shared === true || added;
  return {
    id: "post-1",
    languages: outcomes.filter(({ locale }) => asked.includes(locale)),
    shared: { changes: moves && !sharedLive, added },
  };
}

function serve(
  outcomes: readonly PartsLanguageOutcome[],
  sharedLive = true
): void {
  api.publishParts.mockImplementation(
    (_s: string, _i: string, _d: string, choice: PublishPartsChoice) =>
      Promise.resolve(answerTo(choice, outcomes, sharedLive))
  );
}

function refusal(path: string, code: string, message: string) {
  return parseApiError(
    {
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed.",
        requestId: "r1",
        data: { errors: [{ path, code, message }] },
      },
    },
    400
  );
}

type Props = ComponentProps<typeof PublishPartsDialog>;

function dialog(over: Partial<Props> = {}) {
  return (
    <PublishPartsDialog
      open
      onOpenChange={() => undefined}
      target={{ kind: "collection", slug: "posts", id: "post-1" }}
      direction="publish"
      languages={LANGUAGES}
      labelOf={labelOf}
      initialChoice={{ locales: ["en"], shared: false }}
      currentLocale="en"
      {...over}
    />
  );
}

const open = (over: Partial<Props> = {}) => render(dialog(over));

const choices = () =>
  (
    api.publishParts.mock.calls as [
      string,
      string,
      string,
      PublishPartsChoice,
    ][]
  ).map(([, , , choice]) => choice);

/** The requests described, of the parts chosen rather than of every language. */
const described = () =>
  choices()
    .filter(choice => choice.describe === true && choice.locales !== "all")
    .map(({ locales, shared }) => ({ locales, shared }));

const moves = () =>
  choices()
    .filter(choice => choice.describe !== true)
    .map(({ locales, shared }) => ({ locales, shared }));

const part = (name: string) => screen.getByRole("checkbox", { name });
const confirm = () => screen.getByRole("button", { name: "Publish selected" });

beforeEach(() => {
  api.publishParts.mockReset();
  api.findByID.mockReset();
  api.findByID.mockResolvedValue({ id: "post-1", _rev: "7" });
});

describe("the parts listed", () => {
  it("lists the shared fields apart, and says they change every language for as long as they are chosen", async () => {
    serve(ENGLISH_ALONE);
    open({
      sharedPending: true,
      initialChoice: { locales: ["en"], shared: true },
    });
    await screen.findByText(ENGLISH_PENDING);

    expect(part("Shared fields")).toBeChecked();
    expect(part("Shared fields")).toBeEnabled();
    expect(part("Shared fields")).toHaveAccessibleDescription(
      /Their unpublished changes go live for readers of every language\./
    );
    expect(screen.getByText(SHARED_FACT)).toBeInTheDocument();

    await userEvent.click(part("Shared fields"));
    expect(screen.queryByText(SHARED_FACT)).toBeNull();
  });

  it("says what another language holds while it is not chosen, and leaves it unchosen", async () => {
    serve([
      { locale: "en", outcome: "goes-live-with-pending-change" },
      { locale: "es", outcome: "goes-live-with-pending-change" },
      { locale: "ar", outcome: "goes-live" },
    ]);
    open();
    await screen.findByText(ENGLISH_PENDING);

    expect(part("Spanish")).not.toBeChecked();
    expect(part("Spanish")).toBeEnabled();
    expect(part("Spanish")).toHaveAccessibleDescription(
      "Its unpublished changes go live for readers of Spanish."
    );
    expect(part("Arabic")).toHaveAccessibleDescription(
      "Goes live for the first time: readers of Arabic see it."
    );
    await waitFor(() =>
      expect(described()).toEqual([{ locales: ["en"], shared: false }])
    );
  });

  it("does not offer a part with nothing to publish, and neither describes nor sends it", async () => {
    serve(ENGLISH_ALONE);
    open({ initialChoice: { locales: ["en", "es", "ar"], shared: true } });
    await screen.findByText(ENGLISH_PENDING);

    for (const [name, reason] of [
      ["Spanish", /^Live, with nothing new to publish\.$/],
      ["Arabic", /^Not started, so there is nothing to publish\.$/],
      ["Shared fields", /No unpublished changes\.$/],
    ] as const) {
      expect(part(name)).toBeDisabled();
      expect(part(name)).not.toBeChecked();
      expect(part(name)).toHaveAccessibleDescription(reason);
    }
    expect(screen.queryByText(SHARED_FACT)).toBeNull();

    await pressConfirm(confirm());
    await waitFor(() =>
      expect(moves()).toEqual([{ locales: ["en"], shared: false }])
    );
    expect(described()).not.toEqual([]);
    expect(
      described().filter(
        ({ locales, shared }) => String(locales) !== "en" || shared === true
      )
    ).toEqual([]);
  });

  it("does not offer a language whose change is behind the live values, and says how to bring it up to date", async () => {
    serve([
      { locale: "en", outcome: "goes-live-with-pending-change" },
      {
        locale: "es",
        outcome: "out-of-date",
        fields: ["tagline"],
        hiddenCount: 1,
      },
      { locale: "ar", outcome: "stays-published" },
    ]);
    open({ initialChoice: { locales: ["en", "es"], shared: false } });
    await screen.findByText(ENGLISH_PENDING);

    expect(part("Spanish")).toBeDisabled();
    expect(part("Spanish")).not.toBeChecked();
    expect(part("Spanish")).toHaveAccessibleDescription(
      "Its changes are behind the live tagline and 1 field you can't see. Open Spanish and take the live values before publishing it."
    );
    await waitFor(() =>
      expect(described()).toEqual([{ locales: ["en"], shared: false }])
    );
  });

  it("shows the shared fields a first publish takes as chosen and fixed, and leaves the server to add them", async () => {
    serve(
      [
        { locale: "en", outcome: "goes-live" },
        { locale: "es", outcome: "goes-live" },
        { locale: "ar", outcome: "shows-fallback", fallback: "en" },
      ],
      false
    );
    open();
    await screen.findByText(
      "Goes live for the first time: readers of English see it."
    );

    expect(part("Shared fields")).toBeChecked();
    expect(part("Shared fields")).toBeDisabled();
    expect(part("Shared fields")).toHaveAccessibleDescription(
      /Go live too: a first publish always takes them, for readers of every language\.$/
    );
    expect(screen.getByText(SHARED_FACT)).toBeInTheDocument();

    await pressConfirm(confirm());
    await waitFor(() =>
      expect(moves()).toEqual([{ locales: ["en"], shared: false }])
    );
  });

  it("offers the shared fields once the server says a chosen language cannot go without them", async () => {
    const needed = refusal(
      "tagline",
      "SHARED_EDITS_PENDING",
      "English (en)'s pending change also edits tagline."
    );
    api.publishParts.mockImplementation(
      (_s: string, _i: string, _d: string, choice: PublishPartsChoice) =>
        choice.locales !== "all" && choice.shared !== true
          ? Promise.reject(needed)
          : Promise.resolve(answerTo(choice, ENGLISH_ALONE, true))
    );
    open();
    await screen.findByRole("alert");
    expect(part("Shared fields")).toBeEnabled();

    await userEvent.click(part("Shared fields"));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(part("Shared fields")).toBeChecked();
    expect(part("Shared fields")).toBeEnabled();

    await pressConfirm(confirm());
    await waitFor(() =>
      expect(moves()).toEqual([{ locales: ["en"], shared: true }])
    );
  });

  it("marks the language on screen, and no other part", async () => {
    serve(ENGLISH_ALONE);
    open();
    await screen.findByText(ENGLISH_PENDING);

    expect(screen.getAllByText("This page")).toHaveLength(1);
    expect(part("English")).toHaveAccessibleDescription(/^This page /);
    expect(part("Spanish")).not.toHaveAccessibleDescription(/This page/);
  });

  it("marks none where the document has one language", async () => {
    serve(ENGLISH_ALONE);
    open({ languages: ["en"] });
    await screen.findByText(ENGLISH_PENDING);

    expect(screen.queryByText("This page")).toBeNull();
  });
});

describe("until the server has said what every language would do", () => {
  it("describes nothing and holds the confirm, so no choice about to shrink is sent", async () => {
    let answer: () => void = () => undefined;
    api.publishParts.mockImplementation(
      (_s: string, _i: string, _d: string, choice: PublishPartsChoice) =>
        new Promise(resolve => {
          const result = answerTo(choice, ENGLISH_ALONE, true);
          if (choice.locales === "all") answer = () => resolve(result);
          else resolve(result);
        })
    );
    open({ initialChoice: { locales: ["en", "es"], shared: false } });
    await waitFor(() => expect(choices()).toHaveLength(1));
    expect(choices()[0].locales).toBe("all");
    expect(part("Spanish")).toBeChecked();
    expect(confirm()).toBeDisabled();

    answer();
    await waitFor(() => expect(confirm()).toBeEnabled());
    expect(part("Spanish")).not.toBeChecked();
    await waitFor(() =>
      expect(described()).toEqual([{ locales: ["en"], shared: false }])
    );
  });

  it("offers every part as chosen where that is refused, and the server judges the request", async () => {
    api.publishParts.mockImplementation(
      (_s: string, _i: string, _d: string, choice: PublishPartsChoice) =>
        choice.locales === "all"
          ? Promise.reject(refusal("ar", "FORBIDDEN", "Arabic: not yours."))
          : Promise.resolve(answerTo(choice, ENGLISH_ALONE, true))
    );
    open();
    await screen.findByText(ENGLISH_PENDING);

    for (const name of ["English", "Spanish", "Arabic", "Shared fields"]) {
      expect(part(name)).toBeEnabled();
    }
    // A language nobody chose is not the request's problem.
    expect(screen.queryByText(/not yours/)).toBeNull();

    await pressConfirm(confirm());
    await waitFor(() =>
      expect(moves()).toEqual([{ locales: ["en"], shared: false }])
    );
  });
});

describe("until the server has described the parts as chosen", () => {
  /** Each description of chosen parts, answered when asked to be; that of every language at once. */
  function serveDescriptions() {
    const waiting: {
      choice: PublishPartsChoice;
      answer: () => void;
      fail: (error: unknown) => void;
    }[] = [];
    api.publishParts.mockImplementation(
      (_s: string, _i: string, _d: string, choice: PublishPartsChoice) =>
        new Promise((resolve, reject) => {
          const answer = () => resolve(answerTo(choice, TWO_PENDING, true));
          if (choice.describe !== true || choice.locales === "all") answer();
          else waiting.push({ choice, answer, fail: reject });
        })
    );
    return waiting;
  }

  const TWO_PENDING: PartsLanguageOutcome[] = [
    { locale: "en", outcome: "goes-live-with-pending-change" },
    { locale: "es", outcome: "goes-live-with-pending-change" },
    { locale: "ar", outcome: "shows-fallback", fallback: "en" },
  ];

  it("holds the confirm, and again for a choice changed since", async () => {
    const waiting = serveDescriptions();
    open();
    // Every language is described by now, and English says what it does from that.
    await screen.findByText(ENGLISH_PENDING);
    await waitFor(() => expect(waiting).toHaveLength(1));
    expect(confirm()).toBeDisabled();

    act(() => waiting[0].answer());
    await waitFor(() => expect(confirm()).toBeEnabled());

    await userEvent.click(part("Spanish"));
    await waitFor(() => expect(waiting).toHaveLength(2));
    expect(confirm()).toBeDisabled();
    await userEvent.click(confirm());
    expect(moves()).toEqual([]);

    act(() => waiting[1].answer());
    await pressConfirm(confirm());
    await waitFor(() =>
      expect(moves()).toEqual([{ locales: ["en", "es"], shared: false }])
    );
  });

  it.each([
    ["refuses it", refusal("title", "REQUIRED", "This field is required.")],
    ["does not answer", new Error("Network down.")],
  ])("holds the confirm where the server %s", async (_how, error) => {
    const waiting = serveDescriptions();
    open();
    await waitFor(() => expect(waiting).toHaveLength(1));

    act(() => waiting[0].fail(error));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(confirm()).toBeDisabled();
    await userEvent.click(confirm());
    expect(moves()).toEqual([]);
  });
});

describe("what the publish means beyond its parts", () => {
  it("says which translations it would leave out of date, from the fields the pending change holds otherwise", async () => {
    serve(ENGLISH_ALONE);
    api.findByID.mockImplementation(
      (_slug: string, _id: string, options?: { draft?: boolean }) =>
        Promise.resolve({
          id: "post-1",
          _rev: "7",
          title: options?.draft === true ? "Hello again" : "Hello",
          body: "Same",
        })
    );
    const fromEnglish = { origin: "person", sourceLocale: "en" };
    open({
      overview: {
        es: { fields: { title: fromEnglish, body: fromEnglish } },
      },
    });

    expect(
      await screen.findByText(
        "After this, 1 Spanish field will be out of date."
      )
    ).toBeInTheDocument();
  });

  it("lists both lines where the shared fields go live too", async () => {
    serve(ENGLISH_ALONE);
    api.findByID.mockImplementation(
      (_slug: string, _id: string, options?: { draft?: boolean }) =>
        Promise.resolve({ title: options?.draft === true ? "New" : "Old" })
    );
    open({
      sharedPending: true,
      initialChoice: { locales: ["en"], shared: true },
      overview: {
        es: { fields: { title: { origin: "person", sourceLocale: "en" } } },
      },
    });

    const forecast = await screen.findByText(
      "After this, 1 Spanish field will be out of date."
    );
    expect(
      Array.from(forecast.closest("ul")?.children ?? []).map(
        line => line.textContent
      )
    ).toEqual([
      SHARED_FACT,
      "After this, 1 Spanish field will be out of date.",
    ]);
  });
});

describe("what the dialog is called, and its confirm", () => {
  it("is Publish changes from the editor's Publish, and Choose what to publish from the menu", () => {
    serve(ENGLISH_ALONE);
    const view = open({ openedBy: "publish" });
    expect(
      screen.getByRole("dialog", { name: "Publish changes" })
    ).toBeInTheDocument();
    view.unmount();

    open();
    expect(
      screen.getByRole("dialog", { name: "Choose what to publish" })
    ).toBeInTheDocument();
  });

  it("publishes with the primary button, never the destructive one", async () => {
    serve(ENGLISH_ALONE);
    open();
    await screen.findByText(ENGLISH_PENDING);

    expect(confirm()).toHaveClass("bg-primary");
    expect(confirm()).not.toHaveClass("bg-destructive-solid");
  });

  it("is Publish, of the whole document, where it is not translated", async () => {
    serve([], false);
    open({
      languages: [],
      initialChoice: { locales: [], shared: true },
    });
    await screen.findByText("Their unpublished changes go live.");

    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(part("Shared fields")).toBeChecked();
    expect(part("Shared fields")).toBeEnabled();
    expect(screen.queryByText("Languages")).toBeNull();
    // It has no languages to ask about.
    expect(choices().filter(choice => choice.locales === "all")).toEqual([]);

    await pressConfirm(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() =>
      expect(moves()).toEqual([{ locales: [], shared: true }])
    );
  });
});

describe("unpublishing", () => {
  it("draws each chosen part's own answer, asks of no other, and is destructive", async () => {
    serve([
      { locale: "en", outcome: "taken-down" },
      { locale: "es", outcome: "stays-unpublished" },
    ]);
    const onPublished = vi.fn();
    const onOpenChange = vi.fn();
    open({ direction: "unpublish", onPublished, onOpenChange });

    expect(
      screen.getByRole("dialog", { name: "Choose what to unpublish" })
    ).toBeInTheDocument();
    await screen.findByText("Comes down: readers no longer see it.");
    expect(
      screen.queryByText("Is not published, so nothing changes.")
    ).toBeNull();
    expect(part("Spanish")).toBeEnabled();
    expect(part("Shared fields")).toBeEnabled();
    expect(screen.queryByText("This page")).toBeNull();
    expect(choices().map(choice => choice.locales)).toEqual([["en"]]);

    const unpublish = screen.getByRole("button", { name: "Unpublish" });
    expect(unpublish).toHaveClass("bg-destructive-solid");
    await pressConfirm(unpublish);

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(moves()).toEqual([{ locales: ["en"], shared: false }]);
    expect(onPublished).not.toHaveBeenCalled();
  });
});

describe("once it is published", () => {
  const BOTH: PartsLanguageOutcome[] = [
    { locale: "en", outcome: "goes-live-with-pending-change" },
    { locale: "es", outcome: "goes-live" },
    { locale: "ar", outcome: "goes-live" },
  ];

  it("tells its page the languages the answer says went live, then closes", async () => {
    // Between the description and the publish, a colleague published Arabic.
    api.publishParts.mockImplementation(
      (_s: string, _i: string, _d: string, choice: PublishPartsChoice) =>
        Promise.resolve(
          answerTo(
            choice,
            choice.describe === true
              ? BOTH
              : [
                  ...BOTH.slice(0, 2),
                  { locale: "ar", outcome: "stays-published" },
                ],
            true
          )
        )
    );
    const onPublished = vi.fn();
    const onOpenChange = vi.fn();
    open({
      initialChoice: { locales: LANGUAGES, shared: false },
      onPublished,
      onOpenChange,
    });
    await screen.findByText(ENGLISH_PENDING);

    await pressConfirm(confirm());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onPublished.mock.calls).toEqual([[{ published: ["en", "es"] }]]);
    expect(onPublished.mock.invocationCallOrder[0]).toBeLessThan(
      onOpenChange.mock.invocationCallOrder[0]
    );
  });

  it("tells it nothing when the publish is refused", async () => {
    api.publishParts.mockImplementation(
      (_s: string, _i: string, _d: string, choice: PublishPartsChoice) =>
        choice.describe === true
          ? Promise.resolve(answerTo(choice, BOTH, true))
          : Promise.reject(refusal("en", "NOT_APPROVED", "Not approved."))
    );
    const onPublished = vi.fn();
    const onOpenChange = vi.fn();
    open({ onPublished, onOpenChange });
    await screen.findByText(ENGLISH_PENDING);

    await pressConfirm(confirm());

    await screen.findByText("Not approved.");
    expect(onPublished).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe("closing", () => {
  /** The editor's header behind the dialog, with another control that can hold the focus. */
  const page = (opened: boolean) => (
    <>
      <button type="button">Elsewhere</button>
      <button type="button" data-action="publish" data-primary="true">
        Publish
      </button>
      {dialog({ open: opened, openedBy: "publish" })}
    </>
  );

  it("sends focus to the editor's main button where what opened it lost the focus", async () => {
    serve(ENGLISH_ALONE);
    // Nothing has the focus as it opens: the button that opened it was held while it ran.
    const view = render(page(true));
    await screen.findByText(ENGLISH_PENDING);

    view.rerender(page(false));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Publish" })).toHaveFocus()
    );
  });

  it("returns focus to the control that opened it where that kept it", async () => {
    serve(ENGLISH_ALONE);
    const view = render(page(false));
    const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
    elsewhere.focus();

    view.rerender(page(true));
    await screen.findByText(ENGLISH_PENDING);
    view.rerender(page(false));

    await waitFor(() => expect(elsewhere).toHaveFocus());
  });
});
