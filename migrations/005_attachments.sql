-- Evidence attachments (inspection photos and documents). File bytes live in configured
-- object storage; this table holds provenance, integrity hashes and access metadata.
CREATE TABLE ll_attachments (
 id uuid PRIMARY KEY, campus_id text NOT NULL, generation uuid NOT NULL, incident_id text NOT NULL, work_order_id text,
 kind text NOT NULL CHECK (kind IN ('photo','document')),
 content_type text NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp','application/pdf','text/plain')),
 declared_type text, original_name text NOT NULL CHECK (length(original_name) BETWEEN 1 AND 200),
 size_bytes bigint NOT NULL CHECK (size_bytes > 0), sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
 storage_driver text NOT NULL CHECK (storage_driver IN ('local','s3')), storage_key text NOT NULL UNIQUE,
 description text CHECK (length(description) <= 500),
 uploaded_by text NOT NULL REFERENCES ll_users(id), uploaded_role text NOT NULL,
 uploaded_at timestamptz NOT NULL DEFAULT now(), simulated_at bigint NOT NULL,
 incident_state text NOT NULL, provenance jsonb NOT NULL DEFAULT '{}',
 deleted_at timestamptz, deleted_by text REFERENCES ll_users(id), delete_reason text, purged_at timestamptz,
 FOREIGN KEY (campus_id, generation, incident_id) REFERENCES ll_incidents(campus_id, generation, id),
 FOREIGN KEY (campus_id, generation, work_order_id) REFERENCES ll_work_orders(campus_id, generation, id),
 CHECK ((deleted_at IS NULL) = (deleted_by IS NULL))
);
CREATE INDEX ll_attachments_incident ON ll_attachments(campus_id, generation, incident_id, uploaded_at DESC);

-- Integrity and provenance fields are write-once. Only soft deletion/purge markers may change.
CREATE FUNCTION ll_attachment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Attachment records are retained; use soft deletion'; END IF;
 IF (NEW.id, NEW.campus_id, NEW.generation, NEW.incident_id, NEW.work_order_id, NEW.kind, NEW.content_type, NEW.original_name, NEW.size_bytes, NEW.sha256, NEW.storage_driver, NEW.storage_key, NEW.uploaded_by, NEW.uploaded_at, NEW.simulated_at, NEW.provenance, NEW.description)
    IS DISTINCT FROM (OLD.id, OLD.campus_id, OLD.generation, OLD.incident_id, OLD.work_order_id, OLD.kind, OLD.content_type, OLD.original_name, OLD.size_bytes, OLD.sha256, OLD.storage_driver, OLD.storage_key, OLD.uploaded_by, OLD.uploaded_at, OLD.simulated_at, OLD.provenance, OLD.description) THEN
  RAISE EXCEPTION 'Attachment provenance is immutable';
 END IF;
 IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN RAISE EXCEPTION 'Deleted attachments cannot be restored'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ll_attachments_guard BEFORE UPDATE OR DELETE ON ll_attachments FOR EACH ROW EXECUTE FUNCTION ll_attachment_guard();
ALTER TABLE ll_attachments ENABLE ROW LEVEL SECURITY;
