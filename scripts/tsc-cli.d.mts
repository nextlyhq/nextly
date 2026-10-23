// Types for tsc-cli.mjs, for the TypeScript tests that import it.

export interface TscDiagnostic {
  /** The file as tsc printed it; undefined for a diagnostic about the configuration. */
  file: string | undefined;
  line: number | undefined;
  column: number | undefined;
  /** For example `TS2322`. */
  code: string;
  /** The message, with its continuation lines. */
  message: string;
}

export function tscEntry(): string;
export function tscMajor(): number;
export function diagnosticsIn(output: string): TscDiagnostic[];
export function compile(args: readonly string[], cwd: string): TscDiagnostic[];
export function showConfig(configPath: string): {
  compilerOptions?: Record<string, unknown>;
  files?: string[];
  include?: string[];
  exclude?: string[];
};
export function listedFiles(configPath: string): string[];
