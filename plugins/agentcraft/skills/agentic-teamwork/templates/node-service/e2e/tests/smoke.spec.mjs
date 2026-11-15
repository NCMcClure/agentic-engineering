import { expect, test } from "@playwright/test";

test("the service answers its health check", async ({ request }) => {
  const response = await request.get("/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true });
});
