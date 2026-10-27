// The language-server client's framing and its failures, against servers
// written here: each is a Node script that speaks the same framing, so every
// way a real server can misbehave is one this suite can make happen on demand.
// Whether the compiler's own server answers the questions asked of it is
// asked where those questions are.
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { frame, frameReader, startLanguageServer } from "./language-server.mjs";

const CLIENT = pathToFileURL(
  new URL("./language-server.mjs", import.meta.url).pathname
).href;

/**
 * As the compiler's server answers `shutdown`: it takes no params, not even
 * null.
 */
const SHUTS_DOWN = `reply("params" in message
  ? { jsonrpc: "2.0", id: message.id, error: { code: -32602, message: "expected no params" } }
  : { jsonrpc: "2.0", id: message.id, result: null });`;

/**
 * A server running `body` for each request it reads, and `shutdown` for a
 * shutdown, with `reply(message)` and `write(text)` in scope.
 */
function fakeServer(body, shutdown = SHUTS_DOWN) {
  const source = `
    import { frame, frameReader } from ${JSON.stringify(CLIENT)};
    const reader = frameReader();
    const reply = message => process.stdout.write(frame(message));
    const write = text => process.stdout.write(text);
    process.stdin.on("data", chunk => {
      for (const message of reader.read(chunk)) {
        if (message.method === "shutdown") { ${shutdown} }
        else if (message.method === "exit") process.exit(0);
        else { ${body} }
      }
    });
  `;
  return [process.execPath, "--input-type=module", "-e", source];
}

/** The bytes of `messages`, framed and joined. */
const framed = (...messages) =>
  Buffer.from(messages.map(message => frame(message)).join(""));

describe("frameReader", () => {
  it("completes a frame split across chunks, its header included, only at its end", () => {
    const bytes = framed({ id: 1, result: "done" });
    const reader = frameReader();
    // Cut inside `Content-Length`, inside the blank line, and inside the body.
    const cuts = [4, 19, 23, bytes.length];
    const seen = cuts.map((cut, index) =>
      reader.read(bytes.subarray(index === 0 ? 0 : cuts[index - 1], cut))
    );
    expect(seen).toEqual([[], [], [], [{ id: 1, result: "done" }]]);
    expect(reader.rest()).toBe(0);
  });

  it("reads two messages from one chunk, in order", () => {
    const reader = frameReader();
    expect(reader.read(framed({ id: 1 }, { id: 2 }))).toEqual([
      { id: 1 },
      { id: 2 },
    ]);
  });

  it("counts the body in bytes, so a chunk may end inside a character", () => {
    // Two frames, so a body measured in characters runs into the next one,
    // and a cut inside `✓`, so text decoded per chunk corrupts it.
    const first = { id: 1, result: "déprécié ✓" };
    const second = { id: 2, result: "ü" };
    const bytes = framed(first, second);
    const cut = bytes.indexOf(Buffer.from("✓")) + 1;
    const reader = frameReader();
    expect(reader.read(bytes.subarray(0, cut))).toEqual([]);
    expect(reader.read(bytes.subarray(cut))).toEqual([first, second]);
  });

  it("refuses a frame whose header declares no length", () => {
    const reader = frameReader();
    expect(() =>
      reader.read(Buffer.from('Content-Type: x\r\n\r\n{"id":1}'))
    ).toThrow(/no Content-Length/);
  });
});

describe("startLanguageServer", () => {
  it("resolves a reply, and answers a request the server sends first", async () => {
    // The server asks for configuration and replies with what it was told.
    const server = startLanguageServer({
      command: fakeServer(`
        if (message.id === "asked") {
          reply({ jsonrpc: "2.0", id: 1, result: message.result });
        } else {
          reply({ jsonrpc: "2.0", id: "asked", method: "workspace/configuration", params: { items: [{}, {}] } });
        }
      `),
    });
    await expect(server.request("textDocument/hover", {})).resolves.toEqual([
      null,
      null,
    ]);
    await server.close();
  });

  it("rejects an error reply, naming the request", async () => {
    const server = startLanguageServer({
      command: fakeServer(
        `reply({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: "boom" } });`
      ),
    });
    await expect(server.request("textDocument/hover", {})).rejects.toThrow(
      /textDocument\/hover failed: boom/
    );
    await server.close();
  });

  it("rejects when the server exits mid-reply, and every request after it", async () => {
    // Half a frame, then gone: a reader that waited for the rest would hang,
    // and one that took the exit as the end of the answers would read none.
    const server = startLanguageServer({
      command: fakeServer(
        `write("Content-Length: 40\\r\\n\\r\\n{\\"id\\":1"); process.exit(0);`
      ),
    });
    await expect(server.request("textDocument/hover", {})).rejects.toThrow(
      /exited \(0\) with 1 request\(s\) unanswered and \d+ byte\(s\) of a reply unread/
    );
    await expect(server.request("textDocument/hover", {})).rejects.toThrow(
      /exited/
    );
    await server.close();
  });

  it("closes a server that dies while shutting down, every answer already in", async () => {
    // Dies on `shutdown` instead of answering it, as the compiler's server can.
    const server = startLanguageServer({
      command: fakeServer(
        `reply({ jsonrpc: "2.0", id: message.id, result: "ok" });`,
        "process.exit(2);"
      ),
    });
    await expect(server.request("textDocument/hover", {})).resolves.toBe("ok");
    await expect(server.close()).resolves.toBeUndefined();
  });

  it("refuses to close with a request still waiting, which rejects too", async () => {
    const server = startLanguageServer({ command: fakeServer("") });
    const waiting = server.request("textDocument/hover", {});
    await expect(server.close()).rejects.toThrow(
      /closed with 1 request\(s\) unanswered/
    );
    await expect(waiting).rejects.toThrow(/closed with 1 request/);
  });

  it("rejects a request with no reply once its time is up", async () => {
    const server = startLanguageServer({
      command: fakeServer(""),
      timeoutMs: 300,
    });
    await expect(server.request("textDocument/hover", {})).rejects.toThrow(
      /no reply to textDocument\/hover in 300 ms/
    );
    await server.close();
  });

  it("rejects when the server writes a frame it cannot read", async () => {
    const server = startLanguageServer({
      command: fakeServer(`write("Content-Type: x\\r\\n\\r\\n{}");`),
    });
    await expect(server.request("textDocument/hover", {})).rejects.toThrow(
      /no Content-Length/
    );
    await server.close();
  });
});
