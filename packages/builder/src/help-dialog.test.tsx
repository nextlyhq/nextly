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
import { HelpDialog, type PanelKeysSetting } from "./help-dialog";

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
      <Bind name="entry-form" keys="mod+s" description="Save" />
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
function Editor({
  children,
  panelKeys,
}: {
  children?: React.ReactNode;
  panelKeys?: PanelKeysSetting;
}) {
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
      <Help panelKeys={panelKeys} />
    </ShortcutProvider>
  );
}

let setHelpOpen: (open: boolean) => void = () => {};

/** Help, open unless a test closes it. */
function Help({ panelKeys }: { panelKeys?: PanelKeysSetting }) {
  const [open, setOpen] = React.useState(true);
  setHelpOpen = setOpen;
  return (
    <HelpDialog
      open={open}
      onOpenChange={setOpen}
      {...(panelKeys === undefined ? {} : { panelKeys })}
    />
  );
}

function list() {
  return screen.getByRole("region", { name: "Keyboard shortcuts" });
}

describe("HelpDialog with the editor's panel keys", () => {
  // The family every editor's panel-key layer is named after, and this
  // editor's own layer in it.
  const FAMILY = "Editor panels";
  const LAYER = `${FAMILY} own`;
  const layers = {
    keys: "l",
    description: "Open or close Layers",
    layer: LAYER,
  };
  const setting = (on: boolean, shortcuts = [layers]) => ({
    on,
    onChange: () => {},
    shortcuts,
    layer: LAYER,
    family: FAMILY,
  });

  it("keeps a panel key's row over a page binding below it on the same key", () => {
    // The panel key takes "l"; a row placed after the page's would lose it.
    render(
      <Page>
        <Bind name="page-l" keys="l" description="Page's own L" />
        <Editor panelKeys={setting(true)}>
          <Bind name={LAYER} keys="l" description="Open or close Layers" />
        </Editor>
      </Page>
    );
    expect(list().textContent).toContain("Open or close Layers");
    expect(list().textContent).not.toContain("Page's own L");
  });

  it("places its rows at its own layer, not at a second editor's above a page binding", () => {
    // Two editors on one page: the other editor's panel layer, a page binding
    // on the same key, then this editor's. The page binding takes "l" before
    // this editor does, so its row is the one Help shows.
    render(
      <Page>
        <Editor panelKeys={setting(true)}>
          {/* Registered in reverse: a later registration ranks first. */}
          <Bind name={LAYER} keys="l" description="Open or close Layers" />
          <Bind name="page-between" keys="l" description="Page's own L" />
          <Bind name={`${FAMILY} other`} keys="l" description="Other L" />
        </Editor>
      </Page>
    );
    const text = list().textContent ?? "";
    expect(text).not.toContain("Other L");
    expect(text).toContain("Page's own L");
    expect(text).not.toContain("Open or close Layers");
  });

  it("names in the switch's hint only the keys this editor offers", () => {
    render(
      <Page>
        <Editor
          panelKeys={setting(true, [
            { keys: "a", description: "Open or close Add", layer: LAYER },
            layers,
          ])}
        />
      </Page>
    );
    const hint = screen.getByRole("switch", {
      name: "Single-letter shortcuts",
    });
    expect(hint.getAttribute("aria-describedby")).not.toBeNull();
    const text =
      document.getElementById(hint.getAttribute("aria-describedby") ?? "")
        ?.textContent ?? "";
    expect(text).toMatch(/^A and L open panels\./);
  });
});

describe("HelpDialog", () => {
  it("lists the editor's shortcuts and the page's around it", () => {
    render(
      <Page>
        <Editor />
      </Page>
    );
    expect(list().textContent).toContain("Duplicate the selected block");
    expect(list().textContent).toContain("Save");
    // The platform's menu key is listed by hand.
    expect(list().textContent).toContain(
      "Open the block's menu from a link or button inside it"
    );
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
