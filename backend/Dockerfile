FROM alpine:3.22

ARG PB_VERSION=0.35.0
ARG TARGETARCH=amd64

RUN apk add --no-cache ca-certificates unzip wget

RUN case "${TARGETARCH}" in \
      amd64|arm64) PB_ARCH="${TARGETARCH}" ;; \
      *) echo "Unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
    && wget -q -O /tmp/pocketbase.zip "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${PB_ARCH}.zip" \
    && unzip /tmp/pocketbase.zip -d /pb \
    && chmod +x /pb/pocketbase \
    && rm /tmp/pocketbase.zip

COPY pb_migrations /pb/pb_migrations
COPY pb_hooks /pb/pb_hooks

WORKDIR /pb
EXPOSE 8090

CMD ["/pb/pocketbase", "serve", "--http=0.0.0.0:8090"]
