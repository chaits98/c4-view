## What changes

<!-- one paragraph: the defect or the capability, not the file list -->

## Why

<!-- what breaks or what is impossible today -->

## Proof

- [ ] `node tools/gate.mjs` passes (300-line cap, no `any`, no placeholders)
- [ ] `npx tsc --noEmit` clean
- [ ] `node --test` passes
- [ ] `node tools/golden.mjs --check` — or a one-line explanation of the golden diff
- [ ] the new behaviour has a test that fails without the change
- [ ] commits are signed off (`git commit -s`, DCO)

## Model / gate impact

<!-- does this change the model format, a gate, or the audit line? if yes, say what existing models do -->
