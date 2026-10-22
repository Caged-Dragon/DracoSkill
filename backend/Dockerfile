# DracoSkill backend with all five toolchains. Build context: the backend/ folder.
#   docker build -t dracoskill-backend backend/
#   docker run -p 8787:8787 -v dracoskill-data:/var/data dracoskill-backend
FROM python:3.12-slim-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc g++ make libc6-dev \
        default-jdk-headless \
        nodejs npm \
        util-linux ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . /app

# The server must run as root ONLY so it can start each sandboxed process as a
# different unprivileged uid (setpriv). User code never runs as root.
# Lock the server's own files so sandboxed code cannot modify them.
RUN chmod -R go-w /app && mkdir -p /var/data && chmod 711 /var/data

ENV PORT=8787 \
    DRACOSKILL_DB_PATH=/var/data/dracoskill.db \
    DRACOSKILL_DATA_DIR=/var/data/workspaces

EXPOSE 8787
CMD ["python3", "server.py"]
