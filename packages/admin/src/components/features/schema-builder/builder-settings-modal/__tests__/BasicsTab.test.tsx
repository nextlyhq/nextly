// Why: BasicsTab is config-driven — only the fields listed in the per-kind
// `basicsFields` array should render. Auto-slug from singular name is the
// other key behavior, with the user-overrides-stop-auto-derive rule that
// SlugInput documents. These tests lock both contracts.
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import type { BuilderSettingsValues } from "../../BuilderSettingsModal";
import type { BasicsField } from "../../builder-config";
import { BasicsTab } from "../BasicsTab";

function Controlled(props: {
  fields: readonly BasicsField[];
  initial?: Partial<BuilderSettingsValues>;
  onChange?: (next: BuilderSettingsValues) => void;
}) {
  const [values, setValues] = useState<BuilderSettingsValues>({
    singularName: "",
    pluralName: "",
    slug: "",
    description: "",
    icon: "FileText",
    ...props.initial,
  });
  return (
    <BasicsTab
      fields={props.fields}
      values={values}
      onChange={next => {
        setValues(next);
        props.onChange?.(next);
      }}
    />
  );
}

describe("BasicsTab", () => {
  it("renders only the fields listed in the per-kind config", () => {
    render(<Controlled fields={["singularName", "slug", "icon"]} />);
    expect(screen.getByLabelText(/singular name/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/plural name/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/description/i)).not.toBeInTheDocument();
  });

  it("renders the plural name input when configured (Collections)", () => {
    render(
      <Controlled fields={["singularName", "pluralName", "slug", "icon"]} />
    );
    expect(screen.getByLabelText(/plural name/i)).toBeInTheDocument();
  });

  it("auto-derives slug from singular name on each keystroke until override", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Controlled
        fields={["singularName", "slug"]}
        initial={{ singularName: "" }}
        onChange={onChange}
      />
    );

    await user.type(screen.getByLabelText(/singular name/i), "Blog Post");
    const last = onChange.mock.lastCall?.[0] as BuilderSettingsValues;
    expect(last.singularName).toBe("Blog Post");
    expect(last.slug).toBe("blog_post");
  });

  it("stops auto-deriving slug after the user overrides it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Controlled
        fields={["singularName", "slug"]}
        initial={{ singularName: "Blog", slug: "blog" }}
        onChange={onChange}
      />
    );

    // Override the slug via the SlugInput edit affordance.
    await user.click(screen.getByRole("button", { name: /edit/i }));
    const slugInput = screen.getByRole("textbox", { name: /slug/i });
    await user.clear(slugInput);
    await user.type(slugInput, "post");

    onChange.mockClear();

    // Now type more into singular name. Slug must NOT change to track it.
    await user.type(screen.getByLabelText(/singular name/i), "ger");
    const last = onChange.mock.lastCall?.[0] as BuilderSettingsValues;
    expect(last.singularName).toBe("Blogger");
    expect(last.slug).toBe("post");
  });
});
