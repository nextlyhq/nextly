/**
 * What the template reads that the workbench should point out: variables it
 * uses but does not declare, and uses that render blank (no test value and no
 * `| default:` fallback).
 *
 * Every Liquid field is read: the subject, preview text, From, Reply-To and
 * both bodies. The analysis parses with the engine configured as the
 * server's, which the editor loads on demand; until it has loaded, the
 * variables written as plain `{{ name }}` are listed and nothing is judged
 * blank.
 */
import { useEffect, useMemo, useState } from "react";

import { collectVariableNames } from "./interpolate";
import type * as VariableAnalysisModule from "./liquid/liquid-variables";
import { SUPPLIED_VARIABLE_NAMES } from "./sample-data";

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
}: {
  sources: ReadonlyArray<string | undefined>;
  declared: ReadonlyArray<{ name: string }>;
  data: Record<string, unknown>;
  isLayoutRow: boolean;
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
    const supplied = new Set(SUPPLIED_VARIABLE_NAMES);
    // A layout's body arrives as `content`.
    if (isLayoutRow) supplied.add("content");
    const declaredNames = new Set(declared.map(v => v.name).filter(Boolean));

    const paths = analysis
      ? analysis.usedVariables(texts).map(use => use.path)
      : [...new Set(texts.flatMap(collectVariableNames))];
    const undeclared = new Map<string, string[]>();
    for (const path of paths) {
      const name = path.split(/[.[]/)[0] ?? path;
      if (supplied.has(name) || declaredNames.has(name)) continue;
      undeclared.set(name, [...(undeclared.get(name) ?? []), path]);
    }

    const missing = analysis
      ? [
          ...new Set(
            texts.flatMap(text =>
              analysis.missingValues(text, data, supplied).map(use => use.path)
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
  }, [analysis, key, declared, data, isLayoutRow]);
}
