# viewer server

**C4V-12** · microservice · `node:http, :8788`

Serves the pictures it already has, behind a token. Never writes a diagram.

## Where it sits

It is one of the containers: drill it to see its components. Shown on the **C2 · the containers inside c4-view** level.

## What to know

It serves pictures it already has. The only write it accepts is a POST of a model to the API.
