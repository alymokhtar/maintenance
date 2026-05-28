# تشغيل إشعارات الصيانة اليومية عبر GitHub Actions

هذا الحل لا يحتاج Firebase Functions ولا كارت دفع. GitHub Actions سيشغل سكربت مرة يوميًا، يقرأ بيانات Firestore، ثم يرسل إشعارًا عبر OneSignal.

## 1. ارفع المشروع إلى GitHub

ارفع ملفات المشروع إلى Repository على GitHub.

تأكد أن هذه الملفات موجودة في GitHub:

- `.github/workflows/daily-maintenance-reminder.yml`
- `scripts/send-reminders.js`
- `scripts/package.json`

## 2. احصل على مفتاح OneSignal

من OneSignal:

1. افتح التطبيق الخاص بك.
2. افتح `Settings`.
3. افتح `Keys & IDs`.
4. انسخ `REST API Key`.
5. انسخ أيضًا `App ID`.

## 3. احصل على Firebase Service Account

من Firebase Console:

1. افتح مشروع `maintenance-7fecf`.
2. افتح `Project settings`.
3. افتح تبويب `Service accounts`.
4. اضغط `Generate new private key`.
5. سيتم تنزيل ملف JSON.
6. افتح الملف وانسخ محتواه كاملًا.

لا ترفع هذا الملف إلى GitHub ولا ترسله لأي شخص.

## 4. أضف GitHub Secrets

في GitHub Repository:

1. افتح `Settings`.
2. افتح `Secrets and variables`.
3. اختر `Actions`.
4. اضغط `New repository secret`.

أضف هذه الأسرار:

### FIREBASE_SERVICE_ACCOUNT

القيمة: محتوى ملف JSON الذي نزلته من Firebase كاملًا.

### ONESIGNAL_REST_API_KEY

القيمة: مفتاح `REST API Key` من OneSignal.

### ONESIGNAL_APP_ID

القيمة: `App ID` من OneSignal.

## 5. اختبار التشغيل يدويًا

في GitHub Repository:

1. افتح تبويب `Actions`.
2. اختر `Daily Maintenance Reminder`.
3. اضغط `Run workflow`.
4. انتظر حتى ينتهي التشغيل.
5. افتح نتيجة التشغيل واقرأ السجل.

إذا لم توجد سيارات تحتاج صيانة سيظهر:

```text
No cars need maintenance today.
```

إذا تم الإرسال سيظهر:

```text
Sent reminder for 1 car(s).
```

## 6. موعد التشغيل اليومي

الملف مضبوط حاليًا على التشغيل يوميًا الساعة 09:00 UTC:

```yaml
cron: "0 9 * * *"
```

يمكن تغيير الوقت من ملف:

`.github/workflows/daily-maintenance-reminder.yml`

## 7. ملاحظة مهمة

الإشعار سيُرسل فقط إذا:

- يوجد `oneSignalSubscriptionId` في `users/currentDevice`.
- توجد سيارة آخر صيانة لها مر عليها 35 يومًا أو أكثر.
- OneSignal يقبل إرسال الإشعار لهذا الاشتراك.
