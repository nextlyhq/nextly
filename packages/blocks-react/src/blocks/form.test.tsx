/**
 * What `core/form` has to get right.
 *
 * Three things, and none of them is "it renders a form": the value that reaches
 * the `action` attribute is followed by the browser on submit, the association
 * between a label and its control is what makes the form usable without sight,
 * and the flat structure is load-bearing rather than incidental — the block's
 * whole layout is one grid on the root, so a control nested inside its label
 * would stop being a grid item and the form would lose its rows.
 */
import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";
import {
  blockPartClassName,
  contrastRatio,
  defaultSiteTokens,
  parseColor,
} from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { BlockRenderArgs, PageContext } from "../context";
import type { BlockResolver } from "../resolver";
import { resolvePageStyles } from "../styles";

import { coreBlocks } from "./index";

import { BUTTON_BASE_STYLES } from "./button";
import { form, renderForm, FORM_FIELD_TYPES, type FormProps } from "./form";

function context(): PageContext {
  return {
    entry: null,
    data: { find: () => Promise.resolve({ items: [], total: 0 }) },
    resolveMedia: () => Promise.resolve(null),
    resolveEntryPath: () => Promise.resolve(null),
  } as unknown as PageContext;
}

function args(props: FormProps, nodeId = "n1"): BlockRenderArgs<FormProps> {
  const node: BlockNode = {
    id: nodeId,
    type: "core/form",
    version: 1,
    props: props as BlockNode["props"],
  };
  return {
    props,
    node,
    className: "nx-n1",
    // Required by the render contract; these fixtures declare no parts.
    partClass: () => "",
    ctx: context(),
    renderSlot: () => null,
  } as unknown as BlockRenderArgs<FormProps>;
}

const html = (element: ReactElement): string => renderToStaticMarkup(element);

describe("core/form", () => {
  describe("the value that reaches the action attribute", () => {
    it("refuses a scheme that executes rather than navigates", () => {
      // The single highest-consequence prop in this block: `action` is followed
      // by the browser on submit, so a stored `javascript:` value runs. The
      // block routes it through `url()` rather than trusting the declared type,
      // because the declared type describes what an EDITOR offers and the
      // document holds whatever was written.
      const out = html(renderForm(args({ action: "javascript:alert(1)" })));

      expect(out).not.toContain("javascript:");
      // And the attribute is dropped entirely rather than emitted empty: an
      // `action=""` submits to the page's own URL, which is the same behaviour
      // as omitting it, but asserting the absence is what proves the refusal
      // took the value out rather than blanking it.
      expect(out).not.toContain("action=");
    });

    it("keeps a destination an author legitimately wrote", () => {
      // The positive control. Without it, a block that dropped EVERY action
      // would pass the refusal above while being completely broken.
      const out = html(renderForm(args({ action: "/api/contact" })));

      expect(out).toContain('action="/api/contact"');
    });

    it("posts back to the page when no action is stored", () => {
      const out = html(renderForm(args({})));

      expect(out).toContain("<form");
      expect(out).not.toContain("action=");
    });
  });

  describe("the label and its control", () => {
    it("associates them by id rather than by nesting", () => {
      const out = html(
        renderForm(args({ fields: [{ label: "Email", name: "email" }] }))
      );

      // `htmlFor` and `id` rather than a wrapping `<label>`, because the layout
      // is one grid on the root: a control nested inside its label is not a
      // grid item and the form loses its rows.
      expect(out).toContain('for="n1-field-0"');
      expect(out).toContain('id="n1-field-0"');
      // SIBLINGS. A control that ended up inside the label would still carry
      // both attributes and still be correctly associated, so the assertions
      // above cannot see the layout regression on their own.
      expect(out).not.toMatch(/<label[^>]*>[^<]*<input/);
    });

    it("derives the id from the node, so two forms on a page cannot collide", () => {
      // A fixed id prefix makes the second form's label point at the FIRST
      // form's field — the browser resolves a duplicate id to the first match,
      // so clicking one form's label focuses another form's input.
      const first = html(renderForm(args({ fields: [{ name: "a" }] }, "n1")));
      const second = html(renderForm(args({ fields: [{ name: "a" }] }, "n2")));

      expect(first).toContain('id="n1-field-0"');
      expect(second).toContain('id="n2-field-0"');
    });

    it("labels a field that has no label with the name it submits under", () => {
      // An empty `<label>` announces nothing. The submitted name is a worse
      // label than one an author wrote and a far better one than silence.
      const out = html(renderForm(args({ fields: [{ name: "phone" }] })));

      expect(out).toContain(">phone</label>");
    });

    it("hides the required marker from assistive technology", () => {
      // The `required` attribute already carries this, so an announced asterisk
      // is the same information twice, read as the word "asterisk".
      const out = html(
        renderForm(args({ fields: [{ label: "Name", required: true }] }))
      );

      expect(out).toContain('aria-hidden="true"');
      expect(out).toContain("required");
    });
  });

  describe("what a stored document can actually hold", () => {
    it("renders a textarea only for the type that asks for one", () => {
      const out = html(
        renderForm(
          args({
            fields: [{ name: "a", type: "textarea" }, { name: "b" }],
          })
        )
      );

      expect(out).toContain("<textarea");
      expect(out).toContain('type="text"');
    });

    it("falls back to a text input for a type nobody declared", () => {
      // A stored type can be anything: a migration, a hand edit, or a version
      // of this block that offered a control this one does not.
      const stored = { fields: [{ name: "a", type: "color" }] };
      const out = html(renderForm(args(stored as unknown as FormProps)));

      expect(out).toContain('type="text"');
      expect(out).not.toContain('type="color"');
    });

    it("survives members that are not fields at all", () => {
      // `sanitizeDocument` keeps content it cannot validate, so a member of the
      // wrong type reaches render. Each falls back rather than throwing.
      const stored = { fields: [42, null, {}, ["nested"], "text"] };

      expect(() =>
        html(renderForm(args(stored as unknown as FormProps)))
      ).not.toThrow();
    });

    it("renders nothing but the button when fields is not an array", () => {
      const stored = { fields: 42 };
      const out = html(renderForm(args(stored as unknown as FormProps)));

      // Matched on the attribute rather than on the opening tag's exact text:
      // the submit carries a part class now, and asserting attribute ORDER
      // makes this fail for a styling change while the property under test —
      // that a non-array `fields` renders no fields — is untouched.
      expect(out).toContain('type="submit"');
      expect(out).toContain("<button");
      expect(out).not.toContain("<input");
    });

    it("clamps an oversized array rather than letting the page be refused", () => {
      // Past the renderer's inspection budget the normalizer refuses the WHOLE
      // output and the block becomes a placeholder, so an accidentally long
      // form would lose every field rather than the ones past the end.
      const fields = Array.from({ length: 500 }, (_, index) => ({
        name: `f${index}`,
      }));
      const out = html(renderForm(args({ fields })));

      const inputs = out.match(/<input/g) ?? [];
      expect(inputs.length).toBe(100);
    });

    it("gives the submit button words when none were stored", () => {
      // `text()` maps a missing value and an authored empty string alike to
      // `""`, and a button with no words on it is unusable either way.
      expect(html(renderForm(args({ submitText: "" })))).toContain(">Submit<");
      expect(html(renderForm(args({})))).toContain(">Submit<");
    });

    it("submits by post unless get was explicitly chosen", () => {
      // A `get` form puts every answer in the URL, where it reaches the
      // server's logs and the visitor's history, so it is never the fallback.
      const stored = { method: "delete" };

      expect(html(renderForm(args(stored as unknown as FormProps)))).toContain(
        'method="post"'
      );
      expect(html(renderForm(args({ method: "get" })))).toContain(
        'method="get"'
      );
    });
  });

  describe("the declaration", () => {
    it("offers exactly the control types the renderer can draw", () => {
      // The schema's options and the renderer's allow-list are the same
      // question, so they are the same array. Two lists would let an editor
      // offer a control that silently renders as a text input.
      expect(form.props?.method?.options).toEqual(["post", "get"]);
      expect(FORM_FIELD_TYPES).toContain("textarea");
      expect(FORM_FIELD_TYPES).toContain("email");
    });

    it("writes no inline style, because the layout is the compiled grid", () => {
      // The root-inline-styles ratchet asserts this across the whole library;
      // named here too because this block is the one that most obviously wants
      // an inline `display: grid`, which is what its PoC predecessor wrote.
      const out = html(
        renderForm(args({ fields: [{ name: "a", type: "textarea" }] }))
      );

      expect(out).not.toContain("style=");
    });
  });
});

describe("a control an author can SEE", () => {
  /*
   * Measured in a browser before this existed: an input compiled to
   * `border: 0px`, `background: transparent`, `padding: 0`, so a published
   * form rendered as a column of labels with nothing under them. The fields
   * were present, focusable and submittable, and invisible.
   *
   * The cause is a host CSS reset — Tailwind's Preflight, which the scaffold
   * ships — taking away the border and background a user agent draws on an
   * input. The `control` part already existed and stated only spacing.
   *
   * jsdom cannot see a border, so appearance itself is verified in a browser on
   * a published page rather than here. What a test CAN pin is the compiled
   * stylesheet, and that is what these read — not the declaration object, which
   * is a weaker claim than it looks. `expect(control.border).toBeDefined()`
   * holds for `{ style, color }` with the WIDTH deleted, and a border of no
   * width is exactly as invisible under Preflight as no border at all.
   */
  const control = form.parts?.control?.baseStyles?.base?.base as
    | Record<string, unknown>
    | undefined;

  /** The compiled rule for the control part, which is what reaches a page. */
  function controlCss(): string {
    const document: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "f", type: form.name, version: 1, props: {} }],
    };
    const resolver: BlockResolver = {
      get: (name: string) =>
        coreBlocks.find(candidate => candidate.name === name) as never,
    };
    // A style context is REQUIRED: `resolvePageStyles` compiles only under
    // `if (styleContext)` and returns empty css otherwise, which would report
    // every one of these properties as missing and read as a real failure.
    const css =
      resolvePageStyles(
        document,
        undefined,
        {
          breakpoints: {
            viewport: [{ id: "base", label: "Desktop" }],
            container: [],
          },
        },
        resolver
      ).css ?? "";
    const selector = blockPartClassName(form.name, "control");
    return css
      .split("}")
      .filter(rule => rule.includes(`.${selector}`))
      .join("}");
  }

  /**
   * The VALUE of one declaration inside the control's rule.
   *
   * Read out and asserted separately rather than folded into one regex with a
   * negative lookahead. `property:\s*(?!0[;\s}])` looks like it rejects a zero
   * and does not: `\s*` backtracks to zero width, which moves the lookahead onto
   * the SPACE, where it trivially succeeds. Verified — a control compiling to
   * `border-block-start-width: 0` passed that form.
   */
  function declaredValue(css: string, property: string): string | undefined {
    return css
      .match(new RegExp(`(?:^|[;{\\s])${property}:\\s*([^;}]+)`))?.[1]
      .trim();
  }

  /** A length that actually draws something — not `0`, `0px`, `0rem`. */
  function expectNonZero(css: string, property: string): void {
    const value = declaredValue(css, property);
    expect(value, `${property} never reached the stylesheet`).toBeDefined();
    expect(value, `${property} compiled to the zero ${value}`).not.toMatch(
      /^0[a-z%]*$/
    );
  }

  it("draws a border with a NONZERO width on every side", () => {
    /*
     * The width is the whole mechanism. Preflight sets `border-width: 0` and
     * leaves `border-style: solid` in place, so a control declaring style and
     * colour and no width inherits the zero and stays invisible — while
     * `border` is still "defined" and every leaf it does declare still reaches
     * the stylesheet. Asserting the sides by name and by VALUE is what
     * separates a visible border from that.
     */
    const css = controlCss();

    // Must-be-found: the part compiled at all, so the assertions below are
    // reading a real rule rather than an empty string.
    expect(css).not.toBe("");
    for (const side of [
      "border-block-start-width",
      "border-block-end-width",
      "border-inline-start-width",
      "border-inline-end-width",
    ]) {
      expectNonZero(css, side);
    }
    expect(css).toContain("border-style: solid");
  });

  it("outlines the control in a colour a person can actually SEE it by", () => {
    /*
     * The border is this control's only boundary — it takes the page's own
     * background on purpose — so WCAG 2.2 SC 1.4.11 (Non-text Contrast) wants
     * 3:1 against what sits behind it.
     *
     * The hairline `color.border` does NOT clear that: `#e5e7eb` on `#ffffff` is
     * 1.24:1 and `#1f2937` on `#0b0f19` is 1.30:1. Outlining a field in it is
     * the invisible control this part exists to fix, one property in — and it
     * passes every check that only asks whether a border is "defined" or
     * whether its width is nonzero.
     *
     * Computed from the token set rather than compared to a spelling, so a
     * palette retune that keeps the token name and loses the contrast fails
     * here. The ratio is the thing anybody depends on.
     */
    const named = (
      control?.border as { color?: { $token?: string } } | undefined
    )?.color?.$token;
    expect(named, "the control names no border colour token").toBeDefined();

    const token = defaultSiteTokens().find(entry => entry.name === named);
    expect(
      token,
      `${String(named)} is not in the guaranteed set`
    ).toBeDefined();

    const background = defaultSiteTokens().find(
      entry => entry.name === "color.background"
    );

    for (const mode of ["light", "dark"] as const) {
      const edge = parseColor(token?.values[mode] ?? "");
      const behind = parseColor(background?.values[mode] ?? "");
      expect(edge, `${String(named)} has no ${mode} value`).toBeDefined();
      expect(behind, `color.background has no ${mode} value`).toBeDefined();

      const ratio = contrastRatio(edge!, behind!);

      expect(
        ratio,
        `${String(named)} is ${ratio.toFixed(2)}:1 against the page in ${mode}, ` +
          `below the 3:1 a control boundary needs to be findable.`
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("draws a background and padding an author can see", () => {
    const css = controlCss();

    // A background is what separates the control from the page behind it once
    // the reset has taken the user agent's away.
    expect(css).toMatch(/background-color:\s*var\(--site-/);
    // Padding on all four sides, by value: a zero would compile and read as
    // present while leaving the text against the border.
    for (const side of [
      "padding-block-start",
      "padding-block-end",
      "padding-inline-start",
      "padding-inline-end",
    ]) {
      expectNonZero(css, side);
    }
  });

  it("takes its COLOURS from tokens and its spacing from literals", () => {
    /*
     * A literal colour is wrong in whichever of light and dark it was not
     * chosen for, which is the reason a token set exists; spacing carries no
     * such asymmetry. `core/card` states the same split for the same reason.
     */
    expect(control?.backgroundColor).toHaveProperty("$token");
    expect(control?.color).toHaveProperty("$token");
    expect(
      (control?.border as Record<string, unknown> | undefined)?.color
    ).toHaveProperty("$token");
    expect(typeof control?.borderRadius).toBe("string");
  });

  it("puts the submit's part class on the button it renders", () => {
    /*
     * The style and the markup are two halves of one fact and the suite held
     * only the first. `args()` returns an empty `partClass`, so removing the
     * className from the button left every style test green while the compiled
     * submit rule matched nothing — returning the control to the reset-stripped
     * plain text this whole change exists to fix.
     */
    const out = html(
      renderForm({
        ...args({
          submitText: "Send",
          fields: [{ name: "email", label: "Email", type: "email" }],
        } as unknown as FormProps),
        partClass: (part: string) => `nx-part-${part}`,
      } as unknown as BlockRenderArgs<FormProps>)
    );
    expect(out).toContain('class="nx-part-submit"');
    // Must-be-found control: the control part is marked the same way, so a
    // `partClass` that returned nothing would fail here rather than pass.
    expect(out).toContain("nx-part-control");
  });

  it("gives the submit the SAME appearance as core/button", () => {
    /*
     * A form's submit and a button block are one control to an author, and
     * describing that appearance twice is how a page comes to carry two
     * different-looking primary actions — which is what it did while the
     * submit was a bare element the reset stripped to plain text.
     */
    /*
     * Compared BY VALUE, and as one whole envelope.
     *
     * This checked that every key existed, at both levels. Key existence cannot
     * see the drift it was written to catch: a submit that overrode `padding`,
     * or copied a hover state and changed a declaration inside it, has every
     * expected key and a different appearance. It also cannot see an addition,
     * so a declaration the button never had would pass silently.
     *
     * The expectation is DERIVED from `BUTTON_BASE_STYLES` rather than written
     * out, so the two cannot drift by this file being updated to match a change
     * nobody meant — which is the failure a literal envelope invites.
     */
    const expected = {
      ...BUTTON_BASE_STYLES,
      base: {
        ...BUTTON_BASE_STYLES.base,
        base: {
          ...BUTTON_BASE_STYLES.base.base,
          // The one deliberate difference: the form is a grid, so a stretched
          // item would run the full column width and stop reading as a button.
          width: "fit-content",
        },
      },
    };

    expect(form.parts?.submit?.baseStyles).toEqual(expected);

    // Must-be-found control: the envelope really carries declarations, so the
    // equality above is not two empty shapes agreeing.
    expect(Object.keys(BUTTON_BASE_STYLES.base.base).length).toBeGreaterThan(3);
  });
});
