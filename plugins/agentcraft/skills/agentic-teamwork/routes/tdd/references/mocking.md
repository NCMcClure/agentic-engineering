# What to mock

Mock at system boundaries only:

- external APIs (payment, email, a model provider),
- databases, sometimes, and prefer a real test database,
- time and randomness,
- the filesystem, sometimes.

Do not mock your own modules, internal collaborators, or anything you control. A test that asserts an internal function was called breaks on every refactor and proves nothing about behavior.

## Designing for mockability

**Inject the dependency.** Pass the external thing in rather than constructing it inside:

```ts
// easy to mock
function processPayment(order, paymentClient) {
  return paymentClient.charge(order.total);
}

// hard to mock
function processPayment(order) {
  return new StripeClient(process.env.STRIPE_KEY).charge(order.total);
}
```

The same rule covers paths, URLs, and clocks: a function that derives them from its inputs runs against a temp directory in a test; one that reads a global does not.

**Prefer an SDK-shaped interface over a generic fetcher.** One function per external operation, each independently stubbable:

```ts
// good: each mock returns one shape
const api = {
  getUser: (id) => fetch(`/users/${id}`),
  getOrders: (userId) => fetch(`/users/${userId}/orders`),
  createOrder: (data) => fetch("/orders", { method: "POST", body: data }),
};

// bad: the mock needs conditional logic to answer
const api = { fetch: (endpoint, options) => fetch(endpoint, options) };
```

The generic form pushes a switch statement into every test's setup, and the test then documents the mock instead of the behavior. With one function per operation, each mock returns one shape, a test shows which endpoints it exercises by which functions it stubs, and each operation can carry its own types.

## Verify through the interface

```ts
// bad: bypasses the interface to check
await createUser({ name: "Alice" });
const row = await db.query("SELECT * FROM users WHERE name = ?", ["Alice"]);

// good: checks what a caller can see
const user = await createUser({ name: "Alice" });
expect((await getUser(user.id)).name).toBe("Alice");
```

A test that reaches around the interface passes after a refactor that broke every caller.
