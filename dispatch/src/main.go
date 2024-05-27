package main

import (
    "encoding/json"
    "fmt"
    "log"
    "math/rand"
    "os"
    "strconv"
    "time"

    "github.com/newrelic/go-agent/v3/newrelic"
    "github.com/streadway/amqp"
)

const (
    Service = "Dispatch"
)

var (
    amqpUri         string
    rabbitChan      *amqp.Channel
    rabbitCloseError chan *amqp.Error
    rabbitReady      chan bool
    errorPercent     int
    app             *newrelic.Application
)

func connectToRabbitMQ(uri string) *amqp.Connection {
    for {
        conn, err := amqp.Dial(uri)
        if err == nil {
            return conn
        }

        log.Println(err)
        log.Printf("Reconnecting to %s\n", uri)
        time.Sleep(1 * time.Second)
    }
}

func rabbitConnector(uri string) {
    var rabbitErr *amqp.Error

    for {
        rabbitErr = <-rabbitCloseError
        if rabbitErr != nil {
            log.Printf("Connecting to %s\n", amqpUri)
            rabbitConn := connectToRabbitMQ(uri)
            rabbitConn.NotifyClose(rabbitCloseError)

            var err error

            // create mappings here
            rabbitChan, err = rabbitConn.Channel()
            failOnError(err, "Failed to create channel")

            // create exchange
            err = rabbitChan.ExchangeDeclare("robot-shop", "direct", true, false, false, false, nil)
            failOnError(err, "Failed to create exchange")

            // create queue
            queue, err := rabbitChan.QueueDeclare("orders", true, false, false, false, nil)
            failOnError(err, "Failed to create queue")

            // bind queue to exchange
            err = rabbitChan.QueueBind(queue.Name, "orders", "robot-shop", false, nil)
            failOnError(err, "Failed to bind queue")

            // signal ready
            rabbitReady <- true
        }
    }
}

func failOnError(err error, msg string) {
    if err != nil {
        panic(fmt.Sprintf("%s : %s", msg, err))
    }
}

func getOrderDetails(order []byte) (string, string) {
    orderId := "unknown"
    userId := "unknown"
    var f interface{}
    err := json.Unmarshal(order, &f)
    if err == nil {
        m := f.(map[string]interface{})
        orderId = m["orderid"].(string)
        userId = m["user"].(string)
    }
    return userId, orderId
}

func processSale() {
    time.Sleep(time.Duration(420 + rand.Int63n(420)) * time.Millisecond)
}

func main() {
    // Init New Relic Agent
    appName, ok := os.LookupEnv("NEW_RELIC_APP_NAME")
    if !ok {
        appName = "dispatch-service"
    }
    licenseKey, ok := os.LookupEnv("NEW_RELIC_LICENSE_KEY")
    if !ok {
        log.Fatal("New Relic License Key not set")
    }

    var err error
    app, err = newrelic.NewApplication(
        newrelic.ConfigAppName(appName),
        newrelic.ConfigLicense(licenseKey),
        newrelic.ConfigDistributedTracerEnabled(true),
        newrelic.ConfigDebugLogger(os.Stdout),
    )
    if err != nil {
        log.Fatal("Error initializing New Relic application:", err)
    }
    log.Printf("New Relic application initialized: %s", appName)

    // Init amqpUri
    // get host from environment
    amqpHost, ok := os.LookupEnv("AMQP_HOST")
    if !ok {
        amqpHost = "rabbitmq"
    }
    amqpUri = fmt.Sprintf("amqp://guest:guest@%s:5672/", amqpHost)

    // get error threshold from environment
    errorPercent = 0
    epct, ok := os.LookupEnv("DISPATCH_ERROR_PERCENT")
    if ok {
        epcti, err := strconv.Atoi(epct)
        if err == nil {
            if epcti > 100 {
                epcti = 100
            }
            if epcti < 0 {
                epcti = 0
            }
            errorPercent = epcti
        }
    }
    log.Printf("Error Percent is %d\n", errorPercent)

    // MQ error channel
    rabbitCloseError = make(chan *amqp.Error)

    // MQ ready channel
    rabbitReady = make(chan bool)

    go rabbitConnector(amqpUri)

    rabbitCloseError <- amqp.ErrClosed

    go func() {
        for {
            // wait for rabbit to be ready
            ready := <-rabbitReady
            log.Printf("Rabbit MQ ready %v\n", ready)

            // subscribe to bound queue
            msgs, err := rabbitChan.Consume("orders", "", true, false, false, false, nil)
            failOnError(err, "Failed to consume")

            for d := range msgs {
                // create new Transaction
                txn := app.StartTransaction("consume/order")
                userId, orderId := getOrderDetails(d.Body)
                txn.AddAttribute("user_id", userId)
                txn.AddAttribute("order_id", orderId)
                log.Printf("Order %s\n", d.Body)
                log.Printf("Headers %v\n", d.Headers)
                processSale()
                txn.End()
            }
        }
    }()

    log.Println("Waiting for messages")
    forever := make(chan bool)
    <-forever
}
