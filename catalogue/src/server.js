require('dotenv').config();
const newrelic = require('newrelic');
const { MongoClient, ObjectId } = require('mongodb');
const express = require('express');
const pino = require('pino');
const expPino = require('express-pino-logger');

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

let db;
let collection;
let mongoConnected = false;

app.get('/health', (req, res) => {
    const stat = {
        app: 'OK',
        mongo: mongoConnected
    };
    res.json(stat);
});

// all products
app.get('/products', async (req, res) => {
    if (mongoConnected) {
        try {
            const products = await collection.find({}).toArray();
            res.json(products);
        } catch (e) {
            req.log.error('ERROR', e);
            res.status(500).send(e);
        }
    } else {
        req.log.error('database not available');
        res.status(500).send('database not available');
    }
});

// product by SKU
app.get('/product/:sku', async (req, res) => {
    newrelic.addCustomAttribute('sku', req.params.sku);
    if (mongoConnected) {
        try {
            const product = await collection.findOne({ sku: req.params.sku });
            req.log.info('product', product);
            if (product) {
                res.json(product);
            } else {
                res.status(404).send('SKU not found');
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

// products in a category
app.get('/products/:cat', async (req, res) => {
    newrelic.addCustomAttribute('category', req.params.cat);
    if (mongoConnected) {
        try {
            const products = await collection.find({ categories: req.params.cat }).sort({ name: 1 }).toArray();
            if (products) {
                res.json(products);
            } else {
                res.status(404).send(`No products for ${req.params.cat}`);
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

// all categories
app.get('/categories', async (req, res) => {
    if (mongoConnected) {
        try {
            const categories = await collection.distinct('categories');
            res.json(categories);
        } catch (e) {
            req.log.error('ERROR', e);
            res.status(500).send(e);
        }
    } else {
        req.log.error('database not available');
        res.status(500).send('database not available');
    }
});

// search name and description
app.get('/search/:text', async (req, res) => {
    newrelic.addCustomAttribute('searchText', req.params.text);
    if (mongoConnected) {
        try {
            const hits = await collection.find({ '$text': { '$search': req.params.text } }).toArray();
            res.json(hits);
        } catch (e) {
            req.log.error('ERROR', e);
            res.status(500).send(e);
        }
    } else {
        req.log.error('database not available');
        res.status(500).send('database not available');
    }
});

// set up Mongo
async function mongoConnect() {
    try {
        const mongoHOST = process.env.MONGO_HOST || 'mongodb';
        const mongoURL = `mongodb://${mongoHOST}:27017/catalogue`;
        const client = new MongoClient(mongoURL, { useNewUrlParser: true, useUnifiedTopology: true });
        await client.connect();
        db = client.db();
        collection = db.collection('products');
        mongoConnected = true;
        logger.info('MongoDB connected');
    } catch (error) {
        logger.error('MongoDB connection error', error);
        setTimeout(mongoConnect, 2000);
    }
}

mongoConnect();

// fire it up!
const port = process.env.CATALOGUE_SERVER_PORT || '8080';
app.listen(port, () => {
    logger.info(`Started on port ${port}`);
});
