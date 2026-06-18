import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PluginComponentBoundary } from "./index";

const Boom = (): never => {
  throw new Error("plugin blew up");
};

describe("PluginComponentBoundary", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders children when they do not throw", () => {
    render(
      <PluginComponentBoundary componentPath="@p/x#Ok">
        <div>healthy</div>
      </PluginComponentBoundary>
    );
    expect(screen.getByText("healthy")).toBeInTheDocument();
  });

  it("renders a contained, identifiable fallback when a child throws", () => {
    // React logs caught render errors to console.error — silence for a clean run.
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <PluginComponentBoundary componentPath="@p/x#Boom">
        <Boom />
      </PluginComponentBoundary>
    );
    expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
    expect(screen.getByText("@p/x#Boom")).toBeInTheDocument();
  });

  it("renders a custom fallback when provided", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <PluginComponentBoundary
        componentPath="@p/x#Boom"
        fallback={<div>custom fallback</div>}
      >
        <Boom />
      </PluginComponentBoundary>
    );
    expect(screen.getByText("custom fallback")).toBeInTheDocument();
  });
});
