# Smoke prompt — one line, nothing else

The test of the skill is that this is the whole brief. Paste it into a **new session**:

```
Build a C4 diagram of this repo: /home/canand/Desktop/Projects/c4-view
```

That is it — no levels, no rules, no commands, no delivery format. Everything an agent needs must come
from `skill/SKILL.md` (installed as the `c4-diagram` skill), because a real user will not supply it either.

## What a failing run looks like

| Symptom | What it means |
|---|---|
| it asks which levels you want, or where to put the file | the skill's "the brief is one line" section is not landing |
| it never loads the skill | the description does not match "build a C4 of this repo" |
| it hand-tunes positions, or hunts for coordinates | it missed the central rule: the layout is computed |
| it delivers without audit lines | the delivery contract was ignored |
| one level with 25+ nodes | the level-size guidance was ignored |
| a level with no `flow`, or the animation jumps | the narration rule was missed |
| it "fixes" a red gate by editing `src/` | the only hard rule (fix the model) was not believed |
| C3 lists files/classes instead of stages with artifacts | the survey section is too weak |
| it draws build tooling, tests, or folders | the "what is not runtime" filter failed |

## What a pass looks like

- 2–3 levels: C1, C2, and one C3 for the container that carries the point
- the model lands at `docs/c4/<id>.json` inside the target repo
- every audit line `ok`, `group∧node=0`, `aspect` roughly 1.5–4
- C3 edge labels are artifacts (`Ranked`, `Routed`, `AuditReport`), not `uses`
- flow caption reads like a sentence: `model.parse → rank · Ranked · 1 / 9`
- delivered as grid link + one PNG + the audit lines, with no JSON pasted into chat
