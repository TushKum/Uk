-- Production account lifecycle: invitations, password recovery, managed sessions and SSO identities.
-- Additive only. Existing users, sessions and campus history are preserved.
ALTER TABLE ll_users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE ll_users ADD COLUMN password_changed_at timestamptz;
ALTER TABLE ll_users ADD COLUMN sso_issuer text;
ALTER TABLE ll_users ADD COLUMN sso_subject text;
ALTER TABLE ll_users ADD COLUMN created_by text REFERENCES ll_users(id);
ALTER TABLE ll_users ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE ll_users ADD CONSTRAINT ll_users_sso_pair CHECK ((sso_issuer IS NULL) = (sso_subject IS NULL));
CREATE UNIQUE INDEX ll_users_sso_identity ON ll_users(sso_issuer, sso_subject) WHERE sso_subject IS NOT NULL;

ALTER TABLE ll_sessions ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE ll_sessions ADD CONSTRAINT ll_sessions_public_id UNIQUE(id);
ALTER TABLE ll_sessions ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE ll_sessions ADD COLUMN user_agent text CHECK (length(user_agent) <= 200);
ALTER TABLE ll_sessions ADD COLUMN auth_method text NOT NULL DEFAULT 'password' CHECK (auth_method IN ('password','sso','demo','invitation','reset'));
ALTER TABLE ll_sessions ADD COLUMN revoked_reason text;
CREATE INDEX ll_sessions_active ON ll_sessions(user_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE ll_invitations (
 id uuid PRIMARY KEY, campus_id text NOT NULL REFERENCES ll_campuses(id),
 email text NOT NULL CHECK (email = lower(email)), name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
 role text NOT NULL CHECK (role IN ('manager','technician','operator')), technician_id text,
 token_hash text NOT NULL UNIQUE, invited_by text NOT NULL REFERENCES ll_users(id),
 expires_at timestamptz NOT NULL, accepted_at timestamptz, accepted_user_id text REFERENCES ll_users(id),
 revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (technician_id IS NULL OR role = 'technician'),
 CHECK (NOT (accepted_at IS NOT NULL AND revoked_at IS NOT NULL))
);
CREATE UNIQUE INDEX ll_one_open_invitation ON ll_invitations(campus_id, email) WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE TABLE ll_password_resets (
 id uuid PRIMARY KEY, token_hash text NOT NULL UNIQUE, user_id text NOT NULL REFERENCES ll_users(id),
 requested_by text REFERENCES ll_users(id), expires_at timestamptz NOT NULL, used_at timestamptz,
 invalidated_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ll_password_resets_user ON ll_password_resets(user_id) WHERE used_at IS NULL AND invalidated_at IS NULL;

CREATE TABLE ll_oidc_states (
 state_hash text PRIMARY KEY, nonce text NOT NULL, code_verifier text NOT NULL,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

-- Security-relevant account events survive scenario resets and cannot be edited.
CREATE TABLE ll_account_events (
 id bigserial PRIMARY KEY, campus_id text NOT NULL REFERENCES ll_campuses(id), actor_id text, subject_user_id text,
 event text NOT NULL, detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ll_account_events_recent ON ll_account_events(campus_id, created_at DESC);
CREATE TRIGGER ll_account_events_immutable BEFORE UPDATE OR DELETE ON ll_account_events FOR EACH ROW EXECUTE FUNCTION ll_immutable_event();

ALTER TABLE ll_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ll_password_resets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ll_oidc_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE ll_account_events ENABLE ROW LEVEL SECURITY;
