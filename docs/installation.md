---

title: "Installation"
description: "Add Stage to a project: one runtime dependency (Immer), shipped as TypeScript source."
---

```bash
npm install @michaelrwalker/stage
```

## What you get

Stage has one runtime dependency, [Immer](https://immerjs.github.io/immer/),
which provides the drafts that `update()` hands you and the deep freezing that
keeps tracked values from being changed behind the stage's back.

Stage ships as TypeScript source rather than compiled JavaScript with a
`.d.ts` shadow beside it. `package.json` points `main` and `types` both at
`main.ts`:

```json
{
	"main": "main.ts",
	"types": "main.ts",
	"exports": { ".": "./main.ts" }
}
```

If your project already compiles TypeScript through a bundler (esbuild, Vite,
tsup) or runs it directly (Node with type stripping, Bun, Deno), there is
nothing to configure. Otherwise your toolchain needs to transform `.ts` files
from `node_modules`. In exchange, go-to-definition lands on real, commented
source.

## Importing

```ts
import { Stage, track } from "@michaelrwalker/stage";
```

Everything comes from that single entry point: `Stage`, `track`,
`StageError`, `SyncError`, the `isEqual` and `changedFields` helpers, and the
supporting types. See [Stage API](reference/api) for the full surface.

## Running the examples locally

If you've cloned the repository, the examples run directly under Node's
TypeScript support, with no build step:

```bash
node --experimental-transform-types --disable-warning=ExperimentalWarning examples/round-trip.ts
```
