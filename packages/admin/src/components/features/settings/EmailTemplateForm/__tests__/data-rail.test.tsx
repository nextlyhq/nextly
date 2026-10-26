/**
 * The Data panel: the test data as a field per declared variable, or as the
 * JSON it is, both editing the same data; and its check of the variables the
 * template uses.
 *
 * Mounted with the form's own state rules (`buildSampleData`, `sampleFrom`,
 * `editedValues`), so what a field shows and what the preview receives are
 * read from the same data the form keeps.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { EditorView } from "@uiw/react-codemirror";
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { DataRail } from "../DataRail";
import {
  buildSampleData,
  editedValues,
  sampleFrom,
  type SampleDeclaration,
  type SampleEdits,
} from "../sample-data";
import type { TemplateVariableCheck } from "../useTemplateVariables";

beforeAll(
  () =>
    import("@admin/components/features/entries/fields/text/CodeMirrorEditor"),
  60_000
);

const CLEAR: TemplateVariableCheck = { undeclared: [], missing: [] };

const ORDER: SampleDeclaration[] = [
  {
    name: "customer",
    presentation: { type: "text", label: "Customer", example: "Ada" },
  },
  { name: "count", presentation: { type: "number", example: 3 } },
  { name: "total", presentation: { type: "money", example: 12.5 } },
  { name: "placed", presentation: { type: "date", example: "2026-10-01" } },
  {
    name: "track",
    presentation: { type: "link", example: "https://example.com/t/1" },
  },
  { name: "gift", presentation: { type: "boolean", example: true } },
  {
    name: "lines",
    presentation: {
      type: "list",
      label: "Order lines",
      fields: [
        { name: "title", type: "text", label: "Title" },
        { name: "price", type: "money", label: "Price" },
      ],
      example: [{ title: "Tea", price: 4 }],
    },
  },
  {
    name: "address",
    presentation: {
      type: "object",
      label: "Address",
      fields: [{ name: "city", type: "text", label: "City" }],
      example: { city: "Lahore" },
    },
  },
];

/** The panel, holding its data the way the form does. */
function Harness({
  variables,
  check = CLEAR,
  onDeclare,
}: {
  variables: SampleDeclaration[];
  check?: TemplateVariableCheck;
  onDeclare?: (name: string) => void;
}) {
  const [edits, setEdits] = useState<SampleEdits | null>(null);
  const { data, text, error } = sampleFrom(buildSampleData(variables), edits);
  return (
    <>
      <DataRail
        sampleText={text}
        sampleData={data}
        variables={variables}
        onFieldChange={(name, value) =>
          setEdits(current => ({
            values: { ...editedValues(current), [name]: value },
          }))
        }
        onJsonChange={json => setEdits({ json })}
        onReset={() => setEdits(null)}
        sampleError={error}
        check={check}
        onDeclare={onDeclare}
      />
      <output data-testid="data">{JSON.stringify(data)}</output>
    </>
  );
}

/** The data the panel holds now. */
const data = () =>
  JSON.parse(screen.getByTestId("data").textContent ?? "{}") as Record<
    string,
    unknown
  >;

async function jsonEditor(): Promise<EditorView> {
  fireEvent.click(screen.getByRole("button", { name: "JSON" }));
  const field = await screen.findByRole(
    "textbox",
    { name: "Test data" },
    { timeout: 5000 }
  );
  return EditorView.findFromDOM(field)!;
}

function typeJson(view: EditorView, text: string) {
  act(() => {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
    });
  });
}

describe("the Data panel's fields", () => {
  it("draws a field of each kind, starting from the declared examples", () => {
    render(<Harness variables={ORDER} />);
    expect(screen.getByLabelText("Customer")).toHaveProperty("value", "Ada");
    expect(screen.getByLabelText("count")).toHaveProperty("type", "number");
    expect(screen.getByLabelText("total")).toHaveProperty("step", "0.01");
    expect(screen.getByLabelText("placed")).toHaveProperty("type", "date");
    expect(screen.getByLabelText("track")).toHaveProperty("type", "url");
    expect(screen.getByRole("switch", { name: "gift" })).toHaveProperty(
      "ariaChecked",
      "true"
    );
    expect(screen.getByLabelText("City")).toHaveProperty("value", "Lahore");
  });

  it("keeps a number a number, and a date as the date typed", () => {
    render(<Harness variables={ORDER} />);
    fireEvent.change(screen.getByLabelText("count"), {
      target: { value: "7" },
    });
    fireEvent.change(screen.getByLabelText("placed"), {
      target: { value: "2026-12-24" },
    });
    expect(data()).toMatchObject({ count: 7, placed: "2026-12-24" });
  });

  it("switches a yes/no value", () => {
    render(<Harness variables={ORDER} />);
    fireEvent.click(screen.getByRole("switch", { name: "gift" }));
    expect(data().gift).toBe(false);
  });

  it("adds, edits and removes a list's rows", () => {
    render(<Harness variables={ORDER} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Add a row to Order lines" })
    );
    const rows = screen.getAllByTestId("row-lines");
    expect(rows).toHaveLength(2);
    fireEvent.change(within(rows[1]).getByLabelText("Title"), {
      target: { value: "Cake" },
    });
    fireEvent.change(within(rows[1]).getByLabelText("Price"), {
      target: { value: "6.5" },
    });
    expect(data().lines).toEqual([
      { title: "Tea", price: 4 },
      { title: "Cake", price: 6.5 },
    ]);

    fireEvent.click(
      screen.getByRole("button", { name: "Remove row 1 of Order lines" })
    );
    expect(data().lines).toEqual([{ title: "Cake", price: 6.5 }]);
  });

  it("edits an object's fields in place", () => {
    render(<Harness variables={ORDER} />);
    fireEvent.change(screen.getByLabelText("City"), {
      target: { value: "Karachi" },
    });
    expect(data().address).toEqual({ city: "Karachi" });
  });

  it("starts a variable declared later from its own value, beside what was edited", () => {
    const { rerender } = render(<Harness variables={ORDER.slice(0, 1)} />);
    fireEvent.change(screen.getByLabelText("Customer"), {
      target: { value: "Grace" },
    });
    rerender(<Harness variables={ORDER.slice(0, 2)} />);
    expect(data()).toMatchObject({ customer: "Grace", count: 3 });
  });

  it("says so when nothing is declared", () => {
    render(<Harness variables={[]} />);
    expect(screen.getByText(/No variables are declared/)).toBeDefined();
  });

  it("resets to the starting values", () => {
    render(<Harness variables={ORDER} />);
    fireEvent.change(screen.getByLabelText("Customer"), {
      target: { value: "Grace" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(data().customer).toBe("Ada");
  });
});

describe("the Data panel's JSON", () => {
  it("shows the fields' edits, and its own edits reach the fields", async () => {
    render(<Harness variables={ORDER} />);
    fireEvent.change(screen.getByLabelText("Customer"), {
      target: { value: "Grace" },
    });

    const view = await jsonEditor();
    expect(JSON.parse(view.state.doc.toString()).customer).toBe("Grace");

    typeJson(view, JSON.stringify({ ...data(), customer: "Linus" }));
    fireEvent.click(screen.getByRole("button", { name: "Fields" }));
    expect(screen.getByLabelText("Customer")).toHaveProperty("value", "Linus");
  });

  it("says when it isn't JSON, on the field itself, and the fields say so too", async () => {
    render(<Harness variables={ORDER} />);
    const view = await jsonEditor();
    typeJson(view, "{ not json");
    const message = await screen.findByText(/^Invalid JSON:/);
    const field = screen.getByRole("textbox", { name: "Test data" });
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.getAttribute("aria-describedby")).toBe(message.id);

    fireEvent.click(screen.getByRole("button", { name: "Fields" }));
    expect(screen.getByText(/The JSON doesn.t parse/)).toBeDefined();
  });

  it("marks valid JSON as valid", async () => {
    render(<Harness variables={ORDER} />);
    await jsonEditor();
    const field = screen.getByRole("textbox", { name: "Test data" });
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
    render(<Harness variables={[]} check={check} onDeclare={onDeclare} />);
    const undeclared = screen.getByTestId("undeclared-variables");
    expect(undeclared.textContent).toContain("{{order.number}}");
    expect(undeclared.textContent).toContain("{{order.lines}}");
    fireEvent.click(screen.getByRole("button", { name: "Declare order" }));
    expect(onDeclare).toHaveBeenCalledWith("order");
  });

  it("offers no Declare where the declarations are locked", () => {
    render(<Harness variables={[]} check={check} />);
    expect(screen.getByTestId("undeclared-variables")).toBeDefined();
    expect(screen.queryByRole("button", { name: /^Declare/ })).toBeNull();
  });

  it("lists what shows blank: no test value and no fallback", () => {
    render(<Harness variables={[]} check={check} />);
    const missing = screen.getByTestId("missing-values");
    expect(missing.textContent).toContain("{{currency}}");
    expect(missing.textContent).toContain("{{order.number}}");
  });

  it("says so when everything used is declared and has a value", () => {
    render(<Harness variables={[]} />);
    expect(screen.queryByTestId("undeclared-variables")).toBeNull();
    expect(screen.queryByTestId("missing-values")).toBeNull();
    expect(
      screen.getByText("Every variable used is declared and has a value.")
    ).toBeDefined();
  });
});
