/**
 * The review stands between a reader and a decision about a translation, so
 * what matters is that each text is under its own name, in its own language,
 * with only its own marks; that what is not known is said rather than shown as
 * something else; and that a choice is reported and nothing more.
 */
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

import {
  OutOfDateReview,
  type OutOfDateReviewProps,
  type ReviewLanguage,
} from "../OutOfDateReview";

const ENGLISH: ReviewLanguage = { code: "en", label: "English", rtl: false };
const GERMAN: ReviewLanguage = { code: "de", label: "German", rtl: false };
const ARABIC: ReviewLanguage = { code: "ar", label: "Arabic", rtl: true };

const SOURCE: OutOfDateReviewProps["source"] = {
  language: ENGLISH,
  before: "The quick fox",
  after: "The slow fox",
};

const TRANSLATION: OutOfDateReviewProps["translation"] = {
  language: GERMAN,
  text: "Der schnelle Fuchs",
  origin: "person",
};

const EARLIER = "English, earlier version";
const NOW = "English now";
const CURRENT = "Current German translation";

const SAME_WORDING =
  "The wording is the same. Something else changed, such as formatting.";
const NOT_AVAILABLE = "The earlier version isn't available.";

function renderReview(over: Partial<OutOfDateReviewProps> = {}) {
  const onKeepCurrent = vi.fn<() => void>();
  const onEdit = vi.fn<() => void>();
  render(
    <OutOfDateReview
      fieldLabel="Title"
      source={SOURCE}
      translation={TRANSLATION}
      onKeepCurrent={onKeepCurrent}
      onEdit={onEdit}
      {...over}
    />
  );
  return { onKeepCurrent, onEdit };
}

/**
 * What stands under one version's name. Looking there, and not in the page,
 * is what tells "both texts are somewhere" from "each is under its own name".
 */
function version(name: string): HTMLElement {
  const value = screen.getByText(name, { selector: "dt" }).nextElementSibling;
  if (!(value instanceof HTMLElement) || value.tagName !== "DD") {
    throw new Error(`nothing stands under "${name}"`);
  }
  return value;
}

/** The element holding one version's text, which says its language. */
function valueIn(name: string): HTMLElement {
  const value = version(name).querySelector<HTMLElement>("[lang]");
  if (!value) throw new Error(`no text in a language under "${name}"`);
  return value;
}

const marked = (element: HTMLElement, tag: "del" | "ins"): string[] =>
  Array.from(element.querySelectorAll(tag), mark => mark.textContent ?? "");

const group = (): HTMLElement =>
  screen.getByRole("group", { name: "Out of date: Title" });

const keepButton = (): HTMLElement =>
  screen.getByRole("button", { name: "Keep current: Title" });

const editButton = (): HTMLElement =>
  screen.getByRole("button", { name: "Edit: Title" });

/** The row the actions stand in. */
function actionsRow(): HTMLElement {
  const row = keepButton().parentElement;
  if (!row) throw new Error("the actions stand in no row");
  return row;
}

describe("OutOfDateReview, what changed", () => {
  it("strikes the removed words in the earlier version", () => {
    renderReview();
    expect(version(EARLIER).textContent).toBe("The quick fox");
    expect(marked(version(EARLIER), "del")).toEqual(["quick"]);
    expect(marked(version(EARLIER), "ins")).toEqual([]);
  });

  it("underlines the added words in the source now", () => {
    renderReview();
    expect(version(NOW).textContent).toBe("The slow fox");
    expect(marked(version(NOW), "ins")).toEqual(["slow"]);
    expect(marked(version(NOW), "del")).toEqual([]);
  });

  it("says the change in words, where everyone can read it", () => {
    renderReview();
    const sentence = screen.getByText(
      "1 passage removed (struck through) and 1 passage added (underlined)."
    );
    expect(sentence).toBeVisible();
    // Read by those who see the marks but cannot tell them apart, too.
    expect(sentence.closest(".sr-only, [aria-hidden='true']")).toBeNull();
  });

  it("shows the translation whole and unmarked", () => {
    renderReview();
    expect(version(CURRENT).textContent).toBe("Der schnelle Fuchs");
    expect(marked(version(CURRENT), "del")).toEqual([]);
    expect(marked(version(CURRENT), "ins")).toEqual([]);
  });

  it("says so where the earlier version was not kept, and marks nothing", () => {
    renderReview({ source: { ...SOURCE, before: null } });
    expect(version(EARLIER).textContent).toBe(NOT_AVAILABLE);
    // The text as it is. Marked as all new, it would say what nobody knows.
    expect(version(NOW).textContent).toBe("The slow fox");
    expect(marked(group(), "ins")).toEqual([]);
    expect(marked(group(), "del")).toEqual([]);
  });

  it("says nothing of a change it cannot know of", () => {
    renderReview({ source: { ...SOURCE, before: null } });
    expect(screen.queryByText(/passages? (removed|added)/)).toBeNull();
    expect(screen.queryByText(SAME_WORDING)).toBeNull();
  });

  it("still offers the actions where the earlier version was not kept", () => {
    renderReview({ source: { ...SOURCE, before: null } });
    // An inert button is still an enabled one, so both are looked at.
    expect(keepButton()).toBeEnabled();
    expect(keepButton()).not.toHaveAttribute("aria-disabled");
    expect(editButton()).toBeEnabled();
    expect(editButton()).not.toHaveAttribute("aria-disabled");
  });

  it("tells an earlier version that was empty from one not kept", () => {
    renderReview({ source: { ...SOURCE, before: "" } });
    expect(version(EARLIER).textContent).toBe("Empty");
    expect(screen.queryByText(NOT_AVAILABLE)).toBeNull();
    // Known to have been empty, so all of it is known to be new.
    expect(marked(version(NOW), "ins")).toEqual(["The slow fox"]);
    expect(
      screen.getByText("1 passage added (underlined).")
    ).toBeInTheDocument();
  });

  it("says the source is empty now where its text was removed", () => {
    renderReview({ source: { ...SOURCE, after: "" } });
    expect(marked(version(EARLIER), "del")).toEqual(["The quick fox"]);
    expect(version(NOW).textContent).toBe("Empty");
    expect(
      screen.getByText("1 passage removed (struck through).")
    ).toBeInTheDocument();
  });

  it("says an empty translation is empty, and not in its language", () => {
    renderReview({ translation: { ...TRANSLATION, text: "" } });
    expect(version(CURRENT).textContent).toBe("Empty");
    // The word is the admin's, not German.
    expect(version(CURRENT).querySelector("[lang]")).toBeNull();
  });

  it("says the wording is the same where no word changed", () => {
    renderReview({ source: { ...SOURCE, after: SOURCE.before ?? "" } });
    expect(screen.getByText(SAME_WORDING)).toBeVisible();
    expect(version(EARLIER).textContent).toBe("The quick fox");
    expect(version(NOW).textContent).toBe("The quick fox");
    expect(marked(group(), "del")).toEqual([]);
    expect(marked(group(), "ins")).toEqual([]);
  });

  it("does not say the wording is the same where a word changed", () => {
    renderReview();
    expect(screen.queryByText(SAME_WORDING)).toBeNull();
  });
});

describe("OutOfDateReview, who edited the translation", () => {
  const NOT_KNOWN = "It isn't known whether a person edited this.";
  const SENTENCES: [origin: string, sentence: string][] = [
    ["person", "Last edited by a person."],
    ["agent", "Written by an agent. Not edited by a person."],
    ["machine", "Machine translated. Not edited by a person."],
    ["integration", "Written by an integration. Not edited by a person."],
    ["import", "Imported. Not edited by a person."],
    ["copy", "Copied from another language. Not edited by a person."],
  ];

  /** The sentences on show that answer the question, whichever they are. */
  const shown = (): string[] =>
    screen.getAllByText(/a person/).map(sentence => sentence.textContent ?? "");

  it.each(SENTENCES)("says it for the origin %s", (origin, sentence) => {
    renderReview({ translation: { ...TRANSLATION, origin } });
    expect(shown()).toEqual([sentence]);
  });

  it.each([
    ["unknown", "unknown"],
    ["original", "original"],
    ["one it does not recognise", "somewhere-else"],
    ["one written in another case", "Person"],
    ["an empty one", ""],
    ["one named as every object's own method", "toString"],
  ])("says it isn't known for an origin that is %s", (_name, origin) => {
    renderReview({ translation: { ...TRANSLATION, origin } });
    expect(shown()).toEqual([NOT_KNOWN]);
  });

  it("says it isn't known where no origin is recorded", () => {
    renderReview({
      translation: { language: GERMAN, text: "Der schnelle Fuchs" },
    });
    expect(shown()).toEqual([NOT_KNOWN]);
  });

  it("says it isn't known where the origin is undefined", () => {
    renderReview({ translation: { ...TRANSLATION, origin: undefined } });
    expect(shown()).toEqual([NOT_KNOWN]);
  });
});

describe("OutOfDateReview, language and direction", () => {
  /** Every element in the review, itself included, that sets the attribute. */
  const setting = (attribute: "lang" | "dir"): Element[] =>
    [group(), ...group().querySelectorAll("*")].filter(element =>
      element.hasAttribute(attribute)
    );

  it("sets an Arabic translation right to left beside an English source", () => {
    renderReview({
      translation: { language: ARABIC, text: "الثعلب السريع" },
    });
    const translation = valueIn("Current Arabic translation");
    expect(translation).toHaveAttribute("lang", "ar");
    expect(translation).toHaveAttribute("dir", "rtl");
    expect(translation.textContent).toBe("الثعلب السريع");
    for (const name of [EARLIER, NOW]) {
      expect(valueIn(name)).toHaveAttribute("lang", "en");
      expect(valueIn(name)).toHaveAttribute("dir", "ltr");
    }
  });

  it("sets an Arabic source right to left beside an English translation", () => {
    renderReview({
      source: {
        language: ARABIC,
        before: "الثعلب السريع",
        after: "الثعلب البطيء",
      },
      translation: { language: ENGLISH, text: "The quick fox" },
    });
    for (const name of ["Arabic, earlier version", "Arabic now"]) {
      expect(valueIn(name)).toHaveAttribute("lang", "ar");
      expect(valueIn(name)).toHaveAttribute("dir", "rtl");
    }
    const translation = valueIn("Current English translation");
    expect(translation).toHaveAttribute("lang", "en");
    expect(translation).toHaveAttribute("dir", "ltr");
    // The marks sit inside the text's own direction.
    expect(marked(valueIn("Arabic, earlier version"), "del")).toEqual([
      "السريع",
    ]);
    expect(marked(valueIn("Arabic now"), "ins")).toEqual(["البطيء"]);
  });

  it("sets an Arabic source right to left where nothing is compared", () => {
    renderReview({
      source: { language: ARABIC, before: null, after: "الثعلب البطيء" },
    });
    expect(valueIn("Arabic now")).toHaveAttribute("lang", "ar");
    expect(valueIn("Arabic now")).toHaveAttribute("dir", "rtl");
  });

  it("sets them on the three values and on nothing around them", () => {
    renderReview({
      translation: { language: ARABIC, text: "الثعلب السريع" },
    });
    const values = [EARLIER, NOW, "Current Arabic translation"].map(valueIn);
    expect(setting("dir")).toEqual(values);
    expect(setting("lang")).toEqual(values);
    expect(group()).not.toHaveAttribute("dir");
    expect(group()).not.toHaveAttribute("lang");
  });
});

describe("OutOfDateReview, the actions", () => {
  it("reaches Keep current, then Edit, then the suggestion's actions by Tab", async () => {
    const user = userEvent.setup();
    renderReview({
      suggestionActions: (
        <>
          <button type="button">Use suggestion</button>
          <button type="button">Discard suggestion</button>
        </>
      ),
    });
    await user.tab();
    expect(keepButton()).toHaveFocus();
    await user.tab();
    expect(editButton()).toHaveFocus();
    await user.tab();
    expect(
      screen.getByRole("button", { name: "Use suggestion" })
    ).toHaveFocus();
    await user.tab();
    expect(
      screen.getByRole("button", { name: "Discard suggestion" })
    ).toHaveFocus();
  });

  it("activates Keep current with Enter and with Space", async () => {
    const user = userEvent.setup();
    const { onKeepCurrent, onEdit } = renderReview();
    await user.tab();
    await user.keyboard("{Enter}");
    expect(onKeepCurrent).toHaveBeenCalledTimes(1);
    await user.keyboard(" ");
    expect(onKeepCurrent).toHaveBeenCalledTimes(2);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("activates Edit with Enter and with Space", async () => {
    const user = userEvent.setup();
    const { onKeepCurrent, onEdit } = renderReview();
    await user.tab();
    await user.tab();
    await user.keyboard("{Enter}");
    expect(onEdit).toHaveBeenCalledTimes(1);
    await user.keyboard(" ");
    expect(onEdit).toHaveBeenCalledTimes(2);
    expect(onKeepCurrent).not.toHaveBeenCalled();
  });

  it("reports Keep current and changes no text on show", async () => {
    const user = userEvent.setup();
    const { onKeepCurrent, onEdit } = renderReview();
    const before = group().textContent;
    await user.click(keepButton());
    expect(onKeepCurrent).toHaveBeenCalledTimes(1);
    // With nothing: the choice is the whole report.
    expect(onKeepCurrent).toHaveBeenCalledWith();
    expect(onEdit).not.toHaveBeenCalled();
    expect(version(CURRENT).textContent).toBe("Der schnelle Fuchs");
    expect(group().textContent).toBe(before);
  });

  it("reports Edit and changes no text on show", async () => {
    const user = userEvent.setup();
    const { onKeepCurrent, onEdit } = renderReview();
    const before = group().textContent;
    await user.click(editButton());
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith();
    expect(onKeepCurrent).not.toHaveBeenCalled();
    expect(version(CURRENT).textContent).toBe("Der schnelle Fuchs");
    expect(group().textContent).toBe(before);
  });

  it("names the review and its actions for their field", () => {
    renderReview({ fieldLabel: "Summary" });
    const review = screen.getByRole("group", { name: "Out of date: Summary" });
    const keep = within(review).getByRole("button", {
      name: "Keep current: Summary",
    });
    const edit = within(review).getByRole("button", { name: "Edit: Summary" });
    // The name begins with the words on the button, so it can be spoken.
    expect(keep.textContent).toBe("Keep current");
    expect(edit.textContent).toBe("Edit");
  });

  it("offers no actions to someone who may only read, and shows the rest", () => {
    renderReview({
      readOnly: true,
      suggestionActions: <button type="button">Use suggestion</button>,
    });
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(marked(version(EARLIER), "del")).toEqual(["quick"]);
    expect(marked(version(NOW), "ins")).toEqual(["slow"]);
    expect(version(CURRENT).textContent).toBe("Der schnelle Fuchs");
    expect(screen.getByText("Last edited by a person.")).toBeInTheDocument();
  });

  it("takes no second choice while one is being saved, and keeps focus", async () => {
    const user = userEvent.setup();
    const { onKeepCurrent, onEdit } = renderReview({ busy: true });
    expect(keepButton()).toHaveAttribute("aria-disabled", "true");
    expect(editButton()).toHaveAttribute("aria-disabled", "true");
    await user.tab();
    expect(keepButton()).toHaveFocus();
    await user.keyboard("{Enter}");
    await user.tab();
    expect(editButton()).toHaveFocus();
    await user.keyboard("{Enter}");
    await user.click(keepButton());
    await user.click(editButton());
    expect(onKeepCurrent).not.toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("puts nothing in place of a suggestion's actions where there are none", () => {
    renderReview();
    // Nodes and not only elements, so a stray text counts too.
    expect(Array.from(actionsRow().childNodes)).toEqual([
      keepButton(),
      editButton(),
    ]);
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("puts a suggestion's actions in the row, after the review's own", () => {
    renderReview({
      suggestionActions: <button type="button">Use suggestion</button>,
    });
    expect(within(actionsRow()).getAllByRole("button")).toEqual([
      keepButton(),
      editButton(),
      screen.getByRole("button", { name: "Use suggestion" }),
    ]);
  });
});
