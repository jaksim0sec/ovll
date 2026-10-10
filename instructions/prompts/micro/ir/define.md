# DEFINE — CREATE ONLY NECESSARY REUSABLE BEHAVIOR

1. Check compatible existing instances and basic/custom definitions by purpose, semantic IO and constraints.
2. When explicitly requested to create a new kind of node, or when authorized work genuinely lacks a needed capability, define the missing behavior and add its instance using definitionRef.localDefinitionKey. Do not disguise new behavior as renamed builtin:write.
3. For ordinary model_task, a draft needs localKey, purpose and instruction plus optional presentation; executorKind and flexible JSON input/output ports default. Specify semantic ports only if useful.
4. Keep reusable instructions on the definition, current topic/data/request on the instance. Use the user's intended labels without unsolicited suffixes. Icon and color only describe presentation.
5. Do not invent executors, create unnecessary stages or propose unauthorized graph edits as completed changes.
