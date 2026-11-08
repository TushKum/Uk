-- One row per external model request made by the live agent provider (success or failure).
-- Deterministic demo decisions make no external calls and are not recorded here.
CREATE TABLE ll_model_usage (
 id uuid PRIMARY KEY, campus_id text NOT NULL REFERENCES ll_campuses(id), job_id uuid REFERENCES ll_jobs(id), run_id text,
 provider text NOT NULL, model text NOT NULL, provider_request_id text,
 status text NOT NULL CHECK (status IN ('success','error')), error_class text,
 input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0), output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
 latency_ms double precision NOT NULL CHECK (latency_ms >= 0), cost_usd numeric(12,6) CHECK (cost_usd >= 0),
 input_usd_per_million numeric(12,6), output_usd_per_million numeric(12,6), tool text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ll_model_usage_recent ON ll_model_usage(campus_id, created_at DESC);
CREATE INDEX ll_model_usage_job ON ll_model_usage(job_id);
CREATE TRIGGER ll_model_usage_immutable BEFORE UPDATE ON ll_model_usage FOR EACH ROW EXECUTE FUNCTION ll_immutable_event();
ALTER TABLE ll_model_usage ENABLE ROW LEVEL SECURITY;
