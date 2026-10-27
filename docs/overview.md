---

title: "Overview"
description: "Why Stage exists: edit values in steps with Immer drafts, then sync the net result in as few API calls as the API allows."
---

Stage lets a script change things in stages without paying for every stage
against an API. You track a value, edit it as many times as you like with
[Immer](https://immerjs.github.io/immer/) drafts, and sync once at the end.
Stage works out what actually changed and sends only that, in as few calls as
each endpoint allows.

## The problem

Scripts that change remote data rarely do it in one place. A name gets
normalised in one function, a status is set in another, and a third decides a
field should go back to how it was. Sending a request at each step is the
obvious approach, and it has costs:

- **Rate limits.** Three edits to one record are three requests, and a
  thousand records are three thousand.
- **Wasted writes.** An edit that is later reverted still went over the wire,
  twice.
- **No batching.** APIs with a bulk endpoint can take fifty records in one
  call, but only if something collects the changes first.

The usual workaround is to build up a local copy and remember to diff it
against the original before sending. That bookkeeping is the same every time,
and easy to get subtly wrong.

## The staged-change idea

Stage does that bookkeeping. Every tracked value keeps two versions: `base`
(what the server last saw) and `value` (the current state, including your
edits). A sync compares them, sends the difference and moves `base` forward.

```ts
import { Stage } from "@michaelrwalker/stage";

const stage = new Stage().entity("wizard", {
	key: (wizard: Wizard) => wizard.id,
	push: (change) => api.patch(`/wizards/${change.key}`, change.patch),
	pushMany: { max: 50, run: (changes) => api.post("/wizards/bulk", changes) },
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

await stage.sync(); // one PATCH carrying { name, status }
```

Because the comparison happens at sync time rather than as a log of edits:

- setting a field twice sends it once
- setting a field and then setting it back sends nothing
- values of the same kind go out together through `pushMany`, split into
  batches no bigger than the endpoint accepts

## Typed by the chain

Each `.entity()` call teaches the stage a name, a value type and a key type.
After that, `track("wizrd", ...)` is a compile error, and so is tracking a
house as a wizard, looking a wizard up by a string key, or assigning an
invalid value inside a draft. See [Type safety](guides/type-safety).

## Where to go next

- [Installation](installation) to add the package.
- [Quick Start](quick-start) for a complete worked example.
- [Sync adapters](guides/sync-adapters) for how `push` and `pushMany` are
  chosen and called.
- [Reading responses](guides/reading-responses) for APIs that send back the
  saved entity.
