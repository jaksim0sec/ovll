-- One-time, offline terminology migration. Apply after 003, before new workers.
-- Never rewrite opaque settings, bindings, outputs or artifact values.
BEGIN;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM ov_runs WHERE status IN ('queued','running','waiting'))
     OR EXISTS(SELECT 1 FROM ov_run_queue WHERE status='leased') THEN
    RAISE EXCEPTION 'Drain active runs before migrating skill terminology';
  END IF;
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='ov_attempts' AND column_name='node_id') THEN
    ALTER TABLE ov_attempts RENAME COLUMN node_id TO skill_node_id;
  END IF;
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='ov_attempts' AND column_name='definition_ref') THEN
    ALTER TABLE ov_attempts RENAME COLUMN definition_ref TO skill_definition_ref;
  END IF;
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='ov_value_artifacts' AND column_name='node_id') THEN
    ALTER TABLE ov_value_artifacts RENAME COLUMN node_id TO skill_node_id;
  END IF;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.ovll_term(value jsonb, previous text, next text)
RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN
  IF value ? previous THEN
    IF value ? next THEN RAISE EXCEPTION 'Mixed terminology: % / %',previous,next; END IF;
    RETURN (value-previous)||jsonb_build_object(next,value->previous);
  END IF;
  RETURN value;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.ovll_skill_endpoint(value jsonb)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_temp.ovll_term(pg_temp.ovll_term(value,'nodeId','skillNodeId'),'skillId','skillNodeId')
$$;
CREATE OR REPLACE FUNCTION pg_temp.ovll_skill_snapshot(value jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE g jsonb; items jsonb; links jsonb;
BEGIN
  IF value IS NULL OR NOT (value ? 'graph') THEN RETURN value; END IF;
  value:=pg_temp.ovll_term(value,'definitions','skillDefinitions');
  g:=pg_temp.ovll_term(pg_temp.ovll_term(value->'graph','nodes','skillNodes'),'skills','skillNodes');
  IF jsonb_typeof(g->'skillNodes') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid stored skill graph'; END IF;
  SELECT COALESCE(jsonb_agg(pg_temp.ovll_term(pg_temp.ovll_skill_endpoint(item),'definitionRef','skillDefinitionRef') ORDER BY ord),'[]'::jsonb)
    INTO items FROM jsonb_array_elements(g->'skillNodes') WITH ORDINALITY AS t(item,ord);
  SELECT COALESCE(jsonb_agg(jsonb_set(jsonb_set(item,'{from}',pg_temp.ovll_skill_endpoint(item->'from')),'{to}',pg_temp.ovll_skill_endpoint(item->'to')) ORDER BY ord),'[]'::jsonb)
    INTO links FROM jsonb_array_elements(g->'connections') WITH ORDINALITY AS t(item,ord);
  RETURN jsonb_set(value,'{graph}',g||jsonb_build_object('skillNodes',items,'connections',links));
END $$;
CREATE OR REPLACE FUNCTION pg_temp.ovll_skill_refs(value jsonb)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT CASE WHEN jsonb_typeof(value)='object' THEN
    (SELECT COALESCE(jsonb_object_agg(CASE WHEN key LIKE 'node:%' THEN 'skillNode:'||substr(key,6) WHEN key LIKE 'skill:%' THEN 'skillNode:'||substr(key,7) ELSE key END,entry),'{}'::jsonb)
       FROM jsonb_each(value) AS t(key,entry)) ELSE value END
$$;
CREATE OR REPLACE FUNCTION pg_temp.ovll_skill_metadata(value jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN
  value:=pg_temp.ovll_skill_endpoint(value);
  IF value ? 'createdRefs' THEN value:=jsonb_set(value,'{createdRefs}',pg_temp.ovll_skill_refs(value->'createdRefs')); END IF;
  RETURN value;
END $$;
UPDATE ov_graphs SET snapshot=pg_temp.ovll_skill_snapshot(snapshot);
UPDATE ov_graph_revisions SET snapshot=pg_temp.ovll_skill_snapshot(snapshot);
UPDATE ov_function_versions SET snapshot=pg_temp.ovll_skill_snapshot(snapshot);
UPDATE ov_action_ledger SET result=pg_temp.ovll_skill_metadata(result);
UPDATE ov_events SET body=pg_temp.ovll_skill_metadata(body),
  event_type=CASE WHEN event_type LIKE 'node.%' THEN 'skillNode.'||substr(event_type,6) ELSE event_type END;
DROP FUNCTION pg_temp.ovll_skill_metadata(jsonb);
DROP FUNCTION pg_temp.ovll_skill_refs(jsonb);
DROP FUNCTION pg_temp.ovll_skill_snapshot(jsonb);
DROP FUNCTION pg_temp.ovll_skill_endpoint(jsonb);
DROP FUNCTION pg_temp.ovll_term(jsonb,text,text);
COMMIT;
