/**
 * A preview shows what a document held at an earlier point. The states that
 * matter are the ones that could mislead: a field that was blank then, and a
 * snapshot that failed to load.
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

    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(screen.getByText("World")).toBeInTheDocument();
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

    expect(screen.getByText("Subtitle")).toBeInTheDocument();
    expect(screen.getByText("Not set")).toBeInTheDocument();
  });

  it("tolerates a snapshot that is not an object", () => {
    render(
      <VersionPreview versionNo={3} fields={fields} snapshot={"corrupt"} />
    );

    expect(screen.getAllByText("Not set")).toHaveLength(2);
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

    expect(screen.getByText("City")).toBeInTheDocument();
    expect(screen.getByText("Lisbon")).toBeInTheDocument();
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
