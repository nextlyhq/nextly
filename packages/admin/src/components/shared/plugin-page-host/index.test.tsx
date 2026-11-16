/**
 * A plugin's own page is drawn inside the admin's shell from the pieces core's
 * pages use. A page that draws no `PageFrame` is drawn as a Workspace page
 * (full width, no gutter, no padding); a page that draws its own frame keeps
 * it, gets no second one, and takes the vertical rhythm a core page of its
 * type has.
 */
import { PageFrame, PageHeader } from "@nextlyhq/ui";
import { act, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearRegistry,
  registerComponent,
} from "@admin/lib/plugins/component-registry";

import { PluginPageHost } from "./index";

afterEach(() => {
  clearRegistry();
  vi.restoreAllMocks();
});

/** Every element that says it is a page frame, with its type. */
function frames(container: HTMLElement): (string | null)[] {
  return [
    ...container.querySelectorAll(
      '[data-slot="page-frame"], [data-slot="page-shell"]'
    ),
  ].map(element => element.getAttribute("data-page-type"));
}

function host(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>("[data-plugin-page]");
  if (element === null) throw new Error("the host drew no element");
  return element;
}

describe("a plugin page with no frame", () => {
  it("is drawn as a Workspace page: one frame, no gutter, no padding", () => {
    registerComponent("@p/x#Bare", () => <div>bare page</div>);
    const { container } = render(<PluginPageHost componentPath="@p/x#Bare" />);

    expect(screen.getByText("bare page")).toBeInTheDocument();
    expect(frames(container)).toEqual(["workspace"]);
    const element = host(container);
    expect(element.getAttribute("data-page-type")).toBe("workspace");
    expect(element.contains(screen.getByText("bare page"))).toBe(true);
    // No inset of any kind: neither the list gutter, nor the form's grid, nor
    // the vertical rhythm a list or form page takes.
    expect(element.className).not.toContain("nx-page-pad");
    expect(element.className).not.toContain("nx-page-shell");
    expect(element.className).not.toMatch(/\bp[xy]?-\d/);
    // Full width, on the page surface core's pages draw on.
    expect(element.className).toContain("w-full");
    expect(element.className).toContain("admin-page-container");
  });
});

describe("a plugin page that draws its own frame", () => {
  it.each(["list", "form", "editor", "workspace"] as const)(
    "keeps its %s frame and gets no second one",
    type => {
      registerComponent("@p/x#Framed", () => (
        <PageFrame type={type}>
          <PageHeader title="Reports" />
        </PageFrame>
      ));
      const { container } = render(
        <PluginPageHost componentPath="@p/x#Framed" />
      );

      expect(
        screen.getByRole("heading", { level: 1, name: "Reports" })
      ).toBeInTheDocument();
      // One frame on the page, and it is the plugin's own.
      expect(frames(container)).toEqual([type]);
      expect(host(container).hasAttribute("data-page-type")).toBe(false);
    }
  );

  it("takes the vertical rhythm a core page of its type has", () => {
    registerComponent("@p/x#List", () => (
      <PageFrame type="list">list body</PageFrame>
    ));
    const { container, unmount } = render(
      <PluginPageHost componentPath="@p/x#List" />
    );
    expect(host(container).className).toContain("py-6");
    unmount();

    registerComponent("@p/x#Editor", () => (
      <PageFrame type="editor">editor body</PageFrame>
    ));
    const editor = render(<PluginPageHost componentPath="@p/x#Editor" />);
    expect(host(editor.container).className).not.toContain("py-6");
  });

  it("is mounted once, though its frame is heard after it mounts", () => {
    const mounted = vi.fn();
    registerComponent("@p/x#Counted", () => {
      useEffect(() => {
        mounted();
      }, []);
      return <PageFrame type="list">counted</PageFrame>;
    });
    render(<PluginPageHost componentPath="@p/x#Counted" />);
    expect(screen.getByText("counted")).toBeInTheDocument();
    expect(mounted).toHaveBeenCalledTimes(1);
  });

  it("is framed by the host again once it stops drawing a frame", () => {
    let setFramed: (framed: boolean) => void = () => undefined;
    registerComponent("@p/x#Toggle", () => {
      const [framed, set] = useState(true);
      setFramed = set;
      return framed ? (
        <PageFrame type="form">toggle body</PageFrame>
      ) : (
        <div>toggle body</div>
      );
    });
    const { container } = render(
      <PluginPageHost componentPath="@p/x#Toggle" />
    );
    expect(frames(container)).toEqual(["form"]);

    // A state change inside the page, as a page switching views would make.
    act(() => setFramed(false));
    expect(frames(container)).toEqual(["workspace"]);
  });
});
