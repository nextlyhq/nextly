/**
 * The notice after a one-click publish of an edit to a translated source field: it names the
 * language and how many of its fields are now out of date, with a link to translate it, from the
 * translation overview read after the publish.
 *
 * The plausible broken notices: one counting a field already out of date before the publish, one
 * read from the overview before the publish (which never moves), one that links to the language
 * just published rather than the one to translate, one drawn when nothing went out of date, one
 * an earlier, slower read overwrites, and one that cannot be dismissed.
 */
import userEvent from "@testing-library/user-event";
import type { JSX } from "react";
import { describe, expect, it, vi } from "vitest";

import { render, screen, waitFor } from "@admin/__tests__/utils";

import type { TranslationOverview } from "../out-of-date";
import { OutOfDateNotice } from "../OutOfDateNotice";
import { useOutOfDateNotice } from "../useOutOfDateNotice";

const LANGUAGES = ["en", "es", "fr"];
const labelOf = (code: string) =>
  ({ en: "English", es: "Spanish", fr: "French" })[code] ?? code;
const EDITOR = "/admin/collections/posts/7";

const fromEnglish = (outOfDate: boolean) => ({
  origin: "person",
  sourceLocale: "en",
  outOfDate,
});

/**
 * Spanish was translated from English: its title and summary match English's live values, and its
 * body was already behind English before this publish.
 */
const BEFORE: TranslationOverview = {
  en: {},
  es: {
    fields: {
      title: fromEnglish(false),
      summary: fromEnglish(false),
      body: fromEnglish(true),
    },
  },
  fr: { fields: { title: fromEnglish(false) } },
};

/** English's title was edited and published: Spanish's and French's titles are now behind it. */
const AFTER_TITLE_EDIT: TranslationOverview = {
  en: {},
  es: {
    fields: {
      title: fromEnglish(true),
      summary: fromEnglish(false),
      body: fromEnglish(true),
    },
  },
  fr: { fields: { title: fromEnglish(true) } },
};

/** The editor around the notice: a Publish that publishes English, then says what it left. */
function Editor({
  readOverview,
}: {
  readOverview: () => Promise<TranslationOverview | undefined>;
}): JSX.Element {
  const { notice, afterPublish, dismiss } = useOutOfDateNotice({
    languages: LANGUAGES,
    labelOf,
    editorPath: EDITOR,
    readOverview,
  });
  return (
    <>
      <button
        type="button"
        onClick={() =>
          void afterPublish({ before: BEFORE, published: ["en"], source: "en" })
        }
      >
        Publish
      </button>
      <OutOfDateNotice notice={notice} onDismiss={dismiss} />
    </>
  );
}

describe("the notice after publishing an edit to a translated source field", () => {
  it("names each language and its newly out-of-date fields, read after the publish, with a link to translate it", async () => {
    const readOverview = vi.fn(() => Promise.resolve(AFTER_TITLE_EDIT));
    render(<Editor readOverview={readOverview} />);

    await userEvent.click(screen.getByRole("button", { name: "Publish" }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(
      "Published. 1 Spanish field and 1 French field are now out of date."
    );
    expect(readOverview).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("link", { name: "Translate Spanish" })
    ).toHaveAttribute("href", `${EDITOR}?locale=es&translate=en`);
    expect(
      screen.getByRole("link", { name: "Translate French" })
    ).toHaveAttribute("href", `${EDITOR}?locale=fr&translate=en`);
  });

  it("says nothing when the publish left no translation out of date", async () => {
    render(<Editor readOverview={() => Promise.resolve(BEFORE)} />);

    await userEvent.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("says nothing when the overview cannot be read after the publish", async () => {
    render(
      <Editor readOverview={() => Promise.reject(new Error("offline"))} />
    );

    await userEvent.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("answers the latest publish, not a slower read for an earlier one", async () => {
    let finishFirst: (overview: TranslationOverview) => void = () => {};
    const readOverview = vi
      .fn<() => Promise<TranslationOverview | undefined>>()
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finishFirst = resolve;
          })
      )
      .mockImplementationOnce(() => Promise.resolve(BEFORE));
    render(<Editor readOverview={readOverview} />);

    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    finishFirst(AFTER_TITLE_EDIT);

    await waitFor(() => expect(readOverview).toHaveBeenCalledTimes(2));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("goes away when dismissed", async () => {
    render(<Editor readOverview={() => Promise.resolve(AFTER_TITLE_EDIT)} />);

    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    await screen.findByRole("status");
    await userEvent.click(
      screen.getByRole("button", { name: "Dismiss the out-of-date notice" })
    );

    expect(screen.queryByRole("status")).toBeNull();
  });
});
