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
import { useState } from "react";
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

  it("freezes the form and Reset while the change is being kept, and gives them back if refused", async () => {
    // 🔴 The save carries the values Done was pressed on. A field changed while it ran was
    // dropped without a word when the sheet closed, and after a refusal the form no longer said
    // what had been refused.
    const { onDone, settle } = sheet();
    const items = () =>
      screen.getByRole("spinbutton", { name: /Number of items/ });
    const reset = () =>
      screen.getByRole("button", { name: "Reset to defaults" });
    expect(items()).toBeEnabled();
    await userEvent.click(done());
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(items()).toBeDisabled();
    expect(reset()).toBeDisabled();
    act(() => settle().failed("This change was not saved."));
    expect(items()).toBeEnabled();
    expect(reset()).toBeEnabled();
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

/*
 * The settings and the stored config are held at module level, as a card holds them between
 * renders. Written inline they are new objects on every render, the sheet rebuilds its baseline
 * each time, and a form that writes into that baseline goes unseen.
 */
const NOTHING_STORED: Record<string, unknown> | undefined = undefined;
const HEADING: AnyWidgetSetting[] = [
  { name: "heading", type: "text", label: "Heading" },
];
const STORED_HEADING: Record<string, unknown> = { heading: "Stored" };

describe("opening the settings sheet on its first field", () => {
  /** The sheet with something focusable ahead of the form, where the sheet's own choice lands. */
  function opened(focusFirstField: boolean) {
    render(
      <WidgetSettingsSheet
        open
        onOpenChange={vi.fn()}
        title="Recent posts"
        settings={SETTINGS}
        config={undefined}
        onDone={vi.fn()}
        focusFirstField={focusFirstField}
        renderPreview={() => <button type="button">Ahead of the form</button>}
      />
    );
  }

  it("puts focus on the first field when asked, as a card's empty state asks", async () => {
    opened(true);
    await waitFor(() =>
      expect(
        screen.getByRole("spinbutton", { name: /Number of items/ })
      ).toHaveFocus()
    );
  });

  it("leaves focus where the sheet puts it otherwise", async () => {
    // The control: without the option, focus lands ahead of the form, so the case above is the
    // option's doing.
    opened(false);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Ahead of the form" })
      ).toHaveFocus()
    );
  });
});

describe("reopening the settings sheet", () => {
  function Harness(props: {
    settings: AnyWidgetSetting[];
    config: Record<string, unknown> | undefined;
  }) {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open again
        </button>
        <WidgetSettingsSheet
          open={open}
          onOpenChange={setOpen}
          title="Recent posts"
          settings={props.settings}
          config={props.config}
          onDone={() => {}}
        />
      </>
    );
  }

  async function cancelAndReopen() {
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
    await userEvent.click(screen.getByRole("button", { name: "Open again" }));
  }

  it("opens on the default, not on a change the reader cancelled", async () => {
    render(<Harness settings={SETTINGS} config={NOTHING_STORED} />);
    const items = () =>
      screen.getByRole("spinbutton", { name: /Number of items/ });
    await userEvent.clear(items());
    await userEvent.type(items(), "2");
    await cancelAndReopen();
    expect(items()).toHaveValue(5);
  });

  it("opens on what is stored, not on a change the reader cancelled", async () => {
    render(<Harness settings={HEADING} config={STORED_HEADING} />);
    const heading = () => screen.getByRole("textbox", { name: /Heading/ });
    await userEvent.clear(heading());
    await userEvent.type(heading(), "Cancelled");
    await cancelAndReopen();
    expect(heading()).toHaveValue("Stored");
  });
});

describe("the settings sheet's preview", () => {
  it("is handed what Done would keep, as the reader changes the form", async () => {
    const renderPreview = vi.fn(() => null);
    render(
      <WidgetSettingsSheet
        open
        onOpenChange={() => {}}
        title="Recent posts"
        settings={[{ name: "heading", type: "text", label: "Heading" }]}
        config={undefined}
        onDone={() => {}}
        renderPreview={renderPreview}
      />
    );
    // Nothing changed yet, so nothing would be kept.
    expect(renderPreview).toHaveBeenLastCalledWith({});
    await userEvent.type(
      screen.getByRole("textbox", { name: /Heading/ }),
      "Latest"
    );
    await waitFor(() =>
      expect(renderPreview).toHaveBeenLastCalledWith({ heading: "Latest" })
    );
  });
});
