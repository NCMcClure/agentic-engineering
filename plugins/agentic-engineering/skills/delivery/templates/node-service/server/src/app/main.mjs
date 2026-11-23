// The composition root: read the config, build the app, listen. Everything it
// wires is testable without it.
import http from "node:http";
import { loadConfig } from "../config.mjs";
import { createApp } from "../http/routes.mjs";

const config = loadConfig();
const handle = createApp(config);

const server = http.createServer((req, res) => {
  const { status, body } = handle(req.method, req.url);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
});

server.listen(config.port, () => console.log(`listening on ${config.port} (${config.appEnv})`));

// Stop taking requests and let the ones in flight finish; the process then
// ends by itself.
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => server.close());
