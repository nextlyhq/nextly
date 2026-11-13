/**
 * A code field's editor is named by the field. CodeMirror edits in a
 * contenteditable that the field's `<label>` cannot point at, so the editor
 * carries the field's name itself: its declared label, else its key made
 * readable.
 *
 * @module components/entries/fields/text/CodeInput.test
 */
import { render, screen } from "@testing-library/react";
import type { CodeFieldConfig } from "nextly/config";
import { useForm } from "react-hook-form";
import { beforeAll, describe, expect, it } from "vitest";

import { CodeInput } from "./CodeInput";

// The editor is loaded lazily; load it once up front so a test's wait is for
// the render, not for the module.
beforeAll(() => import("./CodeMirrorEditor"), 60_000);

function Harness({ field }: { field: CodeFieldConfig }) {
  const form = useForm<{ snippet: string }>({
    defaultValues: { snippet: "" },
  });
  return <CodeInput name="snippet" field={field} control={form.control} />;
}

describe("CodeInput's accessible name", () => {
  it("is the field's label", async () => {
    render(
      <Harness
        field={
          {
            type: "code",
            name: "snippet",
            label: "Embed snippet",
          } as CodeFieldConfig
        }
      />
    );
    expect(
      await screen.findByRole(
        "textbox",
        { name: "Embed snippet" },
        { timeout: 5000 }
      )
    ).toBeInTheDocument();
  });

  it("is the field's key made readable when it has no label", async () => {
    render(
      <Harness
        field={{ type: "code", name: "headScripts" } as CodeFieldConfig}
      />
    );
    const editor = await screen.findByRole("textbox", {}, { timeout: 5000 });
    expect(editor).toHaveAccessibleName("Head Scripts");
  });
});
