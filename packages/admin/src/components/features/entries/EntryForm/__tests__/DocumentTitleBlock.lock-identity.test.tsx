import { useForm, FormProvider } from "react-hook-form";
import { describe, it, expect } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { DocumentTitleBlock } from "../DocumentTitleBlock";

/**
 * When the title may be edited: not for a Single, whose title its config
 * fixes, nor under a colleague's claim; and a document being created puts the
 * cursor in it.
 */
function Harness({
  lockIdentity,
  documentLocked,
  mode = "edit",
}: {
  lockIdentity?: boolean;
  documentLocked?: boolean;
  mode?: "create" | "edit";
}) {
  const methods = useForm({ defaultValues: { title: "Homepage" } });
  return (
    <FormProvider {...methods}>
      <DocumentTitleBlock
        mode={mode}
        lockIdentity={lockIdentity}
        documentLocked={documentLocked}
      />
    </FormProvider>
  );
}

describe("DocumentTitleBlock — lockIdentity", () => {
  it("renders the title read-only with the config value when lockIdentity is set", () => {
    render(<Harness lockIdentity />);
    const input = screen.getByLabelText("Title") as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    expect(input.value).toBe("Homepage");
  });

  it("renders an editable title when lockIdentity is not set", () => {
    render(<Harness />);
    const input = screen.getByLabelText("Title") as HTMLInputElement;
    expect(input.readOnly).toBe(false);
  });

  it("renders the title read-only under a colleague's claim", () => {
    render(<Harness documentLocked />);
    expect((screen.getByLabelText("Title") as HTMLInputElement).readOnly).toBe(
      true
    );
  });

  it("puts the cursor in the title of a document being created", () => {
    render(<Harness mode="create" />);
    expect(screen.getByLabelText("Title")).toHaveFocus();
  });

  it("leaves focus alone when an existing document opens", () => {
    render(<Harness />);
    expect(screen.getByLabelText("Title")).not.toHaveFocus();
  });
});
