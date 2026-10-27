---

title: "Sync adapters"
description: "How push, pushMany and concurrency decide which calls a sync makes, and what each call receives."
---

An entity's config is its sync adapter: it says how to send one change, how to
send many, and how many calls may run at once. Stage decides which to use.

## The `Change` object

Every push function receives one or more `Change` objects. Each describes the
net difference for one value since its last successful sync:

| Field     | Notes                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------- |
| `key`     | The value's key.                                                                                  |
| `base`    | The value as the server last saw it.                                                              |
| `current` | The value as it will be once this change lands. Send this to PUT-style endpoints.                 |
| `patch`   | Only the top-level fields that differ, with their new values. Send this to PATCH-style endpoints. |
| `fields`  | The names of the fields in `patch`. Never empty.                                                  |

A field deleted inside a draft appears in `patch` as `undefined` and is listed
in `fields`.

### Top-level diffing

Diffing stops at the top level. A nested edit such as
`draft.wand.wood = "elder"` puts the whole new `wand` object into the patch.
Most PATCH endpoints replace nested objects rather than merging them, so
sending half a `wand` would erase the other half.

Equality is structural: plain objects, arrays, `Date`, `Map` and `Set` are
compared by content. That's what makes a reverted edit drop out of the patch,
even though Immer gave the reverted field a new reference.

## `push`, `pushMany`, or both

An entity needs at least one of them.

| Config          | One dirty value                | Several dirty values           |
| --------------- | ------------------------------ | ------------------------------ |
| `push` only     | `push`                         | `push` once per value          |
| `pushMany` only | `pushMany` with a batch of one | `pushMany`, in chunks of `max` |
| both            | `push`                         | `pushMany`, in chunks of `max` |

With both, a lone change goes through `push`. A single-resource endpoint is
often cheaper against a rate limit than a bulk call carrying one item, and its
error responses are usually easier to read.

```ts
new Stage().entity("product", {
	key: (product: Product) => product.sku,
	push: (change) => api.patch(`/products/${change.key}`, change.patch),
	pushMany: {
		max: 100,
		run: (changes) =>
			api.patch(
				"/products/bulk",
				changes.map(({ key, patch }) => ({ sku: key, ...patch })),
			),
	},
});
```

`max` defaults to no limit: every dirty value of that entity goes in one call.

## Concurrency

`concurrency` caps how many calls for one entity are in flight at once. It
defaults to `1`, because rate limits are usually the reason for staging
changes. Different entities sync in parallel with each other, each under its
own limit.

```ts
.entity("house", {
	key: (house: House) => house.slug,
	push: (change) => api.put(`/houses/${change.key}`, change.current),
	concurrency: 4,
})
```

## What counts as success

A push succeeds when its promise resolves. Whatever it resolves to is ignored
unless the entity has a `receive` handler; see
[Reading responses](reading-responses). A rejected push leaves its values
dirty; see [Failures and retries](failures-and-retries).

A bulk call succeeds or fails as a whole. If your API reports failures for
individual items inside a successful response, throw from `run` so the chunk
is retried.
