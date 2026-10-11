# EXTRACT — BUILD THE SAVED CONTRACT

1. Extract fixed conditions separately from variable inputs and examples.
2. Choose a model_task procedure when sufficient, or a versioned graph when useful.
3. Graph inputs need unambiguous named-to-port bindings.
4. Each public graph output maps to an actual node output of the same representation.
5. Use exact nodeId:port or an unambiguous port name; independent aliases or multiple outputs need outputMap:{publicName:{nodeId,port}}.
6. Use a confirmed graph revision; read it if missing rather than guessing an uncommitted revision.
7. A model_task function uses its own declared output ports.
