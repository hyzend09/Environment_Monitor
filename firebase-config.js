const firebaseConfig = {
  apiKey: "AIzaSyAiQxS-W4StKWk3oZSklzWa4gte49xhWvE",
  authDomain: "iot-based-environmental-78fcd.firebaseapp.com",
  databaseURL: "https://iot-based-environmental-78fcd-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "iot-based-environmental-78fcd",
  storageBucket: "iot-based-environmental-78fcd.firebasestorage.app",
  messagingSenderId: "681467968990",
  appId: "1:681467968990:web:c28382f575b398693ef14f",
  measurementId: "G-RRCW0X8WPP"
};
firebase.initializeApp(firebaseConfig);
window.database = firebase.database();
window.FCM_VAPID_KEY = "PASTE_YOUR_PUBLIC_VAPID_KEY_HERE";
