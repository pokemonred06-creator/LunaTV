# Build the standalone Go proxy binary.
# Go 1.25.7 is a stable release; keep this pinned for reproducible builds.
ARG GO_VERSION=1.25.7
FROM golang:${GO_VERSION}-alpine AS builder
WORKDIR /app
COPY go.mod ./
COPY *.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /proxy ./server.go

FROM scratch
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /proxy /proxy
EXPOSE 8080
ENTRYPOINT ["/proxy"]
CMD ["-addr", ":8080"]
