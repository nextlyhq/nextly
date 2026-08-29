/**
 * The fonts panel: what this site can render, and which choices will not happen.
 *
 * A panel over {@link font-library}. It authors nothing, and that is a design
 * decision rather than an omission: {@link tokens-panel} already creates and
 * renames `fontFamily` tokens, and a second surface editing the same tokens
 * would be two implementations of one question — the defect this codebase names
 * more often than any other.
 *
 * ## The question this answers, which the tokens studio cannot
 *
 * The studio edits one token and knows nothing about the faces the site loads.
 * `compileSiteSheet` calls `emitFontFaces` and `emitTokenBlocks` independently,
 * so a token naming a family with no face is emitted exactly like one that has
 * it, and the page draws in whatever the browser reaches for next. Nothing
 * errors and nothing is logged. Joining the two lists is the only way to see
 * it, and joining them needs both, which is why it lives here.
 *
 * ## Every family is drawn in ITSELF
 *
 * A list of typeface names set in the interface's own font asks an author to
 * choose a typeface from its name, which is guessing. Webflow, Framer and
 * Elementor all render the specimen in the face it names, and the one thing
 * every review of a weak font picker says is that it did not. The specimen is
 * also the honest signal here: a family this site does not provide renders in
 * the fallback, so an author SEES the substitution rather than reading about it.
 *
 * ## What it will not say
 *
 * Never "missing" or "unavailable" for a family with no face. A named family
 * may be installed on the reader's device — `Georgia` and `Helvetica` are the
 * ordinary cases — so declaring it absent is a claim about a machine this code
 * cannot see. The wording says what is true: this site provides no face for it.
 * The same discipline the class manager applies to a usage count it knows can
 * under-count.
 *
 * @module fonts-panel
 */
import type { FontFaceDef, SiteTokenSet } from "@nextlyhq/blocks-engine";
import type * as React from "react";

import {
  fontTokenRows,
  rowsNeedingAttention,
  tokenNotes,
  tokenSummary,
} from "./font-library";
import type { FamilyReading, FontTokenRow } from "./font-library";

export interface FontsPanelProps {
  /**
   * The faces this site loads, or `undefined` while the host has not read them.
   *
   * A real third state rather than an empty list, for the reason the class
   * manager has one: a site that self-hosts nothing legitimately has no faces,
   * and an author must not be shown "no fonts" for a read still in flight.
   */
  faces: readonly FontFaceDef[] | undefined;
  /** The site's tokens, whose `fontFamily` members this reads. */
  tokens: SiteTokenSet | undefined;
  /** Why the faces are absent, when they are. */
  absence?: "pending" | "failed";
  /**
   * Open the tokens panel, when the host offers one.
   *
   * The fix for a token naming a family this site does not provide is to edit
   * that token, and editing it belongs to the studio. Offering the jump rather
   * than the field is what keeps one editor for one question.
   */
  onOpenTokens?: () => void;
}

/** The specimen, one sentence with ascenders, descenders and round forms. */
const SPECIMEN = "Almost before we knew it, we had left the ground";

/** The stack as CSS, so a specimen renders in the family it names. */
function specimenStyle(value: string): React.CSSProperties {
  return { fontFamily: value };
}

/**
 * A face's own specimen, drawn with the descriptors that face declares.
 *
 * Family alone selects the browser's normal weight and upright style, so a
 * site loading regular, bold and italic of one family would draw three
 * identical rows — the specimen would then demonstrate the opposite of what
 * the list claims, which is worse than no specimen.
 */
function faceSpecimenStyle(face: FontFaceDef): React.CSSProperties {
  return {
    fontFamily: `"${face.family}"`,
    ...(face.weight === undefined ? {} : { fontWeight: face.weight }),
    ...(face.style === undefined ? {} : { fontStyle: face.style }),
  };
}

/**
 * A key that separates the faces a family is really split into.
 *
 * Subsetting by `unicodeRange` is the ordinary way to ship a large script, and
 * those faces share family, weight and style by design — keyed on those three
 * alone they collide, and React cannot reconcile the rows.
 */
function faceKey(face: FontFaceDef): string {
  return [
    face.family,
    face.weight ?? "",
    face.style ?? "",
    face.unicodeRange ?? "",
    face.src.map(source => source.url).join("|"),
  ].join("::");
}

/** What a family's source means, in words an author can act on. */
function sourceNote(reading: FamilyReading): string {
  switch (reading.source) {
    case "hosted":
      return "this site loads a font file for it";
    case "generic":
      return "a generic family every browser resolves";
    case "dynamic":
      return "a custom property, resolved when the page renders — what it holds cannot be read from here";
    case "not-provided":
      return "this site provides no font file for it — readers see it only if it is already installed on their device";
  }
}

function FamilyLine({
  reading,
}: {
  reading: FamilyReading;
}): React.JSX.Element {
  return (
    <li className="nx-fonts__family">
      <span className="nx-fonts__family-name">{reading.family}</span>
      <span className="nx-fonts__family-note">{sourceNote(reading)}</span>
    </li>
  );
}

/**
 * What a row needs said, one line per affected mode.
 *
 * Its own component so the row stays layout, and a list because a token can be
 * sound in light and not in dark. The mode is named only when the token
 * actually declares a dark value: naming it otherwise would imply a mode the
 * author never configured.
 */
function TokenNotes({
  row,
  onOpenTokens,
}: {
  row: FontTokenRow;
  onOpenTokens?: () => void;
}): React.JSX.Element | null {
  const notes = tokenNotes(row);
  if (notes.length === 0) return null;
  const named = row.darkReading !== undefined;
  return (
    <>
      {notes.map(note => (
        <p className="nx-fonts__note nx-fonts__note--attention" key={note.mode}>
          {named ? `In ${note.mode} mode: ${note.text}` : note.text}
          {onOpenTokens === undefined ? null : (
            <>
              {" "}
              <button
                type="button"
                className="nx-fonts__jump"
                onClick={onOpenTokens}
              >
                Edit in Tokens
              </button>
            </>
          )}
        </p>
      ))}
    </>
  );
}

function TokenRow({
  row,
  onOpenTokens,
}: {
  row: FontTokenRow;
  onOpenTokens?: () => void;
}): React.JSX.Element {
  return (
    <li className="nx-fonts__token">
      <div className="nx-fonts__token-head">
        <span className="nx-fonts__token-name">{row.token.name}</span>
        {/*
          The specimen carries the token's WHOLE stack, so what is drawn is what
          the page draws. Rendering only the first family would show the author
          a typeface the browser may never reach.
        */}
        <span
          className="nx-fonts__specimen"
          style={specimenStyle(row.token.values.light)}
        >
          {SPECIMEN}
        </span>
      </div>
      <TokenNotes row={row} onOpenTokens={onOpenTokens} />
      <ul className="nx-fonts__families">
        {row.reading.families.map(family => (
          <FamilyLine key={family.family} reading={family} />
        ))}
      </ul>
    </li>
  );
}

/** The faces the site loads, each drawn in itself. */
function FaceList({
  faces,
}: {
  faces: readonly FontFaceDef[];
}): React.JSX.Element {
  if (faces.length === 0) {
    return (
      <p className="nx-fonts__note">
        This site loads no font files of its own. Tokens may still name generic
        families, and any typeface a reader has installed.
      </p>
    );
  }
  return (
    <ul className="nx-fonts__faces">
      {faces.map(face => (
        <li className="nx-fonts__face" key={faceKey(face)}>
          <span className="nx-fonts__face-name">{face.family}</span>
          <span className="nx-fonts__specimen" style={faceSpecimenStyle(face)}>
            {SPECIMEN}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Faces absent: a read in flight and a read that failed need different words. */
function FacesAbsent({
  absence,
}: {
  absence?: "pending" | "failed";
}): React.JSX.Element {
  return (
    <div className="nx-fonts">
      <p className="nx-inspector__note">
        {absence === "failed"
          ? "This site's fonts could not be read."
          : "Loading fonts…"}
      </p>
    </div>
  );
}

/**
 * The panel.
 *
 * Faces first, then tokens: the faces are what the site HAS, and a token is a
 * claim measured against them. Reading the claims before the evidence would put
 * every "no font file for it" note in front of the list that explains it.
 */
export function FontsPanel({
  faces,
  tokens,
  absence,
  onOpenTokens,
}: FontsPanelProps): React.JSX.Element {
  if (faces === undefined) return <FacesAbsent absence={absence} />;

  const rows = fontTokenRows(tokens, faces);

  return (
    <div className="nx-fonts">
      <section aria-labelledby="nx-fonts-faces">
        <h3 className="nx-fonts__heading" id="nx-fonts-faces">
          Font files this site loads
        </h3>
        <FaceList faces={faces} />
      </section>

      <section aria-labelledby="nx-fonts-tokens">
        <h3 className="nx-fonts__heading" id="nx-fonts-tokens">
          Typeface tokens
        </h3>
        <p className="nx-fonts__note" role="status">
          {tokenSummary(rows, rowsNeedingAttention(rows))}
        </p>
        <ul className="nx-fonts__tokens">
          {rows.map(row => (
            <TokenRow
              key={row.token.id ?? row.token.name}
              row={row}
              onOpenTokens={onOpenTokens}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}
