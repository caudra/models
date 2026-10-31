export const meta = {
    name: "model-watch",
    description: "Once a day, sync origin/main, survey model changes, apply confirmed data updates, validate, and open or update a pull request",
    timezone: "UTC",
    triggers: [
        { kind: "schedule", every: "30m" },
        { kind: "armed" },
        { kind: "goal_finished", verdicts: ["met", "impossible", "cleared", "stalled"] },
        { kind: "idle" },
    ],
    args: {
        start_hour: { type: "int", default_value: 7, min: 0, max: 23, description: "UTC hour from which the daily run may start" },
        first_since: { type: "string", default_value: "2026-10-01", description: "Survey start date (YYYY-MM-DD) of the first run. Later runs start at the date of the last completed run" },
        continuation_limit: { type: "int", default_value: 40, min: 1, max: 100, description: "Automatic continuations each step's goal may take" },
        step_notice_hours: { type: "int", default_value: 6, min: 1, max: 168, description: "Hours a step's goal may stay open before you are told it may be looping" },
    },
};

const PASSING_ERRORS = ["rate_limit", "overloaded", "timeout", "network"];
const NEXT_STEP: Record<string, string> = { sync: "survey", survey: "apply", apply: "validate", validate: "land" };

const t = now();
const today = t.date;
let step: string | undefined = state.step;
const goalOptions = { continuation_limit: args.continuation_limit };

if (event.trigger === "schedule") {
    if (state.halted === true) skip("halted: arm model-watch again to resume");
    if (step === "land") {
        if (state.landing === true) {
            const quiet = event.session.status === "idle" && t.unix - (state.land_sent ?? 0) > 3600;
            if (!quiet) skip("landing in progress");
            await log("the landing request got no answer within an hour, asking again");
        }
        await askToLand(event.fire_id);
        return;
    }
    if (step != null) {
        const gone = event.session.goal === null && event.session.status === "idle" && t.unix - event.session.status_since > 7200;
        if (!gone) {
            const started = state.step_at ?? t.unix;
            if (state.stuck_notice !== started && t.unix - started > args.step_notice_hours * 3600) {
                state.stuck_notice = started;
                await notify(`model-watch's ${step} step of the ${state.run} run has had its goal open for over ${args.step_notice_hours} hours, so it may be looping. Check the session: /goal clear stops the step, and arming model-watch again retries it.`);
                return;
            }
            skip(`the ${step} step is in progress`);
        }
        state.halted = true;
        await notify(`model-watch stopped: the ${step} goal of the ${state.run} run ended without finishing. Arm model-watch again in /automations to retry the step.`);
        return;
    }
    if (state.run === today) skip("today's run is done");
    if (t.hour < args.start_hour) skip(`before ${args.start_hour}:00`);
    const blocked = blocker(event.session);
    if (blocked !== null) {
        if (state.nagged === today) skip(blocked);
        state.nagged = today;
        await notify(`model-watch cannot start today's run: ${blocked}.`);
        return;
    }
    state.run = today;
    state.since = state.last_landed ?? args.first_since;
    state.step = "sync";
    await startStep("sync");
} else if (event.trigger === "goal_finished") {
    if (state.current == null || event.condition !== state.current) skip("not a model-watch goal");
    if (event.verdict === "stalled") {
        if (state.step_at != null && state.stuck_notice === state.step_at) skip("already told that this step is stuck");
        state.stuck_notice = state.step_at ?? null;
        await notify(`model-watch's ${step} step of the ${state.run} run stopped making progress, and its goal stays open. Check the session: a reply there lets it go on, /goal clear stops the step, and arming model-watch again retries it.`);
        return;
    }
    state.current = null;
    if (event.verdict !== "met") {
        state.halted = true;
        await notify(`model-watch stopped at the ${step} step of the ${state.run} run: the goal was ${event.verdict}. Fix what blocked it, then arm model-watch again in /automations.`);
        return;
    }
    const next = NEXT_STEP[step ?? ""] ?? "land";
    state.step = next;
    if (next !== "land") {
        await startStep(next);
        return;
    }
    state.step_at = null;
    await askToLand(event.fire_id);
} else if (event.trigger === "idle") {
    const started = event.started_by;
    if (step !== "land" || state.landing !== true || started.kind !== "automation" || started.fire_id !== state.land_fire) {
        skip("not a landing turn");
    }
    state.landing = null;
    if (event.outcome !== "completed") {
        if (event.error_kind !== null && PASSING_ERRORS.includes(event.error_kind)) {
            skip("the landing turn hit a passing error, the next check asks again");
        }
        state.halted = true;
        await notify(`model-watch could not land the ${state.run} run: the turn ended ${event.outcome}. Arm model-watch again in /automations to retry.`);
        return;
    }
    const reply = event.last_response.trim();
    const landed = reply.matches("(^|\\n)MODEL-WATCH LAND: PR https://github\\.com/caudra/models/pull/[1-9][0-9]*$");
    if (!landed && !reply.matches("(^|\\n)MODEL-WATCH LAND: NOTHING$")) {
        state.halted = true;
        await notify(`model-watch could not land the ${state.run} run. The transcript says why. Arm model-watch again in /automations to retry.`);
        return;
    }
    const review = reply.contains("MODEL-WATCH REVIEW");
    state.last_landed = state.run;
    state.step = null;
    state.land_fire = null;
    state.land_sent = null;
    const report = `reports/${state.run}.md`;
    if (landed && review) {
        await notify(`model-watch opened or updated the ${state.run} model update PR, and some findings need a person. See ${report}.`);
    } else if (landed) {
        await notify(`model-watch opened or updated the ${state.run} model update PR. See ${report}.`);
    } else if (review) {
        await notify(`model-watch found nothing to land on ${state.run}, and some findings need a person. See ${report}.`);
    } else {
        await log("nothing to land");
    }
} else if (event.trigger === "armed") {
    if (event.reason !== "manual") {
        if (step === "land") state.landing = null;
        skip(`armed on ${event.reason}, the next check carries on`);
    }
    state.halted = null;
    if (step === "land") {
        await askToLand(event.fire_id);
        return;
    }
    const blocked = blocker(event.session);
    if (blocked !== null) {
        await notify(`model-watch cannot run: ${blocked}. Fix that, then arm it again.`);
        return;
    }
    if (step == null) {
        state.run = today;
        state.since = state.last_landed ?? args.first_since;
        step = "sync";
        state.step = step;
    }
    await startStep(step);
}

async function startStep(name: string) {
    state.current = (await set_goal(goalFor(name, state.run, state.since), goalOptions)).condition;
    state.step_at = t.unix;
}

async function askToLand(fireId: string) {
    await message(landMessage(state.run));
    state.landing = true;
    state.land_fire = fireId;
    state.land_sent = t.unix;
}

function blocker(session: SessionView): string | null {
    if (session.goal !== null) return "another goal is active";
    if (session.autopilot === null) return "autopilot is not engaged, run /autopilot";
    if (session.mode !== "build") return "the session is not in Build mode";
    return null;
}

function goalFor(name: string, run: string, since: string): string {
    const report = `reports/${run}.md`;
    const branch = `model-watch/${run}`;
    const lead = `model-watch run ${run}, `;
    switch (name) {
        case "sync":
            return lead + `step 1 of 4, sync: verify that this checkout's origin is github.com/caudra/models. Stop if it is not. Fetch origin/main. On a clean checkout, create ${branch} from origin/main if it does not exist, or switch to it and merge origin/main if it does. Resolve conflicts on this run branch only. Never discard, stash, or commit unrelated changes. Never switch or write another checkout. The branch must contain origin/main, and \`make check\` must pass. Do not push in this step.`;
        case "survey":
            return lead + `step 2 of 4, survey: load the model-updates skill. Run \`make import\`, then \`make audit SINCE=${since} OUT=${report}\`. Read every provider page in the skill, including every decision-model source. Expand the report with each confirmed change, each older unlisted model, and every decision-model difference regardless of release date. Mark findings apply, due, or unconfirmed. Put unconfirmed findings under "For a person". The import may change import/ and dist/. Do not edit curated providers yet. A survey with no findings meets this step.`;
        case "apply":
            return lead + `step 3 of 4, apply: settle every apply row of ${report} using the model-updates skill. Edit providers/<slug>.json with source and note, or decision-models.json with source. Use requires tokens for behaviour that needs newer Caudra code. Accept deliberate catalog differences in audit/accepted.json. Run \`make build\` and \`make check\`, and commit each provider separately on ${branch}. Commit the reviewed catalog import separately. Include generated dist/ and schema/ files in each commit that changes them. Update the report with what changed or why it did not. Leave unconfirmed rows for a person. No release notes or Caudra code belong in this repository. The checkout must be clean apart from ignored reports and tools. No apply rows is a normal success.`;
        default:
            return lead + `step 4 of 4, validate: \`make check\` and \`make test\` pass on a clean HEAD of ${branch}. The report ${report} records the results and every unresolved finding. Fix failures on this branch before landing. If a change cannot pass, revert that change with a commit and explain it under "For a person". Never push main.`;
    }
}

function landMessage(run: string): string {
    const branch = `model-watch/${run}`;
    const report = `reports/${run}.md`;
    return `Open or update a pull request for model-watch run ${run}. End your reply with exactly one marker as the last line, without backticks or bold.\n`
        + `1. Verify origin is github.com/caudra/models, the current branch is ${branch}, and the checkout is clean. Fetch origin/main. If it is not an ancestor of HEAD, merge origin/main on this run branch, resolve conflicts, then run \`make check\` and \`make test\` again. Any failure stops here with MODEL-WATCH LAND: FAILED.\n`
        + `2. If \`git diff --quiet origin/main...HEAD\` succeeds, end with MODEL-WATCH LAND: NOTHING.\n`
        + `3. Otherwise run \`git push --set-upstream origin HEAD:refs/heads/${branch}\`. Never push main, another branch, or tags. Never force-push. If the push fails, stop with MODEL-WATCH LAND: FAILED.\n`
        + `4. Query \`gh pr list --repo caudra/models --head ${branch} --base main --state open --json number,url\`. If a PR exists, use \`gh pr edit <number> --repo caudra/models --body-file ${report}\`. Otherwise use \`gh pr create --repo caudra/models --base main --head ${branch} --title 'Model updates ${run}' --body-file ${report}\`. Then run \`gh pr view <url> --repo caudra/models --json url,state,headRefName,baseRefName\` and check that the state is OPEN, the head is ${branch}, and the base is main. End with MODEL-WATCH LAND: PR <url> only after that check passes, with the url it printed. Any gh failure or mismatch ends with MODEL-WATCH LAND: FAILED. Do not merge the PR.\n`
        + `Put MODEL-WATCH REVIEW just before the final marker when ${report} lists findings for a person. Never perform the git or gh operations outside this data repository. The complete report is the PR body.`;
}
