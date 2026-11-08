# Three-minute demo: a repair report is not proof

Use the password accounts in `.local-accounts.json`. For a smooth timed presentation, use separate browser profiles for manager, technician and operator; tabs in the same profile share a login session. The API and durable worker must both be running (`npm run local`).

**0:00–0:25 · Set up**
Sign in as the operator (`operator@evergreen.local`). Open Demo controls, choose D (Repair reported, anomaly persists), and reset. Keep the clock paused. Point out SIMULATION and deterministic demo labels. All people and readings are fictional. Account authentication, database writes and queued jobs are real local application behavior.

**0:25–0:55 · Investigate**
As manager (`ava@evergreen.local`), open Incidents and Run investigation. The API returns a queued job and the worker checkpoints tool results. Show meter evidence, schedule, reports and maintenance checks in the timeline. Elevated flow is an observation; a leak remains a hypothesis. Review the versioned inspection proposal and Approve & assign.

**0:55–1:35 · Technician report**
As Ravi (`ravi@evergreen.local`), open Technician view. Accept, check the three inspection items, and save: “Meter WM-001 shows sustained flow; visible water observed near an accessible fixture. Cause remains uncertain.” Submit: “Simulated authorized work reported complete; independent verification requested.” The work order moves to Awaiting verification, not Closed.

**1:35–2:10 · Independent evidence**
As operator advance +60 simulated minutes. As manager open Verification and Evaluate fresh readings. Four valid post-report readings remain abnormal. The job records anomaly persists, keeps the incident open and returns to investigation. The prior work report and assignment history remain in Postgres.

**2:10–2:40 · Adapt**
Open Incidents. Show the unresolved anomaly, current plan and follow-up proposal. Further work requires a new manager approval tied to the evidence revision. A technician's report cannot authorize closure, and a technician account cannot approve another role's action.

**2:40–3:00 · Evidence of reliability**
Open Evaluation lab. Show the synthetic evaluation and persisted agent run. State that results are deterministic simulation measurements, not field savings or live model performance. For a recovery extension, stop the worker, queue a job, reload the page and restart the worker; queued work remains available.
