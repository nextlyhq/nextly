/**
 * The import preview's "Fonts this site doesn't have": each font the file
 * uses that no font file on the site provides, with "Add from Google Fonts"
 * for one the catalogue has. Fonts travel by name only, so the import never
 * adds one by itself; adding goes through the catalogue's own add, the one
 * the Fonts screen uses, and a font the catalogue lacks is uploaded there.
 *
 * @module variables-transfer-fonts
 */
import { Button } from "@nextlyhq/ui";
import * as React from "react";

import { DESIGN_ACTION_WORDS as WORDS } from "./editor-words";
import type { CatalogueFamilyView, FontCatalogue } from "./font-catalogue-view";

/** Where one missing font stands. */
type Standing =
  | { readonly kind: "idle" }
  | { readonly kind: "adding" }
  | { readonly kind: "added" }
  | { readonly kind: "refused"; readonly why: string };

/**
 * The cuts an add asks for: the regular and bold where the family has them,
 * else its first, in its default script and its upright style, or its first
 * where it has none. A variable family is added whole.
 */
function firstCuts(family: CatalogueFamilyView): {
  weights: readonly number[] | "variable";
  styles: CatalogueFamilyView["styles"];
  subsets: readonly string[];
} {
  const styles: CatalogueFamilyView["styles"] = family.styles.includes("normal")
    ? ["normal"]
    : family.styles.slice(0, 1);
  if (family.variable)
    return { weights: "variable", styles, subsets: [family.defSubset] };
  const both = family.weights.filter(
    weight => weight === 400 || weight === 700
  );
  const first = family.weights[0];
  return {
    weights: both.length > 0 ? both : first === undefined ? [] : [first],
    styles,
    subsets: [family.defSubset],
  };
}

/** What the import reads the catalogue with: its families, and its add. */
export type ImportCatalogue = Pick<FontCatalogue, "load" | "add">;

export function MissingFonts({
  families,
  catalogue,
}: {
  /** The missing families, as the file names them. */
  families: readonly string[];
  catalogue?: ImportCatalogue;
}): React.JSX.Element {
  const [offered, setOffered] = React.useState<
    ReadonlyMap<string, CatalogueFamilyView>
  >(() => new Map());
  const [standing, setStanding] = React.useState<ReadonlyMap<string, Standing>>(
    () => new Map()
  );
  React.useEffect(() => {
    if (catalogue === undefined) return undefined;
    const reading = new AbortController();
    catalogue.load(reading.signal).then(
      ({ families: listed }) => {
        if (reading.signal.aborted) return;
        setOffered(
          new Map(listed.map(family => [family.family.toLowerCase(), family]))
        );
      },
      () => undefined
    );
    return () => reading.abort();
  }, [catalogue]);

  const add = async (name: string, family: CatalogueFamilyView) => {
    if (catalogue === undefined) return;
    const set = (next: Standing) =>
      setStanding(held => new Map(held).set(name, next));
    set({ kind: "adding" });
    const cuts = firstCuts(family);
    const refusal = await catalogue.add({
      id: family.id,
      weights: cuts.weights,
      styles: cuts.styles,
      subsets: cuts.subsets,
    });
    set(
      refusal === undefined
        ? { kind: "added" }
        : { kind: "refused", why: refusal }
    );
  };

  return (
    <section className="nx-vars-import__section">
      <h3>{WORDS.missingFonts}</h3>
      <ul className="nx-vars-import__fonts">
        {families.map(name => {
          const family = offered.get(name.toLowerCase());
          const now = standing.get(name) ?? { kind: "idle" };
          return (
            <li key={name} className="nx-vars-import__font">
              <span className="nx-vars-import__font-name">{name}</span>
              {family === undefined ? (
                <span className="nx-vars-import__font-note">
                  {WORDS.uploadFont}
                </span>
              ) : now.kind === "added" ? (
                <span className="nx-vars-import__font-note" role="status">
                  {WORDS.fontAdded}
                </span>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={now.kind === "adding"}
                  aria-label={`${WORDS.addFromGoogle}: ${name}`}
                  onClick={() => void add(name, family)}
                >
                  {WORDS.addFromGoogle}
                </Button>
              )}
              {now.kind === "refused" ? (
                <span className="nx-vars-import__font-note" role="alert">
                  {now.why}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
