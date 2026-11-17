/**
 * What `core/form` has to get right, on its own fields.
 *
 * A form a visitor fills in and sends with no script: the browser refuses
 * what the form's own checks refuse (both read one description of each
 * field), the answers post to the page builder's receiver with the hidden
 * fields it reads, and the four answers a send can come back to are drawn,
 * hidden, for a CSS `:target` rule to show. A provider's form is drawn the
 * same way (`form.provider.test.tsx`).
 */
import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";
import {
  blockPartClassName,
  contrastRatio,
  defaultSiteTokens,
  migrateDocument,
  parseColor,
} from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { BlockRenderArgs, PageContext, PageForms } from "../context";
import { migrationSourceFor, type BlockResolver } from "../resolver";
import { resolvePageStyles } from "../styles";

import { coreBlocks } from "./index";

import { BUTTON_BASE_STYLES } from "./button";
import {
  form,
  formFieldDrawings,
  formFields,
  renderForm,
  sentNameOf,
  FORM_FIELD_TYPES,
  FORM_HONEYPOT_FIELD,
  FORM_REFUSALS,
  FORM_SENT_MESSAGE,
  type FormProps,
} from "./form";
import { FORM_RESULT_CSS } from "./form-draw";

/** A receiver to post to, as a published page's route gives one. */
const FORMS: PageForms = {
  action: "/admin/api/plugins/@nextlyhq/plugin-page-builder/forms/send",
  document: "page:p1",
  returnTo: "/contact",
  describe: () => Promise.resolve({ unavailable: "missing" }),
};

function context(overrides: Partial<PageContext> = {}): PageContext {
  return {
    entry: null,
    data: { find: () => Promise.resolve({ items: [], total: 0 }) },
    resolveMedia: () => Promise.resolve(null),
    resolveEntryPath: () => Promise.resolve(null),
    ...overrides,
  } as unknown as PageContext;
}

function args(
  props: FormProps,
  options: {
    nodeId?: string;
    ctx?: Partial<PageContext>;
    parts?: boolean;
  } = {}
): BlockRenderArgs<FormProps> {
  const node: BlockNode = {
    id: options.nodeId ?? "n1",
    type: "core/form",
    version: 2,
    props: props as BlockNode["props"],
  };
  return {
    props,
    node,
    className: "nx-n1",
    partClass:
      options.parts === true ? (part: string) => `nx-part-${part}` : () => "",
    ctx: context(options.ctx),
    renderSlot: () => null,
  } as unknown as BlockRenderArgs<FormProps>;
}

/** The form drawn as markup, with the result rules React hoists out of it. */
async function drawn(
  props: FormProps,
  options: Parameters<typeof args>[1] = {}
): Promise<string> {
  const element = (await renderForm(args(props, options))) as ReactElement;
  return renderToStaticMarkup(element);
}

/** The form drawn as markup: the form element alone. */
async function html(
  props: FormProps,
  options: Parameters<typeof args>[1] = {}
): Promise<string> {
  return (await drawn(props, options)).replace(
    /^<style[^>]*>[^<]*<\/style>/,
    ""
  );
}

/** The opening tag of the control sent under `name`. */
function controlOf(out: string, name: string): string | undefined {
  return out.match(
    new RegExp(`<(?:input|select|textarea)[^>]*name="${name}"[^>]*>`)
  )?.[0];
}

describe("a new form", () => {
  it("starts with Name and Email, both required, then Message, and a Send button", () => {
    // What the inserter stores for a new block.
    const props = form.defaultProps as FormProps;
    expect(props.submitText).toBe("Send");
    expect(formFields(props)).toEqual([
      {
        name: "name",
        label: "Name",
        type: "text",
        required: true,
        options: [],
      },
      {
        name: "email",
        label: "Email",
        type: "email",
        required: true,
        options: [],
      },
      {
        name: "message",
        label: "Message",
        type: "textarea",
        required: false,
        options: [],
      },
    ]);
    // Stores no sending choice: a simple form shows its message, and a form
    // picked later from a provider follows that form's own setting.
    expect(props).not.toHaveProperty("afterSending");
    expect(props).not.toHaveProperty("method");
  });
});

describe("a field's sent name", () => {
  it("is made from its label", () => {
    expect(sentNameOf("Your email")).toBe("your-email");
    expect(sentNameOf("  Café & menu!  ")).toBe("cafe-menu");
    // A label with nothing to make a name from still sends under one.
    expect(sentNameOf("¿?")).toBe("field");
  });

  it("is unique within the form, made from the label or written", () => {
    const names = formFields({
      fields: [
        { label: "Your email" },
        { label: "Your email" },
        { label: "Phone", name: "your-email" },
        { label: "Your email", name: "contact" },
      ],
    }).map(field => field.name);
    expect(names).toEqual([
      "your-email",
      "your-email-2",
      "your-email-3",
      "contact",
    ]);
  });

  it("is the author's own where they wrote one, but never one the receiver keeps", () => {
    const names = formFields({
      fields: [
        { label: "Company", name: "org" },
        // `_hp` is the spam trap and `_form` the receiver's own: an answer sent
        // under either would be read as the receiver's, so the label names it.
        { label: "Trap", name: "_hp" },
        { label: "Form", name: "_form" },
      ],
    }).map(field => field.name);
    expect(names).toEqual(["org", "trap", "form"]);
  });
});

describe("each field type, drawn", () => {
  const drawn = async (type: string, extra: object = {}): Promise<string> =>
    await html(
      { fields: [{ label: "Answer", type: type as never, ...extra }] },
      { ctx: { forms: FORMS } }
    );

  it.each([
    ["text", "text"],
    ["email", "email"],
    ["tel", "tel"],
    ["number", "number"],
    ["url", "url"],
    ["date", "date"],
  ])("draws %s as an input of type %s", async (type, input) => {
    expect(controlOf(await drawn(type), "answer")).toMatch(
      new RegExp(`^<input[^>]*type="${input}"`)
    );
  });

  it("draws Long text as a textarea", async () => {
    expect(controlOf(await drawn("textarea"), "answer")).toMatch(/^<textarea/);
  });

  it("draws a Dropdown with an empty first choice and its options", async () => {
    const out = await drawn("select", { options: ["Small", "Large"] });
    expect(controlOf(out, "answer")).toMatch(/^<select/);
    expect(out).toContain('<option value="" selected="">Choose…</option>');
    expect(out).toContain('<option value="Small">Small</option>');
    expect(out).toContain('<option value="Large">Large</option>');
  });

  it("draws a Choice as a group of radios under one legend", async () => {
    const out = await drawn("radio", {
      options: ["Yes", "No"],
      required: true,
    });
    expect(out).toMatch(/<fieldset[^>]*><legend>Answer/);
    const radios = out.match(/<input[^>]*type="radio"[^>]*>/g) ?? [];
    expect(radios).toHaveLength(2);
    // The browser refuses a required Choice left empty on its own.
    for (const radio of radios) expect(radio).toContain('required=""');
  });

  it("draws a Checkbox as one box its label sits beside", async () => {
    const out = await drawn("checkbox", { required: true });
    const box = controlOf(out, "answer") ?? "";
    expect(box).toMatch(/^<input[^>]*type="checkbox"/);
    expect(box).toContain('value="yes"');
    expect(box).toContain('required=""');
    expect(out).toMatch(/<label[^>]*for="n1-field-0"><input/);
  });

  it("offers exactly the types it draws", () => {
    expect([...FORM_FIELD_TYPES]).toEqual([
      "text",
      "email",
      "tel",
      "number",
      "url",
      "date",
      "textarea",
      "select",
      "checkbox",
      "radio",
    ]);
    const item = (form.props?.fields as { item?: Record<string, unknown> })
      ?.item as { type?: { options?: unknown } };
    expect(item.type?.options).toEqual([...FORM_FIELD_TYPES]);
  });

  it("falls back to a text input for a type nobody declared", async () => {
    expect(controlOf(await drawn("colour"), "answer")).toMatch(
      /^<input[^>]*type="text"/
    );
  });
});

describe("one description for what is drawn and what is checked", () => {
  it("draws each field's rules from the description the receiver checks", async () => {
    const props: FormProps = {
      fields: [
        { label: "Email", type: "email", required: true },
        { label: "Size", type: "select", options: ["S", "M"], required: true },
        { label: "Visit", type: "radio", options: ["Today", "Later"] },
        { label: "Site", type: "url" },
        { label: "Notes", type: "textarea" },
      ],
    };
    const out = await html(props, { ctx: { forms: FORMS } });
    for (const field of formFieldDrawings(props)) {
      const controls =
        out.match(
          new RegExp(
            `<(?:input|select|textarea)[^>]*name="${field.name}"[^>]*>`,
            "g"
          )
        ) ?? [];
      // Must-be-found: the description's every field is drawn.
      expect(controls.length, field.name).toBeGreaterThan(0);
      for (const control of controls) {
        expect(control.includes('required=""'), field.name).toBe(
          field.required === true && field.kind !== "checkbox"
            ? true
            : field.required === true
        );
        if (["email", "url", "number", "date"].includes(field.kind)) {
          expect(control).toContain(`type="${field.kind}"`);
        }
      }
      // A Dropdown or Choice offers exactly the description's options.
      if (field.options !== undefined) {
        const drawnValues = [
          ...out.matchAll(
            new RegExp(
              field.kind === "select"
                ? `<option value="([^"]+)">`
                : `<input[^>]*name="${field.name}"[^>]*value="([^"]+)"`,
              "g"
            )
          ),
        ].map(match => match[1]);
        for (const option of field.options) {
          expect(drawnValues).toContain(option.value);
        }
      }
    }
  });

  it("gives a Dropdown or Choice its options, and no other type any", () => {
    expect(
      formFieldDrawings({
        fields: [
          { label: "Size", type: "select", options: ["S", "", "S", "M"] },
          { label: "Name", type: "text", options: ["ignored"] },
        ],
      })
    ).toEqual([
      {
        name: "size",
        label: "Size",
        kind: "select",
        required: false,
        options: [
          { value: "S", label: "S" },
          { value: "M", label: "M" },
        ],
      },
      { name: "name", label: "Name", kind: "text", required: false },
    ]);
  });
});

describe("required marks", () => {
  const props: FormProps = {
    fields: [
      { label: "Name", required: true },
      { label: "Email", type: "email", required: true },
      { label: "Notes" },
    ],
  };

  it("says '* Required' once, above the fields, for the eye only", async () => {
    const out = await html(props);
    expect(out.match(/\* Required/g)).toHaveLength(1);
    expect(out.indexOf("* Required")).toBeLessThan(out.indexOf("Name"));
    expect(out).toMatch(/<p[^>]*aria-hidden="true"[^>]*>\* Required<\/p>/);
  });

  it("marks each required field with a visible star and 'required' in its name", async () => {
    const out = await html(props, { parts: true });
    expect(out).toContain(
      '<label for="n1-field-0">Name<span aria-hidden="true"> *</span><span class="nx-part-spoken"> (required)</span></label>'
    );
    expect(out).toContain('<label for="n1-field-2">Notes</label>');
  });

  it("says nothing of required fields where none is", async () => {
    expect(await html({ fields: [{ label: "Notes" }] })).not.toContain(
      "Required"
    );
  });
});

describe("sending, with no script", () => {
  it("posts to the receiver with the fields it reads the form by", async () => {
    const out = await html(
      { fields: [{ label: "Name" }] },
      { nodeId: "contact", ctx: { forms: FORMS, locale: "de" } }
    );
    expect(out).toMatch(
      /^<form class="nx-n1" action="\/admin\/api\/plugins\/@nextlyhq\/plugin-page-builder\/forms\/send" method="post">/
    );
    expect(out).toContain(
      '<input type="hidden" name="_form" value="page:p1"/>'
    );
    expect(out).toContain(
      '<input type="hidden" name="_node" value="contact"/>'
    );
    expect(out).toContain(
      '<input type="hidden" name="_return" value="/contact"/>'
    );
    expect(out).toContain('<input type="hidden" name="_locale" value="de"/>');
  });

  it("never posts to its 'Send to' address from the visitor's browser", async () => {
    const out = await html(
      { action: "https://hooks.example.com/in", fields: [{ label: "Name" }] },
      { ctx: { forms: FORMS } }
    );
    expect(out).not.toContain("hooks.example.com");
  });

  it("posts nowhere where the page has no receiver, and never puts answers in the address", async () => {
    // As on the canvas, or a standalone render: a submit there must not be
    // a GET, which writes every answer into the URL, the history and logs.
    const out = await html({ fields: [{ label: "Name" }] });
    expect(out).toMatch(/^<form class="nx-n1" method="post">/);
    expect(out).not.toContain("action=");
    expect(out).not.toContain('name="_form"');
  });

  it("gives the button words when none were stored", async () => {
    expect(await html({})).toContain('type="submit">Send</button>');
    expect(await html({ submitText: "Ask us" })).toContain(">Ask us</button>");
  });
});

describe("the answers a send comes back to", () => {
  it("draws each outcome's message, hidden, under the id the receiver names", async () => {
    const out = await html({ fields: [] }, { nodeId: "contact" });
    for (const [outcome, words] of [
      ["sent", FORM_SENT_MESSAGE],
      ["invalid", FORM_REFUSALS.invalid],
      ["closed", FORM_REFUSALS.closed],
      ["error", FORM_REFUSALS.error],
    ] as const) {
      expect(out).toContain(
        `<div id="form-contact-${outcome}" class="" data-nx-form-result="${outcome}" tabindex="-1">${words.replaceAll("'", "&#x27;")}</div>`
      );
    }
  });

  it("says the author's own message once sent", async () => {
    const out = await html({ message: "We'll call you back." });
    expect(out).toMatch(
      /data-nx-form-result="sent"[^>]*>We&#x27;ll call you back\./
    );
  });

  it("shows the message the address names, and hides the fields once sent", () => {
    // Hidden by this rule, not by the `hidden` attribute: a host reset such
    // as Tailwind's Preflight makes `[hidden]` `display: none !important`
    // in a layer no rule of the page's can then beat, and the message the
    // address names would never show.
    expect(FORM_RESULT_CSS).toContain(
      "[data-nx-form-result]:not(:target){display:none}"
    );
    expect(FORM_RESULT_CSS).not.toContain("display:block");
    expect(FORM_RESULT_CSS).toContain(
      'form:has(>[data-nx-form-result="sent"]:target)>:not([data-nx-form-result="sent"]){display:none}'
    );
  });

  it("carries the rules with every form, to be hoisted once per page", async () => {
    // Hoisted by React as `data-href`, which is how one copy is kept.
    expect(await drawn({})).toMatch(
      /^<style data-precedence="default" data-href="nx-form-results">/
    );
  });
});

describe("a form saved before this version", () => {
  const resolver: BlockResolver = {
    get: (name: string) =>
      coreBlocks.find(candidate => candidate.name === name) as never,
  };
  const v1 = {
    id: "f",
    type: "core/form",
    version: 1,
    props: {
      action: "https://hooks.example.com/in",
      method: "get",
      fields: [
        { label: "Name", name: "name", type: "text", required: true },
        { label: "Email", name: "email", type: "email" },
      ],
    },
  };

  it("is read as this version, losing only its method", () => {
    const { doc } = migrateDocument(
      { formatVersion: 1, kind: "page", nodes: [v1] },
      migrationSourceFor(resolver)
    );
    const [node] = doc.nodes;
    expect(node?.version).toBe(2);
    expect(node?.props).toEqual({
      action: "https://hooks.example.com/in",
      fields: v1.props.fields,
      // What the button said when nothing was stored.
      submitText: "Submit",
    });
  });

  it("keeps the names its unnamed fields were sent under", () => {
    // A version 1 field with no name was sent as `field-<n>`; a receiving
    // address may expect exactly that.
    const { doc } = migrateDocument(
      {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            ...v1,
            props: {
              ...v1.props,
              fields: [
                { label: "Name", required: true },
                { label: "Email", name: "email", type: "email" },
                { label: "Note" },
              ],
            },
          },
        ],
      },
      migrationSourceFor(resolver)
    );
    expect(
      formFields(doc.nodes[0]?.props ?? {}).map(field => field.name)
    ).toEqual(["field-0", "email", "field-2"]);
  });

  it("keeps words its button had", () => {
    const { doc } = migrateDocument(
      {
        formatVersion: 1,
        kind: "page",
        nodes: [{ ...v1, props: { ...v1.props, submitText: "Go" } }],
      },
      migrationSourceFor(resolver)
    );
    expect(doc.nodes[0]?.props.submitText).toBe("Go");
  });
});

describe("a control an author can SEE", () => {
  const control = form.parts?.control?.baseStyles?.base?.base as
    | Record<string, unknown>
    | undefined;

  /** The compiled rule for one part, which is what reaches a page. */
  function partCss(part: string): string {
    const document: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "f", type: form.name, version: 2, props: {} }],
    };
    const resolver: BlockResolver = {
      get: (name: string) =>
        coreBlocks.find(candidate => candidate.name === name) as never,
    };
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
    const selector = blockPartClassName(form.name, part);
    return css
      .split("}")
      .filter(rule => rule.includes(`.${selector}`))
      .join("}");
  }

  /** The value of one declaration inside a compiled rule. */
  function declaredValue(css: string, property: string): string | undefined {
    return css
      .match(new RegExp(`(?:^|[;{\\s])${property}:\\s*([^;}]+)`))?.[1]
      .trim();
  }

  function expectNonZero(css: string, property: string): void {
    const value = declaredValue(css, property);
    expect(value, `${property} never reached the stylesheet`).toBeDefined();
    expect(value, `${property} compiled to the zero ${value}`).not.toMatch(
      /^0[a-z%]*$/
    );
  }

  it("draws a border with a NONZERO width on every side", () => {
    const css = partCss("control");
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
    const named = (
      control?.border as { color?: { $token?: string } } | undefined
    )?.color?.$token;
    const token = defaultSiteTokens().find(entry => entry.name === named);
    const background = defaultSiteTokens().find(
      entry => entry.name === "color.background"
    );
    expect(
      token,
      `${String(named)} is not in the guaranteed set`
    ).toBeDefined();
    for (const mode of ["light", "dark"] as const) {
      const ratio = contrastRatio(
        parseColor(token?.values[mode] ?? "")!,
        parseColor(background?.values[mode] ?? "")!
      );
      expect(ratio, `${mode}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps a phone from zooming in, and is a target a thumb can hit", () => {
    // 16px of text, so a phone does not zoom the page when a field is
    // tapped, and 44px tall.
    const css = partCss("control");
    expect(declaredValue(css, "font-size")).toBe("1rem");
    expect(declaredValue(css, "min-height")).toBe("2.75rem");
    expect(declaredValue(partCss("choice"), "min-height")).toBe("2.75rem");
    expect(declaredValue(partCss("submit"), "min-height")).toBe("2.75rem");
  });

  it("draws a background and padding an author can see", () => {
    const css = partCss("control");
    expect(css).toMatch(/background-color:\s*var\(--site-/);
    for (const side of [
      "padding-block-start",
      "padding-block-end",
      "padding-inline-start",
      "padding-inline-end",
    ]) {
      expectNonZero(css, side);
    }
  });

  it("writes the messages and help in colours that read in light and dark", () => {
    const tokens = defaultSiteTokens();
    const value = (name: string, mode: "light" | "dark"): string =>
      tokens.find(entry => entry.name === name)?.values[mode] ?? "";
    const parts = form.parts ?? {};
    const colourOf = (part: string, key: string): string | undefined =>
      (
        (parts[part]?.baseStyles?.base?.base as Record<string, unknown>)?.[
          key
        ] as { $token?: string } | undefined
      )?.$token;
    for (const mode of ["light", "dark"] as const) {
      // The message box: its text on its own surface.
      const message = contrastRatio(
        parseColor(value(colourOf("message", "color")!, mode))!,
        parseColor(value(colourOf("message", "backgroundColor")!, mode))!
      );
      expect(message, `message in ${mode}`).toBeGreaterThanOrEqual(4.5);
      // Help, the note and an error, on the page's background.
      for (const part of ["help", "note", "error"]) {
        const ratio = contrastRatio(
          parseColor(value(colourOf(part, "color")!, mode))!,
          parseColor(value("color.background", mode))!
        );
        expect(ratio, `${part} in ${mode}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("puts the parts' classes on what it draws", async () => {
    const out = await html(
      {
        fields: [
          { label: "Email", type: "email", required: true },
          { label: "Size", type: "radio", options: ["S"] },
        ],
      },
      { parts: true }
    );
    for (const part of [
      "submit",
      "control",
      "field",
      "choice",
      "tick",
      "note",
      "error",
      "message",
      "spoken",
      "trap",
    ]) {
      expect(out, part).toContain(`nx-part-${part}`);
    }
  });

  it("gives the button the SAME appearance as core/button, sized to its words", () => {
    expect(form.parts?.submit?.baseStyles).toEqual({
      ...BUTTON_BASE_STYLES,
      base: {
        ...BUTTON_BASE_STYLES.base,
        base: {
          ...BUTTON_BASE_STYLES.base.base,
          width: "fit-content",
          minHeight: "2.75rem",
        },
      },
    });
    expect(Object.keys(BUTTON_BASE_STYLES.base.base).length).toBeGreaterThan(3);
  });

  it("writes no inline style", async () => {
    expect(
      await html({
        fields: [
          { label: "A", required: true },
          { label: "B", type: "radio", options: ["x"] },
        ],
      })
    ).not.toContain("style=");
  });
});

describe("the hidden spam trap", () => {
  function trapInput(out: string): string | undefined {
    return out.match(
      new RegExp(`<input[^>]*name="${FORM_HONEYPOT_FIELD}"[^>]*>`)
    )?.[0];
  }

  it("is in every form, under the name the receiver reads", async () => {
    expect(FORM_HONEYPOT_FIELD).toBe("_hp");
    expect(trapInput(await html({}))).toBeDefined();
    expect(
      trapInput(await html({ fields: [{ label: "Email", type: "email" }] }))
    ).toBeDefined();
  });

  it("is out of the tab order, closed to autofill and hidden from screen readers", async () => {
    const input = trapInput(await html({})) ?? "";
    expect(input).toContain('tabindex="-1"');
    expect(input).toMatch(/autocomplete="off"/i);
    expect(input).toContain('aria-hidden="true"');
    expect(input).toContain('type="text"');
    expect(input).not.toMatch(/value="[^"]+"/);
  });

  it("hides its label from screen readers with it", async () => {
    expect(await html({}, { nodeId: "n7" })).toMatch(
      /<div[^>]*aria-hidden="true"[^>]*><label for="n7-trap">[^<]+<\/label><input[^>]*id="n7-trap"/
    );
  });

  it("is drawn off screen by its part, not by an inline style", () => {
    const trap = form.parts?.trap?.baseStyles?.base?.base as
      | Record<string, unknown>
      | undefined;
    expect(trap?.position).toEqual({ type: "absolute" });
    expect(trap?.margin).toEqual({ inlineStart: "-10000px" });
    expect(trap?.overflow).toBe("hidden");
  });
});

describe("what a stored form can hold", () => {
  it("survives members that are not fields at all", async () => {
    const out = await html({
      fields: ["not a field", null, { label: "Name" }] as never,
    });
    expect(controlOf(out, "name")).toBeDefined();
  });

  it("reads at most a hundred stored fields", () => {
    const fields = Array.from({ length: 150 }, (_, index) => ({
      label: `F${index}`,
    }));
    expect(formFields({ fields })).toHaveLength(100);
  });

  it("labels a field that has no label with the name it sends under", async () => {
    expect(await html({ fields: [{ name: "phone" }] })).toContain(
      '<label for="n1-field-0">phone</label>'
    );
  });
});
