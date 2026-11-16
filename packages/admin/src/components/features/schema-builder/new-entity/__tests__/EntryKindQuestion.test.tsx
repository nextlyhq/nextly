/**
 * The question of what editors will make draws its chosen card as the admin's
 * other chosen cards are drawn: a primary border on a faint primary tint of
 * the dialog's own background, so the card's label and hint keep the contrast
 * they have on that background. The accent fill is a colour a brand can set to
 * anything, so neither card is drawn on it, chosen or hovered.
 *
 * The contrast itself is measured in the browser, in both colour schemes, by
 * the create dialog's end-to-end accessibility test; jsdom paints nothing.
 */
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { render } from "@admin/__tests__/utils";
import {
  STANDARD_FIELDS,
  type StartingFieldChoice,
} from "@admin/lib/builder/starting-field";

import { EntryKindQuestion } from "../EntryKindQuestion";

const PAGES: StartingFieldChoice = {
  type: "blocks",
  label: "Pages you design visually",
  hint: "Each page is laid out from blocks in the Page Builder.",
};

/** The card (its label) that holds the radio named `name`. */
function cardOf(name: string): HTMLElement {
  const card = screen
    .getByRole("radio", { name: new RegExp(name) })
    .closest("label");
  if (!card) throw new Error(`no card holds ${name}`);
  return card;
}

/** Whether `card` paints the accent fill, at rest or on hover. */
function drawsOnAccent(card: HTMLElement): boolean {
  return [...card.classList].some(name => /(^|:)bg-accent(\/|$)/.test(name));
}

describe("EntryKindQuestion", () => {
  it("draws the chosen card on a faint primary tint, and no card on the accent fill", () => {
    render(
      <EntryKindQuestion
        choices={[STANDARD_FIELDS, PAGES]}
        value={undefined}
        onChange={vi.fn()}
      />
    );
    const chosen = cardOf(STANDARD_FIELDS.label);
    const other = cardOf(PAGES.label);

    expect(
      screen.getByRole("radio", { name: /Standard fields/ })
    ).toBeChecked();
    expect(chosen).toHaveClass("border-primary", "bg-primary/5");
    expect(other).not.toHaveClass("border-primary");
    expect(drawsOnAccent(chosen)).toBe(false);
    expect(drawsOnAccent(other)).toBe(false);
  });
});
