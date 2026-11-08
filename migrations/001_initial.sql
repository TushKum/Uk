-- Small local prototype: one campus aggregate, locked transactionally for every mutation.
-- Works with Postgres or a Supabase Postgres connection; no public browser DB access.
CREATE TABLE IF NOT EXISTS leakloop_state (
 id integer PRIMARY KEY CHECK (id = 1),
 revision integer NOT NULL CHECK (revision > 0),
 data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS leakloop_commands (
 command_id text PRIMARY KEY,
 actor_id text NOT NULL,
 action text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE leakloop_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE leakloop_commands ENABLE ROW LEVEL SECURITY;
-- Deliberately no anon/authenticated policies. Access only through trusted server DB role.
