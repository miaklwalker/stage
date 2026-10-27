---

title: "Quick Start"
description: "Fetch an entity, edit it in steps, read it back from anywhere, and sync it with one call."
---

This walks through the whole lifecycle: register an entity, track a value from
a GET, edit it in several places, read the current state, and sync.

## Register the entity

```ts
import { Stage } from "@michaelrwalker/stage";

interface Wizard {
	id: number;
	name: string;
	status: "alive" | "not alive";
	updatedAt: string;
}

export const stage = new Stage().entity("wizard", {
	// The parameter annotation is where the stage learns what a wizard is.
	key: (wizard: Wizard) => wizard.id,
	push: {
		run: (change) => api.patch(`/wizards/${change.key}`, change.patch),
		// The PATCH response holds the saved wizard, with a new updatedAt.
		receive: (response) => response.data,
	},
});
```

Register every entity once, in one place, and import the stage wherever you
need it. If the endpoint doesn't return the saved entity, pass a plain function
as `push` instead. See [Sync adapters](guides/sync-adapters).

## Track and edit

```ts
const { data } = await api.get("/wizards/1");
const tom = stage.track("wizard", data);

tom.update((draft) => {
	draft.name = "lord voldemort";
});
```

`update()` hands you an Immer draft. Write to it as if it were a mutable
object; Stage records the result. Nothing is sent yet.

## Read the current value

The handle's `value` always includes unsynced edits. `base` is what the server
last saw:

```ts
console.log(tom.value.name); // "lord voldemort"
console.log(tom.base.name); // "tom riddle"
console.log(tom.dirty); // true
```

Code that never received the handle can look it up by key:

```ts
stage.get("wizard", 1)?.update((draft) => {
	draft.status = "not alive";
});
```

`value` is deeply frozen and typed `readonly`, so `tom.value.name = "x"` fails
to compile and throws at runtime. All edits go through `update()`.

## Sync

```ts
console.log(stage.changes()); // what the next sync would send
await stage.sync();
```

The two edits go out as one PATCH carrying `{ name, status }`. When it
resolves, `receive` makes the server's version the new `base` and `value`, so
`tom.value.updatedAt` is the server's timestamp and `tom.dirty` is `false`.

To sync one value on its own, call `tom.sync()`. To sync one kind of entity,
call `stage.sync("wizard")`.

## A single value

For a script that only ever edits one thing, `track()` skips the setup:

```ts
import { track } from "@michaelrwalker/stage";

const tom = track(wizard, {
	push: (change) => api.patch(`/wizards/${wizard.id}`, change.patch),
});
tom.update((draft) => {
	draft.name = "lord voldemort";
});
await tom.sync();
```

Move to a `Stage` as soon as there's more than one value: bulk calls are only
possible between values that share a stage.
