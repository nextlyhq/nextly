import pc from "picocolors";

export interface MaybeShowBannerOptions {
  disabled: boolean;
  notifiedAt: number | null;
  markNotified: () => void;
  out?: (chunk: string) => void;
}

// Prints the one-time telemetry notice. Kept as plain writes (not @clack/prompts)
// so @nextly/telemetry has no prompt-library dependency and can be called from
// any CLI entry point without forcing a specific UI framework.
export function maybeShowBanner(opts: MaybeShowBannerOptions): void {
  const write = opts.out ?? (chunk => process.stderr.write(chunk));
  if (opts.disabled) return;
  if (opts.notifiedAt !== null) return;

  const lines = [
    "",
    pc.bold("Anonymous telemetry"),
    "",
    "Nextly collects anonymous usage data to improve the tool.",
    "No project names, paths, code, env vars, or secrets are ever collected.",
    "",
    `Learn what we collect: ${pc.cyan("https://nextlyhq.com/docs/telemetry")}`,
    `Opt out now: ${pc.bold("nextly telemetry disable")}`,
    `               (or set ${pc.bold("NEXTLY_TELEMETRY_DISABLED=1")})`,
    "",
    pc.dim("This notice shows once."),
    "",
  ];

  for (const line of lines) {
    write(`${line}\n`);
  }

  opts.markNotified();
}
