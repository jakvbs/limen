# Groups

A group is several agents, often on different models, working one ticket in rounds. The owner-facing lead starts it with one command; each `--team` is one agent on its own engine, provider, model and reasoning level. Limen starts every round, hands each round every team's results, and tells the lead the result once, after the last round. The lead remains the sole landing owner; group messages are informational data, not owner steering or permission to take over jobs.

Ordinary jobs keep their existing spawn, wake, steering and pruning behavior. A `group/` folder alone launches nothing. Groups use no runtime dependencies, database, remote transport, automatic merge, push or model fallback.

## Start

From the lead's tool, with the repository as its working directory. A Sol and two Opus, drafting, critiquing, and one final result:

```sh
limen group start spec/features/active/FNNN-name \
  --team pi:openai-codex/gpt-6.1-sol:high \
  --team pi:pi-claude/claude-opus-5-5:high \
  --team pi:pi-claude/claude-opus-5-5:high \
  --rounds draft,critique,final
```

- `--team ENGINE:PROVIDER/MODEL:THINKING`, once per team. Teams are `team-1`, `team-2`, and so on, in flag order. The model may contain `/` and `:`; the reasoning level (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`) comes last. Each team's jobs and workers run on its route; Limen checks every route before it records the run.
- `--rounds` (default `draft`): a comma list of the rounds in `templates/group-member.md`. `draft`: each team works alone. `critique`: each team reads every other team's result and checks it against the code. `revise`: each team fixes its own work after the critiques. `final`: the first team reads every round and writes the group's one result; it must be the last round. Put the team you want as the final writer first.
- `--workers N` (default 0): each team may launch N jobs of its own (workers, worker continuations, reviews) with `limen spawn` and its route. With 0, a team does the work itself.
- `--timeout D` (default 90m): one wall-clock deadline for the whole group, with a 60-second wrap-up reserve.
- `--detached` forces background jobs; `--tab` requires Herdr; omit both for the environment's default. The final output line is the group ID. Activation selects the root from the feature and working directory, not an inherited `LIMEN_CONTEXT_ROOT`.

Each feature holds one open group; several features run groups at the same time ("3 groups × 3 models" is three `group start` commands on three tickets). Repeating `group start` returns the feature's group ID and launches nothing until that group is closed or stopped, also after it finished, so a retried command never pays for a second run. Once it is closed or stopped and none of its jobs is live, the next `group start` records a new run.

The packet is the feature's `ticket.md`, committed. A shared `group/brief.md` and a per-team approach note `group/teams/team-N.md` are optional; when they exist, they must be committed too. Markdown is not executable configuration.

**The lead is this plant's Herdr coordinator pane, not a limen job.** Open (or reload) the interactive Pi coordinator with `LIMEN_COORDINATOR=1` and the package hooks loaded; `templates/limen-extension.ts` and the loaders `limen init` writes load `hook/group-peer.ts`. The hook registers the lead's session and process under `.limen/group-leads` and refreshes that registration about once a second; `group start` refuses a registration older than 30 seconds, with a reload hint. Do not write that file by hand. Pi passes `PI_SESSION_ID` to the lead's commands; a lead whose commands carry no session is recognized when that registered process is the command's ancestor. That ancestor check grants group authority only. Hosted jobs set `LIMEN_JOB=1`, so they cannot register as lead, and `group start` refuses them; do not `limen spawn` a substitute lead.

To keep group planning private, run `limen planning private` in the project root before activation. `limen planning` shows the setting stored in `.limen/planning-source`. `limen planning committed` restores the default for new runs. Each private packet file must be a readable file inside that root, also after symlinks resolve. A path that contains `..` or escapes the root fails before activation. Members receive absolute paths to the ticket, the brief, and their team note. They do not receive copies, and their task does not embed the private approach note. Jobs, their descendants, and their continuations keep the planning source recorded at spawn, even when the project setting changes. They read the vision and board in the canonical project root. Never copy, link, stage or commit private planning. Product-code Git checks, lead authority, and group limits do not change.

Repeat `--extension PATH` for trusted local extensions shared by every team, or `--team-extension team-N=PATH` for team-only additions. Common paths come first. Paths use the lead command's directory/home, resolve symlinks and deduplicate in first-seen order. Quote the whole `team-N=PATH` argument when it contains spaces; paths may contain `=`. All selections are checked before activation. See [path rules and trust limits](commands.md#start-and-continue-jobs).

The run records complete effective `teamExtensions` lists, including empty lists. Team jobs, workers, authorized reviews and worker continuations inherit their team's list through the ordinary job record and loaders. Omit member `--extension` flags, or repeat the identical canonical list; a different list fails before consuming a launch slot. Continuation also checks the parent's list. Route flags remain explicit. Malformed maps are errors. A repeated start does not change the extensions or recheck old targets; each actual launch checks its targets again. A partial launch failure retains the cabinet, started jobs and an `activation-error.json`; stop that run before starting a new one.

## Rounds

The first round starts with `group start`: one job per team, labeled `FNNN team-N MODEL · ROUND`. Its task is the group contract (`templates/group-member.md`), the team's route and allowance, the packet, and the round's instruction.

A team's final message is its round result. When every team of a round has ended, Limen saves each result to `.limen/groups/GROUP-ID/rounds/R-NAME/team-N.md` and continues each team whose job ended `done` into the next round, in its own engine session and worktree. The next round's task names every team's result file, branch and worktree; the final round names every round. A team that failed or stopped sits out the rest of the run; its round file and its line in the lead's result say what ended it. A launch that fails records its reason in the round folder. The group finishes after its last round, when no team is left, or when the deadline leaves no time for another round.

A hosted team job ends when its turn ends: once its session has been idle for the idle threshold after a final message, Limen closes it `done`, clean worktree or not, or `failed` when that turn failed. A team job whose worktree is gone or is no Git checkout when its engine would start fails at once with that reason.

Each team job that ends starts `limen group advance GROUP-ID` in its own process. The advance waits for that job's process to exit, takes the launch lock, and does nothing until the round is complete, so the finishes of several teams start a round once. `limen group status GROUP-ID` starts one too, which moves on a round whose last finish could not.

When the group finishes, Limen writes `.limen/groups/GROUP-ID/result.md` and tells the lead once: the final team's whole final message, or without a final round each team's whole final message from the last round, with the result paths; each team's route, state and branch; and the next step. With a live lead hook it is one group event that starts a lead turn. Without one it is a Herdr prompt to the pane the lead started the group from; `result-delivery` in the cabinet records which. A long result travels whole as a job wake does, over the Herdr socket ([Herdr wakes](jobs.md#wakes)). A result past the 1 MiB that Herdr reads in one request cannot travel as a Herdr prompt: `result-delivery` records the failed attempts with `prompt_too_large`, and `result.md` keeps the whole text. Team jobs never send ordinary completion wakes, and the lead does not hear their starts and ends.

## Work and publish

Every member receives its canonical root, group and team IDs, feature pointer, the exact `limen` executable of the package that started the group (a member's shell may put another installed Limen first on PATH), and, for a team job, its route and worker allowance.

Only a team's own job launches that team's workers, through ordinary `limen spawn` with the team's route explicitly supplied. Worker continuations and separately authorized reviews each consume another slot, even if their predecessor finished. Reviews require a candidate branch owned by that team. Exhaustion never replenishes a run. Built-in helper agents do not bypass the allowance. A team's own job continues only into its next round, which Limen starts.

Members use one canonical `.limen/jobs/` cabinet while each team has its own Git worktree. Worker continuation retains its own worktree and same-engine session in a new linked record, without erasing predecessor receipts. Group members can read any job with `limen jobs` and `limen diff`. They cannot stop, steer, continue, watch, or land another team's job. This is process isolation, not a hostile-code sandbox.

Rounds carry most of the exchange. Publish only what a peer must not miss before the round ends: a disproved assumption, a help request, a checked candidate:

```sh
limen group publish 'Finding: stale revisions can conflict. Check: … Commit/artifact: … Uncertainty: …'
limen group publish --team team-2 'Question for team-2: …'
limen group wait
limen group wait --timeout 5s
limen group status
```

Members inherit verified membership and omit the group ID. The lead supplies it after the subcommand, for example `limen group status GROUP-ID` or `limen group publish GROUP-ID 'Lead checkpoint: …'`.

Publication writes only `.limen/groups/GROUP-ID/`, never the primary checkout's tracked packet. Member starts, terminal states and advisory changes are derived automatically from job records and reach only the member's own team. An uncertain tool-stall observation stays in the job record for the operator and is not broadcast. Findings attach to members' normal tool results; the lead receives findings and the result as compact, agent-attributed custom messages. No manual `watch` or `steer` setup is needed. Recorded seat and finish-webhook opt-ins are not repurposed as peer transports.

A team with live workers stays inside its turn. When idle, it re-enters `group wait` after a normal timeout until its workers are done, the group stops or its deadline expires. Each call lasts at most 20 seconds, including an actual CLI-process watchdog. If that watchdog cuts off an in-flight cabinet operation, inspect its uncertain receipt before deliberate recovery. Waits and acknowledgments publish no new events. A hosted team job with live children is not idle-closed; unread events alone never keep a finished worker alive.

The group has one wall-clock deadline. Each worker's deadline is the group deadline minus the recorded 60-second wrap-up reserve. A launch with no remaining worker time is refused. Detached wrappers and hosted supervision enforce the recorded deadline; hosted jobs do not receive unsupported ordinary `spawn --timeout` flags.

## Delivery evidence

`limen group status GROUP-ID` shows the feature, the round now running (or where the result is, once finished), the local deadline and minutes left, stopped and closed flags, and one state row per member with its team and round. A reserved member without a published job state reads `no job record yet`. Use `limen group status GROUP-ID --json` for the full run, roster-derived states, events and receipt evidence. Members omit `GROUP-ID` in both forms. Job records remain authoritative for job state.

Each event has one receipt per recipient. A receipt moves from queued to accepted, observed and processed. None of these states proves that a member agreed with or acted on the event. A receipt marked `uncertain` means a delivery was interrupted, so the event may or may not have reached its recipient. Inspect it before you act on it. Limen tries each recipient and event at most twice automatically.

One message carries at most eight events and 8,000 characters of published text. A single longer event, such as a group result, goes alone and whole. Omitted detail stays in the cabinet, and the message names its location. Processed events are not delivered again. A finished member keeps its unread events for a deliberate continuation; Limen does not respawn it.

When the cabinet is busy, routine sweeps skip it instead of failing the member. A later sweep publishes the updates. Group spawn and continue wait for a launch in progress to finish. They have no timeout, so a launch that never finishes needs inspection.

## Stop, recover and close

```sh
limen group stop GROUP-ID
limen group status GROUP-ID
limen group close GROUP-ID
```

Stop blocks new launches and new rounds, waits for a launch in progress to finish, and then stops the group's members only. `stop-report.json` lists the processes that survived or that Limen cannot confirm stopped. Stop keeps branches, worktrees, round results, findings and unread events. A team job that fails or stops early sits out the later rounds; there is no roster repair.

Every unclosed group's member worktree and job record is protected from ordinary automatic pruning, explicit `prune`, and `prune --retire`. Close decides from each member's job state and recorded processes, never from whether its worktree still exists. It refuses while a member is not over: its state is running, a process it recorded (its pid, its Herdr agent, its owner) still runs or cannot be checked, or it has no record yet. The refusal names that reason and the pid; close never signals a process. A pid no process holds counts as gone at once; one that exists is checked against its recorded start time. Close also refuses while a member's worktree has uncommitted Git work. A worktree that is gone or is no Git checkout holds none: close names each such folder, and prune removes it after close. Refusal preserves all protection. Commit or recover dirty work deliberately; never force-delete it to make close succeed. Successful close releases clean member paths for ordinary pruning, but retains the group cabinet and publications.

Resume the original lead session to recover its subscription and bounded catch-up. A different session does not silently inherit lead authority. A command that prints `group lock busy or uncertain` names a cabinet lock. Read its `.lock/owner` before you recover the lock by hand. Limen recovers a lock whose owner died; it never evicts a live owner. An uncertain or interrupted recovery is evidence to inspect, not a reason to launch a replacement roster. Retained evidence is addressed by group ID, independently of the feature's current lane.

When the result needs filing, the lead puts selected round results in the feature's `group/findings/` and writes `group/synthesis.md`. In committed mode, the lead commits them as an ordinary documentation change. In private mode, the lead keeps them in the canonical project root and does not stage or commit them. Moving the feature does not move or strand its live cabinet.

The lead lands through the spec keeper. After merging the team branches it keeps onto one integration branch, the lead starts one keeper for the feature ticket: `limen keeper <ticket> --group GROUP-ID --candidate <integration branch> --engine E --provider P --model M --thinking T`. `--group` lists every member job in the packet, so the keeper can read each transcript. The keeper refuses while a member runs and fixes ticket, board and map links on its own branch at the integration tip. The lead then lands the keeper job, which carries the integration and the fixes. Members cannot start a keeper or land.

## Reproducible proof setup

The real-agent proof is separate from native regressions. Prepare, but do not automatically launch, its disposable repository:

```sh
node /path/to/candidate/bin/limen-group-fixture.mjs /absolute/new/disposable/repository
```

The generator commits a small ticket and its acceptance test, with no remote or finish webhook, and prints the interactive-lead setup and a three-team draft, critique and final command. The task source intentionally does not exist yet; the teams write it. No dependency install is needed for the fixture's native Node tests.

A pass needs: every round's jobs on their recorded routes, each later round's task naming the earlier results, the final result committed on the first team's branch with `npm test` green, and exactly one result message in the lead's session after the last round, with no wake for any team job. Retain the candidate SHA, fixture path, command, group and member IDs, round folders, `result-delivery`, real check output and the lead transcript excerpt. Queue acceptance or a clean worker exit is not a pass. Quota or engine failure preserves evidence without changing models. Detached proof does not establish hosted real-agent transport.

## How it works

You do not need these mechanics to run a group. They explain the evidence that status, receipts and errors show.

- **Cabinet:** the group's folder, `.limen/groups/GROUP-ID/`. It holds `run.json`, immutable event files and `receipts/RECIPIENT/EVENT.json`.
- **Occurrence:** one observed lifecycle transition. An unchanged advisory produces no new event, but the same advisory after an observed clear is a new occurrence. Limen records a pending occurrence before it publishes it. After an interruption, the next sync finishes that event and its missing recipient receipts before it observes the next value. It keeps receipts that are already accepted or processed.
- **Lock:** a `.lock` folder in the cabinet, so that one process at a time changes the cabinet. Its `owner` file holds the owner's PID. A command waits up to ten seconds for it, then fails with `group lock busy or uncertain`. Routine supervisor, hook and finalization sweeps skip a held lock. Unchanged state and advisory markers do not take the lifecycle lock; delivery and lifecycle publication share one hold when work is pending.
- **Inode-specific claim:** how Limen recovers the lock of a dead owner. It takes over only the same lock folder (same inode) that the dead owner held, so two recoveries cannot both win.
- **Launch lock:** a second lock that one launch holds while it publishes. Membership is claimed only after Limen takes this lock, so the allowance, stop and deadline checks run against the current roster. Spawn, continue, stop and close wait for it with no timeout. A dead owner is recovered as above; a stuck live owner is never evicted.
- **Launch fence:** the `stopped` flag in `run.json`. Stop sets it first, so no new launch starts while stop drains the launch lock.
- **Delivery claim:** a token and owner PID written into a receipt while one process delivers that event to that recipient. Claims run one at a time per recipient. Continuation inherits proven processing from its predecessor chain.
- **Lease:** the 30 seconds after a claim during which no other process retries it. After the lease, a dead owner's claim becomes retryable; a live owner is not displaced.
- **Transport acceptance:** the point at which the transport took the message: CLI output was produced, a tool or custom message was emitted, or the lead transport accepted the custom message.

The receipt states mean:

- **Queued:** durable event and recipient work, including a claimed delivery whose transport has not accepted it yet.
- **Accepted:** transport acceptance happened. This does not prove that a model consumed the message.
- **Observed:** `observedAt` records that the delivery token appeared in the hook's next model-context event.
- **Processed:** a non-errored assistant response followed that observed context. It does not prove agreement, adoption or successful collaboration.

A crash between transport and observation is ambiguous; delivery is not exactly once. Retained tokens, owners and `uncertain` receipts expose that ambiguity. The two automatic attempts count separately for each recipient. Receipt processing never publishes another event.
