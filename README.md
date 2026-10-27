# @michaelrwalker/stage

Edit values locally in as many steps as you like, using Immer drafts, then
sync the net result in as few API calls as the API allows. Edits collapse per
value (two changes to `name` send one field; a change that is reverted sends
nothing), and values of the same kind go out together through a bulk endpoint
when there is one. It exists for code that changes things in stages against
rate-limited APIs.

```ts
import { Stage } from "@michaelrwalker/stage";

const stage = new Stage()
	.entity("wizard", {
		key: (wizard: Wizard) => wizard.id,
		push: (change) => api.patch(`/wizards/${change.key}`, change.patch),
		pushMany: { max: 50, run: (changes) => api.post("/wizards/bulk", changes) },
		concurrency: 1,
	})
	.entity("house", {
		key: (house: House) => house.slug,
		push: (change) => api.put(`/houses/${change.key}`, change.current),
	});

const tom = stage.track("wizard", {
	id: 1,
	name: "tom riddle",
	status: "alive",
});
tom.update((draft) => {
	draft.name = "lord voldemort";
});
tom.update((draft) => {
	draft.status = "not alive";
});

console.log(tom.value.name); // "lord voldemort"
console.log(stage.get("wizard", 1)?.value.name); // same handle, found by key

await stage.sync(); // one PATCH carrying { name, status }
```

Each `.entity()` call teaches the stage a name, a value type and a key type,
so tracking an unregistered entity, passing a house where a wizard belongs,
looking one up by the wrong kind of key, or assigning an invalid value inside
a draft all fail to compile.

## Install

```bash
npm install @michaelrwalker/stage
```

The only runtime dependency is [Immer](https://immerjs.github.io/immer/). The
package ships as TypeScript source, with no build step, and your own
toolchain compiles it.

## `new Stage().entity(name, config)`

Registers one kind of entity and how to sync it. The value type comes from the
parameter annotation on `key`, so annotate it (`(wizard: Wizard) => ...`).

| Option        | Type                                        | Default  | Notes                                                            |
| ------------- | ------------------------------------------- | -------- | ---------------------------------------------------------------- |
| `key`         | `(value: T) => string \| number`            | required | The value's identity. Keys can't change through `update()`.      |
| `push`        | `(change) => Promise` or `{ run, receive }` | —        | Sends one change. Use the object form to read the response.      |
| `pushMany`    | `{ max?, run(changes), receive? }`          | —        | Sends a batch. `max` caps the batch size; it defaults to no cap. |
| `concurrency` | `number`                                    | `1`      | How many calls for this entity may be in flight at once.         |

You must give at least one of `push` and `pushMany`. If you give both, a lone
change goes through `push` and two or more go through `pushMany`. With only
`pushMany`, a lone change is sent as a batch of one.

Each push function receives a `Change`:

| Field     | Notes                                                                                                                                                      |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `key`     | The value's key.                                                                                                                                           |
| `base`    | The value as of the last successful sync.                                                                                                                  |
| `current` | The value as it will be once this change is pushed. Send this to PUT-style endpoints.                                                                      |
| `patch`   | Only the top-level fields that changed, with their new values. Send this to PATCH-style endpoints. A field deleted in a draft appears here as `undefined`. |
| `fields`  | The names of the fields in `patch`.                                                                                                                        |

Diffing happens at the top level. A nested edit (`draft.wand.wood = "elder"`)
puts the whole new `wand` in the patch, because most PATCH endpoints replace
nested objects rather than merging them.

### Reading the server's response

By default, after a successful push the stage assumes the server now holds
exactly what was sent. When the API returns the updated entity (with a new
`updatedAt`, a server-generated slug, a trimmed string, and so on), add a
`receive` handler that pulls the entity out of the response. That entity then
becomes the new `base` and `value`. The response type is inferred from what
`run` returns, so `receive` is fully typed.

```ts
.entity("wizard", {
	key: (wizard: Wizard) => wizard.id,
	push: {
		run: (change) => api.patch(`/wizards/${change.key}`, change.patch), // Promise<{ data: Wizard }>
		receive: (response) => response.data,
	},
	pushMany: {
		run: (changes) => api.post("/wizards/bulk", changes), // Promise<{ results: Wizard[] }>
		receive: (response) => response.results,
	},
})
```

A bulk response is matched back to tracked values with the entity's `key`
function rather than by position. The results can arrive in any order, and
the response can be partial:

- A tracked value missing from the response keeps what was sent.
- An entity in the response whose key wasn't in that batch is ignored. The
  same goes for a single `receive` that returns an entity with a different key.
- Single `receive` can return `undefined` to keep what was sent.
- If `receive` throws, the whole call counts as failed, so its values stay
  dirty and are resent on the next sync.

If you edit a value while its push is in flight, the stage re-applies those
edits field by field over the server's version. The server's own fields, such
as a new timestamp, never leak into the next patch.

## `stage.track(name, value)`

Starts tracking a value and returns its handle. The stage keeps a deep,
frozen copy (via `structuredClone`), so it doesn't see later changes to the
object you passed in. Tracking a key that is already tracked throws an error.
Use `get` to reach the existing handle instead.

The handle (`Staged<T, K>`):

| Member       | Notes                                                                      |
| ------------ | -------------------------------------------------------------------------- |
| `value`      | The current value, including unsynced edits. Deeply frozen and `readonly`. |
| `base`       | The value as the server last saw it.                                       |
| `dirty`      | Whether `value` differs from `base`.                                       |
| `change`     | The pending `Change`, or `null`.                                           |
| `update(fn)` | Edits the value through an Immer draft. Chainable. Nothing is sent.        |
| `discard()`  | Throws away unsynced edits.                                                |
| `sync()`     | Syncs this value alone.                                                    |

## `stage.get(name, key)` and `stage.untrack(name, key)`

`get` returns the handle for a key, or `undefined` if that key isn't tracked.
Use it to read or edit a value from code that never received the handle.
`untrack` forgets a value along with any unsynced edits. In a long-running
process, untrack values you've finished with so they can be garbage-collected.

## `stage.changes(name?)`

Lists every pending change, or the pending changes for one entity. This is
exactly what the next `sync()` would send, which makes it useful for logging
and dry runs.

## `stage.sync(name?)`

Pushes every dirty value, or every dirty value of one entity. Different
entities sync in parallel. Within one entity, the `concurrency` option sets
how many calls run at once.

Syncs on one stage run one after another, so a value is never in two pushes at
once. If you edit a value while its push is in flight, that edit stays dirty
for the next sync and is not lost.

## `track(value, { push })`

A shortcut for a script that only ever edits one value. It creates a private
stage with one entity and returns the handle. The change's key is always
`"value"`.

```ts
const tom = track(wizard, {
	push: (change) => api.patch(`/wizards/${wizard.id}`, change.patch),
});
tom.update((draft) => {
	draft.name = "lord voldemort";
});
await tom.sync();
```

Once you edit more than one value, use a `Stage`. Bulk calls are only possible
when the values share a stage.

## Writing a sync adapter

The extension point is the pair of push functions. Here is an adapter for an
API whose bulk endpoint accepts at most 100 items and can only take one call
at a time:

```ts
const stage = new Stage().entity("product", {
	key: (product: Product) => product.sku,
	pushMany: {
		max: 100,
		run: async (changes) => {
			const response = await fetch("https://api.example.com/products/bulk", {
				method: "PATCH",
				body: JSON.stringify(
					changes.map(({ key, patch }) => ({ sku: key, ...patch })),
				),
			});
			if (!response.ok)
				throw new Error(`${response.status} ${response.statusText}`);
		},
	},
	concurrency: 1,
});
```

A push succeeds when its promise resolves. When it rejects, every value it
carried stays dirty. A bulk call succeeds or fails as a whole. If your API
reports per-item failures inside a successful response, throw an error so the
whole chunk is retried.

## Errors

`StageError` covers misuse. It is thrown for:

- registering an entity name twice
- an entity config with no `key`, or with neither `push` nor `pushMany`
- a `concurrency` or `pushMany.max` that isn't a positive integer
- naming an entity that was never registered
- a `key` function that returns something other than a string or a number
- tracking a key that is already tracked
- an `update()` that changes the value's key (the edit is rejected and the value is left unchanged)

`SyncError` extends `StageError` and is what a `sync()` rejects with when one
or more pushes fail. The stage still attempts every push before rejecting.
`failures` lists each failed call with its entity, its keys and its error, and
`cause` holds the first error. Values whose push failed stay dirty, so calling
`sync()` again retries exactly those.

## Development

```bash
npm test           # node:test, with TypeScript type stripping
npm run typecheck  # tsc --noEmit, which also runs the type-level tests
npm run format     # biome format
npm run fix        # biome lint --write
npm run release    # release-it: bump, tag, publish, GitHub release
```
