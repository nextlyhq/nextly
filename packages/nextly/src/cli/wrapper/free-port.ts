// What: finds a free loopback TCP port by asking the OS for one.
// Why: the wrapper must tell the child which port to bind the IPC server to
// BEFORE spawning next dev (the token + port pair ships as env vars). Asking
// the OS to assign an ephemeral port avoids guessing, retries, and collisions
// with services on common ports (postgres 5432, mysql 3306, etc.).

import { createServer } from "node:net";

export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const { port } = address;
        server.close(err => (err ? reject(err) : resolve(port)));
      } else {
        server.close(() => reject(new Error("Could not determine free port")));
      }
    });
  });
}
