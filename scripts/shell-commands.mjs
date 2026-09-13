/**
 * The simple commands a shell script runs, word by word, in the order they run.
 *
 * For a check that has to know which programs a workflow step starts. It is not a shell: it reads
 * the POSIX tokens that decide where a command begins and what each word is — quoting, escapes,
 * comments, line continuations, control operators, redirections, here-documents and command
 * substitution — and expands nothing. A word whose value depends on the run, such as a parameter,
 * a substitution or an arithmetic expansion, is marked as not literal rather than guessed at.
 *
 * Two properties make it safe to build a refusal on:
 *
 * - Nothing outside a comment is dropped. A region this reader does not interpret, like `${…}` or
 *   `$((…))`, stays verbatim in its word's text, and a here-document's body stays on the command
 *   that reads it, so a caller searching for a program's name sees every place it appears.
 * - A command substitution's commands are reported as commands in their own right, BEFORE the
 *   command whose word contains them, which is the order the shell runs them in. The containing
 *   word carries `$()` in their place, so a name inside the substitution is not found twice.
 *
 * @module shell-commands
 */

/**
 * @typedef {object} ShellWord
 * @property {string} text the word with its quoting removed
 * @property {boolean} literal whether `text` is the word's value, with nothing left to expand
 */

/**
 * @typedef {object} ShellCommand
 * @property {ShellWord[]} words the command's words, without its redirections
 * @property {string[]} heredocs the here-documents and here-strings it reads
 */

/** A control operator, which ends a command. `&` before `>` starts a redirection instead. */
const CONTROL = /^(?:&&|\|\||;;|\|&|[;|]|&(?!>))/;

/** A redirection operator. */
const REDIRECTION = /^(?:<<<|<<-|<<|&>>|&>|>>|>&|<&|<>|>\||<|>)/;

/** What the word after each redirection operator is. Every other operator is followed by a file. */
const REDIRECTED = { "<<": "heredoc", "<<-": "heredoc-tabs", "<<<": "herestring" };

/** A parameter reference after `$`: a name, or one of the special parameters. */
const PARAMETER = /^(?:[A-Za-z_][A-Za-z0-9_]*|[0-9?#@*$!-])/;

/**
 * Every simple command in a script, in the order the shell runs them.
 *
 * @param {string} script
 * @returns {ShellCommand[]}
 */
export function shellCommands(script) {
  const ctx = { src: script, i: 0, out: [] };
  scan(ctx, false);
  return ctx.out;
}

/** Read commands until the source ends or, inside a substitution, until the `)` that closes it. */
function scan(ctx, inSubstitution) {
  const frame = { command: newCommand(), word: null, expect: null, pending: [], depth: 0 };
  while (ctx.i < ctx.src.length) {
    if (inSubstitution && ctx.src[ctx.i] === ")" && frame.depth === 0) {
      ctx.i += 1;
      break;
    }
    if (!readSeparator(ctx, frame)) readWordPart(ctx, frame);
  }
  endCommand(ctx, frame);
}

function newCommand() {
  return { words: [], heredocs: [] };
}

/** Consume what ends a word or a command, returning false when the next character is neither. */
function readSeparator(ctx, frame) {
  const c = ctx.src[ctx.i];
  if (c === " " || c === "\t" || c === "\r") {
    endWord(frame);
    ctx.i += 1;
  } else if (c === "\n") {
    endCommand(ctx, frame);
    ctx.i += 1;
    readHeredocBodies(ctx, frame);
  } else if (c === "#" && frame.word === null) {
    const end = ctx.src.indexOf("\n", ctx.i);
    ctx.i = end === -1 ? ctx.src.length : end;
  } else if (c === "(" || c === ")") {
    endCommand(ctx, frame);
    frame.depth = Math.max(0, frame.depth + (c === "(" ? 1 : -1));
    ctx.i += 1;
  } else {
    const control = CONTROL.exec(ctx.src.slice(ctx.i, ctx.i + 3));
    if (control === null) return false;
    endCommand(ctx, frame);
    ctx.i += control[0].length;
  }
  return true;
}

/** Consume one piece of a word: a quoted span, an expansion, a redirection, or one character. */
function readWordPart(ctx, frame) {
  const c = ctx.src[ctx.i];
  if (c === "\\") readEscape(ctx, frame);
  else if (c === "'") readSingleQuoted(ctx, frame);
  else if (c === '"') readDoubleQuoted(ctx, frame);
  else if (c === "$") readDollar(ctx, frame);
  else if (c === "`") readBackquoted(ctx, frame);
  else if ((c === "<" || c === ">") && ctx.src[ctx.i + 1] === "(") readSubstitution(ctx, frame, 2);
  else if (REDIRECTION.test(ctx.src.slice(ctx.i, ctx.i + 3))) readRedirection(ctx, frame);
  else {
    wordOf(frame).text += c;
    ctx.i += 1;
  }
}

function wordOf(frame) {
  frame.word ??= { text: "", literal: true };
  return frame.word;
}

/** A backslash outside quotes: a line continuation, or the character it escapes. */
function readEscape(ctx, frame) {
  const next = ctx.src[ctx.i + 1];
  ctx.i += 2;
  if (next !== undefined && next !== "\n") wordOf(frame).text += next;
}

function readSingleQuoted(ctx, frame) {
  const close = ctx.src.indexOf("'", ctx.i + 1);
  const end = close === -1 ? ctx.src.length : close;
  wordOf(frame).text += ctx.src.slice(ctx.i + 1, end);
  ctx.i = end + 1;
}

function readDoubleQuoted(ctx, frame) {
  const word = wordOf(frame);
  ctx.i += 1;
  while (ctx.i < ctx.src.length && ctx.src[ctx.i] !== '"') {
    const c = ctx.src[ctx.i];
    if (c === "$") readDollar(ctx, frame);
    else if (c === "`") readBackquoted(ctx, frame);
    else if (c === "\\") readQuotedEscape(ctx, word);
    else {
      word.text += c;
      ctx.i += 1;
    }
  }
  ctx.i += 1;
}

/** Inside double quotes a backslash escapes only `$`, a backquote, `"`, itself, and a newline. */
function readQuotedEscape(ctx, word) {
  const next = ctx.src[ctx.i + 1];
  ctx.i += 2;
  if (next === undefined || next === "\n") return;
  word.text += '$`"\\'.includes(next) ? next : `\\${next}`;
}

/** A `$`: a substitution, an expansion kept verbatim, a parameter, or just a dollar sign. */
function readDollar(ctx, frame) {
  const rest = ctx.src.slice(ctx.i + 1, ctx.i + 3);
  if (rest === "((") return readVerbatim(ctx, frame, 3, 2);
  if (rest[0] === "(") return readSubstitution(ctx, frame, 2);
  if (rest[0] === "{") return readVerbatim(ctx, frame, 2, 1);
  const word = wordOf(frame);
  const name = PARAMETER.exec(ctx.src.slice(ctx.i + 1));
  if (name === null) {
    // `$'…'` decodes escapes, so what follows is not the value as written.
    if (rest[0] === "'") word.literal = false;
    word.text += "$";
    ctx.i += 1;
    return;
  }
  word.text += `$${name[0]}`;
  word.literal = false;
  ctx.i += 1 + name[0].length;
}

/**
 * Keep an expansion this reader does not interpret — `${…}`, `$((…))` — verbatim in its word.
 *
 * @param {number} skip the length of its opening, `${` or `$((`
 * @param {number} depth how many brackets that opening leaves open
 */
function readVerbatim(ctx, frame, skip, depth) {
  const open = ctx.src[ctx.i + 1];
  const close = open === "(" ? ")" : "}";
  let j = ctx.i + skip;
  for (let level = depth; j < ctx.src.length && level > 0; j += 1) {
    if (ctx.src[j] === open) level += 1;
    else if (ctx.src[j] === close) level -= 1;
  }
  const word = wordOf(frame);
  word.text += ctx.src.slice(ctx.i, j);
  word.literal = false;
  ctx.i = j;
}

/** `$(…)`, `<(…)` or `>(…)`: its commands are reported, and the word holds `$()` in their place. */
function readSubstitution(ctx, frame, skip) {
  const word = wordOf(frame);
  ctx.i += skip;
  scan(ctx, true);
  word.text += "$()";
  word.literal = false;
}

/** The older substitution form, whose body is read after its own escapes are removed. */
function readBackquoted(ctx, frame) {
  let body = "";
  let j = ctx.i + 1;
  while (j < ctx.src.length && ctx.src[j] !== "`") {
    const after = ctx.src[j + 1];
    const escaped = ctx.src[j] === "\\" && after !== undefined && "$`\\".includes(after);
    body += escaped ? after : ctx.src[j];
    j += escaped ? 2 : 1;
  }
  ctx.i = j + 1;
  const word = wordOf(frame);
  scan({ src: body, i: 0, out: ctx.out }, false);
  word.text += "$()";
  word.literal = false;
}

function readRedirection(ctx, frame) {
  // Digits touching the operator name the descriptor it redirects; they are not an argument.
  if (frame.word?.literal && /^\d+$/.test(frame.word.text)) frame.word = null;
  endWord(frame);
  const operator = REDIRECTION.exec(ctx.src.slice(ctx.i, ctx.i + 3))[0];
  ctx.i += operator.length;
  frame.expect = REDIRECTED[operator] ?? "file";
}

/** Finish the word in progress: an argument, unless a redirection operator claimed it. */
function endWord(frame) {
  const word = frame.word;
  if (word === null) return;
  frame.word = null;
  const expect = frame.expect;
  frame.expect = null;
  if (expect === null) frame.command.words.push(word);
  else if (expect === "herestring") frame.command.heredocs.push(word.text);
  else if (expect !== "file") {
    const tabs = expect === "heredoc-tabs";
    frame.pending.push({ delimiter: word.text, tabs, command: frame.command });
  }
}

function endCommand(ctx, frame) {
  endWord(frame);
  frame.expect = null;
  const { command } = frame;
  const readsHeredoc = frame.pending.some(entry => entry.command === command);
  if (command.words.length > 0 || command.heredocs.length > 0 || readsHeredoc) ctx.out.push(command);
  frame.command = newCommand();
}

/** After a newline, the bodies of the here-documents opened on the line it ended. */
function readHeredocBodies(ctx, frame) {
  for (const { delimiter, tabs, command } of frame.pending) {
    const lines = [];
    while (ctx.i < ctx.src.length) {
      const end = ctx.src.indexOf("\n", ctx.i);
      const stop = end === -1 ? ctx.src.length : end;
      const line = ctx.src.slice(ctx.i, stop);
      ctx.i = stop + 1;
      if ((tabs ? line.replace(/^\t+/, "") : line) === delimiter) break;
      lines.push(line);
    }
    command.heredocs.push(lines.join("\n"));
  }
  frame.pending = [];
}
