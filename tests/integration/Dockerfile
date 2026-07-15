# Stage 1: Build Next.js frontend (static export)
FROM node:20-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY next.config.js tsconfig.json tailwind.config.ts postcss.config.js components.json ./
COPY src ./src
COPY public ./public
RUN npx next build

# Stage 2: Build Rust backend + run integration tests
FROM rust:slim-bookworm
RUN apt-get update && apt-get install -y curl git python3 pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
RUN BD_VERSION=$(curl -sSL "https://api.github.com/repos/gastownhall/beads/releases/latest" | python3 -c "import sys,json; print(json.load(sys.stdin)['tag_name'].lstrip('v'))") && \
    ARCH=$(dpkg --print-architecture) && \
    curl -sSL -o /tmp/beads.tar.gz "https://github.com/gastownhall/beads/releases/download/v${BD_VERSION}/beads_${BD_VERSION}_linux_${ARCH}.tar.gz" && \
    tar xzf /tmp/beads.tar.gz -C /usr/local/bin bd && \
    chmod +x /usr/local/bin/bd && \
    rm -f /tmp/beads.tar.gz && \
    bd version
# Install Dolt (required by bd for embedded/server mode)
RUN ARCH=$(dpkg --print-architecture) && \
    curl -sSL -o /tmp/dolt.tar.gz "https://github.com/dolthub/dolt/releases/latest/download/dolt-linux-${ARCH}.tar.gz" && \
    tar xzf /tmp/dolt.tar.gz -C /tmp && \
    cp /tmp/dolt-linux-${ARCH}/bin/dolt /usr/local/bin/dolt && \
    chmod +x /usr/local/bin/dolt && \
    rm -rf /tmp/dolt.tar.gz /tmp/dolt-linux-${ARCH} && \
    dolt version
COPY --from=frontend /app/out /app/out
WORKDIR /app/server
COPY server/Cargo.toml server/Cargo.lock ./
COPY server/src ./src
RUN cargo build --release
COPY tests/integration/run-tests.sh /app/tests/run-tests.sh
RUN chmod +x /app/tests/run-tests.sh
WORKDIR /app
CMD ["/app/tests/run-tests.sh"]
