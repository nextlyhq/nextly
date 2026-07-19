/**
 * Layout primitives (Stack/Grid/Stat) exposed to plugins via the SDK.
 *
 * They live in `@nextlyhq/ui` (no test harness there) and are consumed through
 * the admin, so their gap/column class mapping and className merge are pinned
 * here in the admin's jsdom environment — the one place with a React renderer.
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Stack, Grid, Stat } from "@nextlyhq/ui";

describe("layout primitives", () => {
  it("Stack applies flex direction and gap classes", () => {
    const { container } = render(<Stack direction="row" gap={4} />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("flex");
    expect(el.className).toContain("flex-row");
    expect(el.className).toContain("gap-4");
  });

  it("Stack merges a caller className", () => {
    const { container } = render(<Stack className="p-2" />);
    expect((container.firstChild as HTMLElement).className).toContain("p-2");
  });

  it("Grid applies column and gap classes", () => {
    const { container } = render(<Grid cols={3} gap={6} />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("grid");
    expect(el.className).toContain("grid-cols-3");
    expect(el.className).toContain("gap-6");
  });

  it("Stat renders its label and value", () => {
    const { getByText } = render(<Stat label="Users" value={42} />);
    expect(getByText("Users")).toBeTruthy();
    expect(getByText("42")).toBeTruthy();
  });
});
