/**
 * The System health card as a reader sees it, drawn inside the frame: one
 * status line, the facts with their chips and actions, healthy and with each
 * problem; the connection's danger and "Couldn't check"; the version that
 * could not be checked; and Details, with the runtime and plugins.
 *
 * @module components/features/dashboard/SystemHealthCard.test
 */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { DeclaredComponentProps } from "nextly/widget-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { inFrame } from "@admin/components/features/widgets/__tests__/in-frame";

import { SystemHealthCard } from "./SystemHealthCard";

function props(data: unknown): DeclaredComponentProps {
  return {
    widgetId: "core/system-health",
    placementId: "health-1",
    settings: {},
    size: { w: 6, h: 4, tier: "medium" },
    data,
    refreshing: false,
    retry: () => undefined,
  };
}

const DOCS = "https://nextlyhq.com/docs/database/encrypted-connections";

const HEALTHY = {
  version: "0.0.2-alpha.74",
  latest: { status: "latest", version: "0.0.2-alpha.74" },
  environment: { production: true },
  database: {
    dialect: "postgresql",
    serverVersion: "17.2",
    roundTripMs: 4,
    encryption: "encrypted",
    exposed: true,
  },
  migrations: { status: "ok", failed: 0, pending: 0 },
  schemaChanges: { failed: [], more: 0 },
  storage: { status: "ok", type: "vercel-blob" },
  email: { provider: "Resend" },
  jobs: { queued: 2, running: 0, failed: 0 },
  runtime: { node: "24.11.0", next: "16.0.1", react: "19.2.0" },
  plugins: [
    { name: "@nextlyhq/plugin-form-builder", version: "0.0.2-alpha.74" },
    { name: "@nextlyhq/plugin-seo", version: "0.0.2-alpha.74" },
  ],
};

function draw(data: unknown) {
  render(inFrame(<SystemHealthCard {...props(data)} />, "System health"));
  const card = screen.getByTestId("system-health");
  return {
    card,
    status: within(card).getByTestId("system-health-status"),
    fact: (id: string) => within(card).getByTestId(`system-health-${id}`),
  };
}

/** The names of the card's facts, in order, as drawn. */
const factNames = (card: HTMLElement) =>
  Array.from(card.querySelectorAll("dt")).map(dt => dt.textContent);

describe("the System health card", () => {
  it("says everything is working, then eight facts, for a healthy install", () => {
    const { card, status, fact } = draw(HEALTHY);
    expect(status.textContent).toBe("Everything is working");
    expect(status.getAttribute("data-tone")).toBe("success");
    expect(factNames(card)).toEqual([
      "Nextly",
      "Environment",
      "Database",
      "Connection",
      "Migrations",
      "Storage",
      "Email",
      "Background jobs",
    ]);
    expect(fact("version").textContent).toBe("0.0.2-alpha.74Latest");
    expect(fact("database").textContent).toBe("PostgreSQL 17.2 · 4 ms");
    expect(fact("connection").textContent).toBe("EncryptedOK");
    expect(fact("jobs").textContent).toBe("2 queued · 0 failed (24 h)");
    // Nothing to fix, so nothing to follow but Details.
    expect(within(card).queryAllByRole("link")).toHaveLength(0);
  });

  it("marks an unencrypted connection to another machine in production as a risk, with How to fix", () => {
    const { status, fact } = draw({
      ...HEALTHY,
      database: { ...HEALTHY.database, encryption: "unencrypted" },
      migrations: { status: "pending", failed: 0, pending: 1 },
    });
    expect(status.textContent).toBe("2 problems need attention");
    expect(status.getAttribute("data-tone")).toBe("destructive");
    const connection = fact("connection");
    expect(
      within(connection).getByTestId("system-health-value").textContent
    ).toBe("Not encrypted");
    expect(
      within(connection).getByTestId("system-health-chip").textContent
    ).toBe("Risk");
    const fix = within(connection).getByRole("link", { name: "How to fix" });
    expect(fix.getAttribute("href")).toBe(DOCS);
    expect(fix.getAttribute("target")).toBe("_blank");
    expect(fix.getAttribute("rel")).toContain("noopener");
    expect(fact("migrations").textContent).toContain("1 pending");
  });

  it("draws a connection it could not check as Couldn't check with a warning, never encrypted", () => {
    const { status, fact } = draw({
      ...HEALTHY,
      database: { ...HEALTHY.database, encryption: "unknown" },
    });
    expect(status.textContent).toBe("1 thing to check");
    expect(status.getAttribute("data-tone")).toBe("warning");
    const connection = fact("connection");
    expect(connection.textContent).toContain("Couldn't check");
    expect(connection.textContent).not.toContain("Encrypted");
    expect(
      within(connection)
        .getByTestId("system-health-chip")
        .querySelector('[data-slot="badge-dot"]')?.className
    ).toContain("bg-warning-solid");
  });

  it("draws no connection line for SQLite", () => {
    const { card } = draw({
      ...HEALTHY,
      database: {
        dialect: "sqlite",
        encryption: "not-applicable",
        exposed: false,
      },
    });
    expect(factNames(card)).not.toContain("Connection");
    expect(within(card).queryByTestId("system-health-connection")).toBeNull();
  });

  it("shows the installed version with Couldn't check for updates, counting nothing", () => {
    const { status, fact } = draw({
      ...HEALTHY,
      latest: { status: "unknown" },
    });
    expect(fact("version").textContent).toBe(
      "0.0.2-alpha.74Couldn't check for updates"
    );
    expect(fact("version").textContent).not.toContain("Latest");
    expect(status.textContent).toBe("Everything is working");
  });

  it("draws each problem with its chip and where to go about it", () => {
    const { status, fact } = draw({
      ...HEALTHY,
      migrations: { status: "failed", failed: 1, pending: 0 },
      schemaChanges: { failed: [{ slug: "posts", label: "Posts" }], more: 0 },
      storage: {
        status: "failed",
        type: "s3",
        failedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
        adapter: "s3",
        reason: "The storage service could not be reached.",
      },
      email: { provider: null },
      jobs: { queued: 0, running: 0, failed: 4 },
    });
    expect(status.textContent).toBe(
      "3 problems need attention · 2 things to check"
    );
    const migrations = fact("migrations");
    expect(
      within(migrations)
        .getByRole("link", { name: "Fix Posts" })
        .getAttribute("href")
    ).toBe("/admin/builder/collections/posts");
    expect(
      within(migrations)
        .getByRole("link", { name: "How to resolve" })
        .getAttribute("target")
    ).toBe("_blank");
    const storage = fact("storage");
    expect(storage.textContent).toContain("Last write failed 2m ago");
    expect(
      within(storage).getByTestId("system-health-detail").textContent
    ).toBe("The storage service could not be reached. · s3");
    expect(
      within(storage)
        .getByRole("link", { name: "Open media" })
        .getAttribute("href")
    ).toBe("/admin/media");
    expect(fact("email").textContent).toContain("Not set up");
    expect(fact("jobs").textContent).toContain("4 failed (24 h)");
  });

  it("opens Details with every fact, the runtime and each plugin", () => {
    draw(HEALTHY);
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    const details = screen.getByTestId("system-health-details");
    expect(within(details).getByText("For super-admins")).toBeTruthy();
    expect(within(details).getByText("Everything is working")).toBeTruthy();
    expect(
      factNames(within(details).getByTestId("system-health-facts"))
    ).toHaveLength(8);
    const runtime = within(details).getByTestId("system-health-runtime");
    expect(
      Array.from(runtime.querySelectorAll("dt,dd")).map(
        cell => cell.textContent
      )
    ).toEqual(["Node", "24.11.0", "Next.js", "16.0.1", "React", "19.2.0"]);
    expect(within(details).getByText("Plugins (2)")).toBeTruthy();
    expect(
      Array.from(
        within(details)
          .getByTestId("system-health-plugins")
          .querySelectorAll("dt")
      ).map(cell => cell.textContent)
    ).toEqual(["plugin-form-builder", "plugin-seo"]);
  });

  describe("while it stays open", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("ages the storage failure on the clock, with no new answer", () => {
      vi.useFakeTimers();
      vi.setSystemTime(Date.parse("2026-10-30T10:00:00.000Z"));
      draw({
        ...HEALTHY,
        storage: {
          status: "failed",
          failedAt: "2026-10-30T10:00:00.000Z",
          adapter: "s3",
        },
      });
      expect(screen.getByTestId("system-health-storage").textContent).toContain(
        "Last write failed just now"
      );
      // 🔴 Derived only when the answer changed, and batches do not poll: the
      // failure read "just now" for as long as the dashboard was open.
      act(() => {
        vi.advanceTimersByTime(5 * 60 * 1000);
      });
      expect(screen.getByTestId("system-health-storage").textContent).toContain(
        "Last write failed 5m ago"
      );
    });
  });
});
