/**
 * Opening a card's settings before the sheet's code has arrived still opens a
 * panel that holds focus and says it is loading.
 *
 * The menu and popover that open the sheet close themselves without handing
 * focus back, so with nothing drawn while the code loads, focus fell to the
 * page and the action looked lost. The sheet's module is held back here, so the
 * test sees the dashboard as it stands on a slow connection.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const chunk = vi.hoisted(() => {
  let release: () => void = () => undefined;
  const arrived = new Promise<void>(resolve => {
    release = resolve;
  });
  return { arrived, release: () => release() };
});

vi.mock("../WidgetSettingsSheet", async () => {
  await chunk.arrived;
  return {
    WidgetSettingsSheet: ({ title }: { title: string }) => (
      <div role="dialog" aria-label={`${title} settings form`} />
    ),
  };
});

const { LazyWidgetSettingsSheet } = await import("../LazyWidgetSettingsSheet");

describe("the card settings sheet while its code loads", () => {
  it("opens a panel named for the card, takes focus into it, says it is loading, then gives way to the sheet", async () => {
    render(
      <LazyWidgetSettingsSheet
        open
        onOpenChange={vi.fn()}
        title="Notes"
        settings={[]}
        config={undefined}
        onDone={vi.fn()}
      />
    );

    const panel = await screen.findByRole("dialog", { name: "Notes settings" });
    expect(within(panel).getByRole("status")).toHaveTextContent(
      "Loading settings…"
    );
    await waitFor(() =>
      expect(panel).toContainElement(document.activeElement as HTMLElement)
    );
    expect(document.activeElement).not.toBe(document.body);

    chunk.release();
    expect(
      await screen.findByRole("dialog", { name: "Notes settings form" })
    ).toBeInTheDocument();
    expect(screen.queryByText("Loading settings…")).toBeNull();
  });
});
