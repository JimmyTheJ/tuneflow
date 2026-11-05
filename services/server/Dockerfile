FROM rust:1.98-slim-bookworm AS build
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY schema.sql ./
COPY src ./src
RUN cargo build --locked --release

FROM denoland/deno:bin AS javascript

FROM debian:bookworm-slim
ARG PUID=10001
ARG PGID=10001
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates python3 python3-venv ffmpeg tini \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/extractor \
    && /opt/extractor/bin/pip install --no-cache-dir 'yt-dlp[default]>=2026.7.4' 'bgutil-ytdlp-pot-provider==2.0.2' \
    && groupadd -g "${PGID}" tuneflow \
    && useradd -m -u "${PUID}" -g tuneflow -s /usr/sbin/nologin tuneflow \
    && mkdir -p /app/data && chown tuneflow:tuneflow /app/data
COPY --from=build /build/target/release/tuneflow-server /usr/local/bin/tuneflow-server
COPY --from=javascript /deno /usr/local/bin/deno
ENV PATH="/opt/extractor/bin:${PATH}" TUNEFLOW_DATA_DIR=/app/data BIND_ADDRESS=0.0.0.0:8000
WORKDIR /app
USER tuneflow
EXPOSE 8000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["tuneflow-server"]
