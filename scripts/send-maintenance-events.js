const admin = require("firebase-admin");

const ONE_SIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID || "0619eb66-f607-4e31-8f60-3195fd99645c";
const ONE_SIGNAL_REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY;
const FIREBASE_SERVICE_ACCOUNT = process.env.FIREBASE_SERVICE_ACCOUNT;

function requiredEnv(name, value) {
  if (!value) {
    throw new Error(`Missing required GitHub secret: ${name}`);
  }
}

function parseServiceAccount(json) {
  const serviceAccount = JSON.parse(json);
  if (serviceAccount.private_key) {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
  }
  return serviceAccount;
}

async function getActiveSubscriptionIds(db) {
  const snapshot = await db.collection("notificationSubscriptions").get();
  const subscriptionIds = new Set();

  for (const doc of snapshot.docs) {
    const data = doc.data() || {};
    const subscriptionId = data.oneSignalSubscriptionId || data.oneSignalId || doc.id;
    if (subscriptionId && data.oneSignalOptedIn !== false) {
      subscriptionIds.add(subscriptionId);
    }
  }

  if (!subscriptionIds.size) {
    const userDoc = await db.collection("users").doc("currentDevice").get();
    const userData = userDoc.data() || {};
    const subscriptionId = userData.oneSignalSubscriptionId || userData.oneSignalId;
    if (subscriptionId) subscriptionIds.add(subscriptionId);
  }

  return [...subscriptionIds];
}

async function sendOneSignalNotification(subscriptionIds, event) {
  const ownerName = event.ownerName || "غير محدد";
  const plate = event.plate ? ` (${event.plate})` : "";

  const response = await fetch("https://api.onesignal.com/notifications", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${ONE_SIGNAL_REST_API_KEY}`,
    },
    body: JSON.stringify({
      app_id: ONE_SIGNAL_APP_ID,
      target_channel: "push",
      include_subscription_ids: subscriptionIds,
      headings: {
        en: "Maintenance recorded",
        ar: "تم عمل صيانة",
      },
      contents: {
        en: `Maintenance was recorded for ${ownerName}${plate}`,
        ar: `تم عمل صيانة لسيارة ${ownerName}${plate}`,
      },
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`OneSignal request failed: ${response.status} ${JSON.stringify(body)}`);
  }

  return body;
}

async function getPendingEvents(db) {
  const snapshot = await db
    .collection("maintenanceNotifications")
    .where("status", "==", "pending")
    .limit(10)
    .get();

  return snapshot.docs.map((doc) => ({ id: doc.id, ref: doc.ref, ...doc.data() }));
}

async function main() {
  requiredEnv("FIREBASE_SERVICE_ACCOUNT", FIREBASE_SERVICE_ACCOUNT);
  requiredEnv("ONESIGNAL_REST_API_KEY", ONE_SIGNAL_REST_API_KEY);

  admin.initializeApp({
    credential: admin.credential.cert(parseServiceAccount(FIREBASE_SERVICE_ACCOUNT)),
  });

  const db = admin.firestore();
  const subscriptionIds = await getActiveSubscriptionIds(db);

  if (!subscriptionIds.length) {
    console.log("No OneSignal subscription IDs saved.");
    return;
  }

  const events = await getPendingEvents(db);
  if (!events.length) {
    console.log("No pending maintenance notifications.");
    return;
  }

  for (const event of events) {
    try {
      await event.ref.update({
        status: "sending",
        sendingAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const result = await sendOneSignalNotification(subscriptionIds, event);
      await event.ref.update({
        status: "sent",
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        sentToDeviceCount: subscriptionIds.length,
        oneSignalResponse: result,
      });

      console.log(`Sent maintenance notification for ${event.ownerName || event.carId} to ${subscriptionIds.length} device(s).`);
    } catch (error) {
      await event.ref.update({
        status: "error",
        errorMessage: error.message,
        errorAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      throw error;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
