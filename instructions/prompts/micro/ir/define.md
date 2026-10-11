# DEFINE — REUSE OR CREATE REUSABLE BEHAVIOR

1. Check existing instances, then existing compatible definitions by purpose, semantic IO and constraints.
2. First reuse matching existing instances; then use an existing compatible definition for the needed instance.
3. Define a new reusable operation ONLY if none fits or a new kind of node is explicitly requested.
4. A requested new kind means node.define with createInstance:true, or a separate node.add using its created definition alias; a renamed builtin writing node is insufficient.
5. Keep durable instructions on the definition and current topic, data and request on the instance.
6. Use draft defaults unless useful semantic ports are needed; select only supported executors.
7. Use the user's intended labels without unsolicited suffixes. Icon and color describe presentation.
