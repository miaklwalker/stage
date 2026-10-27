---

title: "Reading responses"
description: "Use receive to make the server's saved entity the new baseline, and how bulk responses are matched back to tracked values."
---

By default, after a successful push Stage assumes the server now holds exactly
what was sent. That's wrong whenever the server adds something of its own: a
new `updatedAt`, an incremented revision, a trimmed string, or another
client's edit to a field you didn't touch. A `receive` handler fixes this by
pulling the saved entity out of the response.

## Single pushes

Pass `push` as an object with `run` and `receive`:

```ts
.entity("wizard", {
	key: (wizard: Wizard) => wizard.id,
	push: {
		run: (change) => api.patch(`/wizards/${change.key}`, change.patch),
		receive: (response) => response.data,
	},
})
```

The entity that `receive` returns becomes both `base` and `value`. The
`response` parameter is typed from what `run` resolves to, and `receive` must
return the entity's own type, so returning the response wrapper by mistake is a
compile error.

Return `undefined` from `receive` to keep what was sent, for example when an
endpoint only sometimes includes the entity.

## Bulk pushes

`pushMany` takes an optional `receive` that returns every saved entity in the
response:

```ts
pushMany: {
	max: 50,
	run: (changes) => api.post("/wizards/bulk", changes),
	receive: (response) => response.results,
},
```

The returned entities are matched to tracked values with the entity's own `key`
function, not by position. That has a few consequences:

- **Order doesn't matter.** The response can list entities in any order.
- **Partial responses are fine.** A tracked value missing from the response
  keeps what was sent.
- **Strangers are ignored.** An entity whose key wasn't in this batch is
  dropped. So is an entity returned by a single `receive` whose key doesn't
  match the change.

`receive` also gets the batch's changes as its second argument. Use it when an
API returns results in request order without the full entity:

```ts
receive: (response, changes) =>
	changes.map((change, index) => ({
		...change.current,
		revision: response.revisions[index],
	})),
```

## When `receive` throws

If `receive` throws, the whole call counts as failed. Its values stay dirty and
are sent again on the next sync. Stage treats it this way because it can't
know what the server saved. Resending is usually harmless for PATCH and PUT,
and a lost update is not.

## A worked example

`examples/round-trip.ts` in the repository runs the full case: a GET returns
revision 1, another client changes a field on the server, then the sync's PATCH
response returns revision 3 containing both clients' edits. After the sync,
the local value matches the server exactly and isn't dirty.
