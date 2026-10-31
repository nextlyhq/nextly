/**
 * When the settings sheet's code cannot be fetched, the failure stays inside
 * the panel, with Try again, and a retry that succeeds opens the form: the
 * dashboard is never thrown into its error boundary for the session.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const fetches = vi.hoisted(() => ({ count: 0 }));

vi.mock("../WidgetSettingsSheet", () => {
  fetches.count += 1;
  if (fetches.count === 1) throw new Error("chunk missing after a deploy");
  return {
    WidgetSettingsSheet: ({ title }: { title: string }) => (
      <div role="dialog" aria-label={`${title} settings form`} />
    ),
  };
});

const { LazyWidgetSettingsSheet } = await import("../LazyWidgetSettingsSheet");

describe("the card settings sheet when its code cannot be fetched", () => {
  it("says so in the panel with Try again, and a retry opens the form", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const user = userEvent.setup();
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
    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      "Settings could not be loaded"
    );
    await user.click(within(panel).getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByRole("dialog", { name: "Notes settings form" })
    ).toBeInTheDocument();
    expect(fetches.count).toBe(2);
    consoleError.mockRestore();
  });
});
