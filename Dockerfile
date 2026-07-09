# Stage 1: Build the React Frontend WebUI
FROM node:20-slim AS webui-builder
WORKDIR /webui
COPY webui/package*.json ./
RUN npm install
COPY webui/ ./
RUN npm run build

# Stage 2: Download the matching architecture of aria2-zero
FROM debian:stable-slim AS aria2-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    unzip \
    && rm -rf /var/lib/apt/lists/*

ARG TARGETARCH

RUN mkdir -p /tmp/aria2 && \
    if [ "$TARGETARCH" = "amd64" ] || [ "$TARGETARCH" = "x86_64" ] || [ -z "$TARGETARCH" ]; then \
        curl -L -o /tmp/aria2.zip https://github.com/zeromake/aria2-zero/releases/download/v2026.06.10-release.1/aria2-linux-x86_64.zip; \
    elif [ "$TARGETARCH" = "arm64" ] || [ "$TARGETARCH" = "aarch64" ]; then \
        curl -L -o /tmp/aria2.zip https://github.com/zeromake/aria2-zero/releases/download/v2025.04.06-release.1/aria2-linux-arm64-v8a.zip; \
    else \
        echo "Unsupported architecture: $TARGETARCH"; exit 1; \
    fi && \
    unzip /tmp/aria2.zip -d /tmp/aria2

# Stage 3: Download Jackett
FROM debian:stable-slim AS jackett-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    tar \
    && rm -rf /var/lib/apt/lists/*

ARG TARGETARCH

RUN mkdir -p /opt/jackett && \
    if [ "$TARGETARCH" = "amd64" ] || [ "$TARGETARCH" = "x86_64" ] || [ -z "$TARGETARCH" ]; then \
        JACKETT_ARCH="AMDx64"; \
    elif [ "$TARGETARCH" = "arm64" ] || [ "$TARGETARCH" = "aarch64" ]; then \
        JACKETT_ARCH="ARM64"; \
    else \
        echo "Unsupported architecture: $TARGETARCH"; exit 1; \
    fi && \
    curl -L -o /tmp/jackett.tar.gz "https://github.com/Jackett/Jackett/releases/latest/download/Jackett.Binaries.Linux${JACKETT_ARCH}.tar.gz" && \
    tar -xzf /tmp/jackett.tar.gz -C /opt/jackett --strip-components=1 && \
    rm /tmp/jackett.tar.gz

# Stage 4: Runtime container
FROM debian:stable-slim

# Install runtime dependencies: nginx, samba, supervisor, etc.
RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx-light \
    samba \
    supervisor \
    ca-certificates \
    procps \
    python3-minimal \
    libicu76 \
    && rm -rf /var/lib/apt/lists/*

# Copy aria2c binary from builder stage
COPY --from=aria2-builder /tmp/aria2/bin/aria2c /usr/local/bin/aria2c
RUN chmod +x /usr/local/bin/aria2c

# Copy Jackett from builder stage
COPY --from=jackett-builder /opt/jackett /opt/opt_jackett_temp
RUN mv /opt/opt_jackett_temp /opt/jackett

# Remove default nginx pages and copy the compiled AriaZero React frontend
RUN rm -rf /var/www/html/*
COPY --from=webui-builder /webui/dist/ /var/www/html/

# Copy configurations
COPY nginx.conf /etc/nginx/sites-available/default
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY disk_space_api.py /usr/local/bin/disk_space_api.py
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/disk_space_api.py

# Expose ports:
# 80: AriaZero WebUI (Nginx)
# 6800: Aria2 RPC (Direct access if needed)
# 445: SMB Server (Samba)
EXPOSE 80 6800 445

# Volumes for config and downloads
VOLUME ["/config", "/downloads"]

# OMDb API key for movie metadata (genre, Rotten Tomatoes, plot)
ENV OMDB_API_KEY="2b2ca076"

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
