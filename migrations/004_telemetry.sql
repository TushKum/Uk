-- Real device telemetry. Stored separately from simulated scenario readings (ll_readings),
-- which are regenerated per scenario generation. Device readings are never rewritten by
-- the simulation and are never used as input to the simulated investigation engine.
CREATE TABLE ll_devices (
 id uuid PRIMARY KEY, campus_id text NOT NULL REFERENCES ll_campuses(id),
 name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120), building_id text NOT NULL, meter text CHECK (length(meter) <= 60),
 unit text NOT NULL DEFAULT 'L/min' CHECK (unit IN ('L/min')),
 min_value double precision NOT NULL DEFAULT 0 CHECK (min_value >= 0),
 max_value double precision NOT NULL DEFAULT 2000 CHECK (max_value > min_value),
 key_hash text NOT NULL UNIQUE, key_prefix text NOT NULL,
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
 created_by text NOT NULL REFERENCES ll_users(id), created_at timestamptz NOT NULL DEFAULT now(),
 rotated_at timestamptz, revoked_at timestamptz, last_seen_at timestamptz,
 CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);
CREATE INDEX ll_devices_building ON ll_devices(campus_id, building_id);

CREATE TABLE ll_device_readings (
 id bigserial PRIMARY KEY, campus_id text NOT NULL REFERENCES ll_campuses(id), device_id uuid NOT NULL REFERENCES ll_devices(id),
 building_id text NOT NULL, observed_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
 value double precision CHECK (value >= 0), quality text NOT NULL CHECK (quality IN ('valid','missing','faulty')),
 quality_reason text, message_id text CHECK (length(message_id) <= 100),
 source text NOT NULL DEFAULT 'device' CHECK (source = 'device'),
 CHECK (quality <> 'valid' OR value IS NOT NULL),
 UNIQUE (device_id, observed_at)
);
CREATE UNIQUE INDEX ll_device_readings_message ON ll_device_readings(device_id, message_id) WHERE message_id IS NOT NULL;
CREATE INDEX ll_device_readings_building_time ON ll_device_readings(campus_id, building_id, observed_at DESC, id DESC);
CREATE INDEX ll_device_readings_device_time ON ll_device_readings(device_id, observed_at DESC, id DESC);
CREATE INDEX ll_device_readings_received ON ll_device_readings(received_at);

-- Readings are immutable once accepted; deletion is allowed only for retention.
CREATE FUNCTION ll_readings_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Device readings are immutable'; END $$;
CREATE TRIGGER ll_device_readings_no_update BEFORE UPDATE ON ll_device_readings FOR EACH ROW EXECUTE FUNCTION ll_readings_immutable();

CREATE TABLE ll_ingest_batches (
 id uuid PRIMARY KEY, campus_id text NOT NULL REFERENCES ll_campuses(id), device_id uuid NOT NULL REFERENCES ll_devices(id),
 received_at timestamptz NOT NULL DEFAULT now(), submitted integer NOT NULL, accepted integer NOT NULL, duplicates integer NOT NULL,
 conflicts integer NOT NULL, rejected integer NOT NULL, flagged integer NOT NULL, detail jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX ll_ingest_batches_device ON ll_ingest_batches(device_id, received_at DESC);

ALTER TABLE ll_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE ll_device_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ll_ingest_batches ENABLE ROW LEVEL SECURITY;
