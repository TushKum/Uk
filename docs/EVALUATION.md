# Evaluation protocol

## Dataset and labels

`evaluation/fixtures.json` contains 24 labelled synthetic fixtures: four variants in each of A–F. The first three per family form the 18-case development set; the fourth forms a six-case held-out subset. Held-out fixtures are not used in policy condition selection; they vary magnitude, missing-data patterns or report count. This is a small within-family holdout, not a claim of independent real-world generalization. Labels are human-authored by this prototype's scenario design.

A/C/D/F are labelled actionable flow anomalies; B is explained scheduled demand; E is a telemetry-quality problem, not a labelled leak. “False alarm” means a repair/inspection dispatch recommendation for a non-actionable-flow label; quality evidence requests are tracked as appropriate actions rather than counted as leak alerts. “Missed anomaly” means no dispatch recommendation for a true actionable-flow label.

## Same inputs, frozen baseline

Each evaluator loads identical seeded readings, schedules, complaints, maintenance data, report/decline events, and post-repair readings. The threshold baseline reads the same initial meter window: any valid flow >38 L/min in the last three hours triggers an immediate work order. It does not consult schedules, deduplicate related complaints, handle reassignment or check independent post-repair evidence. Its closure rule is a technician's completion report. The evaluator models those baseline rules directly; it is not a second deployed product. This deliberately simple baseline is documented for transparency and must not be described as representative of every existing facilities system.

The agent runs the actual deterministic provider, tool executor and state machine from the app. The harness simulates manager review (5, 10 or 15 operational minutes), technician acceptance/notes/completion, and 60 minutes of post-report readings. No language model or real human is evaluated. Dispatch latency is measured from seeded detection time zero to approved work order creation; the baseline has zero simulated review delay. This delay is a fixture assumption, not a measured human response time. Model latency is zero and API cost is zero in deterministic mode.

## Metrics

- False alarms and missed anomalies: counts under the dispatch definition above.
- Time to actionable work order: simulated minutes, only for cases that create an order; missing values remain null.
- Correct reassignment: Maya selected after Ravi declines, with one retained work order and assignment history.
- Incorrect closure: scenario D closed despite contradictory post-report readings.
- Successful completion: A/F human-confirmed closure with one order; B explained and manager-confirmed closure without dispatch; C reassignment followed by verified closure; D remains open with persistence identified; E requests manual evidence without dispatch.
- Actual execution time: `performance.now()` in milliseconds for the harness or engine, separate from simulated operational time. This excludes browser, DB and live API overhead; small timings should not be read as application response-time claims.
- Tool calls: actual persisted tool attempt counts. Live latency, usage and cost are not measured; the live adapter records them when used and cost is null without explicit rates.

## Reproduce

Run `npm run evaluate`. It writes detailed per-case measurements and separate development/held-out aggregates to `evaluation/results.json`, and the same report to `public/evaluation-results.json` for the UI. No DB state is changed by the evaluator. The workflow tests separately cover retries, stale approvals, prompt-injection text, assignment conflicts and missing verification data. See `docs/VALIDATION.md` for the measured run and its limits.

No avoided-water-loss estimate is generated. No field deployment or water-saving claim is supported by these synthetic results.
