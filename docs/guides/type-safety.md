---

title: "Type safety"
description: "What the Stage builder learns from each .entity() call, and the mistakes that become compile errors as a result."
---

Each `.entity()` call widens the stage's type with one more entry: the
entity's name, its value type and its key type. Every later call is checked
against what the stage has learned.

```ts
const stage = new Stage()
	.entity("wizard", { key: (wizard: Wizard) => wizard.id, push })
	.entity("house", { key: (house: House) => house.slug, push });
// Stage<{ wizard: { value: Wizard; key: number }; house: { value: House; key: string } }>
```

## Where the types come from

The value type is inferred from the parameter annotation on `key`, and the key
type from what `key` returns. That annotation is the only one you write. The
`change` parameters of `push` and `pushMany`, and the `response` parameter of
`receive`, are all inferred from it.

## What fails to compile

| Mistake                                                              | Why it fails                                 |
| -------------------------------------------------------------------- | -------------------------------------------- |
| `stage.track("wizrd", tom)`                                          | `"wizrd"` isn't a registered name.           |
| `stage.track("wizard", gryffindor)`                                  | A `House` isn't a `Wizard`.                  |
| `stage.get("wizard", "1")`                                           | Wizard keys are numbers.                     |
| `draft.status = "undead"`                                            | `status` is `"alive" \| "not alive"`.        |
| `tom.value.name = "x"`                                               | `value` is deeply `readonly`.                |
| `.entity("wizard", ...)` twice                                       | The name is already registered.              |
| An entity with neither `push` nor `pushMany`                         | At least one is required.                    |
| `push: { run }` without `receive`                                    | The object form exists to read the response. |
| `receive: (response) => response` when the response wraps the entity | `receive` must return the entity type.       |
| `key: (wizard: Wizard) => wizard.wand`                               | Keys must be strings or numbers.             |

A new `Stage()` with nothing registered accepts no entity names at all, so
using it before configuring it is also caught.

## Typed results

`track()` and `get()` return `Staged<Wizard, number>`. `changes("house")`
returns `Change<House, string>[]`. You never cast what comes back.

## Runtime checks too

Types are erased, and JavaScript callers, `as any` and data from the network
all get past them. Every rule above is also checked at runtime and throws a
`StageError` naming the problem. See [Errors](../reference/errors).
