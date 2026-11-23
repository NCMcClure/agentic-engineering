// The HTTP surface, as a plain request handler so a test can call it directly
// without binding a port. `createApp` takes its config rather than reading the
// environment, which is what makes the unit lane possible.
export function createApp(config) {
  const routes = new Map([
    ["GET /health", () => ({ status: 200, body: { ok: true, env: config.appEnv } })],
    ["GET /version", () => ({ status: 200, body: { version: process.env.npm_package_version ?? "0.0.0" } })],
  ]);

  return function handle(method, url) {
    const route = routes.get(`${method} ${new URL(url, "http://localhost").pathname}`);
    if (!route) return { status: 404, body: { error: "not found" } };
    return route();
  };
}
