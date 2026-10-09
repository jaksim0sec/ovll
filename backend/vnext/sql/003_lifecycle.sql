-- Apply after 002. Preserve old failed Task records while allowing frozen blocked state.
ALTER TABLE ov_tasks DROP CONSTRAINT IF EXISTS ov_tasks_status_check;
ALTER TABLE ov_tasks ADD CONSTRAINT ov_tasks_status_check
  CHECK(status IN ('active','waiting','completed','blocked','failed','cancelled'));
CREATE TABLE IF NOT EXISTS ov_questions (
 workspace_id text NOT NULL,
 question_id text NOT NULL,
 task_id text NOT NULL,
 status text NOT NULL CHECK(status IN ('open','answered','cancelled')),
 snapshot jsonb NOT NULL,
 PRIMARY KEY(workspace_id,question_id),
 FOREIGN KEY(workspace_id,task_id) REFERENCES ov_tasks(workspace_id,task_id)
);
CREATE INDEX IF NOT EXISTS ov_questions_pending ON ov_questions(workspace_id,task_id,status);
CREATE TABLE IF NOT EXISTS ov_question_answers (
 workspace_id text NOT NULL,
 answer_id text NOT NULL,
 question_id text NOT NULL,
 value jsonb NOT NULL,
 PRIMARY KEY(workspace_id,answer_id),
 UNIQUE(workspace_id,question_id),
 FOREIGN KEY(workspace_id,question_id) REFERENCES ov_questions(workspace_id,question_id)
);
