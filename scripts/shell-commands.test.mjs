/**
 * The commands `shell-commands.mjs` reads a step's script into.
 *
 * Each case pins one construct against a way a reader could get it wrong and still look right: an
 * operator inside quotes ending a command, a comment read as one, a substitution's command lost
 * inside the word holding it, a here-document's body read as commands or dropped.
 *
 * @module shell-commands.test
 */
import { describe, expect, it } from "vitest";

import { shellCommands } from "./shell-commands.mjs";

/** Each command's words, with `~` before a word that is not literal. */
const read = script =>
  shellCommands(script).map(command =>
    command.words.map(word => (word.literal ? word.text : `~${word.text}`))
  );

describe("shellCommands", () => {
  it("ends a word at whitespace, and a command at each control operator and newline", () => {
    expect(read("a b; c && d || e | f & g\nh")).toEqual([
      ["a", "b"],
      ["c"],
      ["d"],
      ["e"],
      ["f"],
      ["g"],
      ["h"],
    ]);
  });

  it("removes quoting, keeping an operator inside quotes as part of the word", () => {
    expect(read(`echo 'a; b' "c && d" e\\ f ""`)).toEqual([["echo", "a; b", "c && d", "e f", ""]]);
  });

  it("marks a word that expands as not literal, keeping what it does not interpret", () => {
    expect(read('echo $HOME "${X:-y}" $((1 + 2)) "$1"')).toEqual([
      ["echo", "~$HOME", "~${X:-y}", "~$((1 + 2))", "~$1"],
    ]);
  });

  it("keeps a dollar sign that starts no expansion, and distrusts one that decodes escapes", () => {
    expect(read("echo $ '$HOME' $'\\x6eode'")).toEqual([["echo", "$", "$HOME", "~$\\x6eode"]]);
  });

  it("drops a comment, but not a # inside a word", () => {
    expect(read("echo a#b # node x.mjs\n  # node y.mjs\nexit")).toEqual([["echo", "a#b"], ["exit"]]);
  });

  it("joins a line continuation into one command", () => {
    expect(read("node \\\n  --enable-source-maps \\\n  scripts/a.mjs")).toEqual([
      ["node", "--enable-source-maps", "scripts/a.mjs"],
    ]);
  });

  it("reports a substitution's commands before the command holding it, in every spelling", () => {
    expect(read('x=$(node a.mjs) "$(node b.mjs)" `node c.mjs`')).toEqual([
      ["node", "a.mjs"],
      ["node", "b.mjs"],
      ["node", "c.mjs"],
      ["~x=$()", "~$()", "~$()"],
    ]);
  });

  it("reads a substitution nested in another, and a process substitution", () => {
    expect(read("echo $(dirname $(node a.mjs)) <(node b.mjs)")).toEqual([
      ["node", "a.mjs"],
      ["dirname", "~$()"],
      ["node", "b.mjs"],
      ["echo", "~$()", "~$()"],
    ]);
  });

  it("keeps a substitution inside an expansion verbatim, where a search for a name still sees it", () => {
    expect(read('echo "${X:-$(node z.mjs)}"')).toEqual([["echo", "~${X:-$(node z.mjs)}"]]);
  });

  it("excludes redirections, and the files they name, from a command's words", () => {
    expect(read("node a.mjs > out.txt 2>&1 < in.txt &>> log.txt >| forced")).toEqual([
      ["node", "a.mjs"],
    ]);
  });

  it("does not take a number standing apart from the operator as its descriptor", () => {
    expect(read("echo 2 > out.txt")).toEqual([["echo", "2"]]);
  });

  it("keeps a here-document's body on the command that reads it, not as commands", () => {
    const commands = shellCommands("cat <<'EOF' > notes.md\nnode inside.mjs\nEOF\nnode after.mjs");

    expect(commands.map(command => command.words.map(word => word.text))).toEqual([
      ["cat"],
      ["node", "after.mjs"],
    ]);
    expect(commands[0].heredocs).toEqual(["node inside.mjs"]);
  });

  it("ends a <<- here-document at a delimiter indented with tabs", () => {
    const commands = shellCommands("cat <<-EOF\n\tbody\n\tEOF\necho after");

    expect(commands[0].heredocs).toEqual(["\tbody"]);
    expect(commands[1].words.map(word => word.text)).toEqual(["echo", "after"]);
  });

  it("keeps a here-string as its command's input", () => {
    expect(shellCommands('bash <<< "node x.mjs"')).toEqual([
      { words: [{ text: "bash", literal: true }], heredocs: ["node x.mjs"] },
    ]);
  });

  it("treats a subshell's parentheses as separators", () => {
    expect(read("(cd tools && node check.mjs)")).toEqual([["cd", "tools"], ["node", "check.mjs"]]);
  });

  it("reads an unterminated quote to the end instead of throwing", () => {
    expect(read('echo "abc')).toEqual([["echo", "abc"]]);
  });
});
