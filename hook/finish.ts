import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { noteCheck } from "../src/job/task-note.ts";

type Text = { readonly type: "text"; readonly text: string };
type SettleEvent = { readonly outcome?: string; readonly entries?: readonly unknown[] };
type PiApi = {
	registerTool?(tool: {
		readonly name: string;
		readonly label: string;
		readonly description: string;
		readonly parameters: object;
		execute(
			toolCallId: string,
			params: { readonly handoff?: string },
			signal: unknown,
			onUpdate: unknown,
			ctx: { shutdown?(): void },
		): Promise<{ content: Text[]; details: object }>;
	}): void;
	on(event: "agent_before_settle", handler: (event: SettleEvent) => object | undefined): void;
};

/**
 * `finish` for every Limen job, hosted or detached. A detached job resumed from a hosted session keeps the hosted
 * transcript, and the model calls `finish` again. The handoff becomes the job result,
 * and the session ends after this turn.
 *
 * Once per job, before the finish, the agent gets its task note to check: the first `finish` call answers with the
 * check, and a detached run that ends without `finish` gets it as one more turn through Pi's `agent_before_settle`.
 * A hosted run ends at each owner message, so only `finish` asks.
 */
export default function limenFinish(pi: PiApi): void {
	const root = process.env.LIMEN_CONTEXT_ROOT;
	const id = process.env.LIMEN_JOB_ID;
	if (process.env.LIMEN_JOB !== "1" || !root || !id) {
		return;
	}
	const jobDir = join(root, ".limen", "jobs", id);
	if (!existsSync(jobDir)) {
		return;
	}
	let checked = false;
	const check = (finishTool: boolean): string | undefined => {
		if (checked) {
			return;
		}
		checked = true;
		appendFileSync(join(jobDir, "log"), `[limen ${new Date().toISOString()}] note check sent\n`);
		return noteCheck(jobDir, finishTool);
	};
	pi.registerTool?.({
		name: "finish",
		label: "Finish",
		description: "End this job. Pass the handoff text; the job is recorded done and the session exits.",
		parameters: {
			type: "object",
			properties: { handoff: { type: "string", description: "Handoff for the coordinator" } },
			required: ["handoff"],
		},
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const ask = check(true);
			if (ask) {
				return { content: [{ type: "text", text: ask }], details: {} };
			}
			const handoff = typeof params?.handoff === "string" ? params.handoff.trim() : "";
			try {
				if (handoff) {
					writeFileSync(join(jobDir, "result"), `${handoff}\n`);
				}
				writeFileSync(join(jobDir, "session-ended"), `${new Date().toISOString()}\n`);
			} catch {
				// The engine's exit still ends the job; only the handoff text is lost.
			}
			ctx.shutdown?.();
			return { content: [{ type: "text", text: "done" }], details: {} };
		},
	});
	if (process.env.LIMEN_HOSTED === "1") {
		return;
	}
	pi.on("agent_before_settle", (event) => {
		const ask = event.outcome === "completed" ? check(false) : undefined;
		if (!ask) {
			return;
		}
		const entry = { type: "custom_message", customType: "limen-note-check", content: ask, display: false };
		return { entries: [...(event.entries ?? []), entry], continue: true };
	});
}
