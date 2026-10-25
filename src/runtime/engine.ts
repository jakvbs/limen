import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type EngineId = "pi" | "devin";
export type EngineProfile = {
	readonly id: EngineId;
	readonly binaryEnv: "LIMEN_PI" | "LIMEN_DEVIN";
	readonly binaryDefault: EngineId;
	readonly herdrKind: EngineId;
	readonly projectTrust: boolean;
	readonly sessionName: boolean;
	readonly authCheck: boolean;
};
export type EngineArgv = {
	readonly jsonMode: boolean;
	readonly jobDir: string;
	readonly label: string;
	readonly preamble: string;
	readonly extensions: readonly string[];
	readonly provider?: string;
	readonly model?: string;
	readonly thinking?: string;
	readonly continueValue?: string;
	readonly taskFile?: string;
};
export const ENGINES: { readonly [K in EngineId]: EngineProfile } = {
	pi: {
		id: "pi",
		binaryEnv: "LIMEN_PI",
		binaryDefault: "pi",
		herdrKind: "pi",
		projectTrust: true,
		sessionName: true,
		authCheck: true,
	},
	// A Devin job runs in Devin's cloud through its API; the `devin` CLI only lends its login and reports its version.
	devin: {
		id: "devin",
		binaryEnv: "LIMEN_DEVIN",
		binaryDefault: "devin",
		herdrKind: "devin",
		projectTrust: false,
		sessionName: false,
		authCheck: false,
	},
};
export function engineProfile(id: string): EngineProfile {
	if (id === "pi" || id === "devin") {
		return ENGINES[id];
	}
	throw new Error(`unknown engine ${id}`);
}
export function resolveSpawnEngine(flag?: string): EngineProfile {
	const raw = (flag ?? process.env.LIMEN_ENGINE)?.trim() || "pi";
	if (raw === "pi" || raw === "devin") {
		return ENGINES[raw];
	}
	throw new Error("--engine must be pi or devin");
}
export function engineBinary(profile: EngineProfile): string {
	return process.env[profile.binaryEnv] ?? profile.binaryDefault;
}
export async function jobProfile(jobDir: string): Promise<EngineProfile> {
	return engineProfile((await readFile(`${jobDir}/engine`, "utf8").catch(() => "pi")).trim() || "pi");
}
// Package fallback when neither --model nor the role's environment variable names a model.
export function defaultModel(review: boolean): string {
	return process.env[review ? "LIMEN_REVIEWER_MODEL" : "LIMEN_WORKER_MODEL"]?.trim() || "openai-codex/gpt-6-astra:high";
}
export function preflightEngine(profile: EngineProfile, model?: string, provider?: string): void {
	const route = engineRoute(profile, provider, model);
	if (route.bridged && !bridgePath()) {
		throw new Error(
			`--model ${route.model} needs a pi-claude-bridge package (pi install) under ~/.pi/agent/npm, which is missing`,
		);
	}
	if (!(process.env.PATH ?? "").split(":").some((dir) => dir && existsSync(`${dir}/${profile.binaryDefault}`))) {
		throw new Error(`${profile.binaryDefault} is not on PATH; install it`);
	}
	// The bridge signs in through Claude Code, so Pi's own auth store has no say over a bridged route.
	if (!profile.authCheck || route.bridged || process.env.LIMEN_PREFLIGHT !== "auth") {
		return;
	}
	const result = spawnSync(
		engineBinary(profile),
		["auth", "check", ...(provider ? ["--provider", provider] : []), ...(model ? ["--model", model] : [])],
		{
			encoding: "utf8",
		},
	);
	if (result.status !== 0) {
		throw new Error(
			(result.stderr || result.stdout || result.error?.message || "pi auth check failed").trim() ||
				"pi auth check failed",
		);
	}
}
export function argvFor(profile: EngineProfile, slots: EngineArgv): string[] {
	const args: string[] = [];
	if (slots.jsonMode) {
		args.push("--mode", "json");
	}
	if (profile.projectTrust) {
		args.push("--approve");
	}
	args.push("--no-extensions", "--session-dir", `${slots.jobDir}/session`);
	if (profile.sessionName) {
		args.push("--name", `limen: ${slots.label}`);
	}
	args.push("--append-system-prompt", slots.preamble);
	const route = engineRoute(profile, slots.provider, slots.model);
	const bridge = route.bridged ? bridgePath() : undefined;
	const named = [
		...slots.extensions,
		...(bridge ? [bridge] : []),
		...(slots.jsonMode ? [] : herdrStateExtensions(profile)),
	];
	const seen = new Set<string>();
	for (const path of named) {
		const key = profile.id === "pi" && existsSync(path) ? realpathSync(path) : path;
		if (profile.id === "pi" && seen.has(key)) {
			continue;
		}
		seen.add(key);
		args.push("--extension", path);
	}
	if (route.provider) {
		args.push("--provider", route.provider);
	}
	if (route.model) {
		args.push("--model", route.model);
	}
	if (slots.thinking) {
		args.push("--thinking", slots.thinking);
	}
	if (slots.continueValue !== undefined) {
		args.push("--continue", slots.continueValue);
	} else {
		args.push(`@${slots.taskFile}`);
	}
	return args;
}

const BRIDGE = "pi-claude";

// Pi reaches Claude Code through a bridge extension that serves `pi-claude/…` ids and takes the provider as given.
export function engineRoute(
	profile: EngineProfile,
	provider: string | undefined,
	model: string | undefined,
): { readonly provider: string | undefined; readonly model: string | undefined; readonly bridged: boolean } {
	if (profile.id !== "pi") {
		return { provider, model, bridged: false };
	}
	return { provider, model, bridged: provider === BRIDGE || !!model?.startsWith(`${BRIDGE}/`) };
}

// `--no-extensions` hides the bridge. Name it explicitly so the model resolves while other user extensions stay off.
// Pi loads the bridge package it installed, scoped or not.
function bridgePath(): string | undefined {
	const modules = join(homedir(), ".pi", "agent", "npm", "node_modules");
	const scopes = existsSync(modules) ? readdirSync(modules).filter((name) => name.startsWith("@")) : [];
	const found = ["", ...scopes]
		.map((scope) => join(modules, scope, "pi-claude-bridge"))
		.find((path) => existsSync(path));
	return found ? realpathSync(found) : undefined;
}

// `--no-extensions` also hides Herdr's state extension, so a hosted pane falls back to screen
// detection and reads the working agent as idle. Name the Herdr-managed file by its marker.
function herdrStateExtensions(profile: EngineProfile): string[] {
	const dir = join(homedir(), `.${profile.id}`, "agent", "extensions");
	const files = existsSync(dir)
		? readdirSync(dir)
				.filter((name) => name.endsWith(".ts"))
				.sort()
		: [];
	const marker = new RegExp(`^// HERDR_INTEGRATION_ID=${profile.herdrKind}$`, "m");
	return files.map((name) => join(dir, name)).filter((path) => marker.test(readFileSync(path, "utf8")));
}
