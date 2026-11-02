// @vitest-environment jsdom
/**
 * The Help dialog, from the registry it reads.
 *
 * Mounted the way the admin mounts the editor: the page's provider outside,
 * the editor's own nested inside it on the same target. What these pin is that
 * Help says what the keyboard does here and nothing it does not: the editor's
 * bindings and the page's both listed, a key both bind listed once with the
 * editor's binding that takes it, a binding registered while Help is open
 * appearing without reopening it, and the documentation opening on its own.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ShortcutProvider, useShortcuts } from "@nextlyhq/ui";
import * as React from "react";
import { describe, expect, it } from "vitest";

import { PAGE_BUILDER_DOCS } from "./docs-links";
import { HelpDialog } from "./help-dialog";

/** Each binding's description as it runs, for asking which one a key ran. */
let ran: string[] = [];

function Bind({
  name,
  keys,
  description,
}: {
  name: string;
  keys: string;
  description: string;
}) {
  useShortcuts([{ keys, description, run: () => ran.push(description) }], {
    name,
  });
  return null;
}

/** The page's bindings: its save, and the Escape that leaves it. */
function Page({ children }: { children?: React.ReactNode }) {
  return (
    <ShortcutProvider isApple={false}>
      <Bind name="entry-form" keys="mod+s" description="Save entry" />
      <Bind
        name="entry-form-escape"
        keys="Escape"
        description="Cancel and go back"
      />
      {children}
    </ShortcutProvider>
  );
}

/** The editor nested in it, as the shell installs its own provider. */
function Editor({ children }: { children?: React.ReactNode }) {
  return (
    <ShortcutProvider isApple={false}>
      <Bind
        name="builder-block-actions"
        keys="mod+d"
        description="Duplicate the selected block"
      />
      <Bind
        name="builder-canvas-escape"
        keys="Escape"
        description="Clear the block selection"
      />
      {children}
      <Help />
    </ShortcutProvider>
  );
}

let setHelpOpen: (open: boolean) => void = () => {};

/** Help, open unless a test closes it. */
function Help() {
  const [open, setOpen] = React.useState(true);
  setHelpOpen = setOpen;
  return <HelpDialog open={open} onOpenChange={setOpen} />;
}

function list() {
  return screen.getByRole("region", { name: "Keyboard shortcuts" });
}

describe("HelpDialog", () => {
  it("lists the editor's shortcuts and the page's around it", () => {
    render(
      <Page>
        <Editor />
      </Page>
    );
    expect(list().textContent).toContain("Duplicate the selected block");
    expect(list().textContent).toContain("Save entry");
    // The platform's menu key is listed by hand.
    expect(list().textContent).toContain("Open the block's menu");
  });

  it("lists a key both bind once, with the binding the key runs", () => {
    render(
      <Page>
        <Editor />
      </Page>
    );
    // Asked of the manager itself rather than assumed, so the test holds
    // whatever decides precedence: Help must name what pressing the key does.
    // The dialog's hold blocks the keyboard while it is open, so the key is
    // pressed with the dialog closed.
    ran = [];
    act(() => setHelpOpen(false));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(ran).toEqual(["Clear the block selection"]);
    act(() => setHelpOpen(true));

    expect(list().textContent).toContain("Clear the block selection");
    expect(list().textContent).not.toContain("Cancel and go back");
  });

  it("shows a binding registered while it is open", () => {
    function Later() {
      const [on, setOn] = React.useState(false);
      React.useEffect(() => {
        laterOn = () => setOn(true);
      }, []);
      return on ? (
        <Bind
          name="publish"
          keys="mod+shift+p"
          description="Publish the page"
        />
      ) : null;
    }
    let laterOn = () => {};
    render(
      <Page>
        <Editor>
          <Later />
        </Editor>
      </Page>
    );
    expect(list().textContent).not.toContain("Publish the page");

    act(() => laterOn());

    expect(list().textContent).toContain("Publish the page");
  });

  it("links to the documentation in a new tab", () => {
    render(<Editor />);
    for (const doc of PAGE_BUILDER_DOCS) {
      const link = screen.getByRole("link", { name: doc.label });
      expect(link.getAttribute("href")).toBe(doc.href);
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    }
  });
});
