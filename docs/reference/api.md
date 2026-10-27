---

title: "Stage API"
description: "Every export of @michaelrwalker/stage: the Stage builder, the Staged handle, track, Change and the equality helpers."
---

## `Stage`

```ts
class Stage<TEntities extends EntityMap = Record<never, never>>
```

### `.entity(name, config)`

Registers a kind of entity. Returns the stage, widened with the new entity.

| Option        | Type                                                 | Default  | Notes                                            |
| ------------- | ---------------------------------------------------- | -------- | ------------------------------------------------ |
| `key`         | `(value: T) => string \| number`                     | required | The value's identity. Annotate the parameter.    |
| `push`        | `(change) => Promise<unknown>` or `{ run, receive }` | —        | Sends one change.                                |
| `pushMany`    | `{ max?, run, receive? }`                            | —        | Sends a batch of changes.                        |
| `concurrency` | `number`                                             | `1`      | Calls for this entity allowed in flight at once. |

At least one of `push` and `pushMany` is required. See
[Sync adapters](../guides/sync-adapters) and
[Reading responses](../guides/reading-responses).

### `.track(name, value)`

Starts tracking a value and returns its `Staged` handle. The stage stores a
deep, frozen copy made with `structuredClone`, so later changes to the object
you passed in aren't seen, and class instances lose their prototype. Throws if
the key is already tracked.

### `.get(name, key)`

The handle for a key, or `undefined`.

### `.untrack(name, key)`

Forgets a value along with any unsynced edits. Returns whether it was tracked.
In a long-running process, untrack values you're done with so they can be
garbage-collected.

### `.changes(name?)`

Every pending `Change`, or those for one entity: exactly what the next sync
would send.

### `.sync(name?)`

Pushes every dirty value, or every dirty value of one entity. Resolves when
every call has succeeded. Rejects with a `SyncError` after every call has been
attempted, if any failed.

### `.entities`

The registered entity names, in registration order.

## `Staged<T, K>`

The handle returned by `track()` and `get()`.

| Member       | Notes                                                                      |
| ------------ | -------------------------------------------------------------------------- |
| `entity`     | The registered entity name.                                                |
| `key`        | The value's key.                                                           |
| `value`      | The current value, including unsynced edits. Deeply frozen and `readonly`. |
| `base`       | The value as the server last saw it.                                       |
| `dirty`      | Whether `value` differs from `base`.                                       |
| `change`     | The pending `Change`, or `null`.                                           |
| `update(fn)` | Edits the value through an Immer draft. Returns the handle. Sends nothing. |
| `discard()`  | Restores `base`, dropping unsynced edits. Returns the handle.              |
| `sync()`     | Syncs this value alone, through the stage's queue.                         |

## `track(value, { push })`

```ts
function track<T extends object>(
	value: T,
	config: { push: (change: Change<T, "value">) => Promise<unknown> },
): Staged<T, "value">;
```

Creates a private stage holding one value. The change's key is always
`"value"`.

## `Change<T, K>`

| Field     | Type                    | Notes                           |
| --------- | ----------------------- | ------------------------------- |
| `key`     | `K`                     |                                 |
| `base`    | `Immutable<T>`          | As of the last successful sync. |
| `current` | `Immutable<T>`          | As it will be once pushed.      |
| `patch`   | `Immutable<Partial<T>>` | Changed top-level fields only.  |
| `fields`  | `(keyof T & string)[]`  | The keys of `patch`.            |

## Helpers

`isEqual(a, b)` is the structural equality Stage uses: primitives with
`Object.is`, and plain objects, arrays, `Date`, `Map` and `Set` by content.
Anything else is compared by reference.

`changedFields(base, current)` lists the top-level fields that differ,
including fields removed from `current`.

## Types

`Key`, `EntityShape`, `EntityMap`, `EntityConfig`, `Push`, `PushOne`,
`PushOneWithReceive`, `PushMany`, `Recipe`, `ValueOf`, `KeyOf`, `SyncFailure`
and `Prettify` are exported for code that wraps or extends a stage.
