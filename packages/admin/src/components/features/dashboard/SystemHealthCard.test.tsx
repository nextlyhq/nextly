/**
 * The System health card as a reader sees it, drawn inside the frame: three
 * lines always, each led by a severity told by shape and named in words, and
 * a link for each problem.
 *
 * @module components/features/dashboard/SystemHealthCard.test
 */

import { render, screen, within } from "@testing-library/react";
import type { DeclaredComponentProps } from "nextly/widget-result";
import { describe, expect, it } from "vitest";

import { inFrame } from "@admin/components/features/widgets/__tests__/in-frame";

import { SystemHealthCard } from "./SystemHealthCard";

function props(data: unknown): DeclaredComponentProps {
  return {
    widgetId: "core/system-health",
    placementId: "health-1",
    settings: {},
    size: { w: 4, h: 3, tier: "medium" },
    data,
    refreshing: false,
    retry: () => undefined,
  };
}

const HEALTHY = {
  version: "1.2.3",
  migrations: { status: "ok", failed: 0, pending: 0 },
  schemaChanges: { failed: [], more: 0 },
  storage: { status: "ok" },
};

const WITH_PROBLEMS = {
  version: "1.2.3",
  migrations: { status: "failed", failed: 1, pending: 0 },
  schemaChanges: { failed: [{ slug: "posts", label: "Posts" }], more: 0 },
  storage: {
    status: "failed",
    failedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    adapter: "s3",
    reason: "The storage service could not be reached.",
  },
};

/** The shape a line's severity is drawn as: "check", "triangle" or "filled-circle". */
function shapeOf(row: HTMLElement): string | null {
  return row.querySelector("[data-shape]")?.getAttribute("data-shape") ?? null;
}

function draw(data: unknown) {
  render(inFrame(<SystemHealthCard {...props(data)} />, "System health"));
  return {
    version: screen.getByTestId("system-health-version"),
    migrations: screen.getByTestId("system-health-migrations"),
    storage: screen.getByTestId("system-health-storage"),
  };
}

describe("the System health card", () => {
  it("draws all three lines for a healthy install, each with a check named OK", () => {
    const lines = draw(HEALTHY);
    expect(lines.version.textContent).toContain("Nextly 1.2.3");
    expect(lines.migrations.textContent).toContain("Up to date");
    expect(lines.storage.textContent).toContain("Working");
    for (const row of Object.values(lines)) {
      expect(within(row).getByTestId("system-health-ok")).toBeTruthy();
      expect(shapeOf(row)).toBe("check");
      expect(within(row).getByText("OK").className).toContain("sr-only");
    }
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("marks each problem critical, names it in words, and links where to go about it", () => {
    const lines = draw(WITH_PROBLEMS);
    expect(lines.migrations.textContent).toContain("Failed");
    expect(lines.storage.textContent).toContain("Last write failed 2m ago");
    expect(
      within(lines.storage).getByTestId("system-health-detail").textContent
    ).toBe("The storage service could not be reached. · s3");
    for (const row of [lines.migrations, lines.storage]) {
      expect(within(row).getByTestId("system-health-critical")).toBeTruthy();
      expect(shapeOf(row)).toBe("filled-circle");
      expect(row.querySelector("[data-shape]")?.textContent).toBe("!");
      expect(within(row).getByText("Problem").className).toContain("sr-only");
    }
    expect(
      within(lines.migrations)
        .getByRole("link", { name: "Fix Posts" })
        .getAttribute("href")
    ).toBe("/admin/builder/collections/posts");
    const docs = within(lines.migrations).getByRole("link", {
      name: "How to resolve",
    });
    expect(docs.getAttribute("target")).toBe("_blank");
    expect(docs.getAttribute("rel")).toContain("noopener");
    expect(
      within(lines.storage)
        .getByRole("link", { name: "Open media" })
        .getAttribute("href")
    ).toBe("/admin/media");
  });

  it("marks pending migrations as a warning, by a triangle named Warning", () => {
    const lines = draw({
      ...HEALTHY,
      migrations: { status: "pending", failed: 0, pending: 3 },
    });
    expect(lines.migrations.textContent).toContain("3 pending");
    expect(
      within(lines.migrations).getByTestId("system-health-warning")
    ).toBeTruthy();
    expect(shapeOf(lines.migrations)).toBe("triangle");
    expect(within(lines.migrations).getByText("Warning")).toBeTruthy();
  });

  it("carries the anchor Needs your attention's system problems link to", () => {
    draw(HEALTHY);
    expect(screen.getByTestId("system-health").id).toBe("system-health");
  });
});
