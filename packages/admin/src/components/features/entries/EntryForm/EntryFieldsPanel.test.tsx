// @vitest-environment jsdom

/**
 * The decision that withholds the panel, and the grouping it draws when it does
 * not.
 *
 * `takeoverLayout.test` covers which fields come back; this covers what is done
 * with them. The two are worth keeping apart because only one of them is about
 * blankness: a correct field list still produced an empty panel for as long as
 * something rendered it unconditionally.
 *
 * @module components/entries/EntryForm/EntryFieldsPanel.test
 */
import { fireEvent, render, screen } from "@testing-library/react";
import type { FieldConfig } from "nextly/config";
import { describe, expect, it, vi } from "vitest";

/*
 * The field renderer is replaced, not rendered. What is under test is which
 * fields reach it and how they are grouped; drawing fifteen real input types
 * would make this a test of the field renderer, which has its own.
 */
vi.mock("./EntryFormContent", () => ({
  EntryFormContent: ({ fields }: { fields: FieldConfig[] }) => (
    <>
      <span>{fields.map(f => f.name).join(",")}</span>
      {/*
        REAL controls, not a text summary. The Enter guard below is about what
        an implicit submission does, and that is a property of the elements —
        a mock rendering only text would let the guard's test pass whatever the
        handler did, which is the shape of a test that proves nothing.
      */}
      {fields.map(f => (
        <span key={f.name}>
          <input aria-label={`${f.name} input`} />
          <textarea aria-label={`${f.name} textarea`} />
        </span>
      ))}
    </>
  ),
}));

/** Props the stubbed notice was rendered with, newest last. */
const noticeProps: Array<{ slugName: string; active: boolean }> = [];

vi.mock("./PublicUrlChangeNotice", () => ({
  PublicUrlChangeNotice: (props: { slugName: string; active: boolean }) => {
    noticeProps.push({ slugName: props.slugName, active: props.active });
    return <span>url notice</span>;
  },
}));

const { fieldsBesidePanel } = await import("./EntryFieldsPanel");

/**
 * A field fixture.
 *
 * Cast through `unknown` because `FieldConfig` is the CORE union and the types
 * that matter here are not in it: `blocks` is contributed by a plugin, and a
 * bare `admin.condition` is looser than any single member. The panel only ever
 * reads `name` and `admin`, so a fuller fixture would add nothing an assertion
 * could see.
 */
const field = (name: string, type = "text", admin?: unknown) =>
  ({
    name,
    type,
    ...(admin === undefined ? {} : { admin }),
  }) as unknown as FieldConfig;

/** A collection shaped the way a Pages collection usually is. */
const minimal = [field("title"), field("slug"), field("body", "blocks")];

describe("the panel a takeover surface offers back", () => {
  it("answers NULL when the asking field is all there is", () => {
    /*
     * The state that must withhold the panel. A collection declaring only the
     * builder field has nothing to give back — not even an identity, because
     * this fixture has none — and an element here would be offered, opened and
     * blank.
     */
    expect(fieldsBesidePanel([field("body", "blocks")], "body")).toBeNull();
  });

  it("answers null outside any field it recognises, rather than an empty shell", () => {
    // An excludePath naming nothing still has to answer honestly about what is
    // left. Here that is the whole (empty) list.
    expect(fieldsBesidePanel([], "body")).toBeNull();
  });

  it("draws the document's identity, which is what the minimal shape has", () => {
    /*
     * The defect, from the other side. Title and slug were stripped as system
     * fields, so this exact collection produced nothing at all — while being
     * the shape most Pages collections take, and while the builder covering the
     * form is what removed the header that draws them.
     */
    const panel = fieldsBesidePanel(minimal, "body");
    expect(panel).not.toBeNull();
    render(<div data-testid="host">{panel}</div>);

    expect(screen.getByTestId("host").textContent).toContain("title,slug");
  });

  it("labels the groups rather than running them together", () => {
    // The grouping is the reason the panel is readable at all: a slug sorted in
    // among a collection's own relations lands in an order an author cannot
    // anticipate.
    render(
      <div>{fieldsBesidePanel([...minimal, field("summary")], "body")}</div>
    );

    expect(screen.getByText("Page")).toBeDefined();
    expect(screen.getByText("Fields")).toBeDefined();
  });

  it("omits a group that has nothing in it, heading and all", () => {
    /*
     * A labelled region containing nothing is the same failure as the panel
     * itself being blank, one level down — so the heading has to go with its
     * fields. This collection declares no fields of its own.
     */
    render(<div>{fieldsBesidePanel(minimal, "body")}</div>);

    expect(screen.getByText("Page")).toBeDefined();
    expect(screen.queryByText("Fields")).toBeNull();
  });

  it("keeps the collection's own fields out of the identity group", () => {
    // The control for the grouping. One `EntryFormContent` handed every field
    // would satisfy every assertion above about content being present.
    render(
      <div data-testid="host">
        {fieldsBesidePanel([...minimal, field("summary")], "body")}
      </div>
    );

    const text = screen.getByTestId("host").textContent ?? "";
    expect(text).toContain("title,slug");
    expect(text).toContain("summary");
    // Never as one list: that spelling is what a merged panel would produce.
    expect(text).not.toContain("title,slug,summary");
  });

  it("drops a field whose CONDITION is false, rather than counting a blank row", () => {
    /*
     * `FieldRenderer` returns null for a field whose condition is false, so a
     * field counted here but not drawn puts a heading over blank space and
     * offers a panel for it — the same defect this file is about, one level in.
     *
     * `editorMode` is "builder", so a field shown only in the classic editor
     * must not be counted. The identity group is what keeps the panel alive.
     */
    const withConditional = [
      ...minimal,
      field("classicBody", "richText", {
        condition: { field: "editorMode", equals: "classic" },
      }),
    ];
    render(
      <div data-testid="host">
        {fieldsBesidePanel(withConditional, "body", {
          values: { editorMode: "builder" },
        })}
      </div>
    );

    expect(screen.getByTestId("host").textContent).toContain("title,slug");
    expect(screen.queryByText("Fields")).toBeNull();
  });

  it("counts that same field once its condition holds", () => {
    // The control. Without it, a rule that dropped every conditional field —
    // or every field at all — would satisfy the case above.
    render(
      <div data-testid="host">
        {fieldsBesidePanel(
          [
            ...minimal,
            field("classicBody", "richText", {
              condition: { field: "editorMode", equals: "classic" },
            }),
          ],
          "body",
          { values: { editorMode: "classic" } }
        )}
      </div>
    );

    expect(screen.getByText("Fields")).toBeDefined();
    expect(screen.getByTestId("host").textContent).toContain("classicBody");
  });

  it("answers NULL when every remaining field is conditioned away", () => {
    // The whole panel, not just a group: a document left with nothing visible
    // must withhold the rail slot exactly as one with nothing declared does.
    const onlyConditional = [
      field("body", "blocks"),
      field("classicBody", "richText", {
        condition: { field: "editorMode", equals: "classic" },
      }),
    ];
    expect(
      fieldsBesidePanel(onlyConditional, "body", {
        values: { editorMode: "builder" },
      })
    ).toBeNull();
  });

  it("refuses Enter in a single-line field, which would submit the form behind it", () => {
    /*
     * These inputs sit inside the entry's own form, so Enter is an implicit
     * submission — and the builder writes its document back on the way out, so
     * that submit would save the blocks as they were before the editor opened.
     */
    render(<div>{fieldsBesidePanel(minimal, "body")}</div>);

    const input = screen.getByLabelText("title input");
    const prevented = !fireEvent.keyDown(input, { key: "Enter" });

    expect(prevented).toBe(true);
  });

  it("refuses a MODIFIED Enter too, which submits exactly as a bare one does", () => {
    /*
     * An earlier version exempted Shift+Enter on the assumption that a modifier
     * means something other than submit. Measured in a browser: Shift+Enter in
     * a single-line input submits the enclosing form just as a bare Enter does,
     * so the exemption left the whole hole open through one extra keystroke.
     */
    render(<div>{fieldsBesidePanel(minimal, "body")}</div>);
    const input = screen.getByLabelText("title input");

    for (const modifier of [
      { shiftKey: true },
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
    ]) {
      const prevented = !fireEvent.keyDown(input, {
        key: "Enter",
        ...modifier,
      });
      expect(prevented).toBe(true);
    }
  });

  it("lets a COMPOSING Enter through, which an IME uses to accept a candidate", () => {
    /*
     * An author typing Japanese, Chinese or Korean presses Enter to accept the
     * candidate they are part-way through. That keystroke arrives here with
     * `isComposing` set, and the browser does not submit on it — so refusing it
     * protects nothing and makes these fields unusable in those languages.
     */
    render(<div>{fieldsBesidePanel(minimal, "body")}</div>);
    const input = screen.getByLabelText("title input");

    const composing = !fireEvent.keyDown(input, {
      key: "Enter",
      isComposing: true,
    });
    expect(composing).toBe(false);

    // The legacy spelling of the same state, which is how some engines report
    // a composition instead of setting the flag.
    const legacy = !fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(legacy).toBe(false);
  });

  it("leaves Enter alone in a textarea, where it is a newline", () => {
    // The control, and the reason the guard reads the element rather than
    // swallowing every Enter in the panel.
    render(<div>{fieldsBesidePanel(minimal, "body")}</div>);

    const area = screen.getByLabelText("title textarea");
    const prevented = !fireEvent.keyDown(area, { key: "Enter" });

    expect(prevented).toBe(false);
  });

  it("carries the public-URL warning beside the slug, but only with an address to break", () => {
    /*
     * The meta strip that normally shows this is covered by the editor, so
     * this panel is the only place an author renaming a published page from
     * inside the builder is told the old URL stops working.
     *
     * The notice is stubbed and its PROPS asserted rather than its output: it
     * reads form state through its own hook and has its own tests, and what
     * changed here is the wiring. Both directions are asserted from one file
     * because "absent" is only meaningful beside a case that renders it.
     */
    const { unmount } = render(
      <div>
        {fieldsBesidePanel(minimal, "body", { hasPublicAddress: true })}
      </div>
    );
    expect(noticeProps).toEqual([{ slugName: "slug", active: true }]);
    unmount();

    noticeProps.length = 0;
    render(
      <div>
        {fieldsBesidePanel(minimal, "body", { hasPublicAddress: false })}
      </div>
    );
    expect(noticeProps).toEqual([]);
  });

  it("does not warn when the panel is not offering a slug at all", () => {
    // A notice pointing at a field this panel does not show would name a
    // control the author cannot see.
    noticeProps.length = 0;
    render(
      <div>
        {fieldsBesidePanel([field("title"), field("body", "blocks")], "body", {
          hasPublicAddress: true,
        })}
      </div>
    );
    expect(noticeProps).toEqual([]);
  });
});
