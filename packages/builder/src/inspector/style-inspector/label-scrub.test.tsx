// @vitest-environment jsdom

/**
 * The row's slot between a label and its field, driven with a stand-in field
 * so the row's own rules are what is under test: a drag reused for another
 * subject ends unwritten, and the field shows its new subject's value.
 *
 * @module label-scrub.test
 */
import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LabelScrubRow,
  useLabelScrub,
  useLabelScrubProps,
  type LabelScrubField,
} from "./label-scrub";

afterEach(() => {
  cleanup();
});

/** A pointer event carrying the fields the gesture and React read. */
function pointer(type: string, clientX: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    pointerId: 1,
    button: 0,
    clientX,
    clientY: 0,
    pointerType: "mouse",
    shiftKey: false,
    altKey: false,
  });
  return event;
}

function Label(): React.JSX.Element {
  return <label {...useLabelScrubProps()}>Size</label>;
}

function Field({ field }: { field: LabelScrubField }): null {
  useLabelScrub(field);
  return null;
}

function fieldSpies() {
  return {
    origin: "12px",
    at: (_from: LabelScrubField["origin"], delta: number) => `${12 + delta}px`,
    draft: "12",
    show: vi.fn<LabelScrubField["show"]>(),
    commit: vi.fn<LabelScrubField["commit"]>(),
    reset: vi.fn<LabelScrubField["reset"]>(),
  } satisfies LabelScrubField;
}

describe("LabelScrubRow", () => {
  it("ends a drag unwritten when the row is reused for another subject", () => {
    const field = fieldSpies();
    const row = (subject: string) => (
      <LabelScrubRow subject={subject}>
        <Label />
        <Field field={field} />
      </LabelScrubRow>
    );
    const { rerender, container } = render(row("a"));
    const label = container.querySelector("label") as HTMLElement;

    act(() => {
      label.dispatchEvent(pointer("pointerdown", 100));
    });
    act(() => {
      document.dispatchEvent(pointer("pointermove", 110));
    });
    expect(field.show).toHaveBeenLastCalledWith("22px");

    rerender(row("b"));
    act(() => {
      document.dispatchEvent(pointer("pointerup", 110));
    });

    expect(field.commit).not.toHaveBeenCalled();
    // The new subject's value, not the text the field held for the old one.
    expect(field.reset).toHaveBeenCalledTimes(1);
    expect(field.show).not.toHaveBeenLastCalledWith("12");
  });

  it("writes a drag on the same subject once, on release", () => {
    const field = fieldSpies();
    const { container } = render(
      <LabelScrubRow subject="a">
        <Label />
        <Field field={field} />
      </LabelScrubRow>
    );
    const label = container.querySelector("label") as HTMLElement;
    act(() => {
      label.dispatchEvent(pointer("pointerdown", 100));
    });
    act(() => {
      document.dispatchEvent(pointer("pointermove", 110));
      document.dispatchEvent(pointer("pointerup", 110));
    });
    expect(field.commit).toHaveBeenCalledTimes(1);
    expect(field.commit).toHaveBeenCalledWith("22px");
    expect(field.reset).not.toHaveBeenCalled();
  });
});
