# Security scanners for the skill and the package, in one throwaway image.
#
# Every scanner here is static: none of them executes the skill. The LLM stage of SkillSpector is off
# by default (--no-llm) because it uploads file contents to a provider; a run that wants it says so.
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates jq \
 && rm -rf /var/lib/apt/lists/*

# Primary: NVIDIA's scanner (Tier 1 of their trust pipeline). Apache-2.0, SARIF output.
RUN uv tool install git+https://github.com/NVIDIA/SkillSpector.git

# Triangulation, all open source, all keyless — chosen for three DIFFERENT rule corpora over the same
# prose, which is what triangulation means:
#   cisco-ai-skill-scanner  Apache-2.0  typed CEL facts then an optional judge; --fail-on-severity, SARIF
#   agentscan-cli           MIT         deterministic (no LLM at all), stable fingerprints for a baseline
#   skillfrisk              MIT         unicode-hiding + permission checks, exit 2 on high, semantic diff
RUN uv tool install cisco-ai-skill-scanner
RUN uv tool install agentscan-cli
RUN uv tool install skillfrisk

# Triangulation, recorded honestly because "best effort" that prints nothing is how a report ends up
# claiming coverage it does not have:
# Rejected on purpose, both recorded so nobody re-litigates it:
#   - snyk/agent-scan (fka invariantlabs mcp-scan): Apache-2.0 code, but the scan calls Snyk's service and
#     refuses to run without SNYK_TOKEN — account-gated, so it is not in the keyless set.
#   - PyPI `agentscan` 0.0.1 is an unrelated package with no console script; the real one is `agentscan-cli`.
#   - ramparts (Apache-2.0) needs a Rust build (`cargo install --locked`); worth adding to CI images, not
#     worth a 10-minute compile in a throwaway scanning container.

ENV PATH="/root/.local/bin:${PATH}"
WORKDIR /work
