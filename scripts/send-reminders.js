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

function parseMaintenanceDate(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return null;
  const parts = dateStr.split("-");
  if (parts.length !== 3) return null;

  const day = Number(parts[0]);
  const month = Number(parts[1]) - 1;
  const year = Number(parts[2]);
  if (!day || month < 0 || !year) return null;

  const date = new Date(Date.UTC(year, month, day));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function getNextDueDate(dateStr) {
  const date = parseMaintenanceDate(dateStr);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + 35);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

async function getLatestMaintenance(carId, db) {
  const snapshot = await db.collection("maintenances").where("carId", "==", carId).get();
  let latest = null;
  let latestDate = null;

  for (const doc of snapshot.docs) {
    const maintenance = doc.data();
    const maintenanceDate = parseMaintenanceDate(maintenance.date);
    if (maintenanceDate && (!latestDate || maintenanceDate > latestDate)) {
      latest = maintenance;
      latestDate = maintenanceDate;
    }
  }

  return latest;
}

async function getCarsNeedingMaintenance(db) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const carsSnapshot = await db.collection("cars").get();
  const carsNeeding = [];

  for (const carDoc of carsSnapshot.docs) {
    const car = carDoc.data();
    const latestMaintenance = await getLatestMaintenance(carDoc.id, db);
    if (!latestMaintenance) continue;

    const dueDate = getNextDueDate(latestMaintenance.date);
    if (dueDate && dueDate <= today) {
      carsNeeding.push({
        id: carDoc.id,
        name: car.ownerName || car.name || "Unknown car",
        plate: car.plate || "",
        dueDate: dueDate.toISOString().slice(0, 10),
      });
    }
  }

  return carsNeeding;
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

async function sendOneSignalNotification(subscriptionIds, carsList) {
  const carNames = carsList.map((car) => car.name).join(", ");
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
        ar: "🔧 تنبيه صيانة",
      },
      contents: {
        ar: `السيارات التي تحتاج صيانة:\n${carNames}`,
      },
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`OneSignal request failed: ${response.status} ${JSON.stringify(body)}`);
  }

  return body;
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

  const carsNeeding = await getCarsNeedingMaintenance(db);
  if (!carsNeeding.length) {
    console.log("No cars need maintenance today.");
    return;
  }

  const result = await sendOneSignalNotification(subscriptionIds, carsNeeding);
  console.log(`Sent reminder for ${carsNeeding.length} car(s) to ${subscriptionIds.length} device(s).`);
  console.log(JSON.stringify({ carsNeeding, subscriptionIds, oneSignalResponse: result }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
