// Types for declaration-exports.mjs, which documents the behaviour.

export interface ExportStatements {
  named: Array<{ exported: string; local: string; from: string | undefined }>;
  declared: string[];
  stars: Array<{ from: string; as: string | undefined }>;
}

export declare function exportStatements(file: string): ExportStatements;

export declare function clauseName(node: {
  type: string;
  name?: string;
  value?: unknown;
}): string;

export declare function declarationFor(
  specifier: string,
  importer: string
): string;

export declare function exportedNames(
  file: string,
  follow?: (from: string, file: string) => string,
  seen?: Set<string>
): Set<string>;
