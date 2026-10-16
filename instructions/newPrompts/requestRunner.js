import { assemblePrompt } from "./assemblePrompt.js";

const WORKROOMS = new Set(["skillDefine", "skillEdit", "canvasEdit", "textGenerate"]);
const FINISHED = new Set(["completed", "stopped", "failed"]);

export function createRequest({ roomId, userRequest, contextData, requestId = crypto.randomUUID() }) {
  if (!roomId || typeof userRequest !== "string") throw new Error("roomId and userRequest required");
  return { roomId, requestId, userRequest, contextData, contextBlock: { intent: "", progress: "" }, currentLayer: "gate", status: "running" };
}

/**
 * Integration boundaries are injected, rather than inventing new provider/DB APIs:
 * callAI({prompt, layer, ...}) -> JSON-compatible model response
 * executeAction(request, {workroom, result}, signal) -> verified action result
 * lookupNeed(request, need, signal) -> verified data
 * publish(event) -> SSE transport supplied by HTTP route
 * persist(request, event) -> durable save; awaited BEFORE publishing confirmed changes
 */
export function createRequestRunner({ manifest, readText, callAI, executeAction, lookupNeed, persist = async () => {}, publish = () => {}, maxCalls = 32 }) {
  if (![readText, callAI, executeAction, lookupNeed, persist, publish].every(x => typeof x === "function")) throw new Error("Invalid dependencies");
  const requests = new Map();
  const calls = new Map();
  const controllers = new Map();
  const emit = async (r, type, data = {}) => {
    r.revision = (r.revision ?? 0) + 1;
    const event = { roomId: r.roomId, requestId: r.requestId, revision: r.revision, type, data };
    await persist(r, event);
    publish(event);
  };
  const key = (roomId, requestId) => JSON.stringify([roomId, requestId]);
  const isStopped = r => r.status !== "running";
  const guarded = (r, signal) => {
    if (isStopped(r) || signal.aborted) throw Object.assign(new Error("Request stopped"), { name: "AbortError" });
  };
  const next = (r, layer) => { r.currentLayer = layer; };
  const finish = async (r, state, extra = {}) => {
    if (FINISHED.has(r.status)) return;
    r.status = state;
    Object.assign(r, extra);
    await emit(r, "final", { status: state, currentLayer: r.currentLayer, planIndex: r.planIndex ?? null, ...extra });
  };
  const stop = (roomId, requestId) => {
    const id = key(roomId, requestId), r = requests.get(id);
    if (!r) return null;
    if (r.status === "running") {
      r.status = "stopping";
      controllers.get(id)?.abort();
    }
    return { roomId, requestId, status: r.status, revision: r.revision ?? 0 };
  };
  const getRequest = (roomId, requestId) => requests.get(key(roomId, requestId)) ?? null;
  const getCall = (roomId, requestId) => calls.get(key(roomId, requestId)) ?? null;

  async function run(r) {
    const id = key(r.roomId, r.requestId);
    if (requests.has(id)) throw new Error("Request already registered");
    const controller = new AbortController();
    requests.set(id, r);
    controllers.set(id, controller);
    const signal = controller.signal;
    let invocation = 0, lastOutcome = null;
    try {
      await emit(r, "started", { currentLayer: r.currentLayer });
      while (r.status === "running") {
        guarded(r, signal);
        if (++invocation > maxCalls) throw new Error("Model-call safety limit reached");

        // A workroom name is derived from the plan; terminate is not a workroom.
        let workroom, objective, needData;
        if (r.currentLayer === "workroom") {
          const entry = r.plan?.[r.planIndex];
          if (!entry) throw new Error("No plan step at current index");
          workroom = Object.keys(entry)[0];
          if (!WORKROOMS.has(workroom)) throw new Error("Invalid workroom step");
          objective = entry[workroom].objective;
          needData = await lookupNeed(r, entry[workroom].need ?? [], signal);
          guarded(r, signal);
        }
        const layer = r.currentLayer;
        const data = {
          userRequest: r.userRequest, contextData: r.contextData, contextBlock: r.contextBlock,
          focus: { layer, planIndex: r.planIndex ?? null, lastVerifiedOutcome: lastOutcome },
          gateData: r.gateData ?? null, verifiedResults: r.verifiedResults ?? [],
          planObjective: objective ?? null, planNeedResults: needData ?? null,
          relevantVerifiedState: r.verifiedResults ?? []
        };
        // Workroom action selection remains a TODO in 1014. This draft accepts the
        // explicitly supplied action key; no invented "default" action.
        const config = layer === "workroom"
          ? { layer, workroom, action: r.nextAction, data, readText }
          : { layer, data, readText };
        const assembled = await assemblePrompt(manifest, config);
        guarded(r, signal);
        await emit(r, "call_started", { layer, workroom, invocation });
        const response = await callAI({ ...assembled, layer, workroom, signal });
        guarded(r, signal);
        const parsed = typeof response === "string" ? JSON.parse(response) : response;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid model response");
        calls.set(id, { invocation, layer, workroom, response: parsed });

        // Validate allowed output fields before applying state changes.
        const permitted = layer === "gate" ? ["need"]
          : layer === "corridorInitial" ? ["plan", "contextBlock", "contextData", "languageBlock"]
          : layer === "corridorReturn" ? ["plan", "contextBlock"]
          : layer === "output" ? ["languageBlock", "contextBlock", "contextData"]
          : ["action", "result", "languageBlock"];
        for (const field of Object.keys(parsed)) if (!permitted.includes(field)) throw new Error("Unexpected response field: " + field);
        if (layer === "gate") {
          if (!Array.isArray(parsed.need)) throw new Error("Gate requires need[]");
          r.gateData = await lookupNeed(r, parsed.need, signal);
          guarded(r, signal);
          next(r, "corridorInitial");
        } else if (layer === "corridorInitial" || layer === "corridorReturn") {
          const direct = layer === "corridorInitial" && Object.hasOwn(parsed, "languageBlock");
          if (direct) {
            if (Object.hasOwn(parsed, "plan") || !parsed.contextBlock || !parsed.contextData) throw new Error("Invalid direct response");
            r.contextBlock = parsed.contextBlock;
            r.contextData = parsed.contextData;
            r.languageBlock = parsed.languageBlock;
            await emit(r, "language", { languageBlock: parsed.languageBlock });
            await finish(r, "completed");
            break;
          }
          if (!Array.isArray(parsed.plan) || !parsed.contextBlock) throw new Error("Corridor requires plan + contextBlock");
          if (parsed.plan.length === 0) throw new Error("Empty plan");
          for (const step of parsed.plan) {
            const names = step && typeof step === "object" && !Array.isArray(step) ? Object.keys(step) : [];
            if (names.length !== 1 || !(WORKROOMS.has(names[0]) || names[0] === "terminate")) throw new Error("Invalid plan step");
          }
          r.plan = parsed.plan;
          r.planIndex = 0;
          r.contextBlock = parsed.contextBlock;
          next(r, "plan");
          await emit(r, "plan", { plan: r.plan });
        } else if (layer === "plan") {
          throw new Error("Internal plan routing reached model invocation");
        } else if (layer === "workroom") {
          const action = parsed.action;
          if (!action || !WORKROOMS.has(workroom)) throw new Error("Missing workroom action");
          const verified = await executeAction(r, { workroom, action, result: parsed.result }, signal);
          guarded(r, signal);
          if (!verified || typeof verified.success !== "boolean") throw new Error("Action result must contain success");
          r.verifiedResults ??= [];
          r.verifiedResults.push({ workroom, action, outcome: verified });
          lastOutcome = verified;
          await emit(r, "action_result", { workroom, action, outcome: verified });
          if (parsed.languageBlock !== undefined) await emit(r, "language", { languageBlock: parsed.languageBlock });
          if (!verified.success || verified.replan === true) next(r, "corridorReturn");
          else { r.planIndex++; next(r, "plan"); }
        } else if (layer === "output") {
          if (!parsed.contextBlock || !parsed.contextData || parsed.languageBlock === undefined) throw new Error("Incomplete Output");
          r.contextBlock = parsed.contextBlock;
          r.contextData = parsed.contextData;
          r.languageBlock = parsed.languageBlock;
          await emit(r, "language", { languageBlock: parsed.languageBlock });
          await finish(r, "completed");
          break;
        } else throw new Error("Unknown layer");
        // Server-only transitions do not spend an extra model invocation.
        if (r.currentLayer === "plan") {
          const step = r.plan?.[r.planIndex];
          if (!step) next(r, "corridorReturn");
          else if (Object.keys(step)[0] === "terminate") next(r, "output");
          else next(r, "workroom");
        }
        await emit(r, "progress", { currentLayer: r.currentLayer, planIndex: r.planIndex ?? null });
      }
      if (r.status === "stopping") await finish(r, "stopped");
    } catch (error) {
      if (r.status === "stopping" || error?.name === "AbortError") await finish(r, "stopped");
      else await finish(r, "failed", { error: String(error?.message ?? error) });
    } finally {
      controllers.delete(id);
      calls.delete(id); // transient model-response data; request record retained for reconciliation
    }
    return r;
  }
  return { createRequest, run, stop, getRequest, getCall };
}
