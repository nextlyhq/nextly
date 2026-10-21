/**
 * The settings sheet's Done: what the sheet does while the change is being kept, when it has
 * been, when it was refused, and when it cannot be kept at all.
 *
 * Where the change goes is the cell's business (`ArrangedCell`'s `doneFor`); the sheet hears
 * only how it ended, so these hand it an `onDone` that settles when the test says.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnyWidgetSetting } from "nextly/config";
import { describe, expect, it, vi } from "vitest";

import { WidgetSettingsSheet, type DoneSettled } from "../WidgetSettingsSheet";

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({}),
  useBrandingStatus: () => ({
    isPending: false,
    isUnavailable: false,
    isBrandingUnavailable: false,
  }),
}));

const SETTINGS: AnyWidgetSetting[] = [
  { name: "items", type: "number", label: "Number of items", defaultValue: 5 },
];

/** The sheet over an `onDone` that waits, and how to end that wait. */
function sheet(blocked?: string) {
  let settled: DoneSettled | undefined;
  const onDone = vi.fn((_config: Record<string, unknown>, s: DoneSettled) => {
    settled = s;
  });
  const onOpenChange = vi.fn();
  render(
    <WidgetSettingsSheet
      open
      onOpenChange={onOpenChange}
      title="Recent posts"
      settings={SETTINGS}
      config={undefined}
      onDone={onDone}
      {...(blocked === undefined ? {} : { blocked })}
    />
  );
  return { onDone, onOpenChange, settle: () => settled! };
}

const done = () => screen.getByRole("button", { name: /^(Done|Saving…)$/ });
const cancel = () => screen.getByRole("button", { name: "Cancel" });

describe("the settings sheet's Done", () => {
  it("stays open while the change is being kept, with Done and Cancel off", async () => {
    const { onDone, onOpenChange } = sheet();
    await userEvent.click(done());
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(done()).toHaveTextContent("Saving…");
    expect(done()).toBeDisabled();
    expect(cancel()).toBeDisabled();
    // Escape does not close it mid-save either.
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("closes once the change has been kept", async () => {
    const { onDone, onOpenChange, settle } = sheet();
    await userEvent.click(done());
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    act(() => settle().saved());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("stays open and says why, in place, when the change was refused", async () => {
    const { onDone, onOpenChange, settle } = sheet();
    await userEvent.click(done());
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    act(() =>
      settle().failed(
        "Recent posts changed elsewhere, so this change was not saved."
      )
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Recent posts changed elsewhere, so this change was not saved."
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    // And Done can be pressed again.
    expect(done()).toHaveTextContent("Done");
    expect(done()).toBeEnabled();
  });

  it("says why Done cannot keep a change, and leaves Done off", () => {
    const reason =
      "Your saved dashboard cannot be read, so card settings cannot be saved. Reload the page or reset the dashboard.";
    sheet(reason);
    expect(screen.getByText(reason)).toBeInTheDocument();
    expect(done()).toBeDisabled();
  });
});
