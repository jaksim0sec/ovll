import test from 'node:test';
import assert from 'node:assert/strict';
let createWorkspaceModel;
try { ({createWorkspaceModel}=await import('../../front/js/workspace/model.js')); } catch {}
test('definitions and placed blocks stay distinct, snapshots cannot mutate live state',()=>{
 assert.equal(typeof createWorkspaceModel,'function');
 const m=createWorkspaceModel(); const a=m.addBlock('research',{x:12,y:24});const b=m.addBlock('research');
 assert.notEqual(a.id,b.id); assert.equal(a.skillId,'research');
 const s=m.getSnapshot();s.blocks[0].values.request='mutated'; assert.equal(m.getBlock(a.id).values.request,'');
 m.updateBlock(a.id,{values:{request:'hello'}});assert.equal(m.getBlock(a.id).values.request,'hello');assert.equal(m.getBlock(b.id).values.request,'');
});
test('links validate ports, direction, duplicate and cycles; deletion and undo preserve integrity',()=>{
 assert.equal(typeof createWorkspaceModel,'function');
 const m=createWorkspaceModel();const a=m.addBlock('research'),b=m.addBlock('organize');
 const link=m.connect({blockId:a.id,portId:'result'},{blockId:b.id,portId:'in'});
 assert.throws(()=>m.connect(link.from,link.to),/이미/);
 assert.throws(()=>m.connect({blockId:b.id,portId:'result'},{blockId:a.id,portId:'in'}),/순환/);
 assert.throws(()=>m.connect({blockId:a.id,portId:'missing'},link.to),/포트/);
 m.deleteBlock(a.id);assert.equal(m.getSnapshot().links.length,0);m.undo();assert.equal(m.getSnapshot().links.length,1);m.redo();assert.equal(m.getSnapshot().blocks.length,1);
});
test('restoration rejects a broken graph without replacing existing work',()=>{
 assert.equal(typeof createWorkspaceModel,'function');const m=createWorkspaceModel();m.addBlock('start');
 assert.throws(()=>m.replace({version:1,blocks:[{id:'x',skillId:'not-real',x:0,y:0,expanded:false,values:{}}],links:[]}));assert.equal(m.getBlocks().length,1);
 m.replace(m.getSnapshot());assert.equal(m.canUndo(),false);assert.throws(()=>m.updateBlock(m.getBlocks()[0].id,{x:Infinity}));
});
test('arrangement is deterministic and undoable and observers receive detached snapshots',()=>{
 assert.equal(typeof createWorkspaceModel,'function');const m=createWorkspaceModel();const a=m.addBlock('start',{x:88,y:91}),b=m.addBlock('research',{x:1,y:1});
 m.connect({blockId:a.id,portId:'out'},{blockId:b.id,portId:'in'});let notifications=0;
 const off=m.subscribe(e=>{notifications++;e.snapshot.blocks.length=0;});m.arrange();assert.ok(m.getBlock(b.id).x>m.getBlock(a.id).x);m.undo();assert.equal(m.getBlock(a.id).x,88);off();m.clear();assert.equal(notifications,2);
});
test('same metadata binary replacement stores the new file and remains undoable',async()=>{
 const m=createWorkspaceModel();const block=m.addBlock('file');
 m.updateBlock(block.id,{file:{name:'same.bin',type:'application/octet-stream',size:3,blob:new Blob(['one'])}});
 m.updateBlock(block.id,{file:{name:'same.bin',type:'application/octet-stream',size:3,blob:new Blob(['two'])}});
 assert.equal(await m.getBlock(block.id).file.blob.text(),'two');m.undo();assert.equal(await m.getBlock(block.id).file.blob.text(),'one');
});
test('new palette block can be expanded in the same undo step',()=>{
 const m=createWorkspaceModel();m.addBlock('research',{expanded:true});assert.equal(m.getBlocks()[0].expanded,true);m.undo();assert.equal(m.getBlocks().length,0);
});
test('file block creation includes the actual local file in a single history entry',async()=>{
 const m=createWorkspaceModel();const block=m.addBlock('file',{file:{localId:'file-1',name:'memo.txt',type:'text/plain',size:4,blob:new Blob(['memo'])}});
 assert.equal(await block.file.blob.text(),'memo');m.undo();assert.equal(m.getBlocks().length,0);m.redo();assert.equal(await m.getBlocks()[0].file.blob.text(),'memo');
});
