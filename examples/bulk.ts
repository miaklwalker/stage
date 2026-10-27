// Many values, two kinds of entity, and an API with a bulk endpoint that caps
// how many items each call may carry.
import { Stage, SyncError } from "../main.ts";

interface Wizard {
	id: number;
	name: string;
	house: string;
	revision?: number;
}

interface House {
	slug: string;
	points: number;
}

const log: string[] = [];

const stage = new Stage()
	.entity("wizard", {
		key: (wizard: Wizard) => wizard.id,
		// One wizard alone goes through the single-resource endpoint...
		push: async (change) => {
			log.push(`PATCH /wizards/${change.key} ${JSON.stringify(change.patch)}`);
		},
		// ...and anything more through the bulk endpoint, 3 at a time.
		pushMany: {
			max: 3,
			run: async (changes) => {
				log.push(
					`POST /wizards/bulk [${changes.map((c) => c.key).join(", ")}]`,
				);
				// The bulk endpoint echoes the saved wizards back, newest first and
				// with the server's revision number — not in the order we sent them.
				return {
					saved: changes
						.map((change) => ({ ...change.current, revision: 2 }))
						.reverse(),
				};
			},
			// Pull the entities out of the response. The stage matches each one to
			// its tracked value by `key`, so the reversed order doesn't matter.
			receive: (response) => response.saved,
		},
	})
	.entity("house", {
		key: (house: House) => house.slug,
		// This endpoint wants the whole resource, so send `current`, not `patch`.
		push: async (change) => {
			if (change.key === "hufflepuff")
				throw new Error("503 Service Unavailable");
			log.push(`PUT /houses/${change.key} ${JSON.stringify(change.current)}`);
		},
		concurrency: 2,
	});

const students = ["harry", "ron", "hermione", "neville", "luna"].map(
	(name, index) =>
		stage.track("wizard", { id: index + 1, name, house: "gryffindor" }),
);
const houses = ["gryffindor", "ravenclaw", "hufflepuff"].map((slug) =>
	stage.track("house", { slug, points: 0 }),
);

// Luna is in Ravenclaw — edits can come from anywhere, in any order.
stage.get("wizard", 5)?.update((draft) => {
	draft.house = "ravenclaw";
});
for (const student of students) {
	student.update((draft) => {
		draft.name = draft.name[0]?.toUpperCase() + draft.name.slice(1);
	});
}
for (const house of houses) {
	house.update((draft) => {
		draft.points += 50;
	});
}

try {
	await stage.sync();
} catch (error) {
	// Every other push still went through. The failed one stays dirty, so a
	// later sync() retries exactly it.
	if (!(error instanceof SyncError)) throw error;
	log.push(
		`failed: ${error.failures.map((f) => `${f.entity} ${f.keys}`).join("; ")}`,
	);
}

console.log(log.join("\n"));
console.log(
	"still pending:",
	stage.changes().map((change) => change.key),
);
console.log("luna as the server has her:", stage.get("wizard", 5)?.value);
