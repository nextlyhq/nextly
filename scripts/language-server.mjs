// A client for the compiler's language server, `tsc --lsp --stdio`, for the
// checks that ask the compiler something its command line does not answer:
// whether a property a sample writes is deprecated, for one. TypeScript 7 has
// no programmatic API before 7.1, and the language server is the interface it
// keeps for editors. It speaks JSON-RPC over stdio, each message framed by a
// `Content-Length` header, as the Language Server Protocol specifies.
//
// It fails closed. A reply that never comes, a server that exits with a
// request unanswered and a frame it cannot read each reject, so a check built
// on it never reads the silence of a broken server as a clean answer.
import { spawn } from "node:child_process";

import { tscEntry } from "./tsc-cli.mjs";

const HEADER_END = "\r\n\r\n";

/**
 * A reader of framed messages from a byte stream. `read(chunk)` returns the
 * messages that chunk completes, in order: a frame can arrive across several
 * chunks, and one chunk can carry several frames. `rest()` counts the bytes of
 * a frame not yet complete.
 *
 * Bytes, not characters: `Content-Length` counts the body's UTF-8 bytes, and a
 * chunk can end inside a character.
 */
export function frameReader() {
  let buffer = Buffer.alloc(0);
  const next = () => {
    const end = buffer.indexOf(HEADER_END);
    if (end < 0) return undefined;
    const start = end + HEADER_END.length;
    const length = contentLength(buffer.subarray(0, end).toString("ascii"));
    if (buffer.length < start + length) return undefined;
    const body = buffer.subarray(start, start + length).toString("utf8");
    buffer = buffer.subarray(start + length);
    return JSON.parse(body);
  };
  return {
    read(chunk) {
      buffer = Buffer.concat([buffer, chunk]);
      const messages = [];
      for (let message = next(); message !== undefined; message = next()) {
        messages.push(message);
      }
      return messages;
    },
    rest: () => buffer.length,
  };
}

/** The body length a frame's header declares. A header without one is refused. */
function contentLength(header) {
  const declared = /^Content-Length: *(\d+)$/im.exec(header)?.[1];
  if (declared === undefined) {
    throw new Error(
      `language server: a frame with no Content-Length: ${JSON.stringify(header)}`
    );
  }
  return Number(declared);
}

/** A message framed for the server. */
export function frame(message) {
  const body = JSON.stringify(message);
  return `Content-Length: ${String(Buffer.byteLength(body))}${HEADER_END}${body}`;
}

/** The compiler's own language server, run by this Node. */
function compilerServer() {
  return [process.execPath, tscEntry(), "--lsp", "--stdio"];
}

/**
 * Starts a language server and returns `{ request, notify, close }`.
 *
 * - `request(method, params)` resolves with the reply's result, and rejects on
 *   an error reply, after `timeoutMs` with no reply, or when the server stops.
 * - Once anything has failed, every request pending and every later one
 *   rejects with that failure, and the server is stopped.
 * - A request the SERVER sends, for configuration or a registration, is
 *   answered with nothing, as a client with no settings answers it.
 * - `close()` asks the server to shut down and exit.
 *
 * `command` is the server's argv, the compiler's own by default.
 */
export function startLanguageServer({
  cwd,
  command = compilerServer(),
  timeoutMs = 60_000,
} = {}) {
  const server = spawn(command[0], command.slice(1), {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const state = { server, pending: new Map(), failure: undefined, stderr: "" };
  const reader = frameReader();
  server.stderr.on("data", chunk => {
    state.stderr += chunk;
  });
  server.stdout.on("data", chunk => readChunk(state, reader, chunk));
  server.on("error", error => fail(state, error));
  server.on("exit", (code, signal) => exited(state, reader, code ?? signal));
  // A write to a server that has gone reports here; the exit says why.
  server.stdin.on("error", () => {});
  let nextId = 1;
  return {
    request: (method, params) =>
      request(state, nextId++, method, params, timeoutMs),
    notify: (method, params) => send(state, { jsonrpc: "2.0", method, params }),
    close: () => close(state, timeoutMs),
  };
}

/** Every message a chunk completes, each handled; an unreadable frame fails. */
function readChunk(state, reader, chunk) {
  try {
    for (const message of reader.read(chunk)) receive(state, message);
  } catch (error) {
    fail(state, error);
  }
}

/** A reply settles its request; a request from the server is answered. */
function receive(state, message) {
  if (message.method !== undefined && message.id !== undefined) {
    send(state, {
      jsonrpc: "2.0",
      id: message.id,
      result: nothingFor(message),
    });
    return;
  }
  const waiting = state.pending.get(message.id);
  if (waiting === undefined) return;
  state.pending.delete(message.id);
  waiting.settle(message);
}

/** No settings: one empty value per item a configuration request asks for. */
function nothingFor(message) {
  return Array.isArray(message.params?.items)
    ? message.params.items.map(() => null)
    : null;
}

/** Writes a message, unless the server has already failed. */
function send(state, message) {
  if (state.failure === undefined) state.server.stdin.write(frame(message));
}

/** Sends a request and waits for its reply, or for the first failure. */
function request(state, id, method, params, timeoutMs) {
  if (state.failure !== undefined) return Promise.reject(state.failure);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        fail(
          state,
          new Error(
            `language server: no reply to ${method} in ${String(timeoutMs)} ms`
          )
        ),
      timeoutMs
    );
    const settle = reply => {
      clearTimeout(timer);
      if (reply.error) reject(replyError(method, reply.error));
      else resolve(reply.result);
    };
    const abort = error => {
      clearTimeout(timer);
      reject(error);
    };
    state.pending.set(id, { settle, abort });
    send(state, { jsonrpc: "2.0", id, method, params });
  });
}

/** An error reply, as an error naming the request. */
function replyError(method, error) {
  return new Error(`language server: ${method} failed: ${error.message}`);
}

/** The first failure stops the server and rejects everything still waiting. */
function fail(state, error) {
  state.failure ??= error;
  for (const waiting of state.pending.values()) waiting.abort(state.failure);
  state.pending.clear();
  state.server.kill();
}

/**
 * A server that has exited answers nothing more, so every later request fails
 * at once. One that exits with a request unanswered, or part of a frame
 * unread, stopped mid-reply, which is a failure however it exited.
 */
function exited(state, reader, status) {
  const unanswered = `${String(state.pending.size)} request(s) unanswered`;
  const unread = `${String(reader.rest())} byte(s) of a reply unread`;
  const stderr = state.stderr ? `: ${state.stderr.trim()}` : "";
  fail(
    state,
    new Error(
      `language server exited (${String(status)}) with ${unanswered} and ${unread}${stderr}`
    )
  );
}

/**
 * Shuts the server down, waiting for it to exit, and stops it if it does not.
 *
 * Only once every request has its whole answer: closing with one still
 * waiting is refused, and that request rejects, since its answer would go with
 * the server. A server that has already failed is only stopped. The failure
 * was reported where it happened, and a `close` in a `finally` must not
 * replace it.
 *
 * Past that point, a failed shutdown is no failure, because nothing is left to
 * answer. typescript-go 7.0.2's server can panic while handling `shutdown`
 * ("assignment to entry in nil map" in `lspwatcher.WatchFiles`) after it has
 * answered everything else. An exit before the last answer still rejects that
 * request, however it happens.
 */
async function close(state, timeoutMs) {
  if (state.failure !== undefined) {
    state.server.kill();
    return;
  }
  if (state.pending.size > 0) {
    const error = new Error(
      `language server: closed with ${String(state.pending.size)} request(s) unanswered`
    );
    fail(state, error);
    throw error;
  }
  const gone = new Promise(resolve => state.server.once("exit", resolve));
  // No `params` at all: the compiler's server refuses `shutdown` with any,
  // `null` included, as the protocol's "params: void" allows it to.
  await request(state, 0, "shutdown", undefined, timeoutMs).catch(() => {});
  send(state, { jsonrpc: "2.0", method: "exit" });
  const timer = setTimeout(() => state.server.kill(), timeoutMs);
  await gone;
  clearTimeout(timer);
}
