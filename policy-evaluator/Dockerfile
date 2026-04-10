# Policy Evaluator — Dockerfile
# Python 3.11 with GPU support for SLM inference.
# For local dev: uses CPU-only torch.
# For production: use nvidia/cuda base image.

FROM python:3.11-slim AS base

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY domain/ ./domain/
COPY main.py ./
COPY tests/ ./tests/

ENV PORT=8080
ENV MODEL_NAME=TinyLlama/TinyLlama-1.1B-Chat-v1.0
ENV PRELOAD_MODEL=false

EXPOSE 8080

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
