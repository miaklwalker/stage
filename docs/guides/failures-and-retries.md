---

title: "Failures and retries"
description: "What a sync does when some pushes fail, how SyncError reports them, and how to retry exactly what didn't make it."
---

A sync never stops at the first failure. Every planned call is attempted.
Once they've all settled, `sync()` rejects with a `SyncError` if any of them
failed.

## What stays dirty

A failed call leaves every value it carried dirty, with its edits intact. A
successful call moves its values' `base` forward. A failure partway through
therefore leaves the stage holding exactly the changes that didn't reach the
server, and nothing else.

```ts
try {
	await stage.sync();
} catch (error) {
	if (!(error instanceof SyncError)) throw error;
	for (const failure of error.failures) {
		console.error(failure.entity, failure.keys, failure.error);
	}
}

console.log(stage.changes()); // only what failed
```

## `SyncError`

| Field      | Notes                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| `failures` | One entry per failed call: `{ entity, keys, error }`. `keys` has one key for `push`, or the whole chunk for `pushMany`.  |
| `cause`    | The first failure's error, so stack traces in logs lead somewhere useful.                                                |
| `message`  | How many calls failed and how many values they covered.                                                                  |

`SyncError` extends `StageError`, so a single `instanceof StageError` check
catches everything the package throws.

## Retrying

Call `sync()` again. Only dirty values are sent, so a retry resends exactly
what failed:

```ts
for (let attempt = 1; ; attempt += 1) {
	try {
		await stage.sync();
		break;
	} catch (error) {
		if (!(error instanceof SyncError) || attempt === 3) throw error;
		await sleep(attempt * 1000);
	}
}
```

Stage has no retry policy of its own. Backoff, retry budgets and which errors
are worth retrying depend on the API, so they belong in your code.

## Bulk chunks fail together

A rejected `pushMany` call fails every value in its chunk, including any the
server may have accepted. If your bulk endpoint can partly succeed, either
throw only when nothing was saved and use [`receive`](reading-responses) for
the rest, or keep `max` small so a retry resends less.

## Throwing it all away

`handle.discard()` drops one value's unsynced edits. `stage.untrack(name, key)`
forgets a value entirely. Neither sends anything.
