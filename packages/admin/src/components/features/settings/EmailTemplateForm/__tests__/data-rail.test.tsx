/**
 * The Data panel's sample JSON is a named code field that reports what the
 * author types, and says when it doesn't parse.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { EditorView } from "@uiw/react-codemirror";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { DataRail } from "../DataRail";
import type { TemplateVariableCheck } from "../useTemplateVariables";

beforeAll(
  () =>
    import("@admin/components/features/entries/fields/text/CodeMirrorEditor"),
  60_000
);

const CLEAR: TemplateVariableCheck = { undeclared: [], missing: [] };

function mount(
  sampleError: string | null = null,
  check: TemplateVariableCheck = CLEAR,
  onDeclare?: (name: string) => void
) {
  const onSampleChange = vi.fn();
  render(
    <DataRail
      sampleText={'{ "userName": "Ada" }'}
      onSampleChange={onSampleChange}
      onReset={() => {}}
      sampleError={sampleError}
      check={check}
      onDeclare={onDeclare}
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

describe("the Data panel's variable check", () => {
  const check: TemplateVariableCheck = {
    undeclared: [{ name: "order", paths: ["order.number", "order.lines"] }],
    missing: ["order.number", "currency"],
  };

  it("lists a variable used but not declared, by every path it's read by, and declares it", () => {
    const onDeclare = vi.fn();
    mount(null, check, onDeclare);
    const undeclared = screen.getByTestId("undeclared-variables");
    expect(undeclared.textContent).toContain("{{order.number}}");
    expect(undeclared.textContent).toContain("{{order.lines}}");
    fireEvent.click(screen.getByRole("button", { name: "Declare order" }));
    expect(onDeclare).toHaveBeenCalledWith("order");
  });

  it("offers no Declare where the declarations are locked", () => {
    mount(null, check);
    expect(screen.getByTestId("undeclared-variables")).toBeDefined();
    expect(screen.queryByRole("button", { name: /^Declare/ })).toBeNull();
  });

  it("lists what shows blank: no test value and no fallback", () => {
    mount(null, check);
    const missing = screen.getByTestId("missing-values");
    expect(missing.textContent).toContain("{{currency}}");
    expect(missing.textContent).toContain("{{order.number}}");
  });

  it("says so when everything used is declared and has a value", () => {
    mount();
    expect(screen.queryByTestId("undeclared-variables")).toBeNull();
    expect(screen.queryByTestId("missing-values")).toBeNull();
    expect(
      screen.getByText("Every variable used is declared and has a value.")
    ).toBeDefined();
  });
});
