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
import type { BlockNode } from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { BlockRenderArgs, PageContext } from "../context";

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

      expect(out).toContain('<button type="submit"');
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
