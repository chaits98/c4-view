# model.json

The source of truth: levels, nodes, edges, ports and flow. Plain JSON so a diff is readable and a reviewer can see what changed in the picture.

A model that does not describe a C4 shape is refused at parse time with the key named, so nothing downstream has to defend against a half-valid model.
