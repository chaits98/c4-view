# Governance

Small project, explicit rules.

- **Decider:** the maintainer (BDFL model) until there are two regular committers. Then decisions move to
  lazy consensus with the maintainer as tie-breaker.
- **What needs agreement first:** anything that changes the model format, the CLI surface, or the audit
  gates. Open an issue with the shape of the change before the PR; a PR that lands a format change
  without that discussion will be asked to split.
- **What does not:** bug fixes, tests, docs, and performance work inside the existing design.
- **Releases:** semantic versioning. Patch = fixes, minor = new capability that keeps models valid,
  major = a model that used to render may now be rejected (with a migration note).
- **Deprecation:** one minor release of warning, then removal. The `CHANGELOG` carries both.
- **Bus factor:** the layout engine, the model grammar and the audit are the three things that must stay
  documented well enough for someone else to own them; a change that makes any of them a black box is a
  governance problem, not just a code review comment.
