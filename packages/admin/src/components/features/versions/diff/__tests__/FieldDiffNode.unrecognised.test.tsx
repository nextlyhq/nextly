/**
 * Guards the fail-safe for a node kind this build cannot draw.
 *
 * The switch this protects had no `default`, so an unrecognised kind returned
 * nothing and the field VANISHED from the comparison — which reads exactly like
 * a field that did not change, the one conclusion that must never be reached by
 * accident. Unreachable while the union is exhaustive at compile time; reachable
 * the moment a server can send a kind a client predates.
 */
import { describe, expect, it } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import type { FieldDiff } from "@admin/services/versionApi";

import { FieldDiffNode } from "../FieldDiffNode";

/**
 * A node shaped like one from a newer server. Built through `unknown` rather
 * than a cast to `FieldDiff`, so the fixture models a wire value the local
 * types do not describe instead of lying about the union.
 */
function fromNewerServer(): FieldDiff {
  const wire: unknown = {
    kind: "from-a-later-release",
    name: "mystery",
    label: "Mystery",
    type: "x",
    status: "changed",
  };
  return wire as FieldDiff;
}

describe("FieldDiffNode — a kind this build does not know", () => {
  it("names the field and says it changed, rather than rendering nothing", () => {
    render(<FieldDiffNode node={fromNewerServer()} />);
    expect(screen.getByText("Mystery")).toBeInTheDocument();
    expect(
      screen.getByText(/cannot display the comparison/i)
    ).toBeInTheDocument();
  });

  it("still shows the status badge, so the change is not lost", () => {
    render(<FieldDiffNode node={fromNewerServer()} />);
    expect(screen.getByText("Changed")).toBeInTheDocument();
  });
});
