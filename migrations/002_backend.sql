CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE ll_campuses (id text PRIMARY KEY, name text NOT NULL);
CREATE TABLE ll_runtime (
 campus_id text PRIMARY KEY REFERENCES ll_campuses(id), generation uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>0), simulated_at bigint NOT NULL,
 scenario text NOT NULL CHECK(scenario IN('A','B','C','D','E','F')), running boolean NOT NULL DEFAULT false,
 last_tick bigint NOT NULL, metadata jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE ll_users (
 id text PRIMARY KEY, campus_id text NOT NULL REFERENCES ll_campuses(id), email text NOT NULL UNIQUE CHECK(email=lower(email)),
 name text NOT NULL, role text NOT NULL CHECK(role IN('manager','technician','operator')),
 password_hash text NOT NULL, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ll_sessions (
 token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES ll_users(id),
 expires_at timestamptz NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ll_sessions_user ON ll_sessions(user_id);
CREATE TABLE ll_login_limits (key text PRIMARY KEY, failures integer NOT NULL DEFAULT 0, window_at timestamptz NOT NULL DEFAULT now(), locked_until timestamptz);
CREATE TABLE ll_rate_limits (key text PRIMARY KEY, count integer NOT NULL, window_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE ll_buildings (
 campus_id text NOT NULL REFERENCES ll_campuses(id), generation uuid NOT NULL, id text NOT NULL, ordinal integer NOT NULL,
 name text NOT NULL, meter text NOT NULL, expected_low double precision NOT NULL CHECK(expected_low>=0),
 expected_high double precision NOT NULL CHECK(expected_high>=expected_low), payload jsonb NOT NULL,
 PRIMARY KEY(campus_id,generation,id), UNIQUE(campus_id,generation,meter)
);
CREATE TABLE ll_readings (
 campus_id text NOT NULL, generation uuid NOT NULL, id text NOT NULL, ordinal integer NOT NULL, building_id text NOT NULL,
 observed_at bigint NOT NULL, value double precision CHECK(value>=0), quality text NOT NULL CHECK(quality IN('valid','missing','faulty')), payload jsonb NOT NULL,
 PRIMARY KEY(campus_id,generation,id), FOREIGN KEY(campus_id,generation,building_id) REFERENCES ll_buildings(campus_id,generation,id),
 CHECK(quality<>'valid' OR value IS NOT NULL)
);
CREATE INDEX ll_readings_window ON ll_readings(campus_id,generation,building_id,observed_at DESC);
CREATE TABLE ll_technicians (
 campus_id text NOT NULL, generation uuid NOT NULL, id text NOT NULL, ordinal integer NOT NULL,
 name text NOT NULL, available boolean NOT NULL, payload jsonb NOT NULL,
 PRIMARY KEY(campus_id,generation,id), FOREIGN KEY(campus_id) REFERENCES ll_campuses(id)
);
CREATE TABLE ll_incidents (
 campus_id text NOT NULL, generation uuid NOT NULL, id text NOT NULL, ordinal integer NOT NULL, building_id text NOT NULL,
 state text NOT NULL CHECK(state IN('Detected','Investigating','Awaiting evidence/approval','Assigned','In progress','Awaiting verification','Ready for closure','Closed')),
 evidence_version integer NOT NULL CHECK(evidence_version>0), detected_at bigint NOT NULL, proposal_id text, verification_id text, payload jsonb NOT NULL,
 PRIMARY KEY(campus_id,generation,id), FOREIGN KEY(campus_id,generation,building_id) REFERENCES ll_buildings(campus_id,generation,id)
);
CREATE TABLE ll_evidence (
 campus_id text NOT NULL, generation uuid NOT NULL, id text NOT NULL, ordinal integer NOT NULL, building_id text NOT NULL,
 kind text NOT NULL, observed_at bigint NOT NULL, body text NOT NULL, payload jsonb NOT NULL,
 PRIMARY KEY(campus_id,generation,id), FOREIGN KEY(campus_id,generation,building_id) REFERENCES ll_buildings(campus_id,generation,id)
);
CREATE TABLE ll_proposals (
 campus_id text NOT NULL, generation uuid NOT NULL, id text NOT NULL, ordinal integer NOT NULL, incident_id text NOT NULL,
 version integer NOT NULL CHECK(version>0), evidence_version integer NOT NULL CHECK(evidence_version>0),
 kind text NOT NULL CHECK(kind IN('dispatch','reassign','close')), status text NOT NULL CHECK(status IN('pending','approved','rejected','superseded')),
 technician_id text, payload jsonb NOT NULL, PRIMARY KEY(campus_id,generation,id), UNIQUE(campus_id,generation,incident_id,version),
 FOREIGN KEY(campus_id,generation,incident_id) REFERENCES ll_incidents(campus_id,generation,id),
 FOREIGN KEY(campus_id,generation,technician_id) REFERENCES ll_technicians(campus_id,generation,id)
);
CREATE TABLE ll_verifications (
 campus_id text NOT NULL, generation uuid NOT NULL, id text NOT NULL, ordinal integer NOT NULL, incident_id text NOT NULL,
 outcome text NOT NULL CHECK(outcome IN('improvement observed','anomaly persists','insufficient evidence')),
 coverage double precision NOT NULL CHECK(coverage BETWEEN 0 AND 1), mean double precision, evaluated_at bigint NOT NULL, payload jsonb NOT NULL,
 PRIMARY KEY(campus_id,generation,id), FOREIGN KEY(campus_id,generation,incident_id) REFERENCES ll_incidents(campus_id,generation,id)
);
CREATE TABLE ll_work_orders (
 campus_id text NOT NULL, generation uuid NOT NULL, id text NOT NULL, ordinal integer NOT NULL, incident_id text NOT NULL,
 building_id text NOT NULL, technician_id text NOT NULL,
 status text NOT NULL CHECK(status IN('Assigned','In progress','Awaiting verification','Verified','Needs investigation')),
 due_at bigint NOT NULL, payload jsonb NOT NULL,
 PRIMARY KEY(campus_id,generation,id), UNIQUE(campus_id,generation,incident_id),
 FOREIGN KEY(campus_id,generation,incident_id) REFERENCES ll_incidents(campus_id,generation,id),
 FOREIGN KEY(campus_id,generation,building_id) REFERENCES ll_buildings(campus_id,generation,id),
 FOREIGN KEY(campus_id,generation,technician_id) REFERENCES ll_technicians(campus_id,generation,id)
);
CREATE UNIQUE INDEX ll_one_active_assignment ON ll_work_orders(campus_id,generation,technician_id) WHERE status IN('Assigned','In progress');
CREATE TABLE ll_work_order_events (
 campus_id text NOT NULL, generation uuid NOT NULL, id text NOT NULL, ordinal integer NOT NULL, work_order_id text NOT NULL,
 simulated_at bigint NOT NULL, body text NOT NULL, payload jsonb NOT NULL,
 PRIMARY KEY(campus_id,generation,id), FOREIGN KEY(campus_id,generation,work_order_id) REFERENCES ll_work_orders(campus_id,generation,id)
);
CREATE TABLE ll_evidence_requests (
 campus_id text NOT NULL, generation uuid NOT NULL, id text NOT NULL, ordinal integer NOT NULL, incident_id text NOT NULL,
 status text NOT NULL CHECK(status IN('open','received')), payload jsonb NOT NULL,
 PRIMARY KEY(campus_id,generation,id), FOREIGN KEY(campus_id,generation,incident_id) REFERENCES ll_incidents(campus_id,generation,id)
);
CREATE TABLE ll_agent_runs (
 campus_id text NOT NULL, generation uuid NOT NULL, id text NOT NULL, ordinal integer NOT NULL, incident_id text NOT NULL,
 mode text NOT NULL CHECK(mode IN('demo','live')), status text NOT NULL CHECK(status IN('queued','running','completed','failed','bounded','cancelled')),
 steps integer NOT NULL CHECK(steps BETWEEN 0 AND 16), payload jsonb NOT NULL,
 PRIMARY KEY(campus_id,generation,id), FOREIGN KEY(campus_id,generation,incident_id) REFERENCES ll_incidents(campus_id,generation,id)
);
CREATE TABLE ll_tool_executions (
 campus_id text NOT NULL, generation uuid NOT NULL, id text NOT NULL, ordinal integer NOT NULL, run_id text NOT NULL, incident_id text NOT NULL,
 tool text NOT NULL, status text NOT NULL CHECK(status IN('success','error')), elapsed_ms double precision NOT NULL CHECK(elapsed_ms>=0), payload jsonb NOT NULL,
 PRIMARY KEY(campus_id,generation,id), FOREIGN KEY(campus_id,generation,run_id) REFERENCES ll_agent_runs(campus_id,generation,id)
);
CREATE TABLE ll_audit_events (
 campus_id text NOT NULL REFERENCES ll_campuses(id), generation uuid NOT NULL, id text NOT NULL, ordinal integer NOT NULL,
 actor text NOT NULL, simulated_at bigint NOT NULL, body text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(), payload jsonb NOT NULL,
 PRIMARY KEY(campus_id,generation,id)
);
CREATE FUNCTION ll_immutable_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Audit and assignment history are append-only'; END $$;
CREATE TRIGGER ll_audit_immutable BEFORE UPDATE OR DELETE ON ll_audit_events FOR EACH ROW EXECUTE FUNCTION ll_immutable_event();
CREATE TRIGGER ll_work_history_immutable BEFORE UPDATE OR DELETE ON ll_work_order_events FOR EACH ROW EXECUTE FUNCTION ll_immutable_event();
CREATE TABLE ll_jobs (
 id uuid PRIMARY KEY, campus_id text NOT NULL, generation uuid NOT NULL, incident_id text NOT NULL, run_id text NOT NULL,
 requested_by text NOT NULL REFERENCES ll_users(id), status text NOT NULL CHECK(status IN('queued','running','completed','failed','cancelled')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3), decisions integer NOT NULL DEFAULT 0 CHECK(decisions BETWEEN 0 AND 8),
 history jsonb NOT NULL DEFAULT '[]', lease_token uuid, lease_until timestamptz, error text,
 available_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(campus_id,generation,incident_id) REFERENCES ll_incidents(campus_id,generation,id),
 FOREIGN KEY(campus_id,generation,run_id) REFERENCES ll_agent_runs(campus_id,generation,id)
);
CREATE UNIQUE INDEX ll_one_active_job ON ll_jobs(campus_id,generation,incident_id) WHERE status IN('queued','running');
CREATE INDEX ll_jobs_claim ON ll_jobs(status,available_at,lease_until);
CREATE TABLE ll_command_receipts (
 command_id text PRIMARY KEY, campus_id text NOT NULL REFERENCES ll_campuses(id), actor_id text NOT NULL,
 action text NOT NULL, request_hash text NOT NULL, job_id uuid REFERENCES ll_jobs(id), revision integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ll_worker_heartbeats (id text PRIMARY KEY, seen_at timestamptz NOT NULL DEFAULT now());
DO $$ DECLARE t record; BEGIN FOR t IN SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename LIKE 'll_%' LOOP EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t.tablename); END LOOP; END $$;
-- No public/anon policies. A trusted server connection owns these tables; browsers never access Postgres directly.

ALTER TABLE ll_incidents ADD CONSTRAINT ll_current_proposal_fk FOREIGN KEY(campus_id,generation,proposal_id) REFERENCES ll_proposals(campus_id,generation,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ll_incidents ADD CONSTRAINT ll_current_verification_fk FOREIGN KEY(campus_id,generation,verification_id) REFERENCES ll_verifications(campus_id,generation,id) DEFERRABLE INITIALLY DEFERRED;
