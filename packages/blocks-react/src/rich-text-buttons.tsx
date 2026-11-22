/**
 * The button nodes of rich text: a button's variants, sizes and styles, a
 * row of buttons and its alignment, and whether a button draws at all.
 *
 * @module rich-text-buttons
 */
import { cssColor, type RichTextNode } from "@nextlyhq/blocks-engine";
import type { CSSProperties, ReactNode } from "react";

import { oneOf, relFor, text, url } from "./blocks/props";

/**
 * The button vocabularies, and the DEFAULT each falls back to.
 *
 * Every value here is the editor's, not a set invented to look reasonable. A
 * button serialises `variant: "filled"` by default and offers only `"outline"`
 * beside it, so a renderer allowlist of `primary | secondary | outline | ghost`
 * rewrites every default button to `primary` — the author picks an appearance
 * and the page draws a different one, with the value having passed a check that
 * looked like validation.
 *
 * The fallbacks are the editor's defaults for the same reason: a node stored
 * before a field existed carries nothing there, and answering `left` where the
 * editor answers `center` moves a button an author never touched.
 *
 * `richTextValueVocabulariesAgree` in the admin's conformance test is what
 * holds these to the editor's own types. They cannot be imported — this package
 * may not reach the admin — so they are restated and CHECKED rather than
 * restated and hoped for.
 */
/**
 * What a filled button falls back to when the author chose no colours.
 *
 * The CMS's HTML serializer already answers this for the same stored node, and
 * these are its answers. See {@link buttonStyle}.
 */
const FILLED_BACKGROUND = "#000";

const FILLED_FOREGROUND = "#fff";

const BUTTON_VARIANTS = ["filled", "outline"] as const;

const BUTTON_SIZES = ["sm", "md", "lg"] as const;

const BUTTON_ALIGNMENTS = ["left", "center", "right"] as const;

const DEFAULT_VARIANT = "filled";

const DEFAULT_SIZE = "md";

const DEFAULT_ALIGNMENT = "center";

/** Where a row's contents sit, per alignment the editor records. */
const FLEX_ALIGN: Readonly<Record<string, string>> = {
  left: "flex-start",
  center: "center",
  right: "flex-end",
};

/** Padding and text size per size the editor offers. */
const BUTTON_METRICS: Readonly<
  Record<string, { padding: string; fontSize: string }>
> = {
  sm: { padding: "0.375rem 0.75rem", fontSize: "0.875rem" },
  md: { padding: "0.5rem 1rem", fontSize: "0.875rem" },
  lg: { padding: "0.75rem 1.5rem", fontSize: "1rem" },
};

/**
 * What a button LOOKS like, as far as the author decided it.
 *
 * The dividing line rich text's renderer uses everywhere: **the renderer owes
 * what the author chose; what nobody chose stays the host's to theme.** Size and
 * alignment are choices the editor always records, so leaving them to a
 * stylesheet means an author picks `lg`, centred, and the page draws a
 * default-sized link on the left — the same failure the gallery column count
 * had. The colours are only written when the author set them; unset, the editor
 * falls back to its own `--nx-*` tokens, which a published site has no reason to
 * define, so emitting those would put a broken `var()` on the page instead of
 * letting the host's own rule apply.
 *
 * Enough shape to be a button and no more. No hover, no transition, no font
 * family: those are nobody's explicit choice, and the class beside them is how a
 * host says what it wants.
 */
function buttonStyle(
  item: Readonly<Record<string, unknown>>,
  variant: string,
  size: string
): CSSProperties {
  const metrics = Object.hasOwn(BUTTON_METRICS, size)
    ? BUTTON_METRICS[size]
    : undefined;
  // SANITIZED, not merely read. These are stored text and they land in a
  // `style` attribute, which React does not escape: a value of
  // `red;position:fixed;inset:0;background-image:url(...)` does not style the
  // button, it closes the declaration and opens its own — a full-page overlay
  // and an outbound request, from a field an author types into.
  //
  // The check is the engine's rather than this file's, because the CMS makes
  // the same decision about the same stored node and the two have to agree.
  const background = cssColor(item.bgColor);
  const foreground = cssColor(item.textColor);
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "0.375rem",
    textDecoration: "none",
    ...(metrics ?? {}),
    ...(variant === "outline"
      ? {
          border: "1px solid currentColor",
          ...(foreground === undefined ? {} : { color: foreground }),
        }
      : {
          // A filled button with NO colours still has to look filled. Both
          // fields are optional — `ButtonLinkNode`'s constructor defaults them
          // to `undefined` and its HTML-import path leaves them unset — so a
          // legacy, imported or programmatically built button arrives here with
          // neither, and emitting nothing publishes a padded but otherwise
          // plain anchor. This package ships no stylesheet for the class, so
          // there is nothing behind it to fall back on.
          //
          // Black on white rather than a token, because it is what the CMS's
          // own serializer already puts on a published page: `rich-text-html`
          // writes the background as `safeBg || "#000"` and the foreground as
          // `safeText || "#fff"`, and two published renderings of one document
          // have to agree. A `var(--nx-*)` would not — that is an ADMIN token a
          // site has no reason to define, so the page would carry a broken
          // `var()` where the button should be.
          backgroundColor: background ?? FILLED_BACKGROUND,
          color: foreground ?? FILLED_FOREGROUND,
        }),
  };
}

/**
 * One button, as the ANCHOR it is.
 *
 * Never a `<button>`. It navigates, so it has to be announced as a link and
 * behave like one — opening in a new tab, copying its address, being followed
 * by a keyboard. Styling it to look like a button is presentation, not element
 * choice.
 *
 * The destination crosses `url()` for the reason {@link LinkView} gives, and a
 * refused one renders nothing at all rather than the label alone: unlike a link
 * wrapping prose, a button's text IS the button, and leaving it behind as bare
 * words puts an orphaned "Buy now" in the middle of an article.
 */
function ButtonView({
  item,
}: {
  item: Readonly<Record<string, unknown>>;
}): ReactNode {
  const href = url(item.url);
  if (href === undefined) return null;
  const label = text(item.text);
  if (label === "") return null;
  const target = item.target === "_blank" ? "_blank" : undefined;
  const variant = oneOf(item.variant, BUTTON_VARIANTS, DEFAULT_VARIANT);
  const size = oneOf(item.size, BUTTON_SIZES, DEFAULT_SIZE);
  return (
    <a
      className="nextly-rich-text-button"
      href={href}
      target={target}
      rel={relFor(target, item.rel)}
      data-variant={variant}
      data-size={size}
      style={buttonStyle(item, variant, size)}
    >
      {label}
    </a>
  );
}

/**
 * Whether an entry can become a button at all.
 *
 * Asked BEFORE the wrapper is built, because a wrapper around nothing is not
 * nothing: an empty `<p>` keeps its paragraph margins and leaves a blank gap in
 * the prose, which is a visible artefact of a refusal whose stated behaviour is
 * to render nothing. A test asserting only that the LABEL is gone stays green
 * with that gap present.
 */
export function isRenderable(item: Readonly<Record<string, unknown>>): boolean {
  return url(item.url) !== undefined && text(item.text) !== "";
}

/** The row a button or a group of them sits in. */
function ButtonRow({
  node,
  items,
}: {
  node: RichTextNode;
  items: readonly Readonly<Record<string, unknown>>[];
}): ReactNode {
  const usable = items.filter(isRenderable);
  if (usable.length === 0) return null;
  const align = oneOf(node.alignment, BUTTON_ALIGNMENTS, DEFAULT_ALIGNMENT);
  return (
    <p
      className="nextly-rich-text-buttons"
      data-align={align}
      // Alignment is a choice the editor always records, so the page owes it
      // for the reason the size above is owed: left to a stylesheet, a button
      // the author centred publishes against the margin.
      style={{
        display: "flex",
        // WRAPPING, because the editor wraps: its preview uses `flex-wrap` and
        // `exportDOM` sets `flexWrap` explicitly. Without it a group wider than
        // its column overflows rather than moving to a second line, so a long
        // pair of labels — or any group on a narrow screen — publishes
        // differently from what the author was shown.
        flexWrap: "wrap",
        gap: "0.75rem",
        justifyContent: FLEX_ALIGN[align] ?? "center",
      }}
    >
      {usable.map((item, i) => (
        <ButtonView key={i} item={item} />
      ))}
    </p>
  );
}

/** A single button the author placed in their prose. */
export function ButtonLinkView({ node }: { node: RichTextNode }): ReactNode {
  return <ButtonRow node={node} items={[node]} />;
}

/**
 * Several buttons offered together.
 *
 * One refused button leaves the others: a group is a set of alternatives, and
 * dropping the whole row because one destination was unusable takes away
 * choices that were fine.
 */
export function ButtonGroupView({ node }: { node: RichTextNode }): ReactNode {
  if (!Array.isArray(node.buttons)) return null;
  const items = node.buttons.filter(
    (entry): entry is Readonly<Record<string, unknown>> =>
      entry !== null && typeof entry === "object"
  );
  return <ButtonRow node={node} items={items} />;
}
