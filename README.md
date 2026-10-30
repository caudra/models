# caudra-models

This repository is the source of Caudra's model list. It holds the curated provider files and a
reviewed import of models.dev. `make build` turns them into `dist/v1/models.json`, which Caudra
reads from `https://models.caudra.ai/v1/models.json`.

## Set up

1. Install the `caudra-models` tool into `.tools/bin`:

	```sh
	make tool
	```

	`make tool` builds the tool from the Caudra commit pinned in `caudra.toml`. To build from a
	local Caudra checkout instead, run `make tool CAUDRA_SRC=<path to the checkout>`.

2. Optional. Install a pre-commit hook that runs `make check`:

	```sh
	make hooks
	```

Run `make help` to list every target.

## Change a model

1. Confirm the change on the provider's own page. The `model-updates` skill lists the sources and apply rules.
2. Edit `providers/<slug>.json` with a `source` URL and a `note` for non-obvious choices. The `$schema` line gives editors completion and validation.
3. Run `make build` to regenerate `dist/` and `schema/`.
4. Run `make check` and `make test`.
5. Commit the provider file and the regenerated files, and open a pull request.

`make check` fails when `dist/` or `schema/` does not match the sources, so a pull request that
skips step 3 fails CI.

`make check` also compares the data with the published file, `dist/v1/models.json` at
`origin/main`. Run `git fetch origin main` first, or set `PUBLISHED_REF=<commit>`. It fails when
a provider that the published file lists gains a provider-level `requires` token or changes its
`family`, and when a catalog routing change has no acceptance. CI fetches the full history and
compares a pull request with `origin/main`, and a push to `main` with the commit before it.

## Refresh the models.dev import

1. Run `make import`. It downloads `https://models.dev/api.json` into `.tools/`, rewrites
	`import/models-dev.json`, and runs `make build`.
2. Review `git diff import/` before you commit. Every row in the import reaches Caudra's model
	catalog.

## Audit the model data

Run `make audit SINCE=2026-10-01`. It downloads models.dev into `.tools/` and writes
`reports/<UTC date>.md`. Reports are gitignored. `OUT=<path>` chooses another output file.

To compare against a saved catalog without network access:

```sh
make audit MODELS_DEV=/path/to/models-dev.json SINCE=2026-10-01
```

`make import MODELS_DEV=<path>` also skips the download. The underlying command is
`caudra-models audit <data-dir> [--models-dev <file>] [--since DATE] [--out <file>]`.
Without `--models-dev`, it uses the reviewed `import/models-dev.json`. Without `--since`, it
separates new models from older ones at 90 days ago. Without `--out`, it prints to stdout.
The tool never accesses the network.

The report compares prices, reachable long-prompt tiers, input budgets or total context windows,
output limits, deprecations, and scheduled retirements. It also finds missing and unlisted models,
including versions that an older prefix would otherwise swallow. Decision models appear with
their source pages for manual review because models.dev does not list them.

Confirm findings on the provider's own page before editing data. `audit/accepted.json` keeps
deliberate differences in `accepted` and working-window or fallback limits in `caps`. Each row
needs a reason. `make check`, `make build`, and the audit validate this file. They reject unknown
values of `field`, unknown providers, invalid model references, duplicate rows, empty
reasons, and caps that no entry holds. Other unknown JSON keys remain forward-compatible.
The skill describes each row's fields. A changed catalog value reports again, and the old
acceptance appears as stale.

The report's "Routing changes" section compares each catalog row's `api`, `env`, and `npm` in
`import/models-dev.json` with the published file. These fields choose the URL and the API key
that Caudra sends a request with. `make import` prints the same section against the previous
import, and lists each `api` that it dropped because it is not HTTPS or HTTP to loopback. Accept
each change under `routing` in `audit/accepted.json` with `provider` (the catalog slug), `field`
(`api`, `env`, or `npm`), `catalog` (the new value as printed, `-` when removed), and `reason`.
`make check` fails while a change has no acceptance. A protected row is a built-in provider's
catalog row, or a row that lists one of that row's environment keys. Caudra keeps its bundled
routing for protected rows, so only a person accepts their changes.

## Run model-watch

The project automation owns the daily workflow. It syncs `origin/main`, runs `make import` and
`make audit`, checks the provider pages in the skill, and commits confirmed changes per provider.
It runs `make check` and `make test`, then pushes `model-watch/<UTC run date>` and opens or updates
a PR with the report as its body. A person reviews and merges the PR.

The session runs on autopilot and reads untrusted provider pages, so the run's limits must not
depend on its prompt:

- Protect `main` on GitHub. Require a pull request with an approving review and a passing `check`
	workflow, block force pushes and deletion, and apply the rules to administrators.
- Authenticate `gh` and Git with a token that can push branches and open pull requests, but cannot
	merge, bypass branch protection, or administer the repository.
- `.caudra/permissions.toml` denies the common forms of pushing `main`, force pushing, deleting
	branches, `gh pr merge`, and `gh api`. It allows one push without a prompt,
	`git push --set-upstream origin HEAD:refs/heads/model-watch/<branch>`, once you trust the
	project's permissions in `/permissions`. Every other `git push` asks. Prefix rules cannot list
	every spelling of a push, and autopilot may approve an ask once, so branch protection and the
	token remain the guard.

1. Use a dedicated clean checkout of this data repository. Its origin must be `github.com/caudra/models`.
2. Install the pinned maintainer tool with `make tool`. Until the revision in `caudra.toml` is published, use `make tool CAUDRA_SRC=<models-file checkout>`.
3. Install `gh` and authenticate it with the token described above.
4. Enable experimental automations. Set `automations = true` under `[experimental]` in your global Caudra config.
5. Start Caudra in that checkout with `caudra --autopilot` in Build mode. Review and trust `.caudra/permissions.toml` in `/permissions` and `.caudra/automations/model-watch.rhai` in `/automations`.
6. Arm it with `/automations arm model-watch {"first_since":"2026-10-01"}`. Choose your first survey date.

Keep the session open. The schedule checks every 30 minutes and starts once a day from 07:00 UTC.
Manual arming starts immediately. `start_hour`, `continuation_limit`, and `step_notice_hours`
adjust the start hour, goal continuation limit, and stuck-step notice interval. A failed step
halts until you resolve the problem and arm the script again. Editing the script requires
renewed trust. `/automations disarm model-watch` stops it.

The landing reply ends with `MODEL-WATCH LAND: PR <url>`, `MODEL-WATCH LAND: NOTHING`, or
`MODEL-WATCH LAND: FAILED`. Before it reports a PR, the landing turn runs `gh pr view` and checks
that the PR is open, from the run branch, and into `main`. The automation only reads the reply, so
this check happens in the model's turn. A successful run advances the next survey's start date. Findings
that need a person stay in the report rather than holding a goal open indefinitely.

### Replay cases

`make test` runs the pinned tool's
`caudra-models replay .caudra/automations/model-watch.rhai tests/model-watch.json` command.
It validates the script, smoke-runs its triggers, and checks every recorded firing without
performing its actions. It does not call Git, `gh`, a model, or the network.

The JSON file is an array of cases. Each has a `name`, `event`, initial `state`, `args`, and
fixed `now_ms`. `event` uses Caudra's serialized automation event shape, including `$untrusted`
tags on external text. `expected` holds the exact `end`, ordered journal `actions`, and final
`state`. Messages are compared in full. HTTP calls have stubbed responses, Git comparisons return
no repository, and topic filters match literal names in this runner.

The cases preserve the old Rust tests' daily sequencing, scheduling, stalled-goal notices,
failure recovery, and landing correlation. PR success replaces local-main fast-forward success.
Local-main busy and stale handling no longer applies. PR failure and invalid-marker cases replace
those paths. The `gh_disabled_halts` case checks a failed landing response without invoking `gh`.
When changing a prompt or transition, review and update the affected expectations, then run
`make test`. CI runs these offline tests, but it does not download or audit models.dev.

## Format rules for v1

Every Caudra release that reads v1 must keep working with every later v1 file.

- Changes are additive only. A new field is optional and has a default that keeps the old
	behaviour.
- Renaming a field, changing its type, or changing what a value means needs format v2.
- Clients ignore fields they do not know.
- If a model needs new Caudra code, list a token in the model entry's `requires`. A Caudra build
	that does not know the token hides the entry, and an explicit request for it fails with "needs
	a newer Caudra". Ship the code that handles the token in Caudra before you use the token here.
- Never add a provider-level `requires` token or change the `family` of a provider that a
	published file lists. A Caudra build that does not know the token or family drops the whole
	provider. A provider-level token is only for a new provider, before any published file lists
	it without one. `make check` enforces this rule.

### Request behaviour

These optional fields belong to each model entry. An absent field adds no special behaviour.
Serialization omits absent fields.

| Field | Meaning |
| --- | --- |
| `api` | OpenAI API selection, either `chat_completions` or `responses`. It applies to prefix matches, including dated snapshots. Coding Plan models and `-codex` IDs always use Responses. |
| `plan_context_window` | OpenAI Coding Plan entitlement and its context cap in tokens. It applies only when the ID equals one of the entry's `prefixes`. OAuth clamps the model's window to this cap. An absent field grants no entitlement, except for the `-codex` protocol rule. |
| `supports_thinking` | Z.AI thinking-support override. `true` enables support and `false` disables it. It applies only to exact IDs in `prefixes`, not dated or preview suffixes. An absent field leaves other capability sources unchanged. |

`api` is an open string enum. Clients preserve unknown values and classify the entry as unsupported
instead of guessing a request format. Unknown object fields remain ignored. The validator bounds
`plan_context_window` by the same 100,000,000-token limit as other windows.

The initial field values reproduce the ID rules in older Caudra binaries, so these entries need no
new `requires` token. A later edit that changes request behaviour must use a token if an older
binary's ID rules would send a different request. Merely adding a field does not make older
binaries understand it.

## Reference

### `updated_at`

`updated_at` is the time the content last changed. `make build` hashes the payload into
`content_sha256`. If the hash equals the one in the existing `dist/v1/models.json`, the build keeps
the old `updated_at`. Otherwise it stamps the current UTC time, or `NOW=<RFC 3339 time>` when you
pass it. A build with no content change leaves `git status` clean.

The build refuses a changed snapshot whose time is not later than the committed file's, and a
`NOW` more than 5 minutes ahead of the machine's clock. `make check` fails when the committed
file's `updated_at` is more than 5 minutes in the future. Caudra installs a downloaded file only
when it is newer than the one it has, so a time in the future would block later publishes.

### Signing

The `publish` workflow runs on every push to `main`. It checks the repository, signs
`dist/v1/models.json` with the `CAUDRA_MODELS_SIGNING_KEY` secret, and verifies the signature with
the public key in the `CAUDRA_MODELS_PUBLIC_KEY` repository variable. It uploads `models.json`,
`models.json.sig`, and `schema.json` as the `models-v1` artifact. Then it sends a
`models-published` dispatch to `caudra/infra`, which verifies the signature and deploys the
artifact to `models.caudra.ai`. The dispatch needs the `WEBSITE_DISPATCH_TOKEN` secret.

The private key never enters this repository. `.gitignore` excludes `*.pkcs8` and `*.sig`.
`caudra-models keygen <path>` creates a key pair and prints the public key and its key id.

To rotate the key:

1. Run `caudra-models keygen` to create the new key pair.
2. Add the new public key to Caudra's trusted keys next to the old one, and ship a Caudra release.
3. Wait until users run releases that trust the new key. Releases that trust only the old key
	reject a file signed with the new key.
4. Replace the secret and the repository variable with the new key pair.
5. Remove the old public key from Caudra's trusted keys in a later release.

### Make targets

| Target | What it does |
| --- | --- |
| `make tool` | Installs `caudra-models` into `.tools/bin` |
| `make check` | Validates the data, compares it with the published file at `PUBLISHED_REF` (default `origin/main`), and fails if `dist/` or `schema/` is stale |
| `make build` | Writes `dist/` and `schema/`. `NOW=` sets the time for a changed snapshot |
| `make import` | Downloads models.dev, rewrites `import/models-dev.json`, and builds |
| `make audit` | Downloads models.dev and writes `reports/<UTC date>.md`. `MODELS_DEV=`, `SINCE=`, and `OUT=` override its inputs and output |
| `make test` | Validates and replays model-watch without external actions |
| `make hooks` | Installs a pre-commit hook that runs `make check` |

### Layout

| Path | Contents |
| --- | --- |
| `caudra.toml` | The Caudra git URL, commit, toolchain, and features that `make tool` builds from |
| `providers/index.json` | The ordered list of built-in provider slugs |
| `providers/<slug>.json` | One provider. `models_from` copies another provider's models, generations, price periods, and availability |
| `decision-models.json` | The models behind decision endpoints |
| `import/models-dev.json` | The reviewed models.dev import |
| `audit/accepted.json` | Accepted catalog differences, routing changes, and deliberate caps, each with a reason |
| `.caudra/permissions.toml` | Shell rules for the model-watch session: the one allowed push and the denied pushes, deletions, and merges |
| `.caudra/skills/model-updates/SKILL.md` | Provider sources, survey instructions, and apply rules |
| `.caudra/automations/model-watch.rhai` | The daily survey, update, and PR workflow |
| `tests/model-watch.json` | Fixed automation events with expected outcomes, actions, and state |
| `reports/` | Ignored audit and survey reports |
| `schema/*.v1.json` | Generated JSON schemas for the authoring files and the snapshot |
| `dist/v1/models.json` | The built snapshot |
| `dist/v1/schema.json` | The snapshot's JSON schema |
| `.github/workflows/` | `check` runs `make check` and `make test` on pull requests and on `main`. `publish` signs and uploads |

## License

This repository is licensed under the Apache License 2.0. See `LICENSE`.

The models.dev data in `import/models-dev.json` and in the `catalog` section of
`dist/v1/models.json` keeps its upstream MIT license. See `NOTICE`.
