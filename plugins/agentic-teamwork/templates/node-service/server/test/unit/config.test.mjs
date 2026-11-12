// The unit lane: pure logic, no I/O, milliseconds. Most tests live here.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig } from "../../src/config.mjs";
import { createApp } from "../../src/http/routes.mjs";

describe("loadConfig", () => {
  it("defaults the port to 8080", () => {
    assert.equal(loadConfig({}).port, 8080);
  });

  it("rejects a port that is not a port", () => {
    assert.throws(() => loadConfig({ PORT: "http" }), /PORT must be a port number/);
  });
});

describe("routes", () => {
  const handle = createApp(loadConfig({ APP_ENV: "preview" }));

  it("answers /health with the environment it is running in", () => {
    assert.deepEqual(handle("GET", "/health"), { status: 200, body: { ok: true, env: "preview" } });
  });

  it("404s an unknown path", () => {
    assert.equal(handle("GET", "/nope").status, 404);
  });
});
