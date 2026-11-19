/**
 * The pieces the page builder's own starter pages are built from: core
 * blocks, styled only with the site's variables.
 *
 * Every colour and every space is a variable (`$token`) a site always has,
 * so a starter follows the site's light and dark colours and its spacing.
 * Type comes from the site too: a heading draws at its level's Site text,
 * and text that is meant to read smaller or larger uses the built-in type
 * sizes (`font-size.small`, `font-size.h4`). No font name appears here.
 * The literals left are not colours, fonts or spacing steps: a measure
 * (`maxWidth` in `rem`), a border's width, and letter spacing in `em`.
 *
 * @module starter-pages/first-party/parts
 */
import type { BlockNode } from "@nextlyhq/blocks-engine";

import { sides, styled, token } from "../../starter-style";

/** A flex column, its children `gap` apart. */
const stackOf = (gap: string) => ({
  display: "flex",
  flexDirection: "column",
  gap: token(gap),
});

/** One block, at version 1. */
function block(
  id: string,
  type: string,
  props: Record<string, unknown>,
  extra: { styles?: unknown; slots?: unknown } = {}
): BlockNode {
  return { id, type, version: 1, props, ...extra } as BlockNode;
}

/** A page section's look: plain, or on the site's surface colour. */
export type SectionLook = "plain" | "surface";

/**
 * A full-width section, its content held to the site's content width, its
 * children a column `space.columns` apart.
 */
export function section(
  id: string,
  children: BlockNode[],
  options: { look?: SectionLook; padding?: "compact" | "normal" | "roomy" } = {}
): BlockNode {
  return block(
    id,
    "core/section",
    {
      as: "section",
      contained: true,
      paddingPreset: options.padding ?? "normal",
    },
    {
      styles: styled({
        ...stackOf("space.columns"),
        ...(options.look === "surface"
          ? { backgroundColor: token("color.surface") }
          : {}),
      }),
      slots: { children },
    }
  );
}

/** A column of blocks, `space.stack` apart. */
export function stack(
  id: string,
  children: BlockNode[],
  gap = "space.stack"
): BlockNode {
  return block(
    id,
    "core/box",
    { as: "div", contained: false },
    { styles: styled(stackOf(gap)), slots: { children } }
  );
}

/** A narrow column, centred, its text centred: a statement or a call. */
export function centred(id: string, children: BlockNode[]): BlockNode {
  return block(
    id,
    "core/box",
    { as: "div", contained: false },
    {
      styles: styled({
        ...stackOf("space.stack"),
        alignItems: "center",
        textAlign: "center",
        maxWidth: "40rem",
        margin: sides("0", "auto"),
      }),
      slots: { children },
    }
  );
}

/** A narrow column at the start, for a page's opening words. */
export function opening(id: string, children: BlockNode[]): BlockNode {
  return block(
    id,
    "core/box",
    { as: "div", contained: false },
    {
      styles: styled({ ...stackOf("space.stack"), maxWidth: "44rem" }),
      slots: { children },
    }
  );
}

/**
 * A row of columns, which wraps onto more rows on a narrow screen. Each
 * entry is one column's blocks.
 */
export function columns(
  id: string,
  each: BlockNode[][],
  options: { alignCentre?: boolean } = {}
): BlockNode {
  return block(
    id,
    "core/columns",
    { as: "div", contained: false },
    {
      styles: styled({
        gap: token("space.columns"),
        ...(options.alignCentre === true ? { alignItems: "center" } : {}),
      }),
      slots: {
        children: each.map((children, index) =>
          block(
            `${id}-${String(index + 1)}`,
            "core/column",
            { as: "div", contained: false },
            { styles: styled(stackOf("space.stack")), slots: { children } }
          )
        ),
      },
    }
  );
}

/**
 * A card: the site's surface and border, rounded, its content padded. With
 * `marked`, its border is the site's primary colour, for the one choice a
 * page recommends.
 */
export function card(
  id: string,
  children: BlockNode[],
  options: { marked?: boolean } = {}
): BlockNode {
  return block(
    id,
    "core/card",
    { as: "div", contained: false },
    {
      styles: styled({
        ...stackOf("space.stack"),
        padding: sides(token("space.card")),
        ...(options.marked === true
          ? {
              border: {
                width: sides("2px"),
                style: "solid",
                color: token("color.primary"),
              },
            }
          : {}),
      }),
      slots: { children },
    }
  );
}

/** A heading, drawn at its level's Site text. */
export function heading(
  id: string,
  text: string,
  level: "h1" | "h2" | "h3"
): BlockNode {
  return block(id, "core/heading", { text, level });
}

/** How a line of text reads. */
export type TextRole =
  | "body"
  | "lead"
  | "muted"
  | "small"
  | "eyebrow"
  | "figure"
  | "step";

/** Each text role's look, in the site's colours and type sizes. */
const TEXT_LOOKS: Readonly<Record<TextRole, Record<string, unknown>>> = {
  body: {},
  // The sentence under a page's main heading: larger, and quieter.
  lead: {
    color: token("color.muted"),
    fontSize: token("font-size.h4"),
    lineHeight: token("line-height.h4"),
  },
  muted: { color: token("color.muted") },
  small: {
    color: token("color.muted"),
    fontSize: token("font-size.small"),
    lineHeight: token("line-height.small"),
  },
  // The few words over a heading that say what the page is.
  eyebrow: {
    color: token("color.primary"),
    fontSize: token("font-size.small"),
    lineHeight: token("line-height.small"),
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  // A number that is the point: a price, a year, a count.
  figure: {
    color: token("color.text"),
    fontSize: token("font-size.h1"),
    lineHeight: token("line-height.h1"),
    fontWeight: 700,
  },
  // A step's number, in the site's primary colour.
  step: {
    color: token("color.primary"),
    fontSize: token("font-size.h3"),
    lineHeight: token("line-height.h3"),
    fontWeight: 700,
  },
};

/** A line of text, in one of the roles above. */
export function text(
  id: string,
  words: string,
  role: TextRole = "body"
): BlockNode {
  const look = TEXT_LOOKS[role];
  return block(
    id,
    "core/text",
    { text: words },
    Object.keys(look).length === 0 ? {} : { styles: styled(look) }
  );
}

/**
 * A button: the site's primary look, or an outline of it for the second of
 * two choices.
 */
export function button(
  id: string,
  label: string,
  href: string,
  look: "primary" | "outline" = "primary"
): BlockNode {
  return block(
    id,
    "core/button",
    { label, href },
    look === "outline"
      ? {
          styles: styled({
            backgroundColor: "transparent",
            color: token("color.primary"),
            border: {
              width: sides("1px"),
              style: "solid",
              color: token("color.primary"),
            },
          }),
        }
      : {}
  );
}

/** Buttons side by side, wrapping on a narrow screen. */
export function buttons(id: string, children: BlockNode[]): BlockNode {
  return block(
    id,
    "core/box",
    { as: "div", contained: false },
    {
      styles: styled({
        display: "flex",
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        gap: token("space.stack"),
      }),
      slots: { children },
    }
  );
}

/**
 * An Image with no picture yet: it draws its empty state until the author
 * picks one of their own, and loads nothing.
 */
export function emptyImage(id: string): BlockNode {
  return block(id, "core/image", { loading: "lazy" });
}

/** An icon from the page builder's own set, in the site's primary colour. */
export function icon(id: string, name: string): BlockNode {
  return block(
    id,
    "core/icon",
    { icon: `lucide:${name}` },
    {
      styles: styled({
        color: token("color.primary"),
        fontSize: token("font-size.h3"),
      }),
    }
  );
}

/** An icon beside a line of text: a way to reach the business. */
export function detail(id: string, name: string, words: string): BlockNode {
  return block(
    id,
    "core/box",
    { as: "div", contained: false },
    {
      styles: styled({
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: token("space.stack"),
      }),
      slots: {
        children: [icon(`${id}-icon`, name), text(`${id}-text`, words)],
      },
    }
  );
}

/** A quotation, with who said it. */
export function quote(id: string, words: string, who: string): BlockNode {
  return block(id, "core/quote", { text: words, attribution: who });
}

/** A list: ticked, or plain lines with no marks. */
export function list(
  id: string,
  items: string[],
  kind: "checks" | "none" = "checks"
): BlockNode {
  return block(id, "core/list", { kind, items });
}

/** A line between two parts of a card. */
export function divider(id: string): BlockNode {
  return block(id, "core/divider", {});
}

/** Questions and answers, one open at a time, the first open. */
export function questions(
  id: string,
  pairs: readonly (readonly [string, string])[]
): BlockNode {
  return block(
    id,
    "core/accordion",
    {
      as: "div",
      contained: false,
      openMode: "one",
      firstOpen: true,
      titlesAs: "h3",
    },
    {
      slots: {
        children: pairs.map(([question, answer], index) => {
          const item = `${id}-${String(index + 1)}`;
          return block(
            item,
            "core/accordion-item",
            { title: question },
            { slots: { children: [text(`${item}-answer`, answer)] } }
          );
        }),
      },
    }
  );
}

/** One field of a simple form. */
export interface StarterField {
  readonly label: string;
  readonly type: "text" | "email" | "textarea";
}

/**
 * A simple form that says thanks once it is sent. Its "Send to" address is
 * left for the author: a starter cannot know where their answers go, and the
 * editor says so on the form until it is set.
 */
export function form(
  id: string,
  fields: readonly StarterField[],
  submitText: string,
  thanks: string
): BlockNode {
  return block(id, "core/form", {
    fields: fields.map(field => ({
      label: field.label,
      type: field.type,
      required: true,
    })),
    submitText,
    afterSending: "message",
    message: thanks,
  });
}
