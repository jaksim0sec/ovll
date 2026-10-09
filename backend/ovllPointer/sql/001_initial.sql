-- Ovll vNext durable state v1; PostgreSQL 14+. Apply on a dedicated database before opt-in deployment.
-- All user-facing access MUST be workspace-scoped and authenticated by the server.
CREATE TABLE IF NOT EXISTS ov_workspaces (
  workspace_id text PRIMARY KEY,
  event_cursor bigint NOT NULL DEFAULT 0 CHECK (event_cursor >= 0)
);
CREATE TABLE IF NOT EXISTS ov_members (
  workspace_id text NOT NULL REFERENCES ov_workspaces(workspace_id),
  actor_ref text NOT NULL,
  role text NOT NULL CHECK (role IN ('viewer','editor','owner')),
  PRIMARY KEY (workspace_id, actor_ref)
);
CREATE TABLE IF NOT EXISTS ov_graphs (
  workspace_id text NOT NULL REFERENCES ov_workspaces(workspace_id),
  graph_id text NOT NULL,
  revision integer NOT NULL CHECK (revision >= 0),
  snapshot jsonb NOT NULL,
  PRIMARY KEY (workspace_id, graph_id)
);
CREATE TABLE IF NOT EXISTS ov_graph_revisions (
  workspace_id text NOT NULL,
  graph_id text NOT NULL,
  revision integer NOT NULL CHECK (revision >= 0),
  snapshot jsonb NOT NULL,
  PRIMARY KEY (workspace_id, graph_id, revision),
  FOREIGN KEY (workspace_id, graph_id) REFERENCES ov_graphs(workspace_id, graph_id)
);
CREATE TABLE IF NOT EXISTS ov_tasks (
  workspace_id text NOT NULL REFERENCES ov_workspaces(workspace_id),
  task_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('active','waiting','completed','failed','cancelled')),
  snapshot jsonb NOT NULL,
  PRIMARY KEY (workspace_id, task_id)
);
CREATE TABLE IF NOT EXISTS ov_runs (
  workspace_id text NOT NULL,
  run_id text NOT NULL,
  task_id text NOT NULL,
  graph_id text NOT NULL,
  graph_revision integer NOT NULL,
  plan_epoch integer NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('queued','running','waiting','completed','failed','cancelled')),
  snapshot jsonb NOT NULL,
  PRIMARY KEY (workspace_id, run_id),
  FOREIGN KEY (workspace_id, task_id) REFERENCES ov_tasks(workspace_id, task_id),
  FOREIGN KEY (workspace_id, graph_id, graph_revision)
    REFERENCES ov_graph_revisions(workspace_id, graph_id, revision)
);
CREATE TABLE IF NOT EXISTS ov_run_queue (
  workspace_id text NOT NULL,
  run_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','leased','done','outcome_unknown','cancelled')),
  lease_token text,
  leased_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  external_effect boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, run_id),
  FOREIGN KEY (workspace_id, run_id) REFERENCES ov_runs(workspace_id, run_id)
);
CREATE INDEX IF NOT EXISTS ov_queue_ready ON ov_run_queue(status, leased_until, updated_at);
CREATE TABLE IF NOT EXISTS ov_attempts (
  workspace_id text NOT NULL,
  attempt_id text NOT NULL,
  run_id text NOT NULL,
  plan_epoch integer NOT NULL,
  generation integer NOT NULL,
  fingerprint text NOT NULL,
  status text NOT NULL CHECK (status IN ('running','success','failed','cancelled','outcome_unknown')),
  result jsonb,
  PRIMARY KEY (workspace_id, attempt_id),
  FOREIGN KEY (workspace_id, run_id) REFERENCES ov_runs(workspace_id, run_id)
);
CREATE TABLE IF NOT EXISTS ov_function_versions (
  workspace_id text NOT NULL REFERENCES ov_workspaces(workspace_id),
  function_id text NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  snapshot jsonb NOT NULL,
  PRIMARY KEY (workspace_id, function_id, version)
);
CREATE TABLE IF NOT EXISTS ov_action_ledger (
  workspace_id text NOT NULL,
  actor_ref text NOT NULL,
  idempotency_key text NOT NULL,
  signature text NOT NULL,
  result jsonb NOT NULL,
  PRIMARY KEY (workspace_id, actor_ref, idempotency_key)
);
CREATE TABLE IF NOT EXISTS ov_events (
  workspace_id text NOT NULL REFERENCES ov_workspaces(workspace_id),
  event_id bigint NOT NULL CHECK (event_id > 0),
  event_type text NOT NULL,
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, event_id)
);
CREATE INDEX IF NOT EXISTS ov_events_recent ON ov_events(workspace_id, event_id DESC);
