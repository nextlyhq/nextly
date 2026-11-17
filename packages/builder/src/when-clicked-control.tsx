"use client";

/**
 * What a click on a picture does, drawn as one control over the choice and
 * the link it follows: "When clicked: Nothing / Link / Enlarge", with the
 * shared link settings (where it goes, a new tab, its relationship) under it
 * only while Link is the choice.
 *
 * The choice shown is the block's own reading of its props
 * (`whenClickedOf`), the one its render follows, so the panel never says a
 * picture links while the page draws it unlinked. A link the author set
 * stays stored while another choice is made, so switching back to Link
 * brings it back as it was.
 *
 * @module when-clicked-control
 */

import { findNode, optionLabel } from "@nextlyhq/blocks-engine";
import { whenClickedOf } from "@nextlyhq/blocks-react";
import * as React from "react";

import { SegmentedChoice } from "./content-controls";
import { HeldByLock } from "./held-by-lock";
import { propLabel, type EditableProp } from "./inspector";
import { isLinkBound, LinkGroupField } from "./link-control";
import type { LinkGroup } from "./link-group";
import type { PropGroupContext } from "./prop-groups";

/** The choices this control can stand for, as the block reads them. */
const CLICK_CHOICES: ReadonlySet<string> = new Set([
  "nothing",
  "link",
  "enlarge",
]);

/** A block's click choice and the link it follows. */
export interface WhenClickedGroup {
  /** The choice's prop. */
  readonly choice: string;
  /** The link the Link choice follows. */
  readonly link: LinkGroup;
  /** Every prop the control draws: the choice and the link's. */
  readonly drawn: ReadonlySet<string>;
}

/**
 * The click group of a block's props, or `undefined` where it has none: a
 * `whenClicked` select offering Link among choices this control reads, and
 * a link group for Link to show. A `whenClicked` with no link to follow (a
 * gallery's Nothing or Enlarge) keeps its own row.
 */
export function whenClickedGroupOf(
  props: ReadonlyArray<Pick<EditableProp, "name" | "schema">>,
  link: LinkGroup | undefined
): WhenClickedGroup | undefined {
  if (link === undefined) return undefined;
  const choice = props.find(prop => prop.name === "whenClicked");
  const options = choice?.schema.options;
  if (choice?.schema.type !== "select" || !Array.isArray(options)) {
    return undefined;
  }
  if (
    !options.includes("link") ||
    !options.every(option => CLICK_CHOICES.has(String(option)))
  ) {
    return undefined;
  }
  return {
    choice: choice.name,
    link,
    drawn: new Set([choice.name, ...link.drawn]),
  };
}

/** The props as stored, by name: a default is not a value the page holds. */
function storedValues(
  props: readonly EditableProp[]
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(props.map(prop => [prop.name, prop.value]));
}

/**
 * The choice the picture reads as now: the block's reading of what is
 * stored, and Link where nothing is chosen and the link is bound, since the
 * page fills a bound link before the block reads it.
 */
function choiceShown(
  group: WhenClickedGroup,
  values: Readonly<Record<string, unknown>>,
  bindings: Readonly<Record<string, unknown>> | undefined
): string {
  const reading = whenClickedOf(values);
  const unchosen = !CLICK_CHOICES.has(String(values[group.choice]));
  return unchosen && reading === "nothing" && isLinkBound(group.link, bindings)
    ? "link"
    : reading;
}

/** "When clicked", and under Link the link's own settings. */
export function WhenClickedField({
  group,
  ...context
}: PropGroupContext & { group: WhenClickedGroup }): React.JSX.Element {
  const id = React.useId();
  const { props, writable, reasonId, onCommitMany, document, nodeId } = context;
  const prop = props.find(each => each.name === group.choice);
  const options = Array.isArray(prop?.schema.options)
    ? prop.schema.options.map(String)
    : [];
  const values = storedValues(props);
  const bindings = findNode(document.nodes, nodeId)?.bindings;
  const shown = choiceShown(group, values, bindings);
  const held = !writable(group.choice);
  return (
    <div className="nx-when-clicked" data-content-control="when-clicked">
      <HeldByLock reasonId={held ? reasonId : undefined}>
        <div className="nx-inspector__field" data-content-control="select">
          {/* Named by the section it heads, which already says the words,
              so the row draws the choices alone. */}
          <SegmentedChoice
            id={id}
            labelledBy={`${id}-label`}
            options={options}
            labels={options.map(option =>
              prop === undefined ? option : optionLabel(prop.schema, option)
            )}
            value={shown}
            disabled={held}
            // Only the choice is written, so a stored link stays for the
            // next time Link is chosen.
            onChoose={next => {
              if (next !== shown) onCommitMany({ [group.choice]: next });
            }}
          />
          <span id={`${id}-label`} hidden>
            {prop === undefined
              ? "When clicked"
              : propLabel(prop.name, prop.schema)}
          </span>
        </div>
      </HeldByLock>
      {shown === "link" ? (
        <LinkGroupField group={group.link} {...context} />
      ) : null}
    </div>
  );
}
