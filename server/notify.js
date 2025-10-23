const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin SDK with service account
function initFirebase() {
  if (admin.apps && admin.apps.length) return admin.app();

  const saPath = path.join(__dirname, 'key.json');
  admin.initializeApp({
    credential: admin.credential.cert(require(saPath))
  });
  return admin.app();
}

initFirebase();

// Send to specific device token
async function sendNotificationToToken(token, notification = {}, data = {}) {
  const message = {
    token,
    notification, // { title, body }
    data: Object.fromEntries(  // FCM requires all values to be strings
      Object.entries(data).map(([k, v]) => [k, String(v)])
    ),
    android: {
      priority: 'high',
      notification: {
        defaultSound: true
      }
    },
    apns: {
      headers: {
        'apns-priority': '10'
      },
      payload: {
        aps: {
          alert: {
            title: notification.title,
            body: notification.body
          },
          sound: 'default',
          'content-available': 1
        }
      }
    },
    webpush: {
      headers: {
        Urgency: 'high'
      }
    }
  };

  return admin.messaging().send(message);
}

// Send to a topic (all subscribed devices)
async function sendNotificationToTopic(topic, notification = {}, data = {}) {
  const message = {
    topic,
    notification,
    data: Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, String(v)])
    ),
    android: { priority: 'high' },
    apns: { headers: { 'apns-priority': '10' } }
  };
  return admin.messaging().send(message);
}

// Send to multiple tokens in one batch (up to 500)
async function sendNotificationToTokens(tokens, notification = {}, data = {}) {
  if (!tokens || !tokens.length) return null;
  
  const message = {
    tokens,
    notification,
    data: Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, String(v)])
    ),
    android: { priority: 'high' },
    apns: { headers: { 'apns-priority': '10' } }
  };
  return admin.messaging().sendMulticast(message);
}

module.exports = {
  sendNotificationToToken,
  sendNotificationToTopic,
  sendNotificationToTokens
};