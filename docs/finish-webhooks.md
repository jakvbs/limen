# Finish webhooks

A finish webhook tells a bot or a service that a job ended. Limen sends one JSON
POST to each destination that the project configures. The same sender also
carries coordinator and lead events (see [Plant events](#plant-events)).

To use it:

1. Create the project's private env file
   ([macOS](#macos-configure-a-project) or [VPS](#vps-load-only-the-selected-path)).
2. Send one test ping with `limen webhook test`.
3. Spawn a job and check that its record has `finish-webhook-env`.
4. When a send fails, [inspect the receipt](#inspect-failures-and-deliberately-retry)
   before you retry.

The sender is `bin/tony-finish-ping.sh <label> <job-state> <branch>`. The file
keeps its name for compatibility; the name does not limit who receives the
finish. It requires Node.js 24+ and Git, on macOS or Linux. It uses Node's HTTP
client, not curl; credentials never enter child-process arguments. HTTP
acceptance does **not** prove any bot woke or read the handoff.

A `done` job emits `status: "waiting"`, `jobState: "done"`, and
`handoff: "Job done. Next step: land it, or name the check that still blocks landing."`.
The durable job state remains `done`; the webhook status deliberately cannot be
mistaken for landing approval by a recipient that ignores new fields. Receivers
that only accept `status: "done"` must handle `waiting` as a handoff, not as an
error or a new-spawn signal. Failed and stopped jobs retain their status and
direct inspection of the job record. When the ended job has a final message, the
`handoff` continues after a blank line with `Final message:` and that whole
message, never cut: the coordinator a receiver wakes decides the next step from
it. Automatic sends read the saved queue snapshot, so the report does not hit
argv or environment size limits. A manual send adds it when
`LIMEN_FINISH_MESSAGE_FILE` names the result file (see
[the manual send](#inspect-failures-and-deliberately-retry)). All sends include `job`, `status`,
`branch`, `handoff`, and `event`. Automatic sends also carry `finishEvent`,
`plant`, `title`, `jobId`, and `reason`.

## macOS: configure a project

Use an editor to enter the private destination and credential; avoid shell
history. Run this from the intended project (the main checkout or any linked
worktree), **not** from the Limen installation:

```sh
COMMON=$(cd "$(git rev-parse --git-common-dir)" && pwd -P)
PROJECT=$(dirname "$COMMON")
CONFIG="$PROJECT/.limen/finish-webhook.env"
mkdir -p "$PROJECT/.limen"
printf '/.limen/finish-webhook.env\n' >> "$COMMON/info/exclude"
if [ ! -e "$CONFIG" ]; then
  (umask 077; printf '%s\n' \
    "LIMEN_FINISH_WEBHOOK_URL='https://your-endpoint.example.invalid/finish'" \
    "LIMEN_FINISH_WEBHOOK_AUTH='Bearer REPLACE_WITH_TOKEN'" > "$CONFIG")
fi
chmod 600 "$CONFIG"
"${EDITOR:-vi}" "$CONFIG"
git check-ignore "$CONFIG"
```

The final command should show that the file is ignored. `info/exclude` keeps the
credential file out of Git without a repository-wide tracked settings change.
Never add it with `git add -f`. If a config was previously committed, ignoring it
is not a remedy: the operator must remove it from tracking and address exposure.

After replacing the placeholders, deliberately test one request:

```sh
LIMEN_FINISH_WEBHOOK_ENV="$CONFIG" \
  "$HOME/.overment/tony-finish-ping.sh" setup-check done "$(git branch --show-current)"
```

This is a real request, not a dry run. Inspect HTTP acceptance and confirm the
owner's wake separately. A worker should not run it unless explicitly authorized.

## VPS: load only the selected path

Install Node.js 24+ and Git on the VPS, and install the reviewed helper there.
Keep a separate project-owned env file on that host; the Mac's private env does
not travel through Git. For a canonical checkout at `/srv/projects/my-project`,
run the same configuration block above from that checkout, as the account that
runs Limen. That account needs read access to the mode-600 file.

A service or noninteractive shell should supply an absolute path rather than
source the credential file or depend on login-shell exports:

```sh
cd /srv/projects/my-project
export LIMEN_FINISH_WEBHOOK_ENV=/srv/projects/my-project/.limen/finish-webhook.env
"$HOME/.overment/tony-finish-ping.sh" vps-setup-check done "$(git branch --show-current)"
```

For a project-specific systemd unit, the equivalent nonsecret setting is:

```ini
[Service]
WorkingDirectory=/srv/projects/my-project
Environment=LIMEN_FINISH_WEBHOOK_ENV=/srv/projects/my-project/.limen/finish-webhook.env
# Include the directory containing Node.js 24+ if it is not installed in /usr/bin.
Environment=PATH=/usr/local/bin:/usr/bin:/bin
```

Do not install this override in a shared service handling unrelated projects.
The automatic caller must select each project's own config. No `EnvironmentFile`
is required: the helper reads the selected dotenv file itself, including the
space in `Bearer …`.

## Private env format

The env file is dotenv **data**, not a sourced shell script. Use assignments,
optional `export`, comments and literal single/double-quoted values. Do not use
shell expansion, command substitution, shell-escaped spaces or executable setup
commands. Exported URL/auth variables are not a substitute for a selected file.

```dotenv
LIMEN_FINISH_WEBHOOK_URL='https://your-endpoint.example.invalid/finish'
LIMEN_FINISH_WEBHOOK_AUTH='Bearer REPLACE_WITH_TOKEN'
```

`AUTH` is the complete header value, including exactly `Bearer ` followed by a
nonempty token using `A-Z a-z 0-9 - . _ ~ + /` and optional trailing `=` padding.
Basic, raw tokens, extra whitespace, newlines and missing credentials fail before
sending. The URL must use HTTPS, without embedded username/password or fragment.
Response bodies, URLs and credential values are never printed by the helper.
Do not enable runtime network tracing, put secrets in command arguments, or
paste private env contents into job logs.

Only `LIMEN_FINISH_WEBHOOK_*` keys work; there are no aliases. Callers and manual
launchers that select a file set `LIMEN_FINISH_WEBHOOK_ENV`. A file with only
the retired `TONY_*` URL/auth keys fails before any request, and the error names
the `LIMEN_FINISH_WEBHOOK_*` key it needs. The retired `TONY_*` env-path override
is ignored; normal project selection (or the standalone outside-Git home
default) still applies. Limen installation never reads or rewrites private env
files or launcher settings; operators update their own. A job keeps the config
path recorded at spawn, so that file must use the current keys when the job
finishes.

## Two bots on one project

Set `LIMEN_FINISH_WEBHOOK_TARGETS` in the same private env file to a nonempty JSON
array of `{url, auth}` objects. This explicit list **replaces** the single-target
URL/auth pair; it never appends an implicit recipient or falls back to one.
The same HTTPS and Bearer validation applies to every target. Unknown object
fields, malformed JSON, an empty list or any invalid target fail before any send.
The setting is read from the selected file, not inherited from the process env.

```dotenv
LIMEN_FINISH_WEBHOOK_TARGETS='[{"url":"https://your-endpoint.example.invalid/bots/grok-one/finish","auth":"Bearer FIRST_BOT_TOKEN"},{"url":"https://your-endpoint.example.invalid/bots/grok-two/finish","auth":"Bearer SECOND_BOT_TOKEN"}]'
```

These URLs are placeholders, **not a Grok Bot API definition**. Obtain each bot's
authorized wake route from its operator. The route (URL and/or credential) must
select the intended bot and turn the `{job, status, branch}` payload into a wake.
A shared endpoint that merely logs events or always wakes one fixed bot does not meet
that contract. Limen does not infer recipients from a model or display name, nor
does it invent a bot/session field for an unknown receiver API. If another bot should
also receive the finish, include its destination explicitly as another entry.

To send a ticket finish only to that author's bots, add `LIMEN_FINISH_WEBHOOK_AUTHOR_TARGETS`
in the same private file. Keys are lowercase `@login` or `*`; values are nonempty lists of
distinct target numbers from the configured list (single URL/AUTH is target 1).
Spawn records the ticket creation `@login` from GitHub noreply evidence, or an unavailable
reason; continuations inherit that snapshot. At send time an exact login match is used
exclusively, otherwise `*` if present, otherwise the finish is skipped. An empty or invalid
map is not permission to broadcast: nothing is sent, and the job result is unchanged.
Without the map, every target still receives every finish. Filtered receipts keep original
ordinals — selecting 1 and 3 does not renumber 3 as 2.

```dotenv
LIMEN_FINISH_WEBHOOK_TARGETS='[{"url":"https://bots.example.invalid/alice-primary","auth":"Bearer ALICE_PRIMARY_TOKEN"},{"url":"https://bots.example.invalid/alice-secondary","auth":"Bearer ALICE_SECONDARY_TOKEN"},{"url":"https://bots.example.invalid/bob","auth":"Bearer BOB_TOKEN"}]'
LIMEN_FINISH_WEBHOOK_AUTHOR_TARGETS='{"@alice":[1,2],"@bob":[3]}'
```

A wake reports the finish; it does not transfer ownership. Manual retry must pass
`LIMEN_FINISH_WEBHOOK_AUTHOR` from the job's `finish-webhook-author` file (first line when it
is `@login`). Standalone sends without that snapshot use fallback or skip, never a guessed human.

Manual output identifies targets by their one-based list position only:
`finish webhook: target 2 accepted (HTTP 204); owner wake unobserved`.
Exit 0 requires HTTP acceptance from **all** targets. One failure yields exit 1
after the other requests settle. No URLs or credentials appear in output, and no
response body reaches stdout or stderr. Automatic delivery tracks each target
separately. A target that accepted, or refused for good, never gets the ping
again: each resend names those targets in `LIMEN_FINISH_WEBHOOK_SKIP`, and the
sender drops them. Only targets with no answer, or a retryable answer, are tried
again. See [the delivery queue](#delivery-queue).

### Prove wake, not just HTTP

Use a unique probe label with the selected project config and retain the safe
sender results. Then inspect **each intended bot's session** for a new completed
turn that references that exact label and the original status/branch. Record the
bot identity, session/turn address, and observed response separately from the
HTTP status. Two 2xx responses, two request-log entries or one bot's response are
not evidence that two bots woke. If a receiver accepts HTTP but produces no
matching turn, record its wake as unobserved and repair its wake route before
calling delivery proven. This repository's synthetic tests never prove a live
Grok Bot wake; that requires the authorized endpoints and session observations.

## Install the reviewed helper

The repository file is the only sending implementation. Keep the reviewed Limen
package installed at a stable path. Automatic finalization invokes that package's
`bin/tony-finish-ping.sh` directly, never the legacy home launcher.

Existing worker briefs may call `~/.overment/tony-finish-ping.sh` from inside Git
without an explicit override, deliberately relying on home config. Replacing
that path with the strict canonical helper would break those callers. Preserve
it as a thin launcher that selects the legacy manual default and execs the
absolute installed canonical executable. For an installation at
`$HOME/.overment/limen`:

```sh
mkdir -p "$HOME/.overment"
cat > "$HOME/.overment/tony-finish-ping.sh" <<'SH'
#!/bin/sh
export LIMEN_FINISH_WEBHOOK_ENV="${LIMEN_FINISH_WEBHOOK_ENV-$HOME/.overment/tony-finish-webhook.env}"
exec "$HOME/.overment/limen/bin/tony-finish-ping.sh" "$@"
SH
chmod 755 "$HOME/.overment/tony-finish-ping.sh"
```

If Limen is installed elsewhere, set the `exec` target to that absolute installed
path. This wrapper contains no HTTP, auth or JSON implementation. The `-` rather
than `:-` default preserves an explicitly empty override, which the canonical
helper rejects instead of falling back. Legacy manual home selection is an
intentional compatibility exception; it does not opt any project into automation.

Direct replacement of the legacy path is **opt-in only**, after migrating every
caller to the canonical strict selection rules or an explicit project override;
it is not a drop-in migration:

```sh
# Only after all legacy callers have been migrated:
install -m 755 bin/tony-finish-ping.sh "$HOME/.overment/tony-finish-ping.sh"
```

No env file is installed or copied by these commands. Installation and private
configuration belong to the operator/coordinator, not implementation workers.
The canonical helper can also run directly from the checkout; it does not need
the rest of Limen beside it.

## Automatic job delivery

A project opts in when `limen spawn` selects a config:

- An explicit `LIMEN_FINISH_WEBHOOK_ENV` resolves relative to the spawn directory
  and is stored as an absolute path. An explicitly empty value disables automatic
  delivery; it is never passed to the helper. A nonempty missing path is retained
  so completion records a visible sender failure, not a fallback destination.
- Otherwise, opt in only if `.limen/finish-webhook.env` exists in the primary Git
  worktree. A linked worktree uses that primary checkout, not its local `.limen`
  directory. For a non-Git workspace, use the coordinator directory's config,
  not an immediate child repository's destination.
- Without either selection, do not invoke the sender. Automatic delivery never
  looks up home config. Keep overrides project-specific, not in a global shell
  or shared service configuration.

Only the selected path is written to the mode-600 job file `finish-webhook-env`;
credentials remain in the private dotenv file and are read by the helper at
completion. `limen continue` preserves its parent's selected path **or absence**,
regardless of the continuation caller's environment. A fresh `spawn --branch`
selects config at spawn as usual. Existing jobs without a snapshot stay opted out.
For unusual separate Git-directory layouts, an explicit override avoids differing
standalone-helper and primary-worktree discovery locations.

Installing the helper alone does not opt in a project: inspect a newly spawned
job's `finish-webhook-env` before expecting automatic delivery. A legacy home
config is not a project opt-in, and historical jobs are not retrofitted.

When an opted-in job ends, Limen sends its label, `done`/`failed`/`stopped`
state and branch. Each job rings once for its final state, even when another job
finishes at the same Git tip. Sender failure never changes the job outcome or
coordinator wake subscriptions. The job detail view repeats the state-derived
handoff beside the finish receipt, including when webhook delivery is
unconfigured or skipped.

A configured `failed` or `stopped` job always sends, also when its `result` file
is missing or empty. Its `reason` is the finish detail: the failed gate, for
example `timeout after 5400000ms`, `hosted start failed: …`, or `group deadline
or stop`. A `done` job's `reason` is the first text line of its `result`, without
leading Markdown markers such as `#` or `-`, or the finish detail when there is
no result. The reason does not affect native coordinator notifications or
terminal state.

Routine workers should omit a manual finish-ping before exit or `finish`:
automation handles configured jobs. A coordinator uses the deliberate fallback
in [Inspect failures and deliberately retry](#inspect-failures-and-deliberately-retry)
after a failed or absent automatic send, never as a routine duplicate.

### Delivery queue

Every plant ping is queued on disk before any send. This covers a job finish
(`job.done`, `job.failed`, `job.stopped`, `job.timed-out`, `job.stalled`), the
`job.stalled` advisory while a job runs, `coordinator.idle`,
`coordinator.exited`, and `lead.step-done`. The queue entry is `finish-webhook-queue` (JSON) in the ping's
receipt folder. An index file `.limen/outbox/<event-id>` names that folder.

Finalization does not wait for HTTP. It queues the ping in milliseconds and
returns, so the job's shutdown grace does not bound delivery. A detached
deliverer, the internal command `limen webhook deliver <receipt-folder>`, holds
`finish-webhook-lease` (its pid) and runs the sender once per try. One try may
take up to 30 seconds. The sender keeps its own 10-second limit per request.

A target is tried again when it gives no answer (timeout, network error, or a
killed sender) or answers 408, 429 or 5xx. The backoff starts at 5 seconds and
grows three times each try, to at most 10 minutes. `LIMEN_WEBHOOK_RETRY_MS`
sets the base. The deliverer sleeps through a backoff of at most 2 minutes.
After a longer backoff it exits. Then the next `limen` command run in the plant,
`limen sweep`, or the coordinator's wake hook (every 30 seconds) starts a
deliverer for each due entry whose lease holder is dead. A deliverer killed
mid-try is replaced the same way. After 24 hours the queue gives up and records
`failed: gave up after N tries in 24 h; last: …`.

Any other answer (3xx or another 4xx) is final for that target. The target gets
the ping once and the receipt records
`failed: target N HTTP 404 "<body>"; not retried`.

Each request carries the payload's `finishEvent` as the header
`Idempotency-Key`. It is stable per job and event. A repeat can happen only when
a deliverer is killed after the receiver accepted but before the receipt was
written. The receiver can drop that repeat by its key.

## Lead group steps

The interactive coordinator that leads a group (`LIMEN_COORDINATOR=1`, not
`LIMEN_JOB=1`) sends one finish webhook when a lead turn finishes a group step.
A step is a turn that created or changed `group/synthesis.md` in the feature
folder of a group this session leads, or a turn that closed that group. A
synthesis older than the run's start is not a step. Mid-turn tool messages and
failed or aborted turns send nothing.

The notice uses the same sender, project opt-in, and payload fields as a `done`
job. `job` names the feature and the step, for example `F757 lead synthesis` or
`F757 lead close`. `branch` is the lead checkout's branch. `handoff` reads
`Lead step done: <job>. Next step: owner decision on group/synthesis.md, or
close the group.` (or `owner decision` after close) for every feature. It never
says "land it".

Each step sends once. A second idle turn, a pane reload, or the same synthesis
content again sends nothing. A project without a selected config sends nothing
and records no receipt.

## Plant events

The same sender, env file, target list, and author map carry every event that a
plant's shepherd must see. A plant whose env file has only the single
URL/AUTH pair needs no change. One event sends one ping.

| `event` | `status` | Sent when | `reason` |
| --- | --- | --- | --- |
| `job.done` | `waiting` | a job finishes done | first result text line, or the finish detail |
| `job.failed` | `failed` | a job fails | the finish detail (the failed gate) |
| `job.timed-out` | `failed` | a detached job reaches `--timeout` | `timeout after Nms` |
| `job.stalled` | `failed` | a detached job's tool stalls and the job ends | `stalled tool …` |
| `job.stalled` | `stalled` | a hosted job's supervisor writes an idle, blocked, or errored advisory while the session stays open | the advisory line |
| `job.stopped` | `stopped` | a job is stopped | the stop reason |
| `coordinator.idle` | `idle` | a coordinator turn ends, is not aborted, and no running job it owns will wake it | `turn ended` or `last turn failed`, then `; last message: <first line>` |
| `coordinator.exited` | `exited` | the sweep finds a registered coordinator process gone without the hook's shutdown mark | pid and the tool it was running |
| `lead.step-done` | `waiting` | a lead group step (see above) | the step |
| `webhook.test` | `test` | `limen webhook test` | host and time |

A sample `job.failed` body:

```json
{
  "job": "F781 plant webhook events",
  "status": "failed",
  "branch": "limen/2026-10-05-f781-plant-webhook-events-1a2b3c4d",
  "finishEvent": "limen-finish-<sha256>",
  "handoff": "Job failed or stopped; inspect the job record before proceeding",
  "event": "job.timed-out",
  "plant": "chilly",
  "title": "F781 plant webhook events",
  "jobId": "2026-10-05-f781-plant-webhook-events-1a2b3c4d",
  "reason": "timeout after 5400000ms"
}
```

`job` and `title` both carry the label; `job` stays for existing receivers.
Coordinator events set `jobId` to the coordinator's session id and `title` to
its session name, or `coordinator <pane>`, followed by ` · F123` once a last
message names a feature. `handoff` names the next step for each kind. A
`job.stalled` ping goes only while the job is still running; a hosted session
that closes clean and idle sends only `job.done`. A supervisor that restarts on
a standing advisory of the same kind does not ping again.

A coordinator turn ends at Pi's `agent_settled`. Each turn sends at most one
ping: a second end without a new assistant message sends nothing. The last message is the first text line of the turn's last
assistant message, without Markdown markers, up to 200 characters.

Coordinator events come from the wake hook, which every plant loader already
loads, in an interactive session with `LIMEN_COORDINATOR=1` or a Herdr pane
(`HERDR_ENV=1` and `HERDR_PANE_ID`). A coordinator that exits without a normal
exit sends one `coordinator.exited`, also `signal: sighup` from a closed pane: a
missed crash costs more than one extra ping. A process that died with no exit
record, such as `SIGKILL`, reads `exited without a session shutdown (killed or
crashed)`. The reason ends with the tool in flight, for example
`while running bash: limen land 2026-10-05-f781 --yes`.

### Rolling out to a plant

- The env file and the target list do not change.
- Job events start with the next `limen` process: the shared install updates on
  merge, and running hosted supervisors keep their loaded code until their job ends.
- Coordinator events start after the plant's coordinator reloads its hooks, so the
  wake hook registers it. A running coordinator keeps the hook it loaded at
  start. Reload when the coordinator is idle: quit it and resume its session in
  the same pane (`pi --session <session-id>`);
  do not kill a working agent.
- Exit detection needs `limen sweep --install` on the machine. Check with
  `launchctl list | grep limen-sweep`.

Send one test ping to the plant's targets from the plant root:

```sh
limen webhook test
```

The output is the sender's per-target lines, for example
`finish webhook: accepted (HTTP 204)`. HTTP acceptance is not proof that a bot woke.
With an author map and no `*` route, the test reports `not sent: no author route`.

## Inspect failures and deliberately retry

In single-target mode, exit 0 prints `finish webhook: accepted (HTTP NNN)`
for 200–299 only. Other responses print `finish webhook: HTTP NNN rejected` and
exit 1. An explicit target list prints one indexed result per destination and
exits 0 only when all are accepted. Redirects are not
followed. Network errors print `request failed`; a stalled request is forcibly
bounded to 10 seconds and prints `request timed out after 10000ms`. Git lookup
has a separate two-second limit. Config/usage errors exit 1 before transport.
The response body never goes to stdout or stderr. For a refusal, the private
receipt pipe records up to 160 printable characters of the body, with the
target's token replaced by `[auth]` and its URL by `[url]`.

`limen jobs <id>` (compact and human views) separates:

- **Configured:** whether the job recorded a selection; not a validity check.
  Inspection never opens the selected env file.
- **Transport:** each target's standing. An acceptance holds; otherwise the
  newest receipt shows: accepted for HTTP 2xx, rejected for other codes, unknown
  for a network error, a timeout, or a try without a result. No per-target
  evidence, including older aggregate-only jobs, means unknown.
- **Bot-turn:** observed only for a correlated completed-turn export from the
  operator-selected source described below; otherwise unobserved. Each target
  is independent of HTTP and the aggregate. HTTP success, run IDs, local flags
  and response-body claims cannot promote this field. Observed means a matching
  trusted export was inspected, not that Limen authenticated its origin.

The aggregate receipt is shown separately, including its manual-send guidance.
Do not substitute `notify/delivered/*/accepted`: those are native Pi injection
records, not HTTP receipts or external Grok Bot acknowledgements. Multiple
native delivery slots may simply be different subscribed coordinators.
A receiver run ID is also not a completed bot turn. When recording a manual
send, capture the helper's own exit status; a later successful shell command
must not hide a failed ping.

| Job file | Meaning |
|---|---|
| `finish-webhook-env` | Selected absolute private env path only; absence means not opted in. |
| `finish-webhook-author` | Captured `@login` and creation commit, or `unavailable` and a short reason. Continuations inherit it. |
| `finish-webhook-route` | Send-time selection reason and original ordinals (`fan-out`, `mapped @login -> …`, `fallback * -> …`, skip, or invalid map). No URLs or tokens. |
| `tip` | Worktree HEAD at finalize; informational, not a delivery claim. |
| `finish-webhook-attempt` | Flushed final state and timestamp claiming this job's one finish delivery decision, including a skip; never reclaimed. The queue still retries after the claim, so the claim does not mean "never retried". |
| `finish-webhook-queue` | The queued ping (JSON) that the deliverer sends. `.limen/outbox/<event-id>` names this folder. |
| `finish-webhook-lease` | The pid of the deliverer that owns the queue entry. A dead pid lets the next sweep start a new deliverer. |
| `finish-webhook` | First line: `queued <iso>`, then `queued: try N <result>; next try <iso>`, then a final `accepted: every target accepted after N tries (owner wake unobserved)`, `failed: …`, or `skipped: …`. Following lines: one per try (`try N: <result> <iso>`), the last 20. A failed job finish adds one manual-send line. |
| `finish-webhook-targets` | Mode-600 JSON lines: target ordinal, timestamp, transport (`pending`, `accepted`, `rejected`, `unknown`), exact HTTP status (`503`) or `none`; older lines keep `2xx`/`4xx`. A refusal line adds `body` (redacted, at most 160 characters). |
| `state` / `finished-at` | Job outcome and completion time, independent of delivery success. |

`accepted: every target accepted after N tries (owner wake unobserved)` means
the canonical sender reported HTTP success for all selected targets, not an
observed bot wake. A `queued:` line means delivery is still in progress: wait
for its next try. A final `failed:` line names the cause without exposing sender
output: 24 hours of retryable failures, a final refusal, a launch failure, or an
invalid recorded path. Repeated or concurrent finalization never reclaims the
claim and never queues a second ping. A `skipped` aggregate means no sender ran
for that decision, even though the claim exists. A terminal job without a claim
can also mean the finalizer died before deciding delivery; wait for
finalization to settle before deciding it needs a manual send.

To inspect without printing config, set `job` to the absolute job directory:

```sh
job=/absolute/project/.limen/jobs/JOB_ID
for record in state finished-at finish-webhook-author finish-webhook-route finish-webhook-attempt finish-webhook-queue finish-webhook-lease finish-webhook finish-webhook-targets; do
  if [ -f "$job/$record" ]; then printf '%s: ' "$record"; cat "$job/$record"; fi
done
```

Send manually only after the receipt's final line is `failed:`. While it says
`queued`, the queue still owns delivery. Run this from the installed Limen package.
It uses the recorded path and original fields, never a home fallback or a
replacement `done` state for a failed job:

```sh
LIMEN_FINISH_EVENT="$(node --input-type=module -e 'import { finishEvent } from "./src/integrations/finish-receipt.ts"; console.log(finishEvent(process.argv[1]))' "$job")" \
LIMEN_FINISH_WEBHOOK_ENV="$(tr -d '\n' < "$job/finish-webhook-env")" \
LIMEN_FINISH_WEBHOOK_AUTHOR="$(sed -n '1p' "$job/finish-webhook-author")" \
LIMEN_FINISH_MESSAGE_FILE="$job/result" \
  bin/tony-finish-ping.sh "$(tr -d '\n' < "$job/label")" \
  "$(tr -d '\n' < "$job/state")" "$(tr -d '\n' < "$job/branch")"
result=$?
printf 'finish sender exit=%s\n' "$result"
```

A manual send does not rewrite the automatic receipt. Record its sanitized
stdout/stderr and exit status in the handoff, not the private config. If the job
never opted in, the operator must explicitly authorize a project-specific config
before using the fallback; do not select a home destination on its behalf.
For a standalone manual request without a Limen job record:

```sh
LIMEN_FINISH_WEBHOOK_ENV=/absolute/project/.limen/finish-webhook.env \
  "$HOME/.overment/tony-finish-ping.sh" 'original-label' 'failed' 'original-branch'
result=$?
printf 'finish sender exit=%s\n' "$result"
```

The manual helper does not retry and has no queue. A timeout can happen after
the server accepted the request, so a manual send may produce a duplicate; it
carries the same `Idempotency-Key` when `LIMEN_FINISH_EVENT` is set. HTTP
acceptance and each observed bot wake must be recorded as separate facts. Do
not delete a claim or a queue entry to force a resend.

## Diagnose `[unauthenticated]` without changing the wrong credential

A Grok Bot routine failure is not itself a Limen HTTP receipt. The sender never
reads response bodies and cannot emit `[unauthenticated] Error`. First correlate
the exact probe `job`, `status`, `branch`, send timestamp and receiver run; a
notification title alone does not identify which request failed.

| Evidence | Boundary and next action |
|---|---|
| No `finish-webhook-env` on the job | Project opt-in absent; no automatic HTTP request was selected. Configure only the authorized project, then inspect a fresh spawn. Home config does not count. |
| Helper rejects the Bearer value before transport | Local config syntax. Supply the complete `Bearer …` value in the selected private file; do not source it or put credentials in argv. |
| Helper reports HTTP 401 or 403 | Receiver ingress rejected the request. Its operator must verify the selected route, current webhook credential and receiver access policy. Syntax validation cannot prove a key is current. Any ping refused this way, also a coordinator's, writes `.limen/webhook-rejected`, and `limen status` shows `Finish webhook rejects: invalid key` until a later ping that every target accepts, or a passing `limen webhook test`. |
| Helper reports HTTP 2xx; the matching routine later reports `[unauthenticated]` | HTTP accepted, routine failed downstream. Inspect the failing receiver step and its account/provider/integration authentication. Do not assume rotating the ingress webhook key repairs routine credentials. |
| HTTP 2xx with no matching completed turn | Wake unobserved, not delivered. Verify receiver routing and inspect the intended bot's session, not just a run ID. |
| `request failed`, timeout, or HTTP 408/429/5xx | Transport failure; acceptance may be unknown. The queue retries it with backoff. Act only after a final `failed: gave up after …` line, and inspect the receiver first. |
| One indexed target rejected while another accepted | Partial fan-out. The accepted target is never sent again. A 3xx or other 4xx is final; read its redacted `body` in `finish-webhook-targets`, fix that route, then send manually to it only. |
| Exit 127 | Launcher/runtime failure, not an HTTP status. Check executable paths and Node availability in the caller's actual noninteractive environment. |
| Automatic `sender exited 1` only | Aggregate failure, insufficient to diagnose auth. It may be config, HTTP rejection, network failure or partial fan-out. Do not infer 401 from it. |

Check a manual launcher's runtime **without sending**, in the same environment
that failed:

```sh
command -v node
node --version
"$HOME/.overment/tony-finish-ping.sh"
result=$?
printf 'launcher preflight exit=%s (expected 1 with usage)\n' "$result"
```

No arguments causes the canonical helper to print usage and exit 1 before reading
config or sending. Exit 127 instead commonly means a missing launcher target or
Node. On an NVM Mac, a service with only `/usr/bin:/bin` normally cannot find
Node; add the actual Node 24+ installation directory to that **service's** PATH.
An interactive shell succeeding does not prove a launch agent or worker shell
has the same PATH. Preserve the thin launcher's explicit manual-home selection;
do not repair PATH by copying credentials or enabling unrelated projects.

Keep the actual helper exit, safe HTTP status, and matching completed bot turn as
three separate facts. Do not print env contents or receiver response bodies to
diagnose a failed routine. If no authorized receiver history is available, ask
its operator for the failed run address and failing step, with secrets removed.
A fresh webhook key is appropriate only after ingress authentication is
identified as the problem; a receiver-side provider login is a different repair.

## Receiver-exported completed turns: file exchange v1

Inspection opts in only through `LIMEN_FINISH_EVIDENCE_DIR`, an **absolute local
directory** explicitly designated by the operator invoking `limen jobs`. Empty,
relative, absent or unreadable selections leave turns unobserved. There is no
home, project or job-file discovery, and this variable does not configure sending.
Do not set it globally for unrelated projects. Use a separate directory per proof
job so the ordinal mapping cannot drift when a private target list changes.

The operator controls the source directory and its `receivers.json`, confirming
ordinals against that job's selected private target order. Receiver owners export
only actual completed turns into it (or the operator imports their authorized
exports through a separately verified channel). Do not designate a worker-writable
job/worktree as trusted. Protect the directory and its parents with local access
controls; do not let unrelated writers replace it. This is an explicit trust
choice, **not cryptographic proof of origin**. Anyone able to write this source
can forge matching exports. Limen validates structure and correlation, not the
truth of history; the owner/reviewer must follow the referenced session/turn.

The operator writes `receivers.json` (maximum 16 KiB):

```json
{"version":1,"targets":[{"target":1,"receiver":"review-bot"},{"target":2,"receiver":"owner-bot"}]}
```

Use the actual authorized mapping, not assumed names or order. It has 1–64 unique
integer targets in 1–64. Each receiver is a nonsecret stable identity agreed with
its owner. Unknown fields or any invalid/duplicate mapping reject the whole map.

For each mapped target, its owner supplies a file named
`<finishEvent>.<target>.json` (maximum 4096 bytes), with exactly these fields:

```json
{"version":1,"event":"limen-finish-REPLACE_WITH_EXACT_64_LOWERCASE_HEX","target":1,"receiver":"review-bot","state":"completed","session":"OWNER_SESSION_REFERENCE","turn":"OWNER_COMPLETED_TURN_REFERENCE","completedAt":"2026-09-11T12:00:00.000Z"}
```

This is a format example, **not evidence**. `event`, `target` and `receiver` must
match the inspected job, filename and operator map. `state` must be `completed`;
a queued/running/failed run is not a completed turn. `completedAt` is the actual
completion time in canonical UTC ISO format with milliseconds. Receiver, session
and turn identifiers are 1–96 characters: first ASCII alphanumeric, then ASCII
alphanumeric, `_` or `-`. Owners may provide stable sanitized aliases with a
separate private lookup if native references contain other characters. No URLs,
credentials, excerpts, raw bodies, extra fields or local `observed` flags belong
in this contract. Never place secrets even in the allowed identifier fields.

Export atomically: write a temporary regular file, then rename into place after
completion. Inspection reads at most 64 fixed filenames; it never scans history,
opens a receiver connection or waits in the finalizer. Oversized, malformed,
nonregular and symlink files are rejected. Missing, incomplete and mismatched
exports leave that target unobserved without suppressing other targets. No files
or claims are written by inspection. Removing the source/export makes subsequent
inspection unobserved again; retain exports beside review evidence.

Both detail views show the matching receiver/session/turn/time and
`observed (operator-trusted export)`, even if HTTP was rejected or unknown.
The aggregate sender receipt does not change and may still say `owner wake
unobserved`: it records what the sender knew then, not later receiver completion.
Legacy `finish-webhook-bot-turn` and local source-selection flags are ignored.

## Finished receiver-owned proof

The receiver-owned proof is finished. On the VPS, one automatic delivery to
the first bot showed HTTP accepted with the bot turn unobserved while its export was
held, then observed for target 1 after release, with no second send. The record
is the [bot-turn receipt outcome](../spec/features/done/2026-09/F091-finish-job-shows-bot-turn-receipt/outcome.md).
Do not repeat that proof for ordinary setup.

## Checks

```sh
node --test test/u2-webhook-trust.test.ts test/s7-webhooks.test.ts
```

`test/u2-webhook-trust.test.ts` runs the real sender helper with synthetic env
files: a bad credential, destination, target list or author map sends nothing,
no run prints a secret, and the private receipt channel drops malformed and
secret-bearing lines. `test/s7-webhooks.test.ts` runs real jobs on a throwaway
plant: an unconfigured job sends nothing, a finished job pings only the target
its ticket author maps to, a failed job with an empty result still sends one
ping, a continuation keeps the parent's route, and the secret appears only in
the `Authorization` header. Both answer requests from the test plant's
intercepted transport; no real endpoint is called.

## How it works

You do not need these mechanics to configure or inspect a webhook. They explain
how Limen selects a file, sends, and records the result.

- **Standalone selection:** how a manual helper call finds its env file. It is
  fail-closed, in this order:
  1. If `LIMEN_FINISH_WEBHOOK_ENV` is set, it must be an **absolute env-file
     path**. Empty, relative, unreadable or invalid overrides fail; they never
     fall back.
  2. Inside Git, resolve `git rev-parse --git-common-dir` to its real path. The
     selected file is `.limen/finish-webhook.env` beside that directory: for
     `/srv/project/.git`, use `/srv/project/.limen/finish-webhook.env`. Linked
     worktrees and their subdirectories therefore use the canonical checkout's
     file, not a worker's local `.limen` file. Missing/invalid project config
     fails; it does not inherit a home destination. For separate Git-directory
     layouts, use an explicit override if this location is not the intended
     project root.
  3. Only a manual invocation **outside Git** can use the legacy
     `~/.overment/tony-finish-webhook.env` fallback. Git errors other than “not
     a git repository” fail instead of selecting a different destination.
- **Finalization:** the step that ends a job. Both hosted supervisors and
  detached wrappers queue the ping after writing durable terminal state; a
  detached deliverer then runs the package's canonical `bin/tony-finish-ping.sh`.
  The label, state and branch pass
  unchanged as three arguments; only the outgoing `done` payload uses
  `status: "waiting"`. The handoff note in the job view does not change
  transport receipts, routing, or the job state. The caller prepends the
  directory of Limen's running Node executable to the helper's `PATH`, so a
  noninteractive environment missing that directory can still launch the
  sender. Manual launchers still need Node.js 24+ on `PATH`.
- **Delivery claim:** the job's `finish-webhook-attempt` file. It records the
  terminal state and claims the one finish delivery decision. The claim is
  never reclaimed, and a later result edit or a repeated finalization does not
  queue a second ping. The queue retries after the claim. Older
  `.limen/finish-webhook-tips/<sha>` markers are ignored and no new tip markers
  are written.
- **Delivery queue:** the disk record that owns delivery after a ping is
  queued: `finish-webhook-queue`, `finish-webhook-lease`, and the index
  `.limen/outbox/<event-id>`. One try may take up to 30 seconds. Backoff starts
  at 5 seconds, grows three times each try to at most 10 minutes, and stops
  after 24 hours. Job shutdown never waits for it.
- **Fan-out:** sending to several targets at once. Every request starts before
  the sender waits for results, so a failed or stalled first bot does not
  suppress delivery to the second. The standalone bound remains 10 seconds per
  request, concurrent rather than multiplied by recipient count. A killed
  request may already have been accepted; the `Idempotency-Key` header lets the
  receiver drop a repeat.
- **Transport acceptance:** an HTTP 2xx response from a target. It proves only
  that the endpoint took the request, not that a bot woke.
- **Receipt pipe:** a private channel from the sender to Limen. Automatic
  delivery discards sender stdout/stderr. The pipe records only allowlisted
  target ordinals (1–64), UTC timestamps, transport states, exact HTTP status
  codes, and for a refusal up to 160 printable characters of the body with the
  token replaced by `[auth]` and the URL by `[url]`. It never records raw URLs,
  auth, or labels from config. Selections larger
  than 64 targets fail validation before any request. Each validated target is
  recorded as pending before concurrent requests start; each result is flushed
  independently. The parent consumes at most 32 KiB and keeps at most a start
  and one result per target. Killing a stalled sender does not erase another
  target's acceptance.
- **Finish event identity:** the `finishEvent` field. Automatic payloads retain
  `job` (the label) and `branch`, map a completed job to `status: "waiting"`
  plus `jobState: "done"`, and add `finishEvent`: `limen-finish-` plus the
  lowercase SHA-256 of the job directory's basename (the job ID). This identity
  is stable across paths and seats; it is not an authentication token. Each
  request also sends it as the `Idempotency-Key` header, so a receiver can drop
  a repeat. All configured targets get the same identity.
  Continuations have new job IDs and therefore new events. Manual sends omit
  correlation unless `LIMEN_FINISH_EVENT` is supplied in this format; the
  job-based manual-send example above preserves it.
- **Lead step claim:** the record that makes a lead step send once. The hook
  compares the synthesis file and the run's `closed` flag at each turn end.
  Each step is claimed once under
  `.limen/groups/GROUP-ID/lead-steps/<step>/finish-webhook-attempt`, with the
  result in `finish-webhook` beside it. The sender reads the handoff text from
  `LIMEN_FINISH_HANDOFF`, which lead steps and non-terminal events set; a
  terminal job never sets it.
- **Coordinator registration:** the record that lets Limen send coordinator
  events. The wake hook registers the session under
  `.limen/coordinators/<session-id>/` with its pid, process start time, pane,
  title, and the tool it is running. Coordinator pings and their
  receipts live in `.limen/coordinator-events/<session-id>/<event>.<claim>/`,
  outside the registration, so a queued ping survives the coordinator's exit or
  resume. Job stall receipts stay in the job's `events/` folder.
- **Exit detection:** how the sweep notices a dead coordinator. Process exit
  needs no code in the dead process. Each `limen sweep` pass (the installed
  LaunchAgent runs it every 60 seconds) checks every registration. When the
  recorded pid is gone or now belongs to another process, a Pi shutdown mark
  removes the registration silently. Any other exit queues one
  `coordinator.exited`, then removes the registration.
