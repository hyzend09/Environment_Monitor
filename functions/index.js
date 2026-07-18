const functions=require("firebase-functions");
const admin=require("firebase-admin");
admin.initializeApp();
const ROOT="/IoT_Based_Environmental";

exports.sendImmediateAlert=functions.database.ref(`${ROOT}/history/{recordId}`).onCreate(async snap=>{
  const r=snap.val()||{},db=admin.database();
  const cfg=(await db.ref(`${ROOT}/config/thresholds`).once("value")).val()||{};
  const t=Number(r.nhiet_do),h=Number(r.do_am),d=Number(r.bui_min);
  let level="safe",reasons=[];
  const danger=x=>{level="danger";reasons.push(x)},warn=x=>{if(level!=="danger")level="warning";reasons.push(x)};
  if(Number.isFinite(t)){if(t<=Number(cfg.temp_danger_low??0)||t>=Number(cfg.temp_danger_high??45))danger(`Nhiệt độ ${t}°C ở mức nguy hiểm`);else if(t<=Number(cfg.temp_warn_low??10)||t>=Number(cfg.temp_warn_high??38))warn(`Nhiệt độ ${t}°C ở mức cảnh báo`)}
  if(Number.isFinite(h)){if(h<=Number(cfg.humi_danger_low??15)||h>=Number(cfg.humi_danger_high??90))danger(`Độ ẩm ${h}% ở mức nguy hiểm`);else if(h<=Number(cfg.humi_warn_low??20)||h>=Number(cfg.humi_warn_high??80))warn(`Độ ẩm ${h}% ở mức cảnh báo`)}
  if(Number.isFinite(d)){if(d>=Number(cfg.dust_danger_high??150))danger(`Bụi ${d} µg/m³ ở mức nguy hiểm`);else if(d>=Number(cfg.dust_warn_high??80))warn(`Bụi ${d} µg/m³ ở mức cảnh báo`)}
  if(level==="safe")return null;
  const alert={type:"environment",level,message:reasons.join(" • "),node:r.node_id||r.node||"sensor",timestamp:admin.database.ServerValue.TIMESTAMP,acknowledged:false};
  await db.ref(`${ROOT}/alerts`).push(alert);
  return sendToTokens(level==="danger"?"EnviroGuard: Nguy hiểm":"EnviroGuard: Cảnh báo",alert.message,"environment");
});

exports.checkDeviceHealth=functions.pubsub.schedule("every 5 minutes").timeZone("Asia/Ho_Chi_Minh").onRun(async()=>{
  const db=admin.database(),snap=await db.ref(`${ROOT}/devices`).once("value"),now=Date.now(),jobs=[];
  snap.forEach(c=>{const v=c.val()||{},last=Number(v.last_seen||v.lastSeen||0),age=now-(last<1e12?last*1000:last);if(!last||age>6*60*1000){jobs.push(db.ref(`${ROOT}/alerts`).push({type:"device",level:"danger",node:c.key,message:`${v.name||c.key} đã mất kết nối`,timestamp:admin.database.ServerValue.TIMESTAMP,acknowledged:false}));jobs.push(sendToTokens("EnviroGuard: Thiết bị mất kết nối",`${v.name||c.key} không gửi dữ liệu quá 6 phút`,"device"))}});
  return Promise.all(jobs);
});

async function sendToTokens(title,body,category){
  const db=admin.database(),snap=await db.ref(`${ROOT}/notificationTokens`).once("value"),tokens=[];
  snap.forEach(c=>{const v=c.val()||{};if(v.enabled&&v.token&&v[category]!==false)tokens.push(v.token)});
  if(!tokens.length)return null;
  const result=await admin.messaging().sendEachForMulticast({tokens,notification:{title,body},data:{url:"/index.html#alerts",tag:category}});
  const invalid={};result.responses.forEach((r,i)=>{if(!r.success&&["messaging/registration-token-not-registered","messaging/invalid-registration-token"].includes(r.error?.code)){snap.forEach(c=>{if(c.val()?.token===tokens[i])invalid[c.key]=null})}});
  if(Object.keys(invalid).length)await db.ref(`${ROOT}/notificationTokens`).update(invalid);
  return result;
}

exports.archiveOldHistory=functions.pubsub
  .schedule("15 0 * * *")
  .timeZone("Asia/Ho_Chi_Minh")
  .onRun(async()=>{
    const db=admin.database();
    const historyRef=db.ref(`${ROOT}/history`);
    const snap=await historyRef.once("value");
    const cutoff=Date.now()-7*24*60*60*1000;
    const grouped={};

    snap.forEach(child=>{
      const value=child.val()||{};
      let timestamp=Number(value.timestamp||value.time||child.key);
      if(timestamp&&timestamp<1e12)timestamp*=1000;
      if(!timestamp||timestamp>=cutoff)return;
      const date=new Date(timestamp).toLocaleDateString("en-CA",{timeZone:"Asia/Ho_Chi_Minh"});
      if(!grouped[date])grouped[date]=[];
      grouped[date].push({key:child.key,...value});
    });

    const updates={};
    for(const [date,rows] of Object.entries(grouped)){
      const avg=field=>{
        const values=rows.map(row=>Number(row[field])).filter(Number.isFinite);
        return values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;
      };
      updates[`dailyAverages/${date}`]={
        date,
        nhiet_do_avg:avg("nhiet_do"),
        do_am_avg:avg("do_am"),
        bui_min_avg:avg("bui_min"),
        sampleCount:rows.length,
        archivedAt:admin.database.ServerValue.TIMESTAMP
      };
      rows.forEach(row=>updates[`history/${row.key}`]=null);
    }

    if(!Object.keys(updates).length)return null;
    return db.ref(ROOT).update(updates);
  });
