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

# Triangulation: two independent static scanners. A failure to install one must not break the others,
# so each is best-effort and the report says which ones actually ran.
RUN uv tool install agentscan || echo "agentscan unavailable"
RUN uv tool install snyk-agent-scan || uvx snyk-agent-scan@latest --help >/dev/null 2>&1 || echo "snyk-agent-scan unavailable"

ENV PATH="/root/.local/bin:${PATH}"
WORKDIR /work
