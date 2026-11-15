// The integration lane: something real inside the process. This one proves the
// database the config names is up and speaks the postgres protocol, which every
// store test after it assumes. Replace it with a real store test once the
// service has a store.
import assert from "node:assert/strict";
import net from "node:net";
import { describe, it } from "node:test";
import { loadConfig } from "../../src/config.mjs";

const RUN = process.env.RUN_DB_TESTS === "1";

// The SSLRequest packet: length 8, code 80877103. A postgres server answers it
// with one byte, S or N, before any credentials are exchanged.
const SSL_REQUEST = Buffer.from([0, 0, 0, 8, 0x04, 0xd2, 0x16, 0x2f]);

function sslAnswer({ hostname, port }, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: hostname, port: Number(port || 5432) }, () => socket.write(SSL_REQUEST));
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error(`no answer from ${hostname}:${port || 5432} in ${timeoutMs}ms`)));
    socket.once("data", (data) => { socket.destroy(); resolve(data.toString("latin1", 0, 1)); });
    socket.once("error", reject);
  });
}

// The skip reason prints with the suite, so a lane that did not run says so.
describe("the database", { skip: !RUN && "RUN_DB_TESTS is not 1" }, () => {
  it("answers the postgres protocol at the configured url", { timeout: 10_000 }, async () => {
    // With no DATABASE_URL, the compose service, as .env.example names it.
    const url = new URL(loadConfig().databaseUrl ?? "postgres://localhost:5432");
    assert.ok(["S", "N"].includes(await sslAnswer(url, 5000)));
  });
});
