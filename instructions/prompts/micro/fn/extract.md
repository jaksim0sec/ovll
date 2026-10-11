# EXTRACT — BUILD THE SAVED CONTRACT

1. Extract fixed conditions separately from variable inputs and examples.
2. Choose a model_task procedure when sufficient, or a versioned graph when useful.
3. Graph inputs need unambiguous named-to-port bindings.
4. Each public graph output maps to an actual node output of the same representation.
5. Use explicit outputMap:{publicName:{node:NodeSelector,port}} for independent named outputs; preserve their representations. Existing persistent nodeId/port maps also remain valid.
6. For current-graph saving, use procedure:{kind:"graph"}; the host supplies its confirmed revision and binds created node aliases after successful commit.
7. A model_task function uses its own declared output ports.
