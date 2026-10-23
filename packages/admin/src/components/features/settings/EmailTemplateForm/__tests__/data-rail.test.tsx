/**
 * The Data panel's sample JSON is a named code field that reports what the
 * author types, and says when it doesn't parse.
 */
import { act, render, screen } from "@testing-library/react";
import { EditorView } from "@uiw/react-codemirror";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { DataRail } from "../DataRail";

beforeAll(
  () =>
    import("@admin/components/features/entries/fields/text/CodeMirrorEditor"),
  60_000
);

function mount(sampleError: string | null = null) {
  const onSampleChange = vi.fn();
  render(
    <DataRail
      sampleText={'{ "userName": "Ada" }'}
      onSampleChange={onSampleChange}
      onReset={() => {}}
      sampleError={sampleError}
      unknownVariables={[]}
    />
  );
  return onSampleChange;
}

describe("the Data panel", () => {
  it("edits the sample data in a named code field", async () => {
    const onSampleChange = mount();
    const field = await screen.findByRole(
      "textbox",
      { name: "Sample data" },
      { timeout: 5000 }
    );
    const view = EditorView.findFromDOM(field)!;
    act(() => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: "{}" },
      });
    });
    expect(onSampleChange).toHaveBeenLastCalledWith("{}", expect.anything());
  });

  it("says when the sample data isn't JSON, on the field itself", async () => {
    mount("Unexpected token");
    const message = screen.getByText("Invalid JSON: Unexpected token");
    const field = await screen.findByRole(
      "textbox",
      { name: "Sample data" },
      { timeout: 5000 }
    );
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.getAttribute("aria-describedby")).toBe(message.id);
    expect(message.id).not.toBe("");
  });

  it("marks valid sample data as valid", async () => {
    mount();
    const field = await screen.findByRole(
      "textbox",
      { name: "Sample data" },
      { timeout: 5000 }
    );
    expect(field.getAttribute("aria-invalid")).toBe("false");
    expect(field.getAttribute("aria-describedby")).toBeNull();
  });
});
