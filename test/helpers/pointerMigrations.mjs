import {readFile} from 'node:fs/promises';

// Integration suites share one database. Historical migrations must not be
// replayed after migration 004 has renamed their columns.
export async function applyPointerMigrations(pool){
  const state=await pool.query("SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='ov_attempts' AND column_name='skill_node_id'");
  if(state.rows.length)return;
  for(const name of ['001_initial.sql','002_node_evidence.sql','003_lifecycle.sql','004_skill_terminology.sql']){
    await pool.query(await readFile(new URL('../../backend/ovllPointer/sql/'+name,import.meta.url),'utf8'));
  }
}
