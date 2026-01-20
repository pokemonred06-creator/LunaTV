FROM golang:alpine AS builder
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
