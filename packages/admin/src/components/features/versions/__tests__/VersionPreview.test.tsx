/**
 * A preview shows what a document held at an earlier point, drawn by the
 * editor's own field components. The states that matter are the ones that
 * could mislead: a field that was blank then, a snapshot that failed to load,
 * and — since these are the real inputs — any suggestion that the past can be
 * edited from here.
 */
import userEvent from "@testing-library/user-event";
import type { FieldConfig } from "nextly/config";
import { describe, it, expect, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { VersionPreview } from "../VersionPreview";

const fields = [
  { name: "title", type: "text", label: "Title" },
  { name: "subtitle", type: "text", label: "Subtitle" },
] as FieldConfig[];

describe("VersionPreview", () => {
  it("renders each field's stored value", () => {
    render(
      <VersionPreview
        versionNo={3}
        fields={fields}
        snapshot={{ title: "Hello", subtitle: "World" }}
      />
    );

    // Values sit in the editor's own inputs now, so they are display values
    // rather than text nodes. Queried by the label a reader sees, so a field
    // that lost its labelling would fail here too.
    expect(screen.getByLabelText(/Title/)).toHaveValue("Hello");
    expect(screen.getByLabelText(/Subtitle/)).toHaveValue("World");
  });

  it("renders the past read-only, with no way to edit it", () => {
    render(
      <VersionPreview
        versionNo={3}
        fields={fields}
        snapshot={{ title: "Hello", subtitle: "World" }}
      />
    );

    // The whole point of drawing a version in the editor's components is that
    // it must not become a way to edit the past.
    for (const label of [/Title/, /Subtitle/]) {
      expect(screen.getByLabelText(label)).toHaveAttribute("readonly");
    }
    // And nothing in here may offer to write: this subtree renders under its
    // own form context, so a save affordance would act on the snapshot.
    expect(screen.queryByRole("button", { name: /save|publish/i })).toBeNull();
  });

  it("says plainly which version is on screen and that it is not live", () => {
    render(<VersionPreview versionNo={7} fields={fields} snapshot={{}} />);

    expect(screen.getByText(/Viewing version 7/)).toBeInTheDocument();
    expect(screen.getByText(/not\s+what is live/)).toBeInTheDocument();
  });

  it("shows a field the snapshot has no value for rather than omitting it", () => {
    // Omitting it would hide that the field was blank at this point, which is
    // exactly what someone comparing versions is looking for.
    render(
      <VersionPreview
        versionNo={3}
        fields={fields}
        snapshot={{ title: "Hello" }}
      />
    );

    expect(screen.getByLabelText(/Subtitle/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Subtitle/)).toHaveValue("");
  });

  it("tolerates a snapshot that is not an object", () => {
    render(
      <VersionPreview versionNo={3} fields={fields} snapshot={"corrupt"} />
    );

    // Not a crash and not a claim: every field reads as holding nothing, which
    // is the truthful rendering of a snapshot that carries no values.
    expect(screen.getByLabelText(/Title/)).toHaveValue("");
    expect(screen.getByLabelText(/Subtitle/)).toHaveValue("");
  });

  it("announces loading without claiming the document is empty", () => {
    render(
      <VersionPreview
        versionNo={3}
        fields={fields}
        snapshot={undefined}
        isLoading
      />
    );

    expect(screen.getByRole("status")).toHaveTextContent(/Loading/);
    expect(screen.queryByText("Not set")).not.toBeInTheDocument();
  });

  it("offers an in-place retry when a version fails to load", async () => {
    // Without it the only recovery is going back and reopening the same
    // version, which is the same request with extra steps.
    const onRetry = vi.fn();
    render(
      <VersionPreview
        versionNo={3}
        fields={fields}
        snapshot={undefined}
        error={new Error("boom")}
        onRetry={onRetry}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("names the locale a version was captured in", () => {
    render(
      <VersionPreview versionNo={3} fields={fields} snapshot={{}} locale="de" />
    );

    expect(screen.getByText(/\(de\)/)).toBeInTheDocument();
  });

  it("renders the children of a top-level presentational group", () => {
    // A nameless group stores its children at this level; dropping it would
    // hide every field inside from the historical document.
    const grouped = [
      {
        name: "",
        type: "group",
        fields: [{ name: "city", type: "text", label: "City" }],
      },
    ] as FieldConfig[];

    render(
      <VersionPreview
        versionNo={3}
        fields={grouped}
        snapshot={{ city: "Lisbon" }}
      />
    );

    // The editor's own layout handling flattens a nameless group, so this is
    // no longer a case the preview treats specially — it is covered here
    // because dropping it would silently hide every field inside.
    expect(screen.getByLabelText(/City/)).toHaveValue("Lisbon");
  });

  it("reports a failed load instead of rendering an empty document", () => {
    // Rendering empty fields on error would look like a version that held
    // nothing, which is a different and wrong claim.
    render(
      <VersionPreview
        versionNo={3}
        fields={fields}
        snapshot={undefined}
        error={new Error("boom")}
      />
    );

    expect(screen.getByText(/could not be loaded/)).toBeInTheDocument();
    expect(screen.queryByText("Not set")).not.toBeInTheDocument();
  });
});

describe("VersionPreview — switching between versions", () => {
  it("shows the newly selected version's values, not the previous one's", () => {
    const { rerender } = render(
      <VersionPreview
        versionNo={3}
        fields={fields}
        snapshot={{ title: "Third", subtitle: "Older" }}
      />
    );
    expect(screen.getByLabelText(/Title/)).toHaveValue("Third");

    // The panel does not remount this between selections, so the form has to
    // follow a changed snapshot itself. Left to `defaultValues`, the heading
    // would advance while the fields stayed on the previous version — which
    // reads as the new version having those values.
    rerender(
      <VersionPreview
        versionNo={5}
        fields={fields}
        snapshot={{ title: "Fifth", subtitle: "Newer" }}
      />
    );

    expect(screen.getByText(/Viewing version 5/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Title/)).toHaveValue("Fifth");
    expect(screen.getByLabelText(/Subtitle/)).toHaveValue("Newer");
  });
});
