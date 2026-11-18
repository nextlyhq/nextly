// @vitest-environment jsdom
/**
 * The Style tab's text field writes as it is typed into a block, and only
 * when the edit ends into a shared style: a shared style is stored on the
 * site at once, so a write per keystroke would put half-typed values on every
 * page that wears it.
 *
 * @module style-text-field.live.test
 */
import { STYLE_CATALOG, type StyleValue } from "@nextlyhq/blocks-engine";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { styleControlsFor } from "./style-controls";
import {
  BLOCK_TARGET,
  StyleTargetContext,
  type CommitOutcome,
} from "./style-field-surroundings";
import { TextField, useDraft } from "./style-text-field";
import type { StyleTarget } from "./style-target";

afterEach(cleanup);

/** The catalog's opacity control, a plain typed value. */
function opacityControl() {
  const property = (
    STYLE_CATALOG as unknown as readonly { property: string }[]
  ).find(each => each.property === "opacity");
  if (property === undefined) throw new Error("no opacity in the catalog");
  const control = styleControlsFor(property as never).controls[0];
  if (control === undefined) throw new Error("no opacity control");
  return control;
}

const SHARED: StyleTarget = {
  kind: "shared",
  worn: [],
  readOnly: undefined,
  write: async () => undefined,
  style: {
    id: "c-card",
    name: "Card",
    slug: "card",
    className: ".nx-c-card",
    locked: false,
    inCode: false,
    styles: {},
  },
};

function Field({
  onCommit,
}: {
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): React.JSX.Element {
  const [stored, setStored] = React.useState<StyleValue | undefined>(0.5);
  const { draft, setDraft, live } = useDraft(stored);
  return (
    <TextField
      id="opacity"
      control={opacityControl()}
      stored={stored}
      draft={draft}
      setDraft={setDraft}
      tokens={undefined}
      describedBy={undefined}
      invalid={false}
      live={live}
      onCommit={value => {
        const outcome = onCommit(value);
        if (outcome === "applied") setStored(value ?? undefined);
        return outcome;
      }}
    />
  );
}

function mount(target: StyleTarget) {
  const onCommit = vi.fn(
    (_value: StyleValue | null): CommitOutcome => "applied"
  );
  render(
    <StyleTargetContext.Provider value={target}>
      <Field onCommit={onCommit} />
    </StyleTargetContext.Provider>
  );
  return { onCommit, field: screen.getByRole("textbox") as HTMLInputElement };
}

describe("a typed style value", () => {
  it("is written as it is typed into a block", () => {
    const { onCommit, field } = mount(BLOCK_TARGET);
    fireEvent.change(field, { target: { value: "0.8" } });
    expect(onCommit).toHaveBeenCalledWith(0.8);
    expect(field.value).toBe("0.8");
  });

  it("is written into a shared style only when the edit ends", () => {
    const { onCommit, field } = mount(SHARED);
    fireEvent.change(field, { target: { value: "0.8" } });
    fireEvent.change(field, { target: { value: "0.85" } });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(field);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(0.85);
  });
});
