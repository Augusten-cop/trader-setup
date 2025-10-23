const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const cron = require('node-cron');
const { updateSmartAPIData } = require('./connect');
const { fetchCandles } = require('./candle');
const { filterPrices } = require('./priceFilter');
const { fetchOneHourData } = require('./onehourFetch');
const { executeStrategy } = require('./stratagy');
const { sendNotificationToToken, sendNotificationToTopic, sendNotificationToTokens } = require('./notify');
const { checkAndNotify } = require('./checkNotify');
const admin = require('firebase-admin');
const app = express();

// Global error handlers
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    console.error(error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise);
    console.error('Reason:', reason);
});

// Schedule connect.js - 8:55 AM IST on weekdays
cron.schedule('55 8 * * 1-5', async () => {
    console.log('Running connect.js update at 8:55 AM IST');
    try {
        await updateSmartAPIData();
        console.log('Connect.js update completed successfully');
    } catch (error) {
        console.error('Connect.js update failed:', error);
    }
}, {
    scheduled: true,
    timezone: "Asia/Kolkata"
});

// Schedule candle.js - Every Sunday at 6:00 PM IST
cron.schedule('0 18 * * 0', async () => {
    console.log('Running candle.js at 6:00 PM IST');
    try {
        await fetchCandles();
        console.log('Candle.js execution completed successfully');
    } catch (error) {
        console.error('Candle.js execution failed:', error);
    }
}, {
    scheduled: true,
    timezone: "Asia/Kolkata"
});

// Schedule priceFilter.js - Every Sunday at 7:00 PM IST
cron.schedule('0 19 * * 0', async () => {
    console.log('Running priceFilter.js at 7:00 PM IST');
    try {
        await filterPrices();
        console.log('PriceFilter.js execution completed successfully');
    } catch (error) {
        console.error('PriceFilter.js execution failed:', error);
    }
}, {
    scheduled: true,
    timezone: "Asia/Kolkata"
});

// Schedule onehourFetch.js - Every hour from 9:15 AM to 3:15 PM IST on weekdays
cron.schedule('15 9-15 * * 1-5', async () => {
    console.log('Running onehourFetch.js');
    try {
        await fetchOneHourData();
        console.log('OneHourFetch.js execution completed successfully');
    } catch (error) {
        console.error('OneHourFetch.js execution failed:', error);
    }
}, {
    scheduled: true,
    timezone: "Asia/Kolkata"
});

// Schedule stratagy.js - Every hour from 9:20 AM to 3:20 PM IST on weekdays
cron.schedule('20 9-15 * * 1-5', async () => {
    console.log('Running stratagy.js');
    try {
        await executeStrategy();
        console.log('Strategy.js execution completed successfully');
        try {
            await checkAndNotify();
        } catch (e) {
            console.error('Post-strategy notify failed:', e);
        }
    } catch (error) {
        console.error('Strategy.js execution failed:', error);
    }
}, {
    scheduled: true,
    timezone: "Asia/Kolkata"
});

// Middleware
app.use(cors());
app.use(express.json());

// Helper: simple trigger auth. If TRIGGER_KEY is set in env, requests must provide it
function requireTriggerAuth(req, res) {
    const key = process.env.TRIGGER_KEY;
    if (!key) {
        // No key configured -> allow but warn
        console.warn('Warning: TRIGGER_KEY not set. Manual trigger endpoints are unprotected.');
        return true;
    }
    const provided = req.get('x-trigger-key') || req.query.key || (req.headers.authorization && req.headers.authorization.replace(/^Bearer\s+/i, ''));
    if (provided === key) return true;
    res.status(401).json({ success: false, error: 'Unauthorized. Provide correct trigger key in x-trigger-key header or ?key=...' });
    return false;
}

// Manual Trigger Endpoints
app.post('/api/trigger/connect', async (req, res) => {
    try {
        console.log('Manual trigger: Running connect.js update');
        await updateSmartAPIData();
        res.json({ success: true, message: 'Connect.js update completed successfully' });
    } catch (error) {
        console.error('Connect.js update failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/trigger/connect', async (req, res) => {
    if (!requireTriggerAuth(req, res)) return;
    try {
        console.log('Manual GET trigger: Running connect.js update');
        await updateSmartAPIData();
        res.json({ success: true, message: 'Connect.js update completed successfully' });
    } catch (error) {
        console.error('Connect.js update failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/trigger/candles', async (req, res) => {
    try {
        console.log('Manual trigger: Running candle.js');
        await fetchCandles();
        res.json({ success: true, message: 'Candle.js execution completed successfully' });
    } catch (error) {
        console.error('Candle.js execution failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/trigger/pricefilter', async (req, res) => {
    try {
        console.log('Manual trigger: Running priceFilter.js');
        await filterPrices();
        res.json({ success: true, message: 'PriceFilter.js execution completed successfully' });
    } catch (error) {
        console.error('PriceFilter.js execution failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/trigger/onehour', async (req, res) => {
    try {
        console.log('Manual trigger: Running onehourFetch.js');
        await fetchOneHourData();
        res.json({ success: true, message: 'OneHourFetch.js execution completed successfully' });
    } catch (error) {
        console.error('OneHourFetch.js execution failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/trigger/strategy', async (req, res) => {
    try {
        console.log('Manual trigger: Running stratagy.js');
        await executeStrategy();
        // run check & notify after analysis
        let notifyRes = null;
        try {
            notifyRes = await checkAndNotify(req.body.notify || {});
        } catch (e) {
            console.error('Manual strategy notify failed:', e);
        }
        res.json({ success: true, message: 'Strategy.js execution completed successfully', notify: notifyRes });
    } catch (error) {
        console.error('Strategy.js execution failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Manual endpoint to check analysis_results_1hr.json and send notifications if BUY/SELL present
app.post('/api/notify/check', async (req, res) => {
    if (!requireTriggerAuth(req, res)) return;
    try {
        const result = await checkAndNotify(req.body || {});
        res.json(result);
    } catch (error) {
        console.error('Error running notify check:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Data Retrieval Endpoints
app.get('/api/candles/1h', async (req, res) => {
    try {
        const data = await fs.readFile(path.join(__dirname, 'data', 'all_candles_1hr.json'), 'utf8');
        res.json(JSON.parse(data));
    } catch (error) {
        res.status(500).json({ error: 'Error reading candle data' });
    }
});

app.get('/api/candles', async (req, res) => {
    try {
        const data = await fs.readFile(path.join(__dirname, 'data', 'all_candles.json'), 'utf8');
        res.json(JSON.parse(data));
    } catch (error) {
        res.status(500).json({ error: 'Error reading candle data' });
    }
});

app.get('/api/analysis/1h', async (req, res) => {
    try {
        const data = await fs.readFile(path.join(__dirname, 'data', 'analysis_results_1hr.json'), 'utf8');
        res.json(JSON.parse(data));
    } catch (error) {
        res.status(500).json({ error: 'Error reading analysis data' });
    }
});

app.get('/api/filtered-candles', async (req, res) => {
    try {
        const data = await fs.readFile(path.join(__dirname, 'data', 'filtered_candles_strict.json'), 'utf8');
        res.json(JSON.parse(data));
    } catch (error) {
        res.status(500).json({ error: 'Error reading filtered candles data' });
    }
});

// Notification Endpoints
app.post('/api/notify/token', async (req, res) => {
    if (!requireTriggerAuth(req, res)) return;
    
    try {
        const { token, title, body, data } = req.body;
        if (!token) {
            return res.status(400).json({ error: 'token is required' });
        }

        const notification = { title: title || 'Alert', body: body || '' };
        const result = await sendNotificationToToken(token, notification, data || {});
        res.json({ success: true, messageId: result });
    } catch (error) {
        console.error('Error sending notification:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/notify/topic', async (req, res) => {
    if (!requireTriggerAuth(req, res)) return;
    
    try {
        const { topic, title, body, data } = req.body;
        if (!topic) {
            return res.status(400).json({ error: 'topic is required' });
        }

        const notification = { title: title || 'Alert', body: body || '' };
        const result = await sendNotificationToTopic(topic, notification, data || {});
        res.json({ success: true, messageId: result });
    } catch (error) {
        console.error('Error sending notification:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/notify/tokens', async (req, res) => {
    if (!requireTriggerAuth(req, res)) return;
    
    try {
        const { tokens, title, body, data } = req.body;
        if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
            return res.status(400).json({ error: 'tokens array is required' });
        }

        const notification = { title: title || 'Alert', body: body || '' };
        const result = await sendNotificationToTokens(tokens, notification, data || {});
        res.json({ success: true, responses: result });
    } catch (error) {
        console.error('Error sending notifications:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

app.get('/api/trigger/candles', async (req, res) => {
    if (!requireTriggerAuth(req, res)) return;
    try {
        console.log('Manual GET trigger: Running candle.js');
        await fetchCandles();
        res.json({ success: true, message: 'Candle.js execution completed successfully' });
    } catch (error) {
        console.error('Candle.js execution failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/trigger/pricefilter', async (req, res) => {
    if (!requireTriggerAuth(req, res)) return;
    try {
        console.log('Manual GET trigger: Running priceFilter.js');
        await filterPrices();
        res.json({ success: true, message: 'PriceFilter.js execution completed successfully' });
    } catch (error) {
        console.error('PriceFilter.js execution failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/trigger/onehour', async (req, res) => {
    if (!requireTriggerAuth(req, res)) return;
    try {
        console.log('Manual GET trigger: Running onehourFetch.js');
        await fetchOneHourData();
        res.json({ success: true, message: 'OneHourFetch.js execution completed successfully' });
    } catch (error) {
        console.error('OneHourFetch.js execution failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/trigger/strategy', async (req, res) => {
    if (!requireTriggerAuth(req, res)) return;
    try {
        console.log('Manual GET trigger: Running stratagy.js');
        await executeStrategy();
        res.json({ success: true, message: 'Strategy.js execution completed successfully' });
    } catch (error) {
        console.error('Strategy.js execution failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});