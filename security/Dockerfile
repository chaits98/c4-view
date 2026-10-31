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

# Triangulation, recorded honestly because "best effort" that prints nothing is how a report ends up
# claiming coverage it does not have:
#   - PyPI `agentscan` is an unrelated 0.0.1 package that ships no executable, so it is not installed.
#   - snyk-agent-scan installs fine but refuses to scan without SNYK_TOKEN (SaaS account). Left in place
#     so a CI run WITH a token picks it up; without one the report says it did not run.
RUN uv tool install snyk-agent-scan || echo "snyk-agent-scan unavailable (needs SNYK_TOKEN to scan)"

ENV PATH="/root/.local/bin:${PATH}"
WORKDIR /work
