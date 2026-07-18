importScripts("https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js");
importScripts("https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging.js");
firebase.initializeApp({
  apiKey:"AIzaSyAiQxS-W4StKWk3oZSklzWa4gte49xhWvE",
  authDomain:"iot-based-environmental-78fcd.firebaseapp.com",
  databaseURL:"https://iot-based-environmental-78fcd-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId:"iot-based-environmental-78fcd",
  storageBucket:"iot-based-environmental-78fcd.firebasestorage.app",
  messagingSenderId:"681467968990",
  appId:"1:681467968990:web:c28382f575b398693ef14f"
});
const messaging=firebase.messaging();
messaging.onBackgroundMessage(payload=>{
  const n=payload.notification||{};
  self.registration.showNotification(n.title||"EnviroGuard",{body:n.body||"Có thông báo mới",icon:"icon.svg",badge:"icon.svg",data:{url:"./index.html#alerts"},tag:payload.data?.tag||"enviroguard"});
});