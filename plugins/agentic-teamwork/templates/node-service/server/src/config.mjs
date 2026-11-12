// Every environment variable this service reads, in one place, with its
// default. Nothing else calls process.env: a value that arrives through here
// can be overridden in a test without touching the environment.
export function loadConfig(env = process.env) {
  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`PORT must be a port number, got ${JSON.stringify(env.PORT)}`);
  }
  return {
    port,
    appEnv: env.APP_ENV ?? "development",
    databaseUrl: env.DATABASE_URL ?? null,
  };
}
