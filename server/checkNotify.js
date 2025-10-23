const fs = require('fs');
const path = require('path');
const { sendNotificationToTopic, sendNotificationToTokens } = require('./notify');

async function checkAndNotify(options = {}) {
  const file = path.join(__dirname, 'data', 'analysis_results_1hr.json');
  if (!fs.existsSync(file)) {
    console.warn('checkAndNotify: analysis file not found:', file);
    return { success: false, reason: 'file-not-found' };
  }

  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    console.error('checkAndNotify: failed reading file', e.message || e);
    return { success: false, reason: 'read-failed', error: e.message };
  }

  let arr;
  try {
    arr = JSON.parse(raw || '[]');
  } catch (e) {
    console.error('checkAndNotify: invalid JSON', e.message || e);
    return { success: false, reason: 'invalid-json', error: e.message };
  }

  const matches = arr.filter(r => r && r.signal && /\b(BUY|SELL)\b/i.test(r.signal));
  if (!matches || matches.length === 0) {
    console.log('checkAndNotify: no BUY/SELL signals found');
    return { success: true, notified: 0 };
  }

  // Build notification payload
  const maxShow = 6;
  const lines = matches.slice(0, maxShow).map(m => `${m.symbol}: ${m.signal}`);
  const more = matches.length > maxShow ? ` (+${matches.length - maxShow} more)` : '';
  const title = `Trading Alerts: ${matches.length} signal${matches.length>1?'s':''}`;
  const body = lines.join('\n') + more;

  // Decide targets
  const topic = options.topic || process.env.NOTIFY_TOPIC || 'alerts';
  const tokensEnv = process.env.NOTIFY_TOKENS || options.tokens || '';
  const tokens = tokensEnv ? tokensEnv.split(',').map(t => t.trim()).filter(Boolean) : [];

  try {
    const results = {};
    if (topic) {
      console.log(`checkAndNotify: sending to topic ${topic}`);
      const res = await sendNotificationToTopic(topic, { title, body }, { source: 'analysis', count: String(matches.length) });
      results.topic = res;
    }
    if (tokens && tokens.length > 0) {
      console.log(`checkAndNotify: sending to ${tokens.length} tokens`);
      const res2 = await sendNotificationToTokens(tokens, { title, body }, { source: 'analysis', count: String(matches.length) });
      results.tokens = res2;
    }
    console.log('checkAndNotify: notifications sent');
    return { success: true, notified: matches.length, results };
  } catch (e) {
    console.error('checkAndNotify: send failed', e.message || e);
    return { success: false, reason: 'send-failed', error: e.message };
  }
}

module.exports = { checkAndNotify };
