---

title: "Edits during a sync"
description: "Why editing a value while its push is in flight never loses the edit, and how overlapping syncs are ordered."
---

A sync is asynchronous, and nothing stops the rest of the program from calling
`update()` while it runs. Stage is built so that this is always safe.

## Changes are snapshotted when a sync starts

When `sync()` begins, it takes each dirty value's change as it stands at that
moment. Edits made after that point aren't part of this sync. When the push
succeeds, `base` moves to the snapshot that was sent, not to the current
value, so the later edits stay dirty for the next sync:

```ts
tom.update((draft) => {
	draft.name = "lord voldemort";
});

const syncing = stage.sync(); // sends { name }
tom.update((draft) => {
	draft.status = "not alive";
});
await syncing;

console.log(tom.change?.patch); // { status: "not alive" }
```

## With a `receive` handler

When the server returns its own version of the entity, Stage re-applies the
in-flight edits on top of it, field by field. Fields you changed locally keep
your value, and every other field takes the server's. The server's own fields,
such as a new `updatedAt`, become part of `base`, so they never leak into the
next patch.

## Overlapping syncs run in order

Syncs on one stage are queued: a second `sync()` (or a `handle.sync()`) waits
for the one in progress to finish, then starts from the baseline it left
behind. A value is never in two pushes at once, and calling `sync()` twice in
a row never sends the same change twice.

A failed sync doesn't block the queue. The next sync still runs, and it
retries whatever the failed one left dirty.

## Keys can't change

`update()` rejects an edit that changes a value's key, and the value is left
as it was. The key is how the stage, `get()` and bulk response matching
identify a value across syncs. To give something a new identity, track it as a
new value.
