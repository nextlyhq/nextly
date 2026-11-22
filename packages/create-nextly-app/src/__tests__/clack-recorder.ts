/**
 * A stand-in for `@clack/prompts` that records every line the scaffold shows
 * and every prompt it asks. A prompt with no answer set fails the run, so a
 * test of a run that must not prompt fails loudly if one does. Used as
 * `vi.mock("@clack/prompts", async () => (await import("./clack-recorder")).clack())`.
 */
export const ui = {
  /** Every message shown: intro, log lines, notes, spinners, cancel. */
  out: [] as string[],
  /** Every prompt asked, as `<kind>: <message>`. */
  asked: [] as string[],
  /** The answer each kind of prompt gives; unset, the prompt fails. */
  answers: {} as Partial<
    Record<"select" | "text" | "password" | "confirm", unknown>
  >,
  reset(): void {
    this.out.length = 0;
    this.asked.length = 0;
    this.answers = {};
  },
};

type Kind = keyof typeof ui.answers;

export function clack() {
  const say = (...parts: unknown[]) => {
    ui.out.push(parts.map(part => String(part)).join(" "));
  };
  const ask =
    (kind: Kind) =>
    async (options: { message: string }): Promise<unknown> => {
      ui.asked.push(`${kind}: ${options.message}`);
      if (!(kind in ui.answers)) {
        throw new Error(`unexpected prompt: ${options.message}`);
      }
      return ui.answers[kind];
    };
  return {
    intro: say,
    outro: say,
    note: say,
    cancel: say,
    isCancel: () => false,
    spinner: () => ({ start: say, stop: say, message: say }),
    log: {
      success: say,
      warn: say,
      info: say,
      error: say,
      message: say,
      step: say,
    },
    select: ask("select"),
    text: ask("text"),
    password: ask("password"),
    confirm: ask("confirm"),
  };
}

export function telemetry() {
  return {
    init: async () => {},
    capture: () => {},
    shutdown: async () => {},
    classifyError: () => "unknown",
  };
}
