// What: detects collections that exist in BOTH code-first (nextly.config.ts)
// and UI-first (dynamic_collections DB table) sources.
// Why: Task 11 enforces exclusive source ownership per collection slug.
// Silently picking one source would either overwrite UI work on restart or
// ignore code changes, both of which are data-loss footguns. The detector
// surfaces conflicts so the wrapper CLI can refuse startup with an
// actionable message pointing at `nextly db:sync --promote` or `--demote`.

export interface CodeCollection {
  slug: string;
}

export interface UiCollectionRecord {
  slug: string;
  createdAt?: string;
}

export interface Conflict {
  slug: string;
  uiSource: { createdAt?: string };
  codeSource: { configPath: string };
}

export class ConflictDetector {
  // Compares code-first collection slugs against UI-first records.
  // Case-insensitive matching because Postgres and MySQL fold identifier
  // casing in different ways and a user would not expect `Posts` vs `posts`
  // to be treated as two separate collections.
  detect(
    codeCollections: CodeCollection[],
    uiCollections: UiCollectionRecord[],
    configPath = "nextly.config.ts"
  ): Conflict[] {
    const codeSet = new Map<string, CodeCollection>();
    for (const c of codeCollections) {
      codeSet.set(c.slug.toLowerCase(), c);
    }

    const conflicts: Conflict[] = [];
    for (const ui of uiCollections) {
      const key = ui.slug.toLowerCase();
      if (codeSet.has(key)) {
        conflicts.push({
          slug: ui.slug,
          uiSource: { createdAt: ui.createdAt },
          codeSource: { configPath },
        });
      }
    }
    return conflicts;
  }
}

// Formats a conflict report as a string suitable for terminal output. The
// wrapper prints this and exits non-zero so the user sees it immediately
// rather than discovering the collision via silent breakage later.
export function formatConflictError(conflicts: Conflict[]): string {
  const lines: string[] = [];
  lines.push(`[nextly] Schema source conflicts detected:`);
  for (const c of conflicts) {
    lines.push(`  - '${c.slug}' exists in both:`);
    lines.push(
      `      UI: dynamic_collections${c.uiSource.createdAt ? ` (created ${c.uiSource.createdAt})` : ""}`
    );
    lines.push(`      Code: ${c.codeSource.configPath}`);
  }
  lines.push("");
  lines.push("Resolve with one of:");
  lines.push("  nextly db:sync --promote <slug>   # move UI to code");
  lines.push("  nextly db:sync --demote <slug>    # move code to UI");
  return lines.join("\n");
}
