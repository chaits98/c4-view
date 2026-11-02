# git hook

**C4V-15** · batch-job · `.githooks/pre-commit`

Three lines of shell in the user's repo. It owns no judgement.

## Where it sits

A container: something that runs or stores, and could be restarted on its own. Drill it to see the components inside. Shown on the **C2 · the containers inside c4-view** level.

## What to know

The hook exits 0 or 1. All the thinking lives in `c4v gate check`, so updating the tool updates the hook's behaviour without touching the user's repo.
