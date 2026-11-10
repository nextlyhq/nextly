/**
 * What the template reads that the workbench should point out: variables it
 * uses but does not declare, and uses that render blank (no test value and no
 * `| default:` fallback).
 *
 * Every Liquid field is read: the subject, preview text, From, Reply-To and
 * both bodies. The analysis parses with the engine configured as the
 * server's, which the editor loads on demand; until it has loaded, the
 * variables written as plain `{{ name }}` are listed and nothing is judged
 * blank. A template kept on the previous engine is never the analysis's to
 * parse: its plain `{{ name }}` uses are listed as the old editor read them,
 * and nothing is judged blank.
 */
import { useEffect, useMemo, useState } from "react";

import { collectVariableNames } from "./interpolate";
import type * as VariableAnalysisModule from "./liquid/liquid-variables";
import { suppliedNamesFor } from "./sample-data";

// Only its type: the module itself loads on demand, with the editor.
type VariableAnalysis = typeof VariableAnalysisModule;

/** A variable used but not declared, with each path the template reads it by. */
export interface UndeclaredVariable {
  name: string;
  paths: string[];
}

export interface TemplateVariableCheck {
  undeclared: UndeclaredVariable[];
  /** The paths written out with no value and no fallback, each once. */
  missing: string[];
}

export function useTemplateVariables({
  sources,
  declared,
  data,
  isLayoutRow,
  liquid,
}: {
  sources: ReadonlyArray<string | undefined>;
  declared: ReadonlyArray<{ name: string }>;
  data: Record<string, unknown>;
  isLayoutRow: boolean;
  /** Whether the template is on the Liquid engine, rather than kept on the old one. */
  liquid: boolean;
}): TemplateVariableCheck {
  const [analysis, setAnalysis] = useState<VariableAnalysis | null>(null);
  useEffect(() => {
    let live = true;
    void import("./liquid/liquid-variables").then(loaded => {
      if (live) setAnalysis(loaded);
    });
    return () => {
      live = false;
    };
  }, []);

  // Tracked by content: the caller builds a new list on every render.
  const key = JSON.stringify(sources.map(source => source ?? ""));
  return useMemo(() => {
    const texts = JSON.parse(key) as string[];
    const supplied = suppliedNamesFor(isLayoutRow);
    const declaredNames = new Set(declared.map(v => v.name).filter(Boolean));

    // The analysis reads the template as the Liquid engine does; a template
    // kept on the old one is read as the old editor read it, and nothing is
    // judged blank.
    const parsed = liquid && analysis;
    const paths = parsed
      ? parsed.usedVariables(texts).map(use => use.path)
      : [...new Set(texts.flatMap(collectVariableNames))];
    const undeclared = new Map<string, string[]>();
    for (const path of paths) {
      const name = path.split(/[.[]/)[0] ?? path;
      if (supplied.has(name) || declaredNames.has(name)) continue;
      undeclared.set(name, [...(undeclared.get(name) ?? []), path]);
    }

    const missing = parsed
      ? [
          ...new Set(
            texts.flatMap(text =>
              parsed.missingValues(text, data, supplied).map(use => use.path)
            )
          ),
        ]
      : [];

    return {
      undeclared: [...undeclared].map(([name, used]) => ({
        name,
        paths: used,
      })),
      missing,
    };
  }, [analysis, key, declared, data, isLayoutRow, liquid]);
}
