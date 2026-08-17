// @vitest-environment jsdom
/**
 * An outline badge's border colour belongs to whoever renders it.
 *
 * The variant used to mark its border colour important, so a caller asking for
 * a different one lost silently: the class was present in the list and the
 * marked declaration still won in the cascade. Seven call sites were affected,
 * including a status pill carrying a stated 3:1 contrast reason for the colour
 * it asks for.
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Badge } from "./badge";

function borderClassesOf(node: Element | null): string[] {
  return [...(node?.classList ?? [])].filter(c => c.includes("border"));
}

describe("outline badge border colour", () => {
  it("is not important-marked, so a caller's colour can win", () => {
    const { container } = render(<Badge variant="outline">x</Badge>);
    const marked = borderClassesOf(container.firstElementChild).filter(c =>
      c.endsWith("!")
    );
    expect(
      marked,
      "An important-marked border colour cannot be overridden by the caller " +
        "or by a theme, and the base sets no border colour for it to resolve " +
        "against — so the only thing it wins against is deliberate intent."
    ).toEqual([]);
  });

  it("still draws a default border when the caller asks for nothing", () => {
    const { container } = render(<Badge variant="outline">x</Badge>);
    expect(borderClassesOf(container.firstElementChild)).toContain(
      "border-border"
    );
  });
});
