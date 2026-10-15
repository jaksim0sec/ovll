(function(global){
"use strict";

const Store=
  global.OvllCustomSkillStore;

const CanvasPlugins=
  global.OvllCanvasPlugins;

const PLUGIN_ID=
  "custom-skills";

if(!Store){
  return;
}

const TYPE_PREFIX="custom:";

function clone(value){
  return value==null
    ?value
    :JSON.parse(JSON.stringify(value));
}

function isCustomType(type){
  return String(type||"")
    .startsWith(
      TYPE_PREFIX
    );
}

function recordIdFromType(type){
  return isCustomType(type)
    ?String(type)
      .slice(TYPE_PREFIX.length)
    :null;
}

function typeForRecord(recordId){
  return TYPE_PREFIX+
    String(recordId||"");
}

function definitionFor(record){
  return {
    name:
      record.name||
      "커스텀 스킬",
    desc:
      record.description||
      "저장한 흐름을 하나의 노드로 실행합니다.",
    llmdesc:
      record.llmdesc||
      record.description||
      "사용자가 만든 저장형 서브플로우.",
    tag:"CUSTOM",
    color:
      record.color||
      "#7c6cf2",
    iconKey:record.iconKey||"custom",
    params:[],
    inputs:[
      {
        id:"in",
        name:"입력",
        type:"any",
        required:false,
        multiple:true,
        accepts:["any"]
      }
    ],
    outputs:[
      {
        id:"result",
        name:"결과",
        type:"any",
        required:false,
        multiple:true,
        accepts:["any"]
      }
    ],
    customSkillId:
      record.id,
    catalog:{
      group:"custom",
      groupLabel:"내 노드",
      pluginId:
        PLUGIN_ID,
      custom:true
    }
  };
}

function pluginDefinitions(
  context={}
){
  if(
    context.context===
      "custom-builder"
  ){
    return {};
  }

  const skillDefinitions={};

  for(const record of Store.list()){
    skillDefinitions[
      typeForRecord(
        record.id
      )
    ]=
      definitionFor(record);
  }

  return skillDefinitions;
}

function mergeDefinitions(base){
  return {
    ...clone(base||{}),
    ...pluginDefinitions({
      context:"workspace"
    })
  };
}

function adjacency(workflow){
  const skillNodes=
    Array.isArray(workflow?.skillNodes)
      ?workflow.skillNodes
      :[];

  const ids=
    new Set(
      skillNodes.map(skillNode=>
        String(skillNode.id)
      )
    );

  const incoming=
    new Map(
      [...ids]
        .map(id=>[id,[]])
    );

  const outgoing=
    new Map(
      [...ids]
        .map(id=>[id,[]])
    );

  for(
    const connection of
    Array.isArray(workflow?.connections)
      ?workflow.connections
      :[]
  ){
    const from=
      String(
        connection?.from?.skillNode||
        ""
      );

    const to=
      String(
        connection?.to?.skillNode||
        ""
      );

    if(
      !ids.has(from)||
      !ids.has(to)
    ){
      continue;
    }

    outgoing.get(from)
      ?.push(connection);

    incoming.get(to)
      ?.push(connection);
  }

  return {
    ids,
    incoming,
    outgoing
  };
}

function deriveBoundary(workflow){
  const graph=
    adjacency(workflow);

  const entrySkillNodeIds=
    [...graph.ids]
      .filter(id=>
        (
          graph.incoming.get(id)||
          []
        ).length===0
      );

  const exitSkillNodeIds=
    [...graph.ids]
      .filter(id=>
        (
          graph.outgoing.get(id)||
          []
        ).length===0
      );

  return {
    entrySkillNodeIds,
    exitSkillNodeIds,
    exitSkillNodeId:
      exitSkillNodeIds.length===1
        ?exitSkillNodeIds[0]
        :""
  };
}

function ensureAcyclic(
  workflow,
  graph
){
  const visiting=new Set();
  const visited=new Set();

  function visit(id){
    if(visiting.has(id)){
      throw new Error(
        "커스텀 스킬 안에는 순환 연결을 만들 수 없어"
      );
    }

    if(visited.has(id)){
      return;
    }

    visiting.add(id);

    for(
      const connection of
      graph.outgoing.get(id)||
      []
    ){
      visit(
        String(
          connection.to.skillNode
        )
      );
    }

    visiting.delete(id);
    visited.add(id);
  }

  for(const id of graph.ids){
    visit(id);
  }
}

function validateWorkflow(
  workflow,
  skillDefinitions={}
){
  const source={
    skillNodes:
      Array.isArray(workflow?.skillNodes)
        ?workflow.skillNodes
        :[],
    connections:
      Array.isArray(workflow?.connections)
        ?workflow.connections
        :[]
  };

  if(!source.skillNodes.length){
    throw new Error(
      "안에 노드를 하나 이상 넣어야 해"
    );
  }

  for(const skillNode of source.skillNodes){
    const type=
      String(skillNode?.type||"");

    if(
      !type||
      type==="start"||
      type==="file"||
      isCustomType(type)
    ){
      throw new Error(
        "이 노드는 커스텀 스킬 안에 넣을 수 없어"
      );
    }

    if(!skillDefinitions[type]){
      throw new Error(
        `알 수 없는 노드 타입이 있어: ${type}`
      );
    }
  }

  const graph=
    adjacency(source);

  ensureAcyclic(
    source,
    graph
  );

  const boundary=
    deriveBoundary(source);

  if(
    boundary.entrySkillNodeIds.length!==1
  ){
    throw new Error(
      "시작되는 첫 노드는 하나만 남겨줘"
    );
  }

  if(
    boundary.exitSkillNodeIds.length!==1
  ){
    throw new Error(
      "결과로 끝나는 마지막 노드는 하나만 남겨줘"
    );
  }

  const exitSkillNode=
    source.skillNodes.find(skillNode=>
      String(skillNode.id)===
      String(boundary.exitSkillNodeId)
    );

  const exitDefinition=
    skillDefinitions?.[
      String(exitSkillNode?.type||"")
    ];

  if(
    !Array.isArray(
      exitDefinition?.outputs
    )||
    exitDefinition.outputs.length!==1
  ){
    throw new Error(
      "마지막 노드는 결과 출구가 하나여야 해"
    );
  }

  return {
    workflow:clone(source),
    boundary:{
      entrySkillNodeIds:
        boundary.entrySkillNodeIds,
      exitSkillNodeId:
        boundary.exitSkillNodeId
    }
  };
}

function portFor(
  skillDefinitions,
  skillNode,
  direction
){
  const definition=
    skillDefinitions?.[
      String(skillNode?.type||"")
    ];

  const ports=
    direction==="input"
      ?definition?.inputs
      :definition?.outputs;

  const port=
    Array.isArray(ports)
      ?ports[0]
      :null;

  return port
    ?String(port.id)
    :null;
}

function expandWorkflow(
  inputWorkflow,
  pivotId,
  options={}
){
  const workflow=
    clone(
      inputWorkflow||{
        skillNodes:[],
        connections:[]
      }
    );

  const skillDefinitions=
    options.skillDefinitions||{};

  const mode=
    options.mode==="target"
      ?"target"
      :"spread";

  const runtimeSkillNodes=[];
  const internalConnections=[];
  const boundaryByVisible=
    new Map();

  const visibleByRuntimeSkillNode={};
  const runtimeSkillNodesByVisible={};
  const exitRuntimeSkillNodeByVisible={};

  for(const skillNode of workflow.skillNodes||[]){
    if(!isCustomType(skillNode.type)){
      runtimeSkillNodes.push(
        clone(skillNode)
      );
      continue;
    }

    const recordId=
      recordIdFromType(
        skillNode.type
      );

    const record=
      Store.get(recordId);

    if(!record){
      throw new Error(
        `저장된 커스텀 스킬를 찾을 수 없어: ${recordId}`
      );
    }

    const validated=
      validateWorkflow(
        record.workflow,
        skillDefinitions
      );

    const prefix=
      String(skillNode.id)+"~";

    const idMap=
      new Map();

    for(
      const inner of
      validated.workflow.skillNodes
    ){
      const runtimeId=
        prefix+
        String(inner.id);

      idMap.set(
        String(inner.id),
        runtimeId
      );

      visibleByRuntimeSkillNode[
        runtimeId
      ]=
        String(skillNode.id);

      runtimeSkillNodes.push({
        ...clone(inner),
        id:runtimeId
      });
    }

    runtimeSkillNodesByVisible[
      String(skillNode.id)
    ]=
      [...idMap.values()];

    for(
      const connection of
      validated.workflow.connections
    ){
      internalConnections.push({
        ...clone(connection),
        id:
          prefix+
          String(
            connection.id||
            [
              connection.from.skillNode,
              connection.from.port,
              connection.to.skillNode,
              connection.to.port
            ].join("-")
          ),
        from:{
          ...clone(
            connection.from
          ),
          skillNode:
            idMap.get(
              String(
                connection.from.skillNode
              )
            )
        },
        to:{
          ...clone(
            connection.to
          ),
          skillNode:
            idMap.get(
              String(
                connection.to.skillNode
              )
            )
        }
      });
    }

    const entryTargets=
      validated.boundary
        .entrySkillNodeIds
        .map(entryId=>{
          const inner=
            validated.workflow.skillNodes
              .find(item=>
                String(item.id)===
                String(entryId)
              );

          const port=
            portFor(
              skillDefinitions,
              inner,
              "input"
            );

          if(!port){
            return null;
          }

          return {
            skillNode:
              idMap.get(
                String(entryId)
              ),
            port
          };
        })
        .filter(Boolean);

    const exitInner=
      validated.workflow.skillNodes
        .find(item=>
          String(item.id)===
          String(
            validated.boundary
              .exitSkillNodeId
          )
        );

    const exitPort=
      portFor(
        skillDefinitions,
        exitInner,
        "output"
      );

    const exitSkillNode=
      idMap.get(
        String(
          validated.boundary
            .exitSkillNodeId
        )
      );

    exitRuntimeSkillNodeByVisible[
      String(skillNode.id)
    ]=
      exitSkillNode;

    boundaryByVisible.set(
      String(skillNode.id),
      {
        entryTargets,
        entryFallback:
          validated.boundary
            .entrySkillNodeIds
            .map(id=>
              idMap.get(String(id))
            )
            .filter(Boolean),
        exitSource:
          exitPort
            ?{
              skillNode:exitSkillNode,
              port:exitPort
            }
            :null
      }
    );
  }

  const runtimeConnections=[
    ...internalConnections
  ];

  for(
    const connection of
    workflow.connections||[]
  ){
    const fromVisible=
      String(
        connection.from?.skillNode||
        ""
      );

    const toVisible=
      String(
        connection.to?.skillNode||
        ""
      );

    const fromBoundary=
      boundaryByVisible.get(
        fromVisible
      );

    const toBoundary=
      boundaryByVisible.get(
        toVisible
      );

    const sources=
      fromBoundary
        ?(
          fromBoundary.exitSource
            ?[
              fromBoundary.exitSource
            ]
            :[]
        )
        :[
          clone(
            connection.from
          )
        ];

    const targets=
      toBoundary
        ?toBoundary.entryTargets
        :[
          clone(
            connection.to
          )
        ];

    if(
      fromBoundary&&
      !sources.length
    ){
      throw new Error(
        "커스텀 스킬의 마지막 노드에 출력 포트가 없어"
      );
    }

    if(
      toBoundary&&
      !targets.length
    ){
      continue;
    }

    let index=0;

    for(const source of sources){
      for(const target of targets){
        runtimeConnections.push({
          ...clone(connection),
          id:
            index===0
              ?String(
                connection.id||
                ""
              )
              :String(
                connection.id||
                "edge"
              )+
              "~"+
              index,
          from:clone(source),
          to:clone(target)
        });

        index++;
      }
    }
  }

  const visiblePivot=
    String(pivotId||"");

  let runtimePivot=
    visiblePivot;

  const pivotBoundary=
    boundaryByVisible.get(
      visiblePivot
    );

  if(pivotBoundary){
    if(mode==="target"){
      runtimePivot=
        pivotBoundary
          .exitSource
          ?.skillNode||
        exitRuntimeSkillNodeByVisible[
          visiblePivot
        ]||
        pivotBoundary
          .entryFallback[0];
    }else{
      runtimePivot=
        pivotBoundary
          .entryFallback[0]||
        exitRuntimeSkillNodeByVisible[
          visiblePivot
        ];
    }
  }

  return {
    workflow:{
      skillNodes:runtimeSkillNodes,
      connections:
        runtimeConnections
    },
    pivotId:
      runtimePivot,
    visiblePivot,
    visibleByRuntimeSkillNode,
    runtimeSkillNodesByVisible,
    exitRuntimeSkillNodeByVisible,
    visibleEdgeIds:
      new Set(
        (workflow.connections||[])
          .map(connection=>
            String(
              connection.id||
              ""
            )
          )
          .filter(Boolean)
      )
  };
}

function createRuntimeProjection(
  expansion
){
  const visibleByRuntimeSkillNode=
    expansion
      ?.visibleByRuntimeSkillNode||
    {};

  const runtimeSkillNodesByVisible=
    expansion
      ?.runtimeSkillNodesByVisible||
    {};

  const exitRuntimeSkillNodeByVisible=
    expansion
      ?.exitRuntimeSkillNodeByVisible||
    {};

  const visibleEdgeIds=
    expansion
      ?.visibleEdgeIds||
    new Set();

  const statusByVisible=
    new Map();

  const lastVisibleStatus=
    new Map();

  function projectSkillNode(event){
    const runtimeId=
      String(
        event.skillNodeId||
        ""
      );

    const visibleId=
      visibleByRuntimeSkillNode[
        runtimeId
      ];

    if(!visibleId){
      return [event];
    }

    if(!statusByVisible.has(visibleId)){
      statusByVisible.set(
        visibleId,
        new Map()
      );
    }

    const states=
      statusByVisible.get(
        visibleId
      );

    states.set(
      runtimeId,
      {
        status:
          String(
            event.status||
            event.state?.status||
            ""
          ),
        state:
          clone(
            event.state||{}
          )
      }
    );

    const members=
      runtimeSkillNodesByVisible[
        visibleId
      ]||[];

    const values=
      members
        .map(id=>
          states.get(id)
        )
        .filter(Boolean);

    const failed=
      values.find(item=>
        item.status==="FAILED"
      );

    const finished=
      values.length===
        members.length&&
      values.every(item=>
        [
          "SUCCESS",
          "FAILED",
          "SKIPPED"
        ].includes(
          item.status
        )
      );

    let nextStatus="RUNNING";

    if(failed){
      nextStatus="FAILED";
    }else if(finished){
      nextStatus=
        values.some(item=>
          item.status==="SUCCESS"
        )
          ?"SUCCESS"
          :"SKIPPED";
    }

    if(
      lastVisibleStatus.get(
        visibleId
      )===nextStatus&&
      nextStatus==="RUNNING"
    ){
      return [];
    }

    lastVisibleStatus.set(
      visibleId,
      nextStatus
    );

    const exitRuntimeId=
      exitRuntimeSkillNodeByVisible[
        visibleId
      ];

    const exitState=
      states.get(
        exitRuntimeId
      )?.state;

    return [{
      ...clone(event),
      skillNodeId:visibleId,
      status:nextStatus,
      state:{
        ...clone(
          exitState||
          event.state||
          {}
        ),
        status:nextStatus,
        type:"custom"
      }
    }];
  }

  function project(event){
    if(
      !event||
      typeof event!=="object"
    ){
      return [];
    }

    if(event.type==="skillNode:state"){
      return projectSkillNode(event);
    }

    if(event.type==="edge:state"){
      const id=
        String(
          event.edgeId||
          ""
        );

      return visibleEdgeIds.has(id)
        ?[event]
        :[];
    }

    if(event.type==="run:finish"){
      return [{
        ...clone(event),
        pivot:
          expansion?.visiblePivot||
          event.pivot
      }];
    }

    return [event];
  }

  return {
    project
  };
}

function onChange(listener){
  return Store.onChange(
    listener
  );
}

function preparePluginRuntime(
  input={}
){
  const workflow=
    input.workflow||{
      skillNodes:[],
      connections:[]
    };

  const hasCustom=
    Array.isArray(
      workflow.skillNodes
    )&&
    workflow.skillNodes.some(
      skillNode=>
        isCustomType(
          skillNode?.type
        )
    );

  if(!hasCustom){
    return null;
  }

  const expansion=
    expandWorkflow(
      workflow,
      input.pivotId,
      {
        mode:
          input.mode,
        skillDefinitions:
          input.baseDefinitions||
          input.skillDefinitions||
          {}
      }
    );

  const projection=
    createRuntimeProjection(
      expansion
    );

  return {
    workflow:
      expansion.workflow,
    pivotId:
      expansion.pivotId,
    runtimeToVisible:
      expansion
        .visibleByRuntimeSkillNode,
    projectEvent:
      event=>
        projection.project(
          event
        )
  };
}

const canvasPlugin=
  Object.freeze({
    id:PLUGIN_ID,
    getDefinitions:
      pluginDefinitions,
    prepareRuntime:
      preparePluginRuntime
  });

if(CanvasPlugins){
  CanvasPlugins.register(
    canvasPlugin
  );

  Store.onChange(
    ()=>{
      CanvasPlugins.invalidate(
        PLUGIN_ID
      );
    }
  );
}

global.OvllCustomSkills=
  Object.freeze({
    pluginId:
      PLUGIN_ID,
    typePrefix:
      TYPE_PREFIX,
    isCustomType,
    recordIdFromType,
    typeForRecord,
    definitionFor,
    mergeDefinitions,
    deriveBoundary,
    validateWorkflow,
    expandWorkflow,
    createRuntimeProjection,
    list:
      ()=>Store.list(),
    get:
      id=>Store.get(id),
    save:
      value=>Store.save(value),
    remove:
      id=>Store.remove(id),
    onChange
  });

})(window);
