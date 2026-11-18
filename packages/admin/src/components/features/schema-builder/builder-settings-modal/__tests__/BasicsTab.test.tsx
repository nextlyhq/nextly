// Why: BasicsTab is config-driven — only the fields listed in the per-kind
// `basicsFields` array should render. Auto-slug from singular name is the
// other key behavior, with the user-overrides-stop-auto-derive rule that
// SlugInput documents. These tests lock both contracts.
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import type { BuilderSettingsValues } from "../../BuilderSettingsModal";
import type { BasicsField, BuilderKind } from "../../builder-config";
import { BasicsTab, descriptionTooLong } from "../BasicsTab";

function Controlled(props: {
  fields: readonly BasicsField[];
  kind?: BuilderKind;
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
      kind={props.kind ?? "collection"}
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

  // A settings save refuses an empty name for every kind, so the name is marked
  // required where it is seen; the plural falls back to the derived form and
  // stays unmarked.
  it("marks the singular name required, and the plural name not", () => {
    render(<Controlled fields={["singularName", "pluralName", "slug"]} />);
    const singular = screen.getByRole<HTMLInputElement>("textbox", {
      name: "Singular name",
    });
    expect(singular).toBeRequired();
    expect(
      singular.labels?.[0]?.querySelector('[aria-hidden="true"]')
    ).toHaveTextContent("*");

    const plural = screen.getByRole<HTMLInputElement>("textbox", {
      name: "Plural name",
    });
    expect(plural).not.toBeRequired();
    expect(plural.labels?.[0]?.textContent).toBe("Plural name");
  });

  it("renders the plural name input when configured (Collections)", () => {
    render(
      <Controlled fields={["singularName", "pluralName", "slug", "icon"]} />
    );
    expect(screen.getByLabelText(/plural name/i)).toBeInTheDocument();
  });

  it("auto-derives slug as snake_case for collections/components", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Controlled
        fields={["singularName", "slug"]}
        kind="collection"
        initial={{ singularName: "" }}
        onChange={onChange}
      />
    );

    await user.type(screen.getByLabelText(/singular name/i), "Blog Post");
    const last = onChange.mock.lastCall?.[0] as BuilderSettingsValues;
    expect(last.singularName).toBe("Blog Post");
    expect(last.slug).toBe("blog_post");
  });

  it("auto-derives slug as kebab-case for singles", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Controlled
        fields={["singularName", "slug"]}
        kind="single"
        initial={{ singularName: "" }}
        onChange={onChange}
      />
    );

    await user.type(screen.getByLabelText(/singular name/i), "About Page");
    const last = onChange.mock.lastCall?.[0] as BuilderSettingsValues;
    expect(last.singularName).toBe("About Page");
    expect(last.slug).toBe("about-page");
  });

  it("resumes auto-deriving when the slug is cleared", async () => {
    // The half of the predicate that is easy to miss: `!values.slug` counts as
    // still-automatic, so an EMPTY slug is not an override even though it
    // differs from the derived value. Someone who deletes a slug to start over
    // gets tracking back rather than a field pinned to the empty string.
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Controlled
        fields={["singularName", "slug"]}
        initial={{ singularName: "Blog", slug: "custom" }}
        onChange={onChange}
      />
    );

    await user.clear(screen.getByRole("textbox", { name: /slug/i }));
    onChange.mockClear();
    await user.type(screen.getByLabelText(/singular name/i), "ger");

    const last = onChange.mock.lastCall?.[0] as BuilderSettingsValues;
    expect(last.slug).toBe("blogger");
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

    // The slug has to hold a NON-EMPTY value that is not what the singular
    // name would derive, and both halves matter. `setSingular` keeps deriving
    // while `!values.slug || values.slug === previousAutoSlug`, so an empty
    // slug is still an automatic one — typing a differing value is what ends
    // the tracking, and clearing the field would resume it.
    //
    // No flag records the override; it is recomputed from the values on every
    // keystroke, so any route to a differing non-empty value ends tracking
    // identically, typed or programmatic.
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

  it("auto-derives plural from singular while plural is still auto", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Controlled
        fields={["singularName", "pluralName"]}
        initial={{ singularName: "", pluralName: "" }}
        onChange={onChange}
      />
    );
    await user.type(screen.getByLabelText(/singular name/i), "Person");
    const last = onChange.mock.lastCall?.[0] as BuilderSettingsValues;
    // 'Person' -> 'People' (irregular) confirms the pluralize lib is wired.
    expect(last.pluralName).toBe("People");
  });

  it("stops auto-deriving plural once user manually edits it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Controlled
        fields={["singularName", "pluralName"]}
        initial={{ singularName: "Post", pluralName: "Posts" }}
        onChange={onChange}
      />
    );
    // Manually override plural to something the auto-derive would never
    // produce.
    const pluralInput = screen.getByLabelText(
      /plural name/i
    ) as HTMLInputElement;
    await user.clear(pluralInput);
    await user.type(pluralInput, "Articles");
    onChange.mockClear();

    // Now keep typing in singular. Plural must NOT change.
    await user.type(screen.getByLabelText(/singular name/i), "ing");
    const last = onChange.mock.lastCall?.[0] as BuilderSettingsValues;
    expect(last.singularName).toBe("Posting");
    expect(last.pluralName).toBe("Articles");
  });
});

// A kind with no plural name has three basics rather than four, and this group
// covers what the tab renders for one: singular, slug and icon, each appearing
// only when the per-kind config lists it. The arrangement is the shared
// responsive grid, so these assert presence rather than layout classes.
describe("BasicsTab -- the three basics a kind without a plural renders", () => {
  it("renders singular, slug, and icon when pluralName is omitted from fields", () => {
    render(
      <BasicsTab
        fields={["singularName", "slug", "icon"]}
        kind="single"
        values={{
          singularName: "Hero",
          pluralName: "",
          slug: "hero",
          description: "",
          icon: "Box",
        }}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByLabelText(/singular name/i)).toBeInTheDocument();
    // Slug + Icon labels don't bind to form controls via htmlFor;
    // assert the label text is present instead.
    expect(screen.getByText(/^Slug$/)).toBeInTheDocument();
    expect(screen.getByText(/^Icon$/)).toBeInTheDocument();
    // Plural name should NOT appear.
    expect(screen.queryByLabelText(/plural name/i)).toBeNull();
  });

  it("still renders the 2x2 layout when pluralName IS in fields", () => {
    render(
      <BasicsTab
        fields={["singularName", "pluralName", "slug", "icon"]}
        kind="collection"
        values={{
          singularName: "Article",
          pluralName: "Articles",
          slug: "article",
          description: "",
          icon: "FileText",
        }}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByLabelText(/singular name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/plural name/i)).toBeInTheDocument();
    expect(screen.getByText(/^Slug$/)).toBeInTheDocument();
    expect(screen.getByText(/^Icon$/)).toBeInTheDocument();
  });
});

// The limit is told in characters, so it is counted in code points
// (`textLength`): an emoji or a letter outside the BMP is one character,
// not the two UTF-16 units `String.length` would call it — 255 of them are
// at the limit, not past it.
describe("the description limit, counted as a person counts it", () => {
  it("holds the save only past 255 code points", () => {
    expect(descriptionTooLong(undefined)).toBe(false);
    expect(descriptionTooLong("a".repeat(255))).toBe(false);
    expect(descriptionTooLong("a".repeat(256))).toBe(true);
    expect(descriptionTooLong("🎉".repeat(255))).toBe(false);
    expect(descriptionTooLong("🎉".repeat(256))).toBe(true);
  });

  it("counts the shown count the same way", () => {
    render(
      <Controlled
        fields={["singularName", "description"]}
        initial={{ description: "🎉".repeat(255) }}
      />
    );
    expect(screen.getByText("255/255")).toBeInTheDocument();
    expect(
      screen.queryByText(/Keep the description to 255/i)
    ).not.toBeInTheDocument();
  });

  it("says over, and holds, past the limit in code points", () => {
    render(
      <Controlled
        fields={["singularName", "description"]}
        initial={{ description: "🎉".repeat(256) }}
      />
    );
    expect(screen.getByText("256/255")).toBeInTheDocument();
    // An alert, so the crossing is announced as the message appears.
    expect(screen.getByRole("alert")).toHaveTextContent(
      /Keep the description to 255/i
    );
  });
});
