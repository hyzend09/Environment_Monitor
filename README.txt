TerraPulse Environmental Lab

How to run:
1. Open this folder in VS Code.
2. Right-click index.html and choose Open with Live Server.
3. Keep firebase-config.js unchanged to connect to the existing Firebase project.

Database path used by app.js:
/IoT_Based_Environmental/history

Fields used:
nhiet_do, do_am, bui_min, timestamp

Mobile notification notes:
- Click the Alerts button and allow notification permission.
- Notifications are only sent for Warning and Danger records.
- For mobile browsers, notification permission usually requires HTTPS or an installed PWA.
- This static version can show notifications while the web app/PWA is running. True Facebook/YouTube-style push when fully closed needs Firebase Cloud Messaging plus a server or Cloud Function.


Real final fix notes:
- Sensor numbers, trend badge, level label and helper text are forced to follow status color.
- Safe = green, Warning = yellow/orange, Danger = red.
- Advice text now explains what is too high or too low and gives action advice.
- If the old UI still appears, unregister the old Service Worker and hard refresh.
