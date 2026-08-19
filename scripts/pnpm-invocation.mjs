/**
 * How to spawn pnpm, per platform, and how to stop what that spawn produced.
 *
 * Stopping belongs here because on Windows it is a consequence of the shell
 * below, not an independent concern: the shell is what puts a process between
 * the wrapper and its child, and a reader who changes one rule needs the
 * other in view.
 *
 * Its own module, and deliberately free of side effects, so the dev wrapper's
 * spawn rules can be tested without importing the wrapper — which would boot a
 * dev server. The alternative, guarding the wrapper's CLI entry, needs the
 * both-URL-forms dance `verify-merge.mjs` documents, and is silently wrong
 * when it is off: the module declines to run and exits 0 having done nothing.
 *
 * @module pnpm-invocation
 */

/**
 * Quote one argument for cmd.exe, if it needs it.
 *
 * With `shell: true` Node concatenates argv into a single command line and
 * escapes nothing, so an unquoted space splits one argument into two. This
 * repo is routinely checked out under a path containing a space, and the seed
 * step passes exactly such a path.
 *
 * @param {string} arg - a single argument.
 * @returns {string} the argument, quoted when cmd.exe would mis-split it.
 */
export function quoteForCmd(arg) {
  return /[\s"^&|<>()]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg;
}

/**
 * How to spawn a pnpm sub-command on a given platform.
 *
 * Windows has no `pnpm.exe` — pnpm ships as `pnpm.CMD` beside a `.ps1` and a
 * POSIX shell shim. Two Node behaviours then collide, and a fix has to clear
 * both:
 *
 *   - `spawn` without a shell calls CreateProcess, which does not consult
 *     PATHEXT, so a bare "pnpm" matches no file at all -> ENOENT.
 *   - Naming `pnpm.cmd` instead does not help: since the BatBadBut mitigation
 *     (CVE-2024-27980; Node 18.20.2, 20.12.2, 21.7.2) `spawn` REFUSES to run a
 *     `.cmd` or `.bat` unless `shell: true` -> EINVAL.
 *
 * So Windows must go through a shell, and quoting is the price of the shell,
 * which is why the arguments come back quoted there.
 *
 * Every other platform keeps the direct spawn it always had: pnpm is a real
 * executable, no shell means no quoting rules, and the arguments pass through
 * untouched. Linux and macOS therefore behave exactly as they did before this
 * function existed.
 *
 * CI did not catch the Windows fault, but not for want of Windows: `ci.yml`
 * runs `dev-script-smoke` and `Scaffold smoke` on windows-latest today. The
 * real gap is narrower, and worth stating exactly because it names the matrix
 * a future job would extend — no CI job runs `dev-playground.mjs` on ANY
 * platform, so the wrapper is unexercised everywhere, not only on Linux.
 *
 * @param {string[]} args - arguments to pnpm.
 * @param {string} platform - a `process.platform` value.
 * @returns {{command: string, args: string[], shell: boolean}} spawn inputs.
 */
export function pnpmInvocation(args, platform = process.platform) {
  if (platform !== "win32") {
    return { command: "pnpm", args, shell: false };
  }
  return { command: "pnpm", args: args.map(quoteForCmd), shell: true };
}

/**
 * How to stop the wrapper's long-lived child, per platform.
 *
 * The other side of the shell above. On Windows the handle `spawn` returns is
 * cmd.exe, not `next dev`, and Windows has no signal delivery: `child.kill()`
 * is a TerminateProcess against that one handle. The shell dies, `next dev`
 * is orphaned, and the port stays held by a process no longer reachable from
 * the wrapper.
 *
 * An interactive Ctrl-C hides this. The console raises CTRL_C_EVENT on the
 * whole process group without going through the wrapper's handler at all, so
 * the grandchild gets it either way. The case that leaks is a programmatic
 * SIGTERM — a supervising script, an editor's task runner, a test harness —
 * which reaches only the handle. `taskkill /t` walks the child tree, which is
 * the only way to reach a grandchild there.
 *
 * POSIX needs none of it: no shell was used, so the handle IS pnpm, and the
 * signal it is sent is a real one. Returning null rather than a POSIX command
 * keeps that difference explicit at the call site.
 *
 * @param {number} pid - the spawned child's pid.
 * @param {string} platform - a `process.platform` value.
 * @returns {{command: string, args: string[]}|null} a tree-kill command, or
 *   null when the platform's own signal delivery already suffices.
 */
export function treeKillCommand(pid, platform = process.platform) {
  if (platform !== "win32") {
    return null;
  }
  return { command: "taskkill", args: ["/pid", String(pid), "/t", "/f"] };
}
