require('dotenv').config();
const newrelic = require('newrelic');
const { MongoClient, ObjectId } = require('mongodb');
const { createClient } = require('redis');
const express = require('express');
const pino = require('pino');
const expPino = require('express-pino-logger');

// MongoDB
let db;
let usersCollection;
let ordersCollection;
let mongoConnected = false;

const logger = pino({
    level: 'info',
    prettyPrint: false,
    useLevelLabels: true
});

const expLogger = expPino({ logger });

const app = express();

app.use(expLogger);

app.use((req, res, next) => {
    res.set('Timing-Allow-Origin', '*');
    res.set('Access-Control-Allow-Origin', '*');
    next();
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get('/health', (req, res) => {
    const stat = {
        app: 'OK',
        mongo: mongoConnected
    };
    res.json(stat);
});

// use REDIS INCR to track anonymous users
app.get('/uniqueid', async (req, res) => {
    req.log.error('Unique ID test');
    try {
        const r = await redisClient.incr('anonymous-counter');
        res.json({ uuid: 'anonymous-' + r });
    } catch (err) {
        req.log.error('ERROR', err);
        res.status(500).send(err);
    }
});

// check user exists
app.get('/check/:id', async (req, res) => {
    newrelic.addCustomAttribute('user_id', req.params.id);
    if (mongoConnected) {
        try {
            const user = await usersCollection.findOne({ name: req.params.id });
            if (user) {
                res.send('OK');
            } else {
                res.status(404).send('user not found');
            }
        } catch (e) {
            req.log.error(e);
            res.status(500).send(e);
        }
    } else {
        req.log.error('database not available');
        res.status(500).send('database not available');
    }
});

// return all users for debugging only
app.get('/users', async (req, res) => {
    if (mongoConnected) {
        try {
            const users = await usersCollection.find().toArray();
            res.json(users);
        } catch (e) {
            req.log.error('ERROR', e);
            res.status(500).send(e);
        }
    } else {
        req.log.error('database not available');
        res.status(500).send('database not available');
    }
});

app.post('/login', async (req, res) => {
    newrelic.addCustomAttribute('user_id', req.body.name);
    req.log.info('login', req.body);
    if (!req.body.name || !req.body.password) {
        req.log.warn('credentials not complete');
        res.status(400).send('name or password not supplied');
    } else if (mongoConnected) {
        try {
            const user = await usersCollection.findOne({ name: req.body.name });
            req.log.info('user', user);
            if (user) {
                if (user.password === req.body.password) {
                    res.json(user);
                } else {
                    res.status(404).send('incorrect password');
                }
            } else {
                res.status(404).send('name not found');
            }
        } catch (e) {
            req.log.error('ERROR', e);
            res.status(500).send(e);
        }
    } else {
        req.log.error('database not available');
        res.status(500).send('database not available');
    }
});

// TODO - validate email address format
app.post('/register', async (req, res) => {
    newrelic.addCustomAttribute('user_id', req.body.name);
    req.log.info('register', req.body);
    if (!req.body.name || !req.body.password || !req.body.email) {
        req.log.warn('insufficient data');
        res.status(400).send('insufficient data');
    } else if (mongoConnected) {
        try {
            const user = await usersCollection.findOne({ name: req.body.name });
            if (user) {
                req.log.warn('user already exists');
                res.status(400).send('name already exists');
            } else {
                await usersCollection.insertOne({
                    name: req.body.name,
                    password: req.body.password,
                    email: req.body.email
                });
                req.log.info('inserted', req.body);
                res.send('OK');
            }
        } catch (e) {
            req.log.error('ERROR', e);
            res.status(500).send(e);
        }
    } else {
        req.log.error('database not available');
        res.status(500).send('database not available');
    }
});

app.post('/order/:id', async (req, res) => {
    newrelic.addCustomAttribute('user_id', req.params.id);
    req.log.info('order', req.body);
    if (mongoConnected) {
        try {
            const user = await usersCollection.findOne({ name: req.params.id });
            if (user) {
                const history = await ordersCollection.findOne({ name: req.params.id });
                if (history) {
                    const list = history.history;
                    list.push(req.body);
                    await ordersCollection.updateOne(
                        { name: req.params.id },
                        { $set: { history: list } }
                    );
                    res.send('OK');
                } else {
                    await ordersCollection.insertOne({
                        name: req.params.id,
                        history: [req.body]
                    });
                    res.send('OK');
                }
            } else {
                res.status(404).send('name not found');
            }
        } catch (e) {
            req.log.error(e);
            res.status(500).send(e);
        }
    } else {
        req.log.error('database not available');
        res.status(500).send('database not available');
    }
});

app.get('/history/:id', async (req, res) => {
    newrelic.addCustomAttribute('user_id', req.params.id);
    if (mongoConnected) {
        try {
            const history = await ordersCollection.findOne({ name: req.params.id });
            if (history) {
                res.json(history);
            } else {
                res.status(404).send('history not found');
            }
        } catch (e) {
            req.log.error(e);
            res.status(500).send(e);
        }
    } else {
        req.log.error('database not available');
        res.status(500).send('database not available');
    }
});

// connect to Redis
const redisClient = createClient({
    url: `redis://${process.env.REDIS_HOST || 'redis'}:6379`
});

redisClient.on('error', (e) => {
    logger.error('Redis ERROR', e);
});
redisClient.on('ready', () => {
    logger.info('Redis READY');
});

redisClient.connect().catch(e => logger.error('Redis connection error', e));

// set up Mongo
async function mongoConnect() {
    try {
        const mongoHOST = process.env.MONGO_HOST || 'mongodb';
        const mongoURL = `mongodb://${mongoHOST}:27017/users`;
        logger.info(mongoURL);
        const client = new MongoClient(mongoURL);
        await client.connect();
        db = client.db();
        usersCollection = db.collection('users');
        ordersCollection = db.collection('orders');
        mongoConnected = true;
        logger.info('MongoDB connected');
    } catch (error) {
        logger.error('MongoDB connection error', error);
        setTimeout(mongoConnect, 2000);
    }
}

mongoConnect();

// fire it up!
const port = process.env.USER_SERVER_PORT || '8080';
app.listen(port, () => {
    logger.info('Started on port', port);
});
