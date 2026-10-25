import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { SESSION_ID } from "../job/job.ts";
import { textFile } from "../job/record.ts";
import { processInfo } from "../runtime/contain.ts";
import { deliverEventWebhook, finishWebhookEnv, type PlantEvent, plantBranch } from "./finish-webhook.ts";

type Kind = "coordinator.idle" | "coordinator.exited";
export type CoordinatorSignal = { readonly kind: Exclude<Kind, "coordinator.exited">; readonly reason: string };
export type CoordinatorSession = {
	readonly cwd: string;
	readonly agent?: { readonly kind: string };
	readonly sessionManager: {
		getSessionId(): string;
		getSessionName?(): string | undefined;
	};
};

const HANDOFF: Record<Kind, string> = {
	"coordinator.idle": "Coordinator turn ended. Next step: read its last message, then answer, steer or decide.",
	"coordinator.exited":
		"Coordinator process exited. Next step: restart it in its pane, then check unfinished work such as a land in progress.",
};
const FEATURE = /\bF\d{3,5}\b/;
/** One ended turn: its last stop reason, owned running jobs, and the first line of its last assistant message. */
export type CoordinatorTurn = {
	readonly stop: string;
	readonly ownedRunning: number;
	readonly said: string;
};

/**
 * What an ended coordinator turn means for the shepherd. A turn end counts only when no running job owned by this
 * coordinator will wake it again; an aborted turn means the owner is at the pane.
 */
export function turnSignal(turn: CoordinatorTurn): CoordinatorSignal | undefined {
	if (turn.stop === "aborted" || turn.ownedRunning > 0) {
		return;
	}
	const said = turn.said ? `; last message: ${turn.said}` : "";
	return {
		kind: "coordinator.idle",
		reason: `${turn.stop === "error" ? "last turn failed" : "turn ended"}${said}`,
	};
}

/**
 * Coordinator milestones from the wake hook. The coordinator registers under `.limen/coordinators/<session>` so the
 * sweep can find its process exit later, when no code runs in the dead process. Its pings queue under
 * `.limen/coordinator-events/<session>`, which outlives the registration.
 */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: split pending: factory, handlers share its state
export function coordinatorSignals() {
	let dir: string | undefined;
	let root = "";
	let session: CoordinatorSession | undefined;
	let pane = "";
	let stop = "";
	// An assistant message opens a turn; the first turn end closes it, so a repeated end event sends nothing.
	let turnOpen = false;
	let said = "";
	let ticket = "";
	const tools = new Map<string, string>();
	const write = (name: string, value: string) => {
		if (!dir) {
			return;
		}
		try {
			writeFileSync(join(dir, name), `${value}\n`);
		} catch {
			// The registration is advisory; a missing file only weakens a later exit reason.
		}
	};
	const title = () => {
		const name =
			session?.sessionManager.getSessionName?.()?.trim() ||
			`coordinator ${pane || session?.sessionManager.getSessionId()}`;
		return ticket && !name.includes(ticket) ? `${name} · ${ticket}` : name;
	};
	// The start time tells the sweep a reused pid from this process. A loaded machine can miss the 1s query; a later turn end retries.
	const recordBorn = () => {
		if (!dir || existsSync(join(dir, "born"))) {
			return;
		}
		void processInfo(process.pid)
			.then((outcome) => {
				if (outcome.kind === "present") {
					write("born", outcome.process.born);
				}
			})
			.catch(() => {});
	};
	const signal = (kind: Exclude<Kind, "coordinator.exited">, reason: string, claim = String(Date.now())) => {
		if (!dir || !session) {
			return;
		}
		// Pings live outside the registration, which a normal exit or a resumed session removes.
		const events = join(root, ".limen", "coordinator-events", session.sessionManager.getSessionId());
		try {
			const config = finishWebhookEnv(root, root);
			if (!config) {
				return;
			}
			const event: PlantEvent = {
				kind,
				status: kind.slice("coordinator.".length),
				title: title(),
				id: session.sessionManager.getSessionId(),
				reason,
				branch: plantBranch(root),
				plant: basename(root),
				handoff: HANDOFF[kind],
			};
			void deliverEventWebhook(join(events, `${kind}.${claim}`), config, event, join(root, ".limen")).catch(() => {});
		} catch {
			// A webhook is a side channel; it never disturbs the coordinator's turn.
		}
	};
	return {
		start(plant: string, context: CoordinatorSession): void {
			if (process.env.LIMEN_JOB === "1" || context.agent?.kind === "sub") {
				return;
			}
			pane = process.env.HERDR_ENV === "1" ? (process.env.HERDR_PANE_ID?.trim() ?? "") : "";
			if (process.env.LIMEN_COORDINATOR !== "1" && !pane) {
				return;
			}
			const id = context.sessionManager.getSessionId();
			if (!SESSION_ID.test(id)) {
				return;
			}
			const base = join(plant, ".limen", "coordinators");
			try {
				// A resumed session in a new process starts a fresh registration: the old pid, start time, and exit claim describe another process.
				const previous = readOptional(join(base, id, "pid"));
				if (previous && previous !== String(process.pid)) {
					rmSync(join(base, id), { recursive: true, force: true });
				}
				mkdirSync(join(base, id), { recursive: true });
				// One process holds one registration: a switched session ends the old one cleanly.
				for (const name of readdirSync(base)) {
					if (name !== id && readOptional(join(base, name, "pid")) === String(process.pid)) {
						rmSync(join(base, name), { recursive: true, force: true });
					}
				}
				rmSync(join(base, id, "shutdown"), { force: true });
			} catch {
				return;
			}
			root = plant;
			session = context;
			dir = join(base, id);
			write("pid", String(process.pid));
			write("pane", pane);
			write("started-at", new Date().toISOString());
			write("title", title());
			recordBorn();
		},
		toolStart(event: unknown): void {
			if (!dir) {
				return;
			}
			const value = fields(event);
			const name = typeof value.toolName === "string" && value.toolName.trim() ? value.toolName.trim() : "tool";
			const args = fields(value.args ?? value.input);
			const detail = typeof args.command === "string" ? args.command : typeof args.path === "string" ? args.path : "";
			tools.set(
				typeof value.toolCallId === "string" ? value.toolCallId : name,
				`${name}${detail ? `: ${detail.replace(/\s+/g, " ").trim().slice(0, 160)}` : ""}`,
			);
			write("tool", [...tools.values()].at(-1) ?? name);
		},
		toolEnd(event: unknown): void {
			if (!dir) {
				return;
			}
			const value = fields(event);
			const name = typeof value.toolName === "string" && value.toolName.trim() ? value.toolName.trim() : "tool";
			tools.delete(typeof value.toolCallId === "string" ? value.toolCallId : name);
			const current = [...tools.values()].at(-1);
			if (current) {
				write("tool", current);
			} else {
				rmSync(join(dir, "tool"), { force: true });
			}
		},
		messageEnd(stopReason: string | undefined, text = ""): void {
			turnOpen = true;
			if (!stopReason || stopReason === "toolUse") {
				return;
			}
			stop = stopReason;
			// The first text line, without Markdown markers, is the answer a coordinator leads with.
			const head = text
				.split("\n")
				.map((line) => line.replace(/^[\s#>*-]+/, "").trim())
				.find(Boolean);
			if (head) {
				said = head.slice(0, 200);
				ticket = FEATURE.exec(text)?.[0] ?? ticket;
			}
		},
		settled(): void {
			if (!dir || !session || !turnOpen) {
				return;
			}
			turnOpen = false;
			write("title", title());
			recordBorn();
			const turn = {
				stop,
				ownedRunning: ownedRunning(root, session.sessionManager.getSessionId(), pane),
				said,
			};
			stop = "";
			said = "";
			const next = turnSignal(turn);
			if (next) {
				signal(next.kind, next.reason);
			}
		},
		shutdown(): void {
			write("shutdown", new Date().toISOString());
			dir = undefined;
			session = undefined;
		},
	};
}

/**
 * The sweep finds a coordinator process that died and removes its registration. A death without the hook's shutdown
 * mark first queues one `coordinator.exited`. Its registration is the only evidence.
 */
export async function sweepCoordinators(root: string): Promise<void> {
	const base = join(root, ".limen", "coordinators");
	for (const name of await readdir(base).catch(() => [] as string[])) {
		const dir = join(base, name);
		const { pid, state } = await registeredProcess(dir);
		if (state !== "dead") {
			continue;
		}
		if (existsSync(join(dir, "shutdown"))) {
			await rm(dir, { recursive: true, force: true });
			continue;
		}
		const tool = await textFile(join(dir, "tool"));
		const event: PlantEvent = {
			kind: "coordinator.exited",
			status: "exited",
			title: (await textFile(join(dir, "title"))) || `coordinator ${name}`,
			id: name,
			reason: `pid ${pid} exited without a session shutdown (killed or crashed)${tool ? ` while running ${tool}` : ""}`,
			branch: plantBranch(root),
			plant: basename(root),
			handoff: HANDOFF["coordinator.exited"],
		};
		// The claim names the pid: a resumed session in a new process can exit again.
		await deliverEventWebhook(
			join(root, ".limen", "coordinator-events", name, `coordinator.exited.${pid}`),
			finishWebhookEnv(root, root),
			event,
			join(root, ".limen"),
		);
		await rm(dir, { recursive: true, force: true });
	}
}

export type LiveCoordinator = { readonly session: string; readonly pane: string; readonly startedAt: number };

/**
 * The coordinators of one project that run now in a Herdr pane: a registration with a pane, no `shutdown` mark, and a
 * live process, as the sweep judges it.
 */
export async function liveCoordinators(root: string): Promise<readonly LiveCoordinator[]> {
	const base = join(root, ".limen", "coordinators");
	const live: LiveCoordinator[] = [];
	for (const session of await readdir(base).catch(() => [] as string[])) {
		const dir = join(base, session);
		const pane = await textFile(join(dir, "pane"));
		if (!pane || existsSync(join(dir, "shutdown")) || (await registeredProcess(dir)).state !== "live") {
			continue;
		}
		live.push({ session, pane, startedAt: Date.parse(await textFile(join(dir, "started-at"))) || 0 });
	}
	return live;
}

/**
 * A registration's process: live when its pid runs with the recorded start time, or before one is recorded; dead when
 * it does not run; unknown without a pid or when the process query fails.
 */
async function registeredProcess(
	dir: string,
): Promise<{ readonly pid: number; readonly state: "live" | "dead" | "unknown" }> {
	const pid = Number(await textFile(join(dir, "pid")));
	if (!Number.isSafeInteger(pid) || pid <= 0) {
		return { pid, state: "unknown" };
	}
	const outcome = await processInfo(pid);
	if (outcome.kind === "unavailable") {
		return { pid, state: "unknown" };
	}
	const born = await textFile(join(dir, "born"));
	return { pid, state: outcome.kind === "present" && (!born || outcome.process.born === born) ? "live" : "dead" };
}

function ownedRunning(root: string, session: string, pane: string): number {
	const jobs = join(root, ".limen", "jobs");
	let count = 0;
	for (const id of existsSync(jobs) ? readdirSync(jobs) : []) {
		if (readOptional(join(jobs, id, "state")) !== "running") {
			continue;
		}
		if (
			(pane && readOptional(join(jobs, id, "origin-pane")) === pane) ||
			existsSync(join(jobs, id, "notify", "subscribers", session))
		) {
			count += 1;
		}
	}
	return count;
}

function readOptional(path: string): string {
	try {
		return readFileSync(path, "utf8").trim();
	} catch {
		return "";
	}
}

/** Hook events arrive as engine-owned objects; a missing or foreign shape reads as empty. */
function fields(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
