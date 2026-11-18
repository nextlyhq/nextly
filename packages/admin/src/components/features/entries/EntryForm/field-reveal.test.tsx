// @vitest-environment jsdom
/**
 * The editor's side of "Show me": the surface below registers how it shows
 * a field, the latest function is the one asked, and nothing is asked once
 * the surface has gone.
 */
import { render } from "@testing-library/react";
import type { JSX } from "react";
import { describe, expect, it } from "vitest";

import {
  FieldRevealScope,
  useFieldReveal,
  useRevealField,
  type FieldReveal,
} from "./field-reveal";

let asked: FieldReveal | null | undefined;

/** What the refusal's message reads, beside the surface. */
function Asker(): null {
  asked = useFieldReveal();
  return null;
}

function Surface({ shows }: { shows: string | null }): null {
  useRevealField(
    shows === null ? null : path => (path === shows ? () => {} : null)
  );
  return null;
}

function Host({
  shows,
  mounted = true,
}: {
  shows: string | null;
  mounted?: boolean;
}): JSX.Element {
  return (
    <FieldRevealScope>
      <Asker />
      {mounted ? <Surface shows={shows} /> : null}
    </FieldRevealScope>
  );
}

describe("how a surface shows a field a refused save names", () => {
  it("asks the surface below, by its latest function", () => {
    const view = render(<Host shows="summary" />);
    expect(asked?.("summary")).toBeTypeOf("function");
    expect(asked?.("body")).toBeNull();

    view.rerender(<Host shows="body" />);
    expect(asked?.("summary")).toBeNull();
    expect(asked?.("body")).toBeTypeOf("function");
  });

  it("answers nothing once the surface has gone, or says it shows nothing", () => {
    const view = render(<Host shows={null} />);
    expect(asked?.("summary")).toBeNull();

    view.rerender(<Host shows="summary" mounted={false} />);
    expect(asked?.("summary")).toBeNull();
  });

  it("does nothing outside an editor that asks, and answers nothing there", () => {
    expect(() => render(<Surface shows="summary" />)).not.toThrow();
    render(<Asker />);
    expect(asked).toBeNull();
  });
});
