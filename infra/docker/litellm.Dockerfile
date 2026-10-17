# syntax=docker/dockerfile:1
# sutra-litellm — the official LiteLLM proxy image with our model config baked in. Build from the
# repo root:  docker build -f infra/docker/litellm.Dockerfile -t <image> .
# Stateless (no database_url): cost comes back per response in x-litellm-response-cost. The
# GEMINI_API_KEY and LITELLM_API_KEY come from the mounted SUTRA_ENV secret at /secrets/.env.
FROM ghcr.io/berriai/litellm:v1.105.1

COPY infra/litellm/config.yaml /app/config.yaml

EXPOSE 4000
# LiteLLM reads env from the process; Cloud Run's secret mount is a file, so load it first.
# ENTRYPOINT, not CMD: the base image's entrypoint is `litellm`, which would treat `sh` as a subcommand.
ENTRYPOINT ["sh", "-c", "set -a; [ -f /secrets/.env ] && . /secrets/.env; set +a; litellm --config /app/config.yaml --port ${PORT:-4000}"]
CMD []
