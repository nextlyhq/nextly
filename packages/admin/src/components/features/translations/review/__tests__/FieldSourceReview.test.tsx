/**
 * The review of an out-of-date field where it is translated: only the requests
 * are replaced.
 *
 * The plausible broken reviews: one that reads every field's change as the page
 * opens; one that keeps against anything but what it showed; one that keeps a
 * translation the person has since changed; one that shows an empty earlier
 * version where none was kept; and one that leaves the keyboard nowhere.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FormProvider, useForm } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@admin/__tests__/utils";
import { toast } from "@admin/components/ui";
import { protectedApi } from "@admin/lib/api/protectedApi";
import type { SourceChange } from "@admin/services/sourceReviewApi";

import {
  FieldSourceReview,
  type FieldSourceReviewProps,
} from "../FieldSourceReview";

const ENGLISH = { code: "en", label: "English", rtl: false };
const SPANISH = { code: "es", label: "Spanish", rtl: false };
const VALUE = "a".repeat(64);
const SOURCE = "b".repeat(64);

const CHANGE: SourceChange = {
  available: true,
  sourceLocale: "en",
  before: "The quick fox",
  after: "The slow fox",
  valueFingerprint: VALUE,
  sourceFingerprint: SOURCE,
};

const get = vi.spyOn(protectedApi, "get");
const post = vi.spyOn(protectedApi, "post");
const said = vi.spyOn(toast, "success");
const refused = vi.spyOn(toast, "error");
const focusField = vi.fn();
const reload = vi.fn();

const ENTRY = { kind: "collection", slug: "authors", id: "a 1" } as const;

function Harness(props: Partial<FieldSourceReviewProps>) {
  const form = useForm<Record<string, unknown>>({
    defaultValues: { bio: "El zorro rápido" },
  });
  return (
    <FormProvider {...form}>
      <input aria-label="Biography" {...form.register("bio")} />
      <FieldSourceReview
        document={ENTRY}
        field={{ name: "bio", label: "Biography" }}
        target={SPANISH}
        languageOf={code =>
          code === "en" ? ENGLISH : { code, label: code, rtl: false }
        }
        origin="person"
        readOnly={false}
        isSaving={false}
        focusField={focusField}
        reload={reload}
        {...props}
      />
    </FormProvider>
  );
}

const render = (props: Partial<FieldSourceReviewProps> = {}) =>
  renderWithProviders(<Harness {...props} />);
const toggle = () =>
  screen.getByRole("button", { name: "What changed: Biography" });
const keep = () =>
  screen.queryByRole("button", { name: "Keep current: Biography" });
const edit = () => screen.queryByRole("button", { name: "Edit: Biography" });
/** Opens the review, and the group it is drawn in. */
async function open(props: Partial<FieldSourceReviewProps> = {}) {
  render(props);
  await userEvent.click(toggle());
  return within(
    await screen.findByRole("group", { name: "Out of date: Biography" })
  );
}

beforeEach(() => {
  for (const mock of [get, post, said, refused, focusField, reload]) {
    mock.mockReset();
  }
  said.mockReturnValue("");
  refused.mockReturnValue("");
  get.mockResolvedValue(CHANGE);
  post.mockResolvedValue({ message: "Translation kept as it is." });
  reload.mockResolvedValue({});
});

describe("an out-of-date field's review", () => {
  it("reads nothing until it is opened, then shows what changed", async () => {
    render();
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(get).not.toHaveBeenCalled();

    await userEvent.click(toggle());

    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    const review = within(
      await screen.findByRole("group", { name: "Out of date: Biography" })
    );
    expect(get).toHaveBeenCalledWith(
      "/collections/authors/entries/a%201/source-change?locale=es&field=bio"
    );
    expect(review.getByText("quick")).toBeInTheDocument();
    expect(review.getByText("slow")).toBeInTheDocument();
    expect(review.getByText("El zorro rápido")).toBeInTheDocument();
    expect(review.getByText("Last edited by a person.")).toBeInTheDocument();
  });

  it("asks a Single by its slug alone", async () => {
    await open({ document: { kind: "single", slug: "home" } });
    expect(get).toHaveBeenCalledWith(
      "/singles/home/source-change?locale=es&field=bio"
    );
  });

  it("reads again each time it is opened", async () => {
    await open();
    await userEvent.click(toggle());
    expect(
      screen.queryByRole("group", { name: "Out of date: Biography" })
    ).toBeNull();
    await userEvent.click(toggle());
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });

  it("says while it loads, and lets a failed load be tried again", async () => {
    get.mockRejectedValueOnce(new Error("The server is away."));
    render();
    await userEvent.click(toggle());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The server is away."
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("group", { name: "Out of date: Biography" })
    ).toBeInTheDocument();
  });

  it("goes to the field to edit it", async () => {
    await open();
    await userEvent.click(edit()!);
    expect(focusField).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
  });

  it("offers a reader who may not write neither choice", async () => {
    await open({ readOnly: true });
    expect(keep()).toBeNull();
    expect(edit()).toBeNull();
  });
});

describe("keeping the translation", () => {
  it("keeps against what was shown, then reads the document again", async () => {
    await open();
    await userEvent.click(keep()!);

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith(
      "/collections/authors/entries/a%201/keep-current",
      {
        locale: "es",
        field: "bio",
        valueFingerprint: VALUE,
        sourceFingerprint: SOURCE,
      }
    );
    expect(said).toHaveBeenCalledWith("Biography kept as it is.");
    // Before the mark and the review go, the keyboard is on the field.
    expect(focusField.mock.invocationCallOrder[0]).toBeLessThan(
      reload.mock.invocationCallOrder[0]!
    );
  });

  it("says why it was refused, and shows the source as it now is", async () => {
    post.mockRejectedValue(new Error("The source changed."));
    get
      .mockResolvedValueOnce(CHANGE)
      .mockResolvedValue({ ...CHANGE, after: "The slow red fox" });
    const review = await open();
    await userEvent.click(keep()!);

    await waitFor(() =>
      expect(refused).toHaveBeenCalledWith("The source changed.")
    );
    expect(await review.findByText(/red/)).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
    expect(focusField).not.toHaveBeenCalled();
  });

  it.each([
    ["its own value", { sourceFingerprint: SOURCE }],
    ["its source", { valueFingerprint: VALUE }],
  ])(
    "is not offered where the server named nothing of %s",
    async (_of, named) => {
      get.mockResolvedValue({
        available: false,
        reason: "not-kept",
        sourceLocale: "en",
        after: "The slow fox",
        ...named,
      });
      await open();
      expect(keep()).toBeNull();
      expect(edit()).not.toBeNull();
    }
  );

  it("is not offered over a translation being changed, and says what a save does", async () => {
    const review = await open();
    await userEvent.type(
      screen.getByRole("textbox", { name: "Biography" }),
      "!"
    );

    expect(keep()).toBeNull();
    expect(
      screen.getByText(
        "You've changed this translation. Saving it marks it up to date."
      )
    ).toBeInTheDocument();
    // The stored text, not what is being typed over it.
    expect(review.getByText("El zorro rápido")).toBeInTheDocument();
  });

  it("does nothing while the page saves", async () => {
    await open({ isSaving: true });
    expect(keep()).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(keep()!);
    expect(post).not.toHaveBeenCalled();
  });

  it("is sent once while it is on its way", async () => {
    let answer!: (value: unknown) => void;
    post.mockReturnValue(new Promise(resolve => (answer = resolve)));
    await open();
    await userEvent.click(keep()!);
    await waitFor(() =>
      expect(keep()).toHaveAttribute("aria-disabled", "true")
    );
    await userEvent.click(keep()!);
    expect(post).toHaveBeenCalledTimes(1);
    answer({});
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });
});

describe("a source that can't be shown", () => {
  it("shows the source now and says the earlier version isn't available", async () => {
    get.mockResolvedValue({
      available: false,
      reason: "unknown-origin",
      sourceLocale: "en",
      after: "The slow fox",
      valueFingerprint: VALUE,
      sourceFingerprint: SOURCE,
    });
    const review = await open();
    expect(
      review.getByText("The earlier version isn't available.")
    ).toBeInTheDocument();
    expect(review.getByText("The slow fox")).toBeInTheDocument();
    expect(keep()).not.toBeNull();
  });

  it("tells an earlier version that was empty from one that wasn't kept", async () => {
    get.mockResolvedValue({ ...CHANGE, before: null });
    const review = await open();
    expect(
      review.queryByText("The earlier version isn't available.")
    ).toBeNull();
    expect(review.getByText("Empty")).toBeInTheDocument();
  });

  it.each([
    [
      { available: false, reason: "original" },
      "This was written in its own language, so it has no source to compare with.",
    ],
    [
      {
        available: false,
        reason: "source-language-removed",
        sourceLocale: "fr",
      },
      "This was translated from a language the site no longer has (fr).",
    ],
  ] as [SourceChange, string][])("says so: %o", async (change, words) => {
    get.mockResolvedValue(change);
    render();
    await userEvent.click(toggle());
    expect(await screen.findByText(words)).toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "Out of date: Biography" })
    ).toBeNull();
  });
});
