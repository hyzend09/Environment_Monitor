(() => {
"use strict";
const ROOT="/IoT_Based_Environmental";
const HISTORY_PATH=`${ROOT}/history`, CONFIG_PATH=`${ROOT}/config`, CONTROL_PATH=`${ROOT}/control`, SNOOZE_PATH=`${ROOT}/snooze`, COMMAND_PATH=`${ROOT}/commands`, DEVICES_PATH=`${ROOT}/devices`, ALERTS_PATH=`${ROOT}/alerts`, DAILY_AVERAGES_PATH=`${ROOT}/dailyAverages`;
const DEFAULT_CONFIG={send_interval:60,fixed_times:["08:00","12:00","18:00"],listen_window:3,heartbeat:15,delta:{temp:.5,humi:2,dust:5},thresholds:{temp_danger_low:0,temp_warn_low:10,temp_safe_low:18,temp_safe_high:35,temp_warn_high:38,temp_danger_high:45,humi_danger_low:15,humi_warn_low:20,humi_safe_low:30,humi_safe_high:65,humi_warn_high:80,humi_danger_high:90,dust_safe_high:45,dust_warn_high:80,dust_danger_high:150},buzzer:{mode:"snooze",snooze_duration:600,auto_mode:true,lock_danger:false,resume_if_danger:true}};
const $=id=>document.getElementById(id), $$=sel=>[...document.querySelectorAll(sel)];
let records=[],alerts=[],devices={},dailyAverages={},config=clone(DEFAULT_CONFIG),control={buzzerOn:false,buzzerMuted:false,muteUntil:0},snooze={active:false,start_time:0,duration:0},latest=null,chart=null,firebaseOnline=false,historyLimit=60,alertLimit=40,selectedSnooze=30;

document.addEventListener("DOMContentLoaded",init);
function init(){bindNav();bindActions();tick();setInterval(tick,1000);setInterval(renderBuzzer,1000);setToday();registerSW();connectFirebase();}
function bindNav(){[...$$(".nav-btn"),...$$(".mobile-btn")].forEach(b=>b.onclick=()=>goPage(b.dataset.page));$$("[data-go]").forEach(b=>b.onclick=()=>goPage(b.dataset.go));$("menuBtn").onclick=()=>toggleSide(true);$("sidebarBackdrop").onclick=()=>toggleSide(false);const h=location.hash.slice(1);if(["overview","history","alerts","buzzer","devices","settings"].includes(h))goPage(h)}
function goPage(p){$$(".page").forEach(x=>x.classList.toggle("active",x.id===p));[...$$(".nav-btn"),...$$(".mobile-btn")].forEach(x=>x.classList.toggle("active",x.dataset.page===p));location.hash=p==="overview"?"":p;toggleSide(false);if(p==="history")renderHistory();if(p==="alerts")renderAlerts();if(p==="devices")renderDevices();}
function toggleSide(open){$("sidebar").classList.toggle("open",open);$("sidebarBackdrop").classList.toggle("show",open)}
function bindActions(){
 $("chartCount").onchange=renderChart;$("exportCsv").onclick=exportCsv;
 ["historySearch","historyNode","historyStatus","historyDate"].forEach(id=>$(id).addEventListener(id==="historySearch"?"input":"change",renderHistory));
 $("clearHistoryFilters").onclick=()=>{$("historySearch").value="";$("historyNode").value="all";$("historyStatus").value="all";$("historyDate").value="";renderHistory()};
 $("loadMoreHistory").onclick=()=>{historyLimit+=60;renderHistory()};$("loadMoreAlerts").onclick=()=>{alertLimit+=40;renderAlerts()};
 ["alertType","alertStatus","alertDate"].forEach(id=>$(id).onchange=renderAlerts);$("todayAlerts").onclick=()=>{$("alertDate").value=dateKey(Date.now());renderAlerts()};
 $("deleteAlertsSelected").onclick=deleteSelectedAlerts;
 $$(".preset").forEach(b=>b.onclick=()=>{$$(".preset").forEach(x=>x.classList.remove("active"));b.classList.add("active");selectedSnooze=Number(b.dataset.seconds);$("customSnoozeValue").value=selectedSnooze;$("customSnoozeUnit").value="seconds"});
 $("customSnoozeValue").oninput=()=>$$(".preset").forEach(x=>x.classList.remove("active"));$("customSnoozeUnit").onchange=()=>$$(".preset").forEach(x=>x.classList.remove("active"));
 $("startSnooze").onclick=startSnooze;$("cancelSnooze").onclick=cancelSnooze;
 $("autoMode").onchange=e=>saveBuzzerSetting("auto_mode",e.target.checked);$("lockDanger").onchange=e=>saveBuzzerSetting("lock_danger",e.target.checked);$("resumeIfDanger").onchange=e=>saveBuzzerSetting("resume_if_danger",e.target.checked);
 $("refreshDevices").onclick=()=>{renderDevices();toast("Đã kiểm tra lại trạng thái hai node")};
 $("sendIntervalUnit").onchange=updateSendIntervalLimits;
 $("addFixedTime").onclick=()=>addFixedTime("08:00");$("configForm").onsubmit=saveConfig;$("resetConfig").onclick=()=>{config=clone(DEFAULT_CONFIG);fillConfig();toast("Đã khôi phục cấu hình mặc định. Nhấn Lưu thay đổi để ghi lên Firebase.")};
 $("notificationToggle").onchange=toggleNotifications;$("notificationPermission").onclick=toggleNotifications;
 document.addEventListener("click",e=>{const d=e.target.closest("[data-alert-key]");if(d)deleteAlert(d.dataset.alertKey)});
}
function connectFirebase(){
 if(!window.database){setConnection(false,"Thiếu cấu hình Firebase");return}
 database.ref(".info/connected").on("value",s=>setConnection(s.val()===true,s.val()===true?"Firebase online":"Firebase offline"));
 database.ref(HISTORY_PATH).limitToLast(5000).on("value",snap=>{const arr=[];snap.forEach(c=>{const r=normalize(c.val(),c.key);if(r)arr.push(r)});arr.sort((a,b)=>a.time-b.time);records=arr;latest=arr.at(-1)||null;renderAll()});
 database.ref(CONFIG_PATH).on("value",s=>{config=mergeDeep(clone(DEFAULT_CONFIG),s.val()||{});normalizeFixedTimes();fillConfig();renderOverview()});
 database.ref(CONTROL_PATH).on("value",s=>{control={...control,...(s.val()||{})};renderBuzzer();renderOverview()});
 database.ref(SNOOZE_PATH).on("value",s=>{snooze={...snooze,...(s.val()||{})};renderBuzzer()});
 database.ref(DEVICES_PATH).on("value",s=>{devices=s.val()||{};renderDevices();renderOverview()});
 database.ref(ALERTS_PATH).limitToLast(1000).on("value",s=>{const a=[];s.forEach(c=>a.push({key:c.key,...c.val()}));alerts=a.sort((x,y)=>timeMs(x.timestamp)-timeMs(y.timestamp));renderAlerts()});
 database.ref(DAILY_AVERAGES_PATH).on("value",s=>{dailyAverages=s.val()||{};renderAverages()});
}
function normalize(raw,key){if(!raw||typeof raw!=="object")return null;const temp=num(raw.nhiet_do??raw.temperature??raw.temp),humid=num(raw.do_am??raw.humidity??raw.humid),dust=num(raw.bui_min??raw.bui??raw.pm25??raw.dust);let t=Number(raw.timestamp??raw.time??key);if(!Number.isFinite(t))t=Date.now();if(t<1e12)t*=1000;const node=String(raw.node_id??raw.nodeId??raw.node??"combined");return {key,time:t,temp,humid,dust,node,...analyze(temp,humid,dust)}}
function analyze(temp,humid,dust){const th=config.thresholds;let level=0,reasons=[];const add=(l,t)=>{level=Math.max(level,l);reasons.push(t)};
 if(Number.isFinite(temp)){if(temp<=th.temp_danger_low)add(2,`Nhiệt độ ${fmt(temp)}°C nguy hiểm thấp`);else if(temp<=th.temp_warn_low)add(1,`Nhiệt độ ${fmt(temp)}°C cảnh báo thấp`);else if(temp>=th.temp_danger_high)add(2,`Nhiệt độ ${fmt(temp)}°C nguy hiểm cao`);else if(temp>=th.temp_warn_high)add(1,`Nhiệt độ ${fmt(temp)}°C cảnh báo cao`)}
 if(Number.isFinite(humid)){if(humid<=th.humi_danger_low)add(2,`Độ ẩm ${fmt(humid)}% nguy hiểm thấp`);else if(humid<=th.humi_warn_low)add(1,`Độ ẩm ${fmt(humid)}% cảnh báo thấp`);else if(humid>=th.humi_danger_high)add(2,`Độ ẩm ${fmt(humid)}% nguy hiểm cao`);else if(humid>=th.humi_warn_high)add(1,`Độ ẩm ${fmt(humid)}% cảnh báo cao`)}
 if(Number.isFinite(dust)){if(dust>=th.dust_danger_high)add(2,`Bụi ${fmt(dust)} µg/m³ nguy hiểm`);else if(dust>=th.dust_warn_high)add(1,`Bụi ${fmt(dust)} µg/m³ cảnh báo`)}
 return {status:level===2?"danger":level===1?"warning":"safe",reasons:reasons.length?reasons:["Các chỉ số trong vùng an toàn"]}}
function renderAll(){records=records.map(r=>({...r,...analyze(r.temp,r.humid,r.dust)}));latest=records.at(-1)||null;renderOverview();renderChart();renderHistory();renderAlerts();renderDevices();renderBuzzer()}
function renderOverview(){
 if(!latest){$("systemState").textContent="Đang chờ dữ liệu";return}
 const m={safe:["An toàn","Tất cả chỉ số trong vùng cho phép","✓"],warning:["Cảnh báo",latest.reasons.join(" • "),"!"],danger:["Nguy hiểm",latest.reasons.join(" • "),"!"]}[latest.status];
 $("systemBanner").className=`system-banner ${latest.status}`;$("systemState").textContent=m[0];$("systemMessage").textContent=m[1];$("systemIcon").textContent=m[2];
 setMetric("temp",latest.temp,metricStatus("temp",latest.temp),Math.max(4,Math.min(100,latest.temp/50*100)));setMetric("humid",latest.humid,metricStatus("humid",latest.humid),Math.max(4,Math.min(100,latest.humid)));setMetric("dust",latest.dust,metricStatus("dust",latest.dust),Math.max(4,Math.min(100,latest.dust/180*100)));
 $("latestDateTime").textContent=formatDateTime(latest.time);$("sideLatest").textContent=formatTime(latest.time);
 const states=getNodeStates(),healthy=states.filter(x=>x.level==="online").length;$("nodeCountText").textContent=`${healthy}/2`;$("healthScore").textContent=`${Math.round(healthy/2*100)}%`;$("healthTitle").textContent=healthy===2?"Hệ thống hoạt động tốt":healthy===1?"Một node cần kiểm tra":"Hai node cần kiểm tra";$("healthNote").textContent=states.map(s=>`${s.name}: ${s.label}`).join(" • ");
 $("sendIntervalSummary").textContent=formatSendInterval(config.send_interval);$("fixedTimesSummary").textContent=(config.fixed_times||[]).join(", ")||"--";$("buzzerSummary").textContent=snooze.active?"Đang snooze":control.buzzerOn?"Đang kêu":"Sẵn sàng";
 renderAverages();$("overviewHistoryBody").innerHTML=records.slice(-8).reverse().map(tableRow).join("")||`<tr><td colspan="6">Chưa có dữ liệu.</td></tr>`;
}
function setMetric(id,v,status,pct){$(id+"Value").textContent=Number.isFinite(v)?fmt(v):"--";$(id+"Card").className=`metric ${status}`;$(id+"State").textContent=label(status);$(id+"Bar").style.width=pct+"%"}
function metricStatus(type,v){const t=config.thresholds;if(!Number.isFinite(v))return"warning";if(type==="temp")return v<=t.temp_danger_low||v>=t.temp_danger_high?"danger":v<=t.temp_warn_low||v>=t.temp_warn_high?"warning":"safe";if(type==="humid")return v<=t.humi_danger_low||v>=t.humi_danger_high?"danger":v<=t.humi_warn_low||v>=t.humi_warn_high?"warning":"safe";return v>=t.dust_danger_high?"danger":v>=t.dust_warn_high?"warning":"safe"}
function renderChart(){if(!$("mainChart"))return;const n=Number($("chartCount").value||24),d=records.slice(-n);if(chart)chart.destroy();chart=new Chart($("mainChart"),{type:"line",data:{labels:d.map(r=>formatTime(r.time)),datasets:[{label:"Nhiệt độ °C",data:d.map(r=>r.temp),borderColor:"#20ad67",backgroundColor:"rgba(32,173,103,.1)",tension:.35,pointRadius:2},{label:"Độ ẩm %",data:d.map(r=>r.humid),borderColor:"#2d7eea",backgroundColor:"rgba(45,126,234,.1)",tension:.35,pointRadius:2},{label:"Bụi µg/m³",data:d.map(r=>r.dust),borderColor:"#f4a30b",backgroundColor:"rgba(244,163,11,.1)",tension:.35,pointRadius:2}]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:"index",intersect:false},plugins:{legend:{position:"bottom",labels:{usePointStyle:true,boxWidth:8}}},scales:{x:{grid:{display:false}},y:{beginAtZero:true,grid:{color:"rgba(100,116,139,.12)"}}}}})}
function renderAverages(){
 if(!$("averageGrid"))return;
 const periods=[["Hôm nay",1,true],["2 ngày",2,false],["7 ngày",7,false],["30 ngày",30,false]];
 $("averageGrid").innerHTML=periods.map(([name,days,today])=>{
   const start=today?startOfDay(Date.now()):Date.now()-days*864e5;
   const live=records.filter(r=>r.time>=start);
   const archived=Object.values(dailyAverages||{}).filter(x=>{
     const ts=Date.parse((x.date||"")+"T00:00:00");
     return Number.isFinite(ts)&&ts>=start;
   });
   const a=combinedAverage(live,archived);
   const count=live.length+archived.reduce((s,x)=>s+Number(x.sampleCount||0),0);
   return `<div class="average-card"><strong>${name}</strong>${a?`<span>${fmt(a.temp)} <small>°C</small></span><span>${fmt(a.humid)} <small>%</small></span><span>${fmt(a.dust)} <small>µg/m³</small></span><small>${count} mẫu</small>`:`<small>Chưa có dữ liệu</small>`}</div>`
 }).join("")
}
function filteredHistory(){const q=$("historySearch").value.toLowerCase().trim(),node=$("historyNode").value,status=$("historyStatus").value,date=$("historyDate").value;return records.filter(r=>(status==="all"||r.status===status)&&(!date||dateKey(r.time)===date)&&(node==="all"||nodeType(r)===node)&&(!q||formatDateTime(r.time).toLowerCase().includes(q)||r.node.toLowerCase().includes(q)||label(r.status).toLowerCase().includes(q))).reverse()}
function renderHistory(){if(!$("historyList"))return;const all=filteredHistory(),shown=all.slice(0,historyLimit);$("historyList").innerHTML=shown.map(r=>`<article class="record-card ${r.status}"><div><span>Thời gian</span><strong>${formatDateTime(r.time)}</strong></div><div><span>Sensor node</span><strong>${nodeName(r)}</strong></div><div><span>Nhiệt độ</span><strong>${Number.isFinite(r.temp)?fmt(r.temp)+" °C":"--"}</strong></div><div><span>Độ ẩm</span><strong>${Number.isFinite(r.humid)?fmt(r.humid)+"%":"--"}</strong></div><div><span>Bụi mịn</span><strong>${Number.isFinite(r.dust)?fmt(r.dust):"--"}</strong></div><div><span class="state ${r.status}">${label(r.status)}</span></div></article>`).join("")||`<div class="panel">Chưa có dữ liệu phù hợp.</div>`;$("historyCount").textContent=`Hiển thị ${shown.length} / ${all.length} bản ghi`;$("loadMoreHistory").style.display=shown.length<all.length?"inline-flex":"none"}
function renderAlerts(){if(!$("alertList"))return;const date=$("alertDate").value,type=$("alertType").value,status=$("alertStatus").value;let all=alerts.length?alerts.map(a=>normalizeAlert(a)):records.filter(r=>r.status!=="safe").map(r=>({key:"history-"+r.key,type:"environment",status:r.status,time:r.time,message:r.reasons.join(" • "),node:nodeName(r)}));all=all.filter(a=>(type==="all"||a.type===type)&&(status==="all"||a.status===status)&&(!date||dateKey(a.time)===date)).reverse();const shown=all.slice(0,alertLimit);$("alertList").innerHTML=shown.map(a=>`<article class="alert-card ${a.status}"><input class="alert-check" type="checkbox" value="${esc(a.key)}"><div class="alert-main"><div><small>Thời gian</small><strong>${formatDateTime(a.time)}</strong></div><div><small>Loại</small><strong>${a.type==="device"?"Thiết bị":"Môi trường"}</strong></div><div><small>Nội dung</small><strong>${esc(a.message)}</strong><small>${esc(a.node||"")}</small></div></div><div class="alert-actions"><span class="state ${a.status}">${label(a.status)}</span>${!a.key.startsWith("history-")?`<button class="delete-btn" data-alert-key="${esc(a.key)}" title="Xóa">⌫</button>`:""}</div></article>`).join("")||`<div class="panel">Không có cảnh báo phù hợp.</div>`;$("alertCount").textContent=`${all.length} cảnh báo`;$("alertBadge").textContent=String(all.filter(a=>dateKey(a.time)===dateKey(Date.now())).length);$("loadMoreAlerts").style.display=shown.length<all.length?"inline-flex":"none"}
function normalizeAlert(a){return {key:a.key,type:a.type||((a.device||a.node_status)?"device":"environment"),status:a.level==="critical"?"danger":a.level||a.status||"warning",time:timeMs(a.timestamp),message:a.message||a.content||a.reason||"Cảnh báo",node:a.node_name||a.node||""}}
async function deleteAlert(key){if(!confirm("Xóa cảnh báo này?"))return;try{await database.ref(`${ALERTS_PATH}/${key}`).remove();toast("Đã xóa cảnh báo")}catch(e){toast(e.message)}}
async function deleteSelectedAlerts(){const keys=$$(".alert-check:checked").map(x=>x.value).filter(x=>!x.startsWith("history-"));if(!keys.length)return toast("Chưa chọn cảnh báo Firebase nào");if(!confirm(`Xóa ${keys.length} cảnh báo?`))return;const up={};keys.forEach(k=>up[k]=null);await database.ref(ALERTS_PATH).update(up);toast("Đã xóa cảnh báo đã chọn")}
function renderDevices(){if(!$("deviceGrid"))return;const states=getNodeStates();$("healthyNodes").textContent=states.filter(s=>s.level==="online").length;$("problemNodes").textContent=states.filter(s=>s.level!=="online").length;$("deviceBadge").textContent=states.filter(s=>s.level!=="online").length;$("deviceGrid").innerHTML=states.map(s=>deviceCard(s)).join("")}
function getNodeStates(){const now=Date.now(),latestClimate=getLatestFor("climate"),latestDust=getLatestFor("dust");return [buildNode("climate","Node nhiệt độ & độ ẩm","Đo nhiệt độ và độ ẩm",latestClimate,devices.climate_node||devices.node_climate||devices.node_01,now),buildNode("dust","Node bụi mịn","Đo nồng độ bụi",latestDust,devices.dust_node||devices.node_dust||devices.node_02,now)]}
function buildNode(id,name,desc,last,raw,now){let seen=timeMs(raw?.last_seen??raw?.lastSeen??last?.time??0),age=seen?now-seen:Infinity,level=age<=180000?"online":age<=360000?"slow":"offline";let label=level==="online"?"Hoạt động tốt":level==="slow"?"Cập nhật chậm":"Mất kết nối";return {id,name,desc,last,raw:raw||{},seen,age,level,label}}
function getLatestFor(type){const subset=records.filter(r=>nodeType(r)===type||r.node==="combined");return subset.at(-1)||null}
function nodeType(r){const n=r.node.toLowerCase();if(n.includes("dust")||n.includes("bui")||n.includes("02"))return"dust";if(n.includes("temp")||n.includes("humi")||n.includes("climate")||n.includes("01"))return"climate";if(Number.isFinite(r.dust)&&!Number.isFinite(r.temp)&&!Number.isFinite(r.humid))return"dust";return"climate"}
function deviceCard(s){const raw=s.raw,stuck=detectStuck(s.id),signal=raw.wifi_rssi??raw.wifiRssi??raw.lora_rssi??raw.loraRssi??"--";const health=s.id==="climate"?`<div><span>Nhiệt độ</span><strong class="${stuck.temp?"warn":"ok"}">${stuck.temp?"Có thể bị treo":"Hoạt động tốt"}</strong></div><div><span>Độ ẩm</span><strong class="${stuck.humid?"warn":"ok"}">${stuck.humid?"Có thể bị treo":"Hoạt động tốt"}</strong></div>`:`<div><span>Bụi mịn</span><strong class="${stuck.dust?"warn":"ok"}">${stuck.dust?"Có thể bị treo":"Hoạt động tốt"}</strong></div>`;return `<article class="device-card ${s.level}"><div class="device-card-head"><div><h2>${s.name}</h2><p>${s.desc}</p></div><span class="state ${s.level==="online"?"safe":s.level==="slow"?"warning":"danger"}">${s.label}</span></div><div class="device-meta"><div><span>Cập nhật cuối</span><strong>${s.seen?formatDateTime(s.seen):"Chưa có dữ liệu"}</strong></div><div><span>Tín hiệu</span><strong>${signal}${signal!=="--"?" dBm":""}</strong></div><div><span>Firmware</span><strong>${raw.firmware||"--"}</strong></div><div><span>Uptime</span><strong>${raw.uptime?formatDuration(raw.uptime):"--"}</strong></div></div><div class="sensor-health">${health}<div><span>Kết nối dữ liệu</span><strong class="${s.level==="online"?"ok":s.level==="slow"?"warn":"bad"}">${s.label}</strong></div></div></article>`}
function detectStuck(type){const rs=records.filter(r=>nodeType(r)===type).slice(-12),eq=k=>rs.length>=8&&rs.every(r=>Number.isFinite(r[k]))&&new Set(rs.map(r=>fmt(r[k]))).size===1;return {temp:eq("temp"),humid:eq("humid"),dust:eq("dust")}}
function renderBuzzer(){
 if(!$("buzzerText"))return;
 const now=Date.now();
 const snoozeUntil=Number(snooze.start_time||0)+Number(snooze.duration||0)*1000;
 const controlUntil=Number(control.muteUntil||0);
 const until=Math.max(snoozeUntil,controlUntil);
 const active=(!!snooze.active||!!control.buzzerMuted)&&until>now;
 if((snooze.active||control.buzzerMuted)&&!active&&window.database){
   const expiredAt=Date.now();
   database.ref(ROOT).update({
     "snooze/active":false,
     "snooze/start_time":0,
     "snooze/duration":0,
     "control/buzzerMuted":false,
     "control/manualCommand":"auto",
     "control/command":"mute_expired",
     "control/muteUntil":0,
     "control/muteSeconds":0,
     "control/updatedAt":firebase.database.ServerValue.TIMESTAMP,
     "commands/pending":true,
     "commands/id":`web-${expiredAt}`,
     "commands/command":"BUZZER_AUTO",
     "commands/duration":0,
     "commands/muteUntil":0,
     "commands/source":"web",
     "commands/acknowledged":false,
     "commands/timestamp":firebase.database.ServerValue.TIMESTAMP
   }).catch(error=>console.error("Không thể kết thúc snooze:",error));
 }
 $("countdownWrap").classList.toggle("hidden",!active);
 $("cancelSnooze").classList.toggle("hidden",!active);
 $("startSnooze").classList.toggle("hidden",active);
 $("buzzerLamp").className=`buzzer-icon ${control.buzzerOn&&!active?"on":""}`;
 $("buzzerText").textContent=active?"Chuông đang tắt tạm thời":control.buzzerOn?"Chuông đang kêu":"Chuông đang chờ";
 $("buzzerNote").textContent=active?"Chuông sẽ tự bật lại khi hết thời gian.":control.buzzerOn?"Hệ thống đang yêu cầu phát cảnh báo.":"Chuông chỉ kêu khi hệ thống yêu cầu hoặc được kích hoạt tự động.";
 $("muteCountdown").textContent=active?countdown(until-now):"00:00";
 $("autoMode").checked=!!config.buzzer.auto_mode;
 $("lockDanger").checked=!!config.buzzer.lock_danger;
 $("resumeIfDanger").checked=config.buzzer.resume_if_danger!==false
}
// async function startSnooze(){
//  let value=Number($("customSnoozeValue").value||selectedSnooze);
//  let seconds=$("customSnoozeUnit").value==="minutes"?value*60:value;
//  if($$(".preset.active").length)seconds=selectedSnooze;
//  if(seconds<30||seconds>3600)return toast("Thời gian phải từ 30 giây đến 60 phút");
//  if(latest?.status==="danger"&&config.buzzer.lock_danger)return toast("Đang khóa tắt tạm thời vì hệ thống ở mức nguy hiểm");
//  const now=Date.now(),until=now+seconds*1000;
//  try{
//    await Promise.all([
//      database.ref(CONTROL_PATH).update({
//        buzzerMuted:true,
//        buzzerOn:false,
//        command:"mute",
//        manualCommand:"off",
//        muteMinutes:seconds/60,
//        muteUntil:until,
//        updatedAt:firebase.database.ServerValue.TIMESTAMP
//      }),
//      database.ref(SNOOZE_PATH).set({
//        active:true,
//        start_time:now,
//        duration:seconds,
//        level_before:latest?.status||"safe"
//      }),
//      database.ref(COMMAND_PATH).set({
//        pending:true,
//        command:"BUZZER_SNOOZE",
//        duration:seconds,
//        timestamp:firebase.database.ServerValue.TIMESTAMP
//      })
//    ]);
//    toast("Đã gửi lệnh tắt chuông tạm thời")
//  }catch(error){toast("Không gửi được lệnh: "+error.message)}
// }

async function startSnooze() {
    let value = Number(
        $("customSnoozeValue").value || selectedSnooze
    );

    let seconds =
        $("customSnoozeUnit").value === "minutes"
            ? value * 60
            : value;

    if ($$(".preset.active").length) {
        seconds = selectedSnooze;
    }

    if (seconds < 30 || seconds > 3600) {
        return toast("Thời gian phải từ 30 giây đến 60 phút");
    }

    const now = Date.now();
    const muteUntil = now + seconds * 1000;
    const commandId = `web-${now}`;

    try {
        await database.ref(ROOT).update({
            "control/buzzerMuted": true,
            "control/buzzerOn": false,
            "control/manualCommand": "off",
            "control/command": "web_mute",
            "control/muteUntil": muteUntil,
            "control/muteSeconds": seconds,
            "control/updatedAt":
                firebase.database.ServerValue.TIMESTAMP,

            "snooze/active": true,
            "snooze/start_time": now,
            "snooze/duration": seconds,
            "snooze/level_before":
                latest?.status || "safe",

            "commands/pending": true,
            "commands/id": commandId,
            "commands/command": "BUZZER_OFF",
            "commands/duration": seconds,
            "commands/muteUntil": muteUntil,
            "commands/source": "web",
            "commands/acknowledged": false,
            "commands/timestamp":
                firebase.database.ServerValue.TIMESTAMP
        });

        toast("Đã gửi lệnh tắt chuông đến thiết bị");
    } catch (error) {
        console.error(error);
        toast("Không gửi được lệnh: " + error.message);
    }
}
async function cancelSnooze(){
 const now=Date.now();
 const commandId=`web-${now}`;
 try{
   await database.ref(ROOT).update({
     "control/buzzerMuted":false,
     "control/buzzerOn":false,
     "control/command":"web_resume_auto",
     "control/manualCommand":"auto",
     "control/muteUntil":0,
     "control/muteSeconds":0,
     "control/updatedAt":firebase.database.ServerValue.TIMESTAMP,

     "snooze/active":false,
     "snooze/start_time":0,
     "snooze/duration":0,

     "commands/pending":true,
     "commands/id":commandId,
     "commands/command":"BUZZER_AUTO",
     "commands/duration":0,
     "commands/muteUntil":0,
     "commands/source":"web",
     "commands/acknowledged":false,
     "commands/timestamp":firebase.database.ServerValue.TIMESTAMP
   });
   toast("Chuông đã trở lại chế độ tự động")
 }catch(error){
   console.error(error);
   toast("Không gửi được lệnh: "+error.message)
 }
}
async function saveBuzzerSetting(k,v){config.buzzer[k]=v;await database.ref(`${CONFIG_PATH}/buzzer/${k}`).set(v);await signalSync();toast("Đã cập nhật thiết lập an toàn")}
function fillConfig(){normalizeFixedTimes();fillSendIntervalInput(config.send_interval);$("deltaTemp").value=config.delta.temp;$("deltaHumi").value=config.delta.humi;$("deltaDust").value=config.delta.dust;const m={tempDangerLow:"temp_danger_low",tempWarnLow:"temp_warn_low",tempSafeLow:"temp_safe_low",tempSafeHigh:"temp_safe_high",tempWarnHigh:"temp_warn_high",tempDangerHigh:"temp_danger_high",humiDangerLow:"humi_danger_low",humiWarnLow:"humi_warn_low",humiSafeLow:"humi_safe_low",humiSafeHigh:"humi_safe_high",humiWarnHigh:"humi_warn_high",humiDangerHigh:"humi_danger_high",dustSafeHigh:"dust_safe_high",dustWarnHigh:"dust_warn_high",dustDangerHigh:"dust_danger_high"};Object.entries(m).forEach(([id,k])=>$(id).value=config.thresholds[k]);renderFixedTimes()}
function normalizeFixedTimes(){let x=config.fixed_times;if(typeof x==="string")x=x.split(",");if(!Array.isArray(x)||!x.length)x=["08:00"];config.fixed_times=[...new Set(x.map(String).filter(t=>/^\d{2}:\d{2}$/.test(t)))].sort()}
function renderFixedTimes(){$("fixedTimes").innerHTML=config.fixed_times.map((t,i)=>`<div class="time-chip"><input type="time" value="${t}" data-time-index="${i}"><button type="button" data-remove-time="${i}" title="Xóa">×</button></div>`).join("");$$("[data-time-index]").forEach(x=>x.onchange=e=>{config.fixed_times[Number(e.target.dataset.timeIndex)]=e.target.value;normalizeFixedTimes();renderFixedTimes()});$$("[data-remove-time]").forEach(x=>x.onclick=e=>{if(config.fixed_times.length<=1)return toast("Phải giữ ít nhất một mốc giờ");config.fixed_times.splice(Number(e.target.dataset.removeTime),1);renderFixedTimes()})}
function addFixedTime(t){
 let candidate=t||"08:00",tries=0;
 while(config.fixed_times.includes(candidate)&&tries<144){
   const parts=candidate.split(":").map(Number);
   const total=(parts[0]*60+parts[1]+10)%1440;
   candidate=String(Math.floor(total/60)).padStart(2,"0")+":"+String(total%60).padStart(2,"0");
   tries++;
 }
 config.fixed_times.push(candidate);normalizeFixedTimes();renderFixedTimes()
}
async function saveConfig(e){
 e.preventDefault();
 const next=clone(config);
 const intervalValue=Number($("sendIntervalValue").value);
 const intervalUnit=$("sendIntervalUnit").value;
 const intervalMultiplier=intervalUnit==="hours"?3600:intervalUnit==="minutes"?60:1;
 next.send_interval=Math.round(intervalValue*intervalMultiplier);
 if(!Number.isFinite(next.send_interval)||next.send_interval<30||next.send_interval>7200)return toast("Chu kỳ gửi phải từ 30 giây đến 2 giờ");
 next.delta={temp:Number($("deltaTemp").value),humi:Number($("deltaHumi").value),dust:Number($("deltaDust").value)};
 const map={temp_danger_low:"tempDangerLow",temp_warn_low:"tempWarnLow",temp_safe_low:"tempSafeLow",temp_safe_high:"tempSafeHigh",temp_warn_high:"tempWarnHigh",temp_danger_high:"tempDangerHigh",humi_danger_low:"humiDangerLow",humi_warn_low:"humiWarnLow",humi_safe_low:"humiSafeLow",humi_safe_high:"humiSafeHigh",humi_warn_high:"humiWarnHigh",humi_danger_high:"humiDangerHigh",dust_safe_high:"dustSafeHigh",dust_warn_high:"dustWarnHigh",dust_danger_high:"dustDangerHigh"};
 Object.entries(map).forEach(([k,id])=>next.thresholds[k]=Number($(id).value));
 const t=next.thresholds;
 if(!(t.temp_danger_low<t.temp_warn_low&&t.temp_warn_low<t.temp_safe_low&&t.temp_safe_low<t.temp_safe_high&&t.temp_safe_high<t.temp_warn_high&&t.temp_warn_high<t.temp_danger_high))return toast("Kiểm tra lại thứ tự ngưỡng nhiệt độ");
 if(!(t.humi_danger_low<t.humi_warn_low&&t.humi_warn_low<t.humi_safe_low&&t.humi_safe_low<t.humi_safe_high&&t.humi_safe_high<t.humi_warn_high&&t.humi_warn_high<t.humi_danger_high))return toast("Kiểm tra lại thứ tự ngưỡng độ ẩm");
 if(!(t.dust_safe_high<t.dust_warn_high&&t.dust_warn_high<t.dust_danger_high))return toast("Ngưỡng bụi phải tăng dần");
 if(!next.fixed_times.length)return toast("Phải có ít nhất một mốc giờ");
 if(!validTimeSpacing(next.fixed_times))return toast("Các mốc giờ phải cách nhau tối thiểu 10 phút");
 config=next;
 try{
   await database.ref(CONFIG_PATH).update({
     send_interval:config.send_interval,
     fixed_times:config.fixed_times,
     delta:config.delta,
     thresholds:config.thresholds,
     buzzer:config.buzzer,
     version:firebase.database.ServerValue.TIMESTAMP,
     updatedAt:firebase.database.ServerValue.TIMESTAMP
   });
   await signalSync();
   toast("Đã lưu cấu hình lên Firebase")
 }catch(error){toast("Không lưu được cấu hình: "+error.message)}
}
function fillSendIntervalInput(value){
 const seconds=normalizeSendInterval(value);
 let unit="seconds",display=seconds;
 if(seconds%3600===0){
   unit="hours";
   display=seconds/3600;
 }else if(seconds%60===0){
   unit="minutes";
   display=seconds/60;
 }
 $("sendIntervalUnit").value=unit;
 $("sendIntervalValue").value=display;
 updateSendIntervalLimits();
}
function updateSendIntervalLimits(){
 const unit=$("sendIntervalUnit").value;
 const input=$("sendIntervalValue");
 if(unit==="hours"){
   input.min="0.0083333333";
   input.max="2";
   input.step="0.1";
 }else if(unit==="minutes"){
   input.min="0.5";
   input.max="120";
   input.step="0.5";
 }else{
   input.min="30";
   input.max="7200";
   input.step="1";
 }
}
function normalizeSendInterval(value){
 const n=Number(value);
 if(!Number.isFinite(n))return 60;
 return Math.min(7200,Math.max(30,Math.round(n)));
}
function formatSendInterval(value){
 const seconds=normalizeSendInterval(value);
 if(seconds%3600===0)return`${seconds/3600} giờ / lần`;
 if(seconds%60===0)return`${seconds/60} phút / lần`;
 if(seconds>3600){
   const h=Math.floor(seconds/3600),m=Math.floor((seconds%3600)/60),s=seconds%60;
   return`${h} giờ${m?` ${m} phút`:""}${s?` ${s} giây`:""} / lần`;
 }
 if(seconds>60){
   const m=Math.floor(seconds/60),s=seconds%60;
   return`${m} phút${s?` ${s} giây`:""} / lần`;
 }
 return`${seconds} giây / lần`;
}
function validTimeSpacing(ts){const mins=[...ts].sort().map(t=>{const[h,m]=t.split(":").map(Number);return h*60+m});for(let i=1;i<mins.length;i++)if(mins[i]-mins[i-1]<10)return false;if(mins.length>1&&1440-mins.at(-1)+mins[0]<10)return false;return true}
async function signalSync(){await database.ref(COMMAND_PATH).set({pending:true,command:"SYNC_CONFIG",timestamp:firebase.database.ServerValue.TIMESTAMP})}
async function toggleNotifications(){if(!("Notification"in window))return toast("Trình duyệt không hỗ trợ thông báo");const p=await Notification.requestPermission();const on=p==="granted";$("notificationToggle").checked=on;localStorage.setItem("enviroguard.notifications",String(on));if(on)await registerMessagingToken();toast(on?"Thông báo đã được bật":"Chưa được cấp quyền thông báo")}
async function registerMessagingToken(){try{if(!firebase.messaging||!window.FCM_VAPID_KEY||window.FCM_VAPID_KEY.includes("PASTE"))return;const reg=await navigator.serviceWorker.ready,token=await firebase.messaging().getToken({vapidKey:window.FCM_VAPID_KEY,serviceWorkerRegistration:reg});if(token){const key=await sha256(token);await database.ref(`${ROOT}/notificationTokens/${key}`).set({token,enabled:true,environment:$("notifyEnvironment").checked,device:$("notifyDevice").checked,updatedAt:firebase.database.ServerValue.TIMESTAMP})}}catch(e){console.warn(e)}}
function setToday(){$("alertDate").value=dateKey(Date.now())}
function setConnection(ok,text){firebaseOnline=ok;$("connection").className=`status-pill ${ok?"online":"offline"}`;$("connection").textContent=text;$("firebaseStateText").textContent=ok?"Online":"Offline";$("sideFirebase").textContent=ok?"Online":"Offline"}
function tableRow(r){return `<tr class="row-${r.status}"><td>${formatDateTime(r.time)}</td><td>${nodeName(r)}</td><td>${Number.isFinite(r.temp)?fmt(r.temp)+"°C":"--"}</td><td>${Number.isFinite(r.humid)?fmt(r.humid)+"%":"--"}</td><td>${Number.isFinite(r.dust)?fmt(r.dust):"--"}</td><td><span class="state ${r.status}">${label(r.status)}</span></td></tr>`}
function exportCsv(){const rows=[["timestamp","node","nhiet_do","do_am","bui_min","status"],...filteredHistory().reverse().map(r=>[new Date(r.time).toISOString(),r.node,r.temp,r.humid,r.dust,r.status])],blob=new Blob(["\ufeff"+rows.map(r=>r.join(",")).join("\n")],{type:"text/csv;charset=utf-8"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`enviroguard-${dateKey(Date.now())}.csv`;a.click();URL.revokeObjectURL(a.href)}
function tick(){const d=new Date();$("clock").textContent=d.toLocaleTimeString("vi-VN");$("sideClock").textContent=d.toLocaleTimeString("vi-VN");$("sideDate").textContent=d.toLocaleDateString("vi-VN")}
function registerSW(){if("serviceWorker"in navigator)navigator.serviceWorker.register("sw.js?v=8").catch(console.warn)}
function nodeName(r){return nodeType(r)==="dust"?"Node bụi mịn":"Node nhiệt độ & độ ẩm"}function label(s){return s==="danger"?"Nguy hiểm":s==="warning"?"Cảnh báo":s==="offline"?"Mất kết nối":"An toàn"}
function clone(value){return JSON.parse(JSON.stringify(value))}
function combinedAverage(live,archived){
 const sums={temp:0,humid:0,dust:0},counts={temp:0,humid:0,dust:0};
 live.forEach(r=>{if(Number.isFinite(r.temp)){sums.temp+=r.temp;counts.temp++}if(Number.isFinite(r.humid)){sums.humid+=r.humid;counts.humid++}if(Number.isFinite(r.dust)){sums.dust+=r.dust;counts.dust++}});
 archived.forEach(r=>{const n=Number(r.sampleCount||0);if(n>0&&Number.isFinite(Number(r.nhiet_do_avg))){sums.temp+=Number(r.nhiet_do_avg)*n;counts.temp+=n}if(n>0&&Number.isFinite(Number(r.do_am_avg))){sums.humid+=Number(r.do_am_avg)*n;counts.humid+=n}if(n>0&&Number.isFinite(Number(r.bui_min_avg))){sums.dust+=Number(r.bui_min_avg)*n;counts.dust+=n}});
 if(!counts.temp&&!counts.humid&&!counts.dust)return null;
 return {temp:counts.temp?sums.temp/counts.temp:NaN,humid:counts.humid?sums.humid/counts.humid:NaN,dust:counts.dust?sums.dust/counts.dust:NaN}
}
function average(a){if(!a.length)return null;const vals=k=>a.map(x=>x[k]).filter(Number.isFinite);const av=k=>{const x=vals(k);return x.length?x.reduce((s,v)=>s+v,0)/x.length:NaN};return{temp:av("temp"),humid:av("humid"),dust:av("dust")}}
function startOfDay(t){const d=new Date(t);d.setHours(0,0,0,0);return d.getTime()}function dateKey(t){const d=new Date(t),p=n=>String(n).padStart(2,"0");return`${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`}function formatDateTime(t){return new Date(t).toLocaleString("vi-VN",{hour:"2-digit",minute:"2-digit",second:"2-digit",day:"2-digit",month:"2-digit",year:"numeric"})}function formatTime(t){return new Date(t).toLocaleTimeString("vi-VN",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}function timeMs(v){let n=Number(v||0);if(n&&n<1e12)n*=1000;return n}function fmt(v){return Number(v).toFixed(1)}function num(v){if(v===null||v===undefined||v==="")return NaN;return Number(v)}function esc(s){return String(s??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]))}function countdown(ms){const s=Math.max(0,Math.ceil(ms/1000)),m=Math.floor(s/60),r=s%60;return`${String(m).padStart(2,"0")}:${String(r).padStart(2,"0")}`}function formatDuration(s){s=Number(s);const d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60);return d?`${d} ngày ${h} giờ`:h?`${h} giờ ${m} phút`:`${m} phút`}function mergeDeep(a,b){for(const[k,v]of Object.entries(b||{})){if(v&&typeof v==="object"&&!Array.isArray(v))a[k]=mergeDeep(a[k]&&typeof a[k]==="object"?a[k]:{},v);else a[k]=v}return a}function toast(m){$("toast").textContent=m;$("toast").classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>$("toast").classList.remove("show"),2800)}async function sha256(s){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));return[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("").slice(0,32)}
})();