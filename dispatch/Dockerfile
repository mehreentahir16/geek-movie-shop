FROM golang:1.20

# Set the GOPATH environment variable
ENV GOPATH=/go

# Copy the source code to the container
COPY src/ /go/src/github.com/newrelic/dispatch

# Set the working directory
WORKDIR /go/src/github.com/newrelic/dispatch

# Run go mod tidy to ensure all dependencies are downloaded
# Run go build to build the application
RUN go mod tidy && go build -o bin/gorcv main.go

# Set the entry point for the container
CMD ["bin/gorcv"]
