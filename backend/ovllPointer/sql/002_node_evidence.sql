-- vNext node evidence extension; apply after 001_initial.sql.
-- Additive migration. No legacy tables are touched.
ALTER TABLE ov_run_queue ADD COLUMN IF NOT EXISTS execution_token text;
ALTER TABLE ov_runs ADD COLUMN IF NOT EXISTS requester_ref text;
ALTER TABLE ov_attempts ADD COLUMN IF NOT EXISTS node_id text;
ALTER TABLE ov_attempts ADD COLUMN IF NOT EXISTS definition_ref jsonb;
ALTER TABLE ov_attempts ADD COLUMN IF NOT EXISTS input_refs jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE ov_attempts ADD COLUMN IF NOT EXISTS output_refs jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE ov_attempts ADD COLUMN IF NOT EXISTS lease_token text;
CREATE UNIQUE INDEX IF NOT EXISTS ov_attempt_one_generation
  ON ov_attempts(workspace_id,run_id,node_id,plan_epoch,generation);
CREATE TABLE IF NOT EXISTS ov_value_artifacts (
  workspace_id text NOT NULL,
  value_id text NOT NULL,
  run_id text NOT NULL,
  attempt_id text NOT NULL,
  node_id text NOT NULL,
  output_port text NOT NULL,
  representation text NOT NULL,
  value jsonb NOT NULL,
  source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  validation_status text NOT NULL DEFAULT 'contract_validated'
    CHECK (validation_status IN ('contract_validated','externally_verified')),
  semantic_role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,value_id),
  FOREIGN KEY (workspace_id,attempt_id) REFERENCES ov_attempts(workspace_id,attempt_id),
  FOREIGN KEY (workspace_id,run_id) REFERENCES ov_runs(workspace_id,run_id)
);
CREATE INDEX IF NOT EXISTS ov_artifacts_from_attempt
  ON ov_value_artifacts(workspace_id,run_id,node_id,attempt_id);

CREATE UNIQUE INDEX IF NOT EXISTS ov_attempt_one_running_node
  ON ov_attempts(workspace_id,run_id,node_id,plan_epoch) WHERE status='running';
CREATE UNIQUE INDEX IF NOT EXISTS ov_artifact_one_port
  ON ov_value_artifacts(workspace_id,attempt_id,output_port);
