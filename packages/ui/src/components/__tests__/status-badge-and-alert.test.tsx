// @vitest-environment jsdom
/**
 * Status colour comes from the status tokens, and quietly. A status badge is a
 * neutral chip whose dot, not its fill, carries the colour, so the word is the
 * signal and the dot only marks it. An alert keeps the page's own text: info
 * and success are plain cards, warning and destructive sit on their status
 * surface inside its border, the icon takes the status's text colour, and none
 * carries a coloured side bar. The numbered tint shades (`success-100`) are the
 * look these replace, so their return is what each assertion rules out.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Alert } from "../alert";
import { Badge } from "../badge";

afterEach(cleanup);

/** Any numbered status shade, such as `bg-success-100` or `text-warning-700`. */
const TINT = /\b(?:bg|text|border)-(?:success|warning|destructive)-\d{2,3}\b/;

const STATUS_DOT = {
  success: "bg-success-solid",
  warning: "bg-warning-solid",
  destructive: "bg-danger-solid",
  info: "bg-info-solid",
} as const;

describe("a status badge", () => {
  it.each(Object.entries(STATUS_DOT))(
    "%s is a neutral chip with a dot in its status's solid colour",
    (variant, dotClass) => {
      render(
        <Badge variant={variant as keyof typeof STATUS_DOT}>Published</Badge>
      );
      const chip = screen.getByText("Published");
      const dot = chip.querySelector('[data-slot="badge-dot"]');

      expect(dot, "the status dot is drawn").not.toBeNull();
      expect(dot?.getAttribute("aria-hidden")).toBe("true");
      // The admin neutralises every `[data-slot^="badge."]` inside a table,
      // so a dot named under that prefix renders grey there.
      expect(dot?.getAttribute("data-slot")).not.toMatch(/^badge\./);
      expect(dot?.className).toContain(dotClass);
      // The dot comes first, then the word, which carries the meaning.
      expect(chip.firstChild).toBe(dot);
      expect(chip.className).toContain("bg-card");
      expect(chip.className).toContain("text-foreground");
      expect(chip.className).not.toMatch(TINT);
    }
  );

  it("draws no dot on a badge that is not a status", () => {
    render(<Badge>Built-in</Badge>);
    expect(
      screen.getByText("Built-in").querySelector('[data-slot="badge-dot"]')
    ).toBeNull();
  });
});

describe("an alert", () => {
  const cases = [
    ["info", ["bg-card", "border-border", "[&>svg]:text-info-text"]],
    ["success", ["bg-card", "border-border", "[&>svg]:text-success-text"]],
    [
      "warning",
      [
        "bg-warning-surface",
        "border-warning-border",
        "[&>svg]:text-warning-text",
      ],
    ],
    [
      "destructive",
      ["bg-danger-surface", "border-danger-border", "[&>svg]:text-danger-text"],
    ],
  ] as const;

  it.each(cases)(
    "%s keeps the page's text and colours only its surface and icon",
    (variant, expected) => {
      render(<Alert variant={variant}>Saved.</Alert>);
      const alert = screen.getByRole("alert");
      for (const cls of expected) expect(alert.className).toContain(cls);
      expect(alert.className).toContain("text-foreground");
      expect(alert.className).not.toMatch(TINT);
      expect(alert.className, "no coloured side bar").not.toMatch(
        /\bborder-l-\d/
      );
    }
  );
});
