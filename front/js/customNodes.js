(function(global){
"use strict";

const Store=
  global.OvllCustomNodeStore;

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

function customIcon(){
  return `
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="3.4" y="4" width="5.2" height="5.2" rx="1.6" stroke="currentColor" stroke-width="1.45"/>
      <rect x="11.4" y="10.8" width="5.2" height="5.2" rx="1.6" stroke="currentColor" stroke-width="1.45"/>
      <path d="M8.6 6.6h2.1a2 2 0 0 1 2 2v2.2" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"/>
    </svg>
  `;
}

function definitionFor(record){
  return {
    name:
      record.name||
      "커스텀 노드",
    desc:
      record.description||
      "저장한 흐름을 하나의 노드로 실행합니다.",
    llmdesc:
      "사용자가 만든 저장형 서브플로우. 기존 노드만 보존하며 새 custom id를 임의 생성하지 않음.",
    tag:"CUSTOM",
    color:
      record.color||
      "#7c6cf2",
    icon:customIcon(),
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
    customNodeId:
      record.id
  };
}

function mergeDefinitions(base){
  const merged={
    ...clone(base||{})
  };

  for(const record of Store.list()){
    merged[
      typeForRecord(
        record.id
      )
    ]=
      definitionFor(record);
  }

  return merged;
}

function adjacency(workflow){
  const nodes=
    Array.isArray(workflow?.nodes)
      ?workflow.nodes
      :[];

  const ids=
    new Set(
      nodes.map(node=>
        String(node.id)
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
        connection?.from?.node||
        ""
      );

    const to=
      String(
        connection?.to?.node||
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

  const entryNodeIds=
    [...graph.ids]
      .filter(id=>
        (
          graph.incoming.get(id)||
          []
        ).length===0
      );

  const exitNodeIds=
    [...graph.ids]
      .filter(id=>
        (
          graph.outgoing.get(id)||
          []
        ).length===0
      );

  return {
    entryNodeIds,
    exitNodeIds,
    exitNodeId:
      exitNodeIds.length===1
        ?exitNodeIds[0]
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
        "커스텀 노드 안에는 순환 연결을 만들 수 없어"
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
          connection.to.node
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
  definitions={}
){
  const source={
    nodes:
      Array.isArray(workflow?.nodes)
        ?workflow.nodes
        :[],
    connections:
      Array.isArray(workflow?.connections)
        ?workflow.connections
        :[]
  };

  if(!source.nodes.length){
    throw new Error(
      "안에 노드를 하나 이상 넣어야 해"
    );
  }

  for(const node of source.nodes){
    const type=
      String(node?.type||"");

    if(
      !type||
      type==="start"||
      type==="file"||
      isCustomType(type)
    ){
      throw new Error(
        "이 노드는 커스텀 노드 안에 넣을 수 없어"
      );
    }

    if(!definitions[type]){
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
    boundary.exitNodeIds.length!==1
  ){
    throw new Error(
      "결과로 끝나는 마지막 노드는 하나만 남겨줘"
    );
  }

  const exitNode=
    source.nodes.find(node=>
      String(node.id)===
      String(boundary.exitNodeId)
    );

  const exitDefinition=
    definitions?.[
      String(exitNode?.type||"")
    ];

  if(
    !Array.isArray(
      exitDefinition?.outputs
    )||
    !exitDefinition.outputs.length
  ){
    throw new Error(
      "마지막 노드는 다음 단계로 결과를 내보낼 수 있어야 해"
    );
  }

  return {
    workflow:clone(source),
    boundary:{
      entryNodeIds:
        boundary.entryNodeIds,
      exitNodeId:
        boundary.exitNodeId
    }
  };
}

function portFor(
  definitions,
  node,
  direction
){
  const definition=
    definitions?.[
      String(node?.type||"")
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
        nodes:[],
        connections:[]
      }
    );

  const definitions=
    options.definitions||{};

  const mode=
    options.mode==="target"
      ?"target"
      :"spread";

  const runtimeNodes=[];
  const internalConnections=[];
  const boundaryByVisible=
    new Map();

  const visibleByRuntimeNode={};
  const runtimeNodesByVisible={};
  const exitRuntimeNodeByVisible={};

  for(const node of workflow.nodes||[]){
    if(!isCustomType(node.type)){
      runtimeNodes.push(
        clone(node)
      );
      continue;
    }

    const recordId=
      recordIdFromType(
        node.type
      );

    const record=
      Store.get(recordId);

    if(!record){
      throw new Error(
        `저장된 커스텀 노드를 찾을 수 없어: ${recordId}`
      );
    }

    const validated=
      validateWorkflow(
        record.workflow,
        definitions
      );

    const prefix=
      String(node.id)+"~";

    const idMap=
      new Map();

    for(
      const inner of
      validated.workflow.nodes
    ){
      const runtimeId=
        prefix+
        String(inner.id);

      idMap.set(
        String(inner.id),
        runtimeId
      );

      visibleByRuntimeNode[
        runtimeId
      ]=
        String(node.id);

      runtimeNodes.push({
        ...clone(inner),
        id:runtimeId
      });
    }

    runtimeNodesByVisible[
      String(node.id)
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
              connection.from.node,
              connection.from.port,
              connection.to.node,
              connection.to.port
            ].join("-")
          ),
        from:{
          ...clone(
            connection.from
          ),
          node:
            idMap.get(
              String(
                connection.from.node
              )
            )
        },
        to:{
          ...clone(
            connection.to
          ),
          node:
            idMap.get(
              String(
                connection.to.node
              )
            )
        }
      });
    }

    const entryTargets=
      validated.boundary
        .entryNodeIds
        .map(entryId=>{
          const inner=
            validated.workflow.nodes
              .find(item=>
                String(item.id)===
                String(entryId)
              );

          const port=
            portFor(
              definitions,
              inner,
              "input"
            );

          if(!port){
            return null;
          }

          return {
            node:
              idMap.get(
                String(entryId)
              ),
            port
          };
        })
        .filter(Boolean);

    const exitInner=
      validated.workflow.nodes
        .find(item=>
          String(item.id)===
          String(
            validated.boundary
              .exitNodeId
          )
        );

    const exitPort=
      portFor(
        definitions,
        exitInner,
        "output"
      );

    const exitNode=
      idMap.get(
        String(
          validated.boundary
            .exitNodeId
        )
      );

    exitRuntimeNodeByVisible[
      String(node.id)
    ]=
      exitNode;

    boundaryByVisible.set(
      String(node.id),
      {
        entryTargets,
        entryFallback:
          validated.boundary
            .entryNodeIds
            .map(id=>
              idMap.get(String(id))
            )
            .filter(Boolean),
        exitSource:
          exitPort
            ?{
              node:exitNode,
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
        connection.from?.node||
        ""
      );

    const toVisible=
      String(
        connection.to?.node||
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
        "커스텀 노드의 마지막 노드에 출력 포트가 없어"
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
          ?.node||
        exitRuntimeNodeByVisible[
          visiblePivot
        ]||
        pivotBoundary
          .entryFallback[0];
    }else{
      runtimePivot=
        pivotBoundary
          .entryFallback[0]||
        exitRuntimeNodeByVisible[
          visiblePivot
        ];
    }
  }

  return {
    workflow:{
      nodes:runtimeNodes,
      connections:
        runtimeConnections
    },
    pivotId:
      runtimePivot,
    visiblePivot,
    visibleByRuntimeNode,
    runtimeNodesByVisible,
    exitRuntimeNodeByVisible,
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
  const visibleByRuntimeNode=
    expansion
      ?.visibleByRuntimeNode||
    {};

  const runtimeNodesByVisible=
    expansion
      ?.runtimeNodesByVisible||
    {};

  const exitRuntimeNodeByVisible=
    expansion
      ?.exitRuntimeNodeByVisible||
    {};

  const visibleEdgeIds=
    expansion
      ?.visibleEdgeIds||
    new Set();

  const statusByVisible=
    new Map();

  const lastVisibleStatus=
    new Map();

  function projectNode(event){
    const runtimeId=
      String(
        event.nodeId||
        ""
      );

    const visibleId=
      visibleByRuntimeNode[
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
      runtimeNodesByVisible[
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
      exitRuntimeNodeByVisible[
        visibleId
      ];

    const exitState=
      states.get(
        exitRuntimeId
      )?.state;

    return [{
      ...clone(event),
      nodeId:visibleId,
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

    if(event.type==="node:state"){
      return projectNode(event);
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

global.OvllCustomNodes=
  Object.freeze({
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
