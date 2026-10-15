import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function loadCustomSkillNodes(records){
  const byId=
    new Map(
      records.map(record=>[
        record.id,
        structuredClone(record)
      ])
    );

  const listeners=
    new Set();

  let registeredPlugin=null;
  let invalidations=0;

  const window={
    OvllCanvasPlugins:{
      register(plugin){
        registeredPlugin=plugin;
        return ()=>{};
      },
      invalidate(){
        invalidations++;
        return true;
      }
    },
    OvllCustomSkillStore:{
      list(){
        return [
          ...byId.values()
        ].map(
            value=>
              structuredClone(value)
          );
      },
      get(id){
        const record=
          byId.get(
            String(id)
          );

        return record
          ?structuredClone(record)
          :null;
      },
      save(value){
        byId.set(
          value.id,
          structuredClone(value)
        );
        return structuredClone(value);
      },
      remove(id){
        return byId.delete(
          String(id)
        );
      },
      onChange(listener){
        listeners.add(listener);
        return ()=>listeners.delete(listener);
      }
    }
  };

  const source=
    fs.readFileSync(
      new URL(
        "../front/js/customSkills.js",
        import.meta.url
      ),
      "utf8"
    );

  vm.runInNewContext(
    source,
    {
      window,
      console,
      Set,
      Map,
      JSON,
      Array,
      Object,
      String,
      Number,
      Boolean,
      Math
    },
    {
      filename:"customSkills.js"
    }
  );

  window.OvllCustomSkillsTestState={
    get plugin(){
      return registeredPlugin;
    },
    get invalidations(){
      return invalidations;
    }
  };

  return window.OvllCustomSkills;
}

const skillDefinitions={
  research:{
    inputs:[
      {id:"in"}
    ],
    outputs:[
      {id:"result"}
    ]
  },
  write:{
    inputs:[
      {id:"in"}
    ],
    outputs:[
      {id:"result"}
    ]
  },
  organize:{
    inputs:[
      {id:"in"}
    ],
    outputs:[
      {id:"result"}
    ]
  },
  judge:{
    inputs:[
      {id:"in"}
    ],
    outputs:[
      {id:"true"},
      {id:"false"}
    ]
  }
};

function customRecord(){
  return {
    id:"cw",
    name:"조사 후 작성",
    color:"#7c6cf2",
    workflow:{
      skillNodes:[
        {
          id:"a",
          type:"research",
          x:0,
          y:0,
          data:{
            params:{
              request:"조사해"
            }
          }
        },
        {
          id:"b",
          type:"write",
          x:220,
          y:0,
          data:{
            params:{
              request:"써줘"
            }
          }
        }
      ],
      connections:[
        {
          id:"ab",
          from:{
            skillNode:"a",
            port:"result"
          },
          to:{
            skillNode:"b",
            port:"in"
          },
          data:{
            kind:"data"
          }
        }
      ]
    }
  };
}

test(
  "custom skillNode expands into ordinary runtime skillNodes and reconnects outer edges",
  ()=>{
    const CustomSkillNodes=
      loadCustomSkillNodes([
        customRecord()
      ]);

    const visible={
      skillNodes:[
        {
          id:"p",
          type:"research",
          data:{params:{}}
        },
        {
          id:"c",
          type:"custom:cw",
          data:{}
        },
        {
          id:"q",
          type:"organize",
          data:{params:{}}
        }
      ],
      connections:[
        {
          id:"outer-in",
          from:{
            skillNode:"p",
            port:"result"
          },
          to:{
            skillNode:"c",
            port:"in"
          },
          data:{
            kind:"data"
          }
        },
        {
          id:"outer-out",
          from:{
            skillNode:"c",
            port:"result"
          },
          to:{
            skillNode:"q",
            port:"in"
          },
          data:{
            kind:"data"
          }
        }
      ]
    };

    const expanded=
      CustomSkillNodes.expandWorkflow(
        visible,
        "c",
        {
          mode:"spread",
          skillDefinitions
        }
      );

    assert.deepEqual(
      Array.from(
        expanded.workflow.skillNodes,
        skillNode=>skillNode.id
      ),
      [
        "p",
        "c~a",
        "c~b",
        "q"
      ]
    );

    assert.equal(
      expanded.pivotId,
      "c~a"
    );

    const byId=
      new Map(
        expanded.workflow
          .connections
          .map(connection=>[
            connection.id,
            connection
          ])
      );

    assert.deepEqual(
      JSON.parse(
        JSON.stringify(
          byId.get("outer-in")?.to
        )
      ),
      {
        skillNode:"c~a",
        port:"in"
      }
    );

    assert.deepEqual(
      JSON.parse(
        JSON.stringify(
          byId.get("c~ab")?.from
        )
      ),
      {
        skillNode:"c~a",
        port:"result"
      }
    );

    assert.deepEqual(
      JSON.parse(
        JSON.stringify(
          byId.get("outer-out")?.from
        )
      ),
      {
        skillNode:"c~b",
        port:"result"
      }
    );

    const target=
      CustomSkillNodes.expandWorkflow(
        visible,
        "c",
        {
          mode:"target",
          skillDefinitions
        }
      );

    assert.equal(
      target.pivotId,
      "c~b"
    );
  }
);

test(
  "custom flow requires exactly one terminal output",
  ()=>{
    const CustomSkillNodes=
      loadCustomSkillNodes([]);

    assert.throws(
      ()=>
        CustomSkillNodes.validateWorkflow(
          {
            skillNodes:[
              {
                id:"judge",
                type:"judge",
                data:{params:{}}
              }
            ],
            connections:[]
          },
          skillDefinitions
        ),
      /결과 출구가 하나/
    );
  }
);

test(
  "runtime projection collapses internal skillNode events back to the visible custom skillNode",
  ()=>{
    const CustomSkillNodes=
      loadCustomSkillNodes([
        customRecord()
      ]);

    const expansion=
      CustomSkillNodes.expandWorkflow(
        {
          skillNodes:[
            {
              id:"c",
              type:"custom:cw",
              data:{}
            }
          ],
          connections:[]
        },
        "c",
        {
          mode:"spread",
          skillDefinitions
        }
      );

    const projection=
      CustomSkillNodes
        .createRuntimeProjection(
          expansion
        );

    const first=
      projection.project({
        type:"skillNode:state",
        skillNodeId:"c~a",
        status:"RUNNING",
        state:{
          status:"RUNNING",
          type:"research"
        }
      });

    assert.equal(
      first[0]?.skillNodeId,
      "c"
    );

    assert.equal(
      first[0]?.status,
      "RUNNING"
    );

    projection.project({
      type:"skillNode:state",
      skillNodeId:"c~a",
      status:"SUCCESS",
      state:{
        status:"SUCCESS",
        result:{
          outputs:{
            result:"research"
          }
        }
      }
    });

    const finish=
      projection.project({
        type:"skillNode:state",
        skillNodeId:"c~b",
        status:"SUCCESS",
        state:{
          status:"SUCCESS",
          result:{
            outputs:{
              result:"final"
            }
          }
        }
      });

    assert.equal(
      finish[0]?.skillNodeId,
      "c"
    );

    assert.equal(
      finish[0]?.status,
      "SUCCESS"
    );

    assert.equal(
      finish[0]?.state
        ?.result
        ?.outputs
        ?.result,
      "final"
    );
  }
);

test(
  "custom skillNodes register through the canvas plugin contract",
  ()=>{
    const byId=
      new Map([
        [
          "cw",
          customRecord()
        ]
      ]);

    let plugin=null;
    let invalidations=0;
    const listeners=new Set();

    const window={
      OvllCanvasPlugins:{
        register(value){
          plugin=value;
          return ()=>{};
        },
        invalidate(){
          invalidations++;
          return true;
        }
      },
      OvllCustomSkillStore:{
        list(){
          return [
            ...byId.values()
          ].map(
            value=>
              structuredClone(value)
          );
        },
        get(id){
          const value=
            byId.get(
              String(id)
            );

          return value
            ?structuredClone(value)
            :null;
        },
        save(value){
          byId.set(
            value.id,
            structuredClone(value)
          );

          for(
            const listener of
            listeners
          ){
            listener({
              type:"update",
              id:value.id
            });
          }

          return structuredClone(value);
        },
        remove(id){
          return byId.delete(
            String(id)
          );
        },
        onChange(listener){
          listeners.add(listener);
          return ()=>listeners.delete(listener);
        }
      }
    };

    const source=
      fs.readFileSync(
        new URL(
          "../front/js/customSkills.js",
          import.meta.url
        ),
        "utf8"
      );

    vm.runInNewContext(
      source,
      {
        window,
        console,
        Set,
        Map,
        JSON,
        Array,
        Object,
        String,
        Number,
        Boolean,
        Math
      },
      {
        filename:"customSkills.js"
      }
    );

    assert.equal(
      plugin?.id,
      "custom-skills"
    );

    const workspaceDefinitions=
      plugin.getDefinitions({
        context:"workspace"
      });

    assert.equal(
      workspaceDefinitions[
        "custom:cw"
      ]?.name,
      "조사 후 작성"
    );

    assert.equal(
      workspaceDefinitions[
        "custom:cw"
      ]?.catalog
        ?.group,
      "custom"
    );

    assert.deepEqual(
      JSON.parse(
        JSON.stringify(
          plugin.getDefinitions({
            context:
              "custom-builder"
          })
        )
      ),
      {}
    );

    const prepared=
      plugin.prepareRuntime({
        workflow:{
          skillNodes:[
            {
              id:"c",
              type:"custom:cw",
              data:{}
            }
          ],
          connections:[]
        },
        pivotId:"c",
        mode:"spread",
        baseDefinitions:
          skillDefinitions
      });

    assert.equal(
      prepared.pivotId,
      "c~a"
    );

    assert.equal(
      prepared.runtimeToVisible[
        "c~b"
      ],
      "c"
    );

    window
      .OvllCustomSkillStore
      .save({
        ...customRecord(),
        name:"갱신"
      });

    assert.equal(
      invalidations,
      1
    );
  }
);

