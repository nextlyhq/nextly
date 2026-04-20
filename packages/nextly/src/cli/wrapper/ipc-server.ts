// What: starts a small HTTP server in the Next child process to serve
// /__nextly/* IPC endpoints on a port separate from Next's dev server port.
// Why: routing IPC through Next's normal pipeline would require every
// consuming app to add a catch-all route or middleware for /__nextly/*.
// Using a dedicated loopback port keeps the IPC off the app's route surface
// entirely: the user's Next config stays clean and the wrapper does not
// compete with app handlers.

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import {
  createIpcDispatcher,
  type IpcDispatcher,
} from "../../dispatcher/handlers/ipc-dispatcher.js";
import type {
  AppliedChangePayload,
  PendingChangePayload,
} from "../../domains/schema/types/ipc-types.js";

export interface IpcServerOptions {
  port: number;
  token: string;
  onPending?: (payload: PendingChangePayload) => void;
  onApplied?: (payload: AppliedChangePayload) => void;
}

export interface IpcServerHandle {
  dispatcher: IpcDispatcher;
  close: () => Promise<void>;
  port: number;
}

// Converts a Node http IncomingMessage into a fetch Request so the
// dispatcher (which operates on the platform-agnostic Request/Response
// interfaces) can handle it without a separate code path.
async function nodeRequestToFetchRequest(
  req: IncomingMessage,
  host: string
): Promise<Request> {
  const url = `http://${host}${req.url ?? "/"}`;
  const method = req.method ?? "GET";

  // Preserve headers for the dispatcher's auth check.
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(", "));
  }

  const hasBody = method !== "GET" && method !== "HEAD";
  const body = hasBody
    ? await new Promise<string>((resolve, reject) => {
        let data = "";
        req.on("data", chunk => {
          data += String(chunk);
        });
        req.on("end", () => resolve(data));
        req.on("error", reject);
      })
    : undefined;

  return new Request(url, { method, headers, body });
}

// Streams a fetch Response back to a Node ServerResponse.
async function fetchResponseToNodeResponse(
  fetchRes: Response,
  res: ServerResponse
): Promise<void> {
  res.statusCode = fetchRes.status;
  fetchRes.headers.forEach((value, name) => {
    res.setHeader(name, value);
  });
  const body = await fetchRes.text();
  res.end(body);
}

export function startIpcServer(
  opts: IpcServerOptions
): Promise<IpcServerHandle> {
  const dispatcher = createIpcDispatcher({
    token: opts.token,
    onPending: opts.onPending ?? (() => {}),
    onApplied: opts.onApplied ?? (() => {}),
  });

  const server: Server = createServer((req, res) => {
    void (async () => {
      try {
        const host = req.headers.host ?? `127.0.0.1:${opts.port}`;
        const fetchReq = await nodeRequestToFetchRequest(req, host);
        const fetchRes = await dispatcher.handle(fetchReq);
        if (!fetchRes) {
          res.statusCode = 404;
          res.end("not found");
          return;
        }
        await fetchResponseToNodeResponse(fetchRes, res);
      } catch (err) {
        res.statusCode = 500;
        res.end(err instanceof Error ? err.message : String(err));
      }
    })();
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    // Bind explicitly to 127.0.0.1. Never expose IPC to the network: the
    // token check is a second line of defence but loopback-only binding
    // keeps the first line airtight.
    server.listen(opts.port, "127.0.0.1", () => {
      // Read back the actual port. When opts.port is 0 the OS assigned a
      // free port and opts.port alone would be 0, not the real port.
      const address = server.address();
      const actualPort =
        address && typeof address === "object" ? address.port : opts.port;
      resolve({
        dispatcher,
        port: actualPort,
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            server.close(err => (err ? rejectClose(err) : resolveClose()));
          }),
      });
    });
  });
}
