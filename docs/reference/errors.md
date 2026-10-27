---

title: "Errors"
description: "StageError and SyncError: every way Stage throws, and when."
---

Stage exports two error classes. `SyncError` extends `StageError`, so
`instanceof StageError` catches everything the package throws.

## `StageError`

Thrown synchronously, at the call that made the mistake.

| When                                                     | Thrown by                                         |
| -------------------------------------------------------- | ------------------------------------------------- |
| An entity name is registered twice                       | `.entity()`                                       |
| The config has no `key` function                         | `.entity()`                                       |
| The config has neither `push` nor `pushMany`             | `.entity()`                                       |
| `push` is an object without both `run` and `receive`     | `.entity()`                                       |
| `concurrency` or `pushMany.max` isn't a positive integer | `.entity()`                                       |
| The entity name was never registered                     | `.track()`, `.get()`, `.untrack()`, `.sync(name)` |
| `key` returns something other than a string or number    | `.track()`                                        |
| The key is already tracked                               | `.track()`                                        |
| An edit changes the value's key                          | `handle.update()`                                 |

Messages name the entity and the offending value, and say what to do instead.
For example:

```text
wizard 1 is already tracked. Use stage.get("wizard", 1) to reach it.
```

A rejected `update()` leaves the value as it was before the call.

## `SyncError`

The rejection from `stage.sync()` or `handle.sync()` when one or more calls
failed. It is raised only after every call in the sync has been attempted.

| Field      | Notes                                             |
| ---------- | ------------------------------------------------- |
| `failures` | `{ entity, keys, error }[]`, one per failed call. |
| `cause`    | The first failure's error.                        |

A call fails when `run` (or a plain `push` function) rejects, or when its
`receive` handler throws. Values in a failed call stay dirty, so calling
`sync()` again retries exactly those. See
[Failures and retries](../guides/failures-and-retries).
