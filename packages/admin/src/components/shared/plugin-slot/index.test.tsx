import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearRegistry,
  registerComponent,
} from "../../../lib/plugins/component-registry";

import { PluginSlot } from "./index";

afterEach(() => {
  clearRegistry();
  vi.restoreAllMocks();
});

describe("PluginSlot", () => {
  it("resolves and renders a registered component, passing props", () => {
    registerComponent("@p/x#Hello", (p: { name: string }) => (
      <div>hello {p.name}</div>
    ));
    render(<PluginSlot path="@p/x#Hello" props={{ name: "world" }} />);
    expect(screen.getByText("hello world")).toBeInTheDocument();
  });

  it("renders nothing (no crash) when the path is unregistered", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {}); // getComponent warns on miss
    const { container } = render(<PluginSlot path="@p/x#Missing" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the provided fallback when unregistered", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<PluginSlot path="@p/x#Missing" fallback={<div>nope</div>} />);
    expect(screen.getByText("nope")).toBeInTheDocument();
  });

  it("isolates a throwing component behind the boundary", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    registerComponent("@p/x#Boom", () => {
      throw new Error("x");
    });
    render(<PluginSlot path="@p/x#Boom" />);
    expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
  });

  it("renders nothing when path is undefined", () => {
    const { container } = render(<PluginSlot path={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
