/**
 * A contributed component inside the document's form keeps to itself: a
 * button or a key press of the plugin's never submits or resets the document,
 * a form of its own still works, and the page's own Save still saves however
 * focus was left.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { IsolatedContribution } from "../IsolatedContribution";

/** The document's form, with a contribution inside it, as the editors draw. */
function documentWith(contribution: ReactNode) {
  const save = vi.fn();
  const reset = vi.fn();
  render(
    <form
      onSubmit={event => {
        event.preventDefault();
        save();
      }}
      onReset={() => reset()}
    >
      <input aria-label="Title" defaultValue="Hello" />
      <IsolatedContribution>{contribution}</IsolatedContribution>
      <button type="submit">Save</button>
    </form>
  );
  return { save, reset };
}

describe("a contribution inside the document's form", () => {
  it("does not save the document when a plain button of the plugin's is clicked", async () => {
    const pluginAction = vi.fn();
    const { save } = documentWith(
      <button onClick={pluginAction}>Escalate</button>
    );

    await userEvent.click(screen.getByRole("button", { name: "Escalate" }));
    expect(pluginAction).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });

  it("does not reset the document when a reset button of the plugin's is clicked", async () => {
    const { reset } = documentWith(<button type="reset">Clear</button>);

    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(reset).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Title")).toHaveValue("Hello");
  });

  it("does not save the document on Enter in an input of the plugin's", async () => {
    const { save } = documentWith(<input aria-label="Ticket" />);

    await userEvent.type(screen.getByLabelText("Ticket"), "42{Enter}");
    expect(save).not.toHaveBeenCalled();
  });

  it("lets a form of the plugin's own submit, and only it", async () => {
    const ownSubmit = vi.fn();
    const { save } = documentWith(
      <form
        onSubmit={event => {
          event.preventDefault();
          ownSubmit();
        }}
      >
        <input aria-label="Note" />
        <button type="submit">Send</button>
      </form>
    );

    await userEvent.type(screen.getByLabelText("Note"), "hi{Enter}");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(ownSubmit).toHaveBeenCalledTimes(2);
    expect(save).not.toHaveBeenCalled();
  });

  it("still saves the document from its own Save while focus sits in the plugin's input", () => {
    const { save } = documentWith(<input aria-label="Ticket" />);

    // As Safari clicks: the button takes no focus, which stays in the
    // plugin's field.
    screen.getByLabelText("Ticket").focus();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(save).toHaveBeenCalledTimes(1);
  });
});
