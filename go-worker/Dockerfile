FROM golang:1.25-alpine

WORKDIR /app

COPY go.mod ./
RUN go mod download

COPY . .

CMD ["go", "run", "."]
