import { useForm, FormProvider } from "react-hook-form";
import { describe, it, expect, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { EntrySystemHeader } from "../EntrySystemHeader";

function Harness({ lockIdentity }: { lockIdentity?: boolean }) {
  const methods = useForm({ defaultValues: { title: "Homepage" } });
  return (
    <FormProvider {...methods}>
      <EntrySystemHeader
        mode="edit"
        hasStatus
        entry={{ id: "homepage", status: "draft", title: "Homepage" }}
        collectionSlug="homepage"
        scope="single"
        lockIdentity={lockIdentity}
        onSaveDraft={vi.fn()}
        onPublish={vi.fn()}
        onSaveChanges={vi.fn()}
        onUnpublish={vi.fn()}
        onCancel={vi.fn()}
      />
    </FormProvider>
  );
}

describe("EntrySystemHeader — lockIdentity", () => {
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
});
