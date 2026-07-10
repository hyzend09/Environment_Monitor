(() => {
    "use strict";

    const FIREBASE_HISTORY_PATH = "/IoT_Based_Environmental/history";
    const TIME_ZONE = "Asia/Ho_Chi_Minh";
    const STORAGE = {
        theme: "terrapulse.theme.v1",
        thresholds: "terrapulse.thresholds.v1",
        notifications: "terrapulse.notifications.v1",
        lastNotificationKey: "terrapulse.lastNotificationKey.v1",
        lastNotificationTime: "terrapulse.lastNotificationTime.v1",
        clearedAt: "terrapulse.alertsClearedAt.v1"
    };

    // const DEFAULT_THRESHOLDS = {
    //     tempWarning: 35,
    //     tempDanger: 40,
    //     humidLowWarning: 40,
    //     humidHighWarning: 80,
    //     humidLowDanger: 25,
    //     humidHighDanger: 90,
    //     dustWarning: 50,
    //     dustDanger: 70,
    //     recordLimit: 600
    // };

    const DEFAULT_THRESHOLDS = {
        tempWarning: 35,
        tempDanger: 39,

        humidLowWarning: 40,
        humidHighWarning: 80,
        humidLowDanger: 25,
        humidHighDanger: 90,

        dustWarning: 35,
        dustDanger: 50,

        recordLimit: 600
    };

    const NOTIFICATION_COOLDOWN_MS = 5 * 60 * 1000;

    const state = {
        records: [],
        latest: null,
        previous: null,
        filteredLogs: [],
        chartMode: "latest",
        selectedDate: "",
        visibleLogs: 45,
        firebaseConnected: false,
        thresholds: loadThresholds(),
        notificationsEnabled: localStorage.getItem(STORAGE.notifications) === "true",
        alertsClearedAt: Number(localStorage.getItem(STORAGE.clearedAt)) || 0,
        mainChart: null,
        analysisChart: null,
        statusChart: null,
        toastTimer: null,
        simulatedActive: false
    };

    const $ = (id) => document.getElementById(id);
    const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

    document.addEventListener("DOMContentLoaded", init);

    function init() {
        const savedTheme = localStorage.getItem(STORAGE.theme) || "terra";
        applyTheme(savedTheme);
        setDateInputs(todayKey());
        fillSettingsForm();
        syncRangeOutputs();
        bindNavigation();
        bindControls();
        updateClock();
        setInterval(updateClock, 1000);
        setInterval(() => {
            renderFreshness();
            renderHealth();
        }, 5000);
        registerServiceWorker();
        updateNotificationUi();
        connectFirebase();
        handleInitialHash();
    }

    function bindNavigation() {
        [...$$(".nav-btn"), ...$$(".mobile-btn")].forEach((button) => {
            button.addEventListener("click", () => setPage(button.dataset.page));
        });
    }

    function setPage(page) {
        document.body.classList.remove("page-home", "page-lab", "page-logs", "page-alerts", "page-guide", "page-settings");
        document.body.classList.add(`page-${page}`);
        $$('[data-panel]').forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === page));
        [...$$(".nav-btn"), ...$$(".mobile-btn")].forEach((button) => button.classList.toggle("active", button.dataset.page === page));
        if (page === "lab") renderLab();
        if (page === "logs") renderLogs();
        if (page === "alerts") renderAlerts();
        location.hash = page === "home" ? "" : page;
    }

    function handleInitialHash() {
        const hash = location.hash.replace("#", "");
        if (["home", "lab", "logs", "alerts", "guide", "settings"].includes(hash)) {
            setPage(hash);
        }
    }

    function bindControls() {
        $("themeSelect")?.addEventListener("change", (event) => applyTheme(event.target.value));
        $("notifyBtn")?.addEventListener("click", enableNotifications);
        $("notifyHeroBtn")?.addEventListener("click", enableNotifications);
        $("copyBriefBtn")?.addEventListener("click", copyBrief);
        $("clearAlertsBtn")?.addEventListener("click", clearViewedAlerts);
        $("todayBtn")?.addEventListener("click", () => {
            state.selectedDate = todayKey();
            state.chartMode = "latest";
            setDateInputs(state.selectedDate);
            setActiveChartMode("latest");
            renderAll();
        });
        $("datePicker")?.addEventListener("change", (event) => {
            state.selectedDate = event.target.value || todayKey();
            state.chartMode = "selected";
            setDateInputs(state.selectedDate);
            setActiveChartMode("selected");
            renderAll();
        });
        $("analysisDate")?.addEventListener("change", (event) => {
            state.selectedDate = event.target.value || todayKey();
            setDateInputs(state.selectedDate);
            renderLab();
        });
        $("analysisMode")?.addEventListener("change", renderLab);
        $$('[data-chart-mode]').forEach((button) => {
            button.addEventListener("click", () => {
                state.chartMode = button.dataset.chartMode;
                setActiveChartMode(state.chartMode);
                renderCharts();
            });
        });
        ["globalSearch", "logSearch", "statusFilter", "logDate", "sortMode"].forEach((id) => {
            $(id)?.addEventListener("input", () => {
                if (id === "globalSearch" && $("logSearch")) $("logSearch").value = $("globalSearch").value;
                state.visibleLogs = 45;
                renderLogs();
            });
            $(id)?.addEventListener("change", () => {
                state.visibleLogs = 45;
                renderLogs();
            });
        });
        $("resetLogBtn")?.addEventListener("click", resetLogFilters);
        $("loadMoreBtn")?.addEventListener("click", () => {
            state.visibleLogs += 45;
            renderLogs();
        });
        $("exportCsvBtn")?.addEventListener("click", exportCsv);
        $("exportJsonBtn")?.addEventListener("click", exportJson);
        $("thresholdForm")?.addEventListener("submit", (event) => {
            event.preventDefault();
            saveSettings();
        });
        $("resetSettingsBtn")?.addEventListener("click", resetSettings);
        ["simTemp", "simHumid", "simDust"].forEach((id) => {
            $(id)?.addEventListener("input", syncRangeOutputs);
        });
        $("simulateBtn")?.addEventListener("click", simulateRecord);
    }

    function connectFirebase() {
        if (!window.database) {
            setConnection(false, "Firebase config missing");
            toast("Không tìm thấy window.database. Giữ nguyên firebase-config.js và kiểm tra thứ tự script.");
            return;
        }

        try {
            window.database.ref(".info/connected").on("value", (snapshot) => {
                state.firebaseConnected = snapshot.val() === true;
                setConnection(state.firebaseConnected, state.firebaseConnected ? "Firebase connected" : "Firebase offline");
                renderHealth();
            });

            window.database
                .ref(FIREBASE_HISTORY_PATH)
                .limitToLast(Number(state.thresholds.recordLimit) || DEFAULT_THRESHOLDS.recordLimit)
                .on("value", (snapshot) => {
                    const nextRecords = [];
                    snapshot.forEach((child) => {
                        const normalized = normalizeRecord(child.val(), child.key);
                        if (normalized) nextRecords.push(normalized);
                    });

                    nextRecords.sort((a, b) => timeMs(a.timestamp) - timeMs(b.timestamp));
                    state.records = nextRecords;
                    state.latest = nextRecords.at(-1) || null;
                    state.previous = nextRecords.at(-2) || null;
                    state.simulatedActive = false;
                    setConnection(true, "Firebase connected");
                    renderAll();
                    maybeNotifyLatest();
                }, (error) => {
                    setConnection(false, "Read failed");
                    toast(`Firebase read failed: ${error.message || error}`);
                    if (state.records.length === 0) renderDemoFallback();
                });
        } catch (error) {
            setConnection(false, "Firebase error");
            toast(`Không kết nối được Firebase: ${error.message || error}`);
            renderDemoFallback();
        }
    }


    // function normalizeRecord(raw, key) {
    //     if (!raw || typeof raw !== "object") return null;

    //     const numericKey = Number(key);
    //     const timestamp = raw.timestamp ?? raw.time ?? raw.createdAt ?? raw.created_at ?? (Number.isFinite(numericKey) ? numericKey : Date.now());
    //     const temp = toNumber(raw.nhiet_do ?? raw.temperature ?? raw.temp ?? raw.t);
    //     const humid = toNumber(raw.do_am ?? raw.humidity ?? raw.humid ?? raw.h);
    //     const dust = toNumber(raw.bui ?? raw.pm25 ?? raw.pm2_5 ?? raw.dust ?? raw.pm);
    //     const analysis = analyzeRecord(temp, humid, dust);

    //     return {
    //         key: key || String(timestamp),
    //         timestamp,
    //         nhiet_do: temp,
    //         do_am: humid,
    //         bui: dust,
    //         status: analysis.status,
    //         severity: analysis.severity,
    //         icon: analysis.icon,
    //         note: analysis.note,
    //         reasons: analysis.reasons,
    //         shortReason: analysis.shortReason,
    //         issueMap: analysis.issueMap,
    //         readingsText: analysis.readingsText,
    //         raw
    //     };
    // }

    function normalizeRecord(raw, key) {
        if (!raw || typeof raw !== "object") return null;

        const numericKey = Number(key);

        const timestamp =
            raw.timestamp ??
            raw.time ??
            raw.createdAt ??
            raw.created_at ??
            (Number.isFinite(numericKey) ? numericKey : Date.now());

        const temp = toNumber(
            raw.nhiet_do ??
            raw.temperature ??
            raw.temp ??
            raw.t
        );

        const humid = toNumber(
            raw.do_am ??
            raw.humidity ??
            raw.humid ??
            raw.h
        );

        // Firebase lưu dữ liệu bụi bằng field "bui"
        const dust = toNumber(
            raw.bui ??
            raw.pm25 ??
            raw.pm2_5 ??
            raw.dust ??
            raw.pm
        );

        const analysis = analyzeRecord(temp, humid, dust);

        return {
            key: key || String(timestamp),
            timestamp: timestamp,

            nhiet_do: temp,
            do_am: humid,
            bui: dust,

            status: analysis.status,
            severity: analysis.severity,
            icon: analysis.icon,
            note: analysis.note,
            reasons: analysis.reasons,
            shortReason: analysis.shortReason,
            issueMap: analysis.issueMap,
            readingsText: analysis.readingsText,

            raw: raw
        };
    }

    function analyzeRecord(temp, humid, dust) {
        const t = state.thresholds;
        const issues = [];
        const issueMap = {
            temp: "Temperature is stable.",
            humid: "Humidity is balanced.",
            dust: "Air quality is clean."
        };

        const addIssue = (status, metric, direction, text, sensorText) => {
            issues.push({ status, metric, direction, text, sensorText });
            if (metric === "temp") issueMap.temp = sensorText;
            if (metric === "humid") issueMap.humid = sensorText;
            if (metric === "dust") issueMap.dust = sensorText;
        };

        if (temp >= t.tempDanger) addIssue("danger", "temp", "high", `Temperature is dangerously high at ${fmt(temp)}°C.`, "Temperature is dangerously high.");
        else if (temp > t.tempWarning) addIssue("warning", "temp", "high", `Temperature is getting high at ${fmt(temp)}°C.`, "Temperature is getting high.");

        if (humid >= t.humidHighDanger) addIssue("danger", "humid", "high", `Humidity is dangerously high at ${fmt(humid)}%.`, "Humidity is dangerously high.");
        else if (humid <= t.humidLowDanger) addIssue("danger", "humid", "low", `Humidity is dangerously low at ${fmt(humid)}%.`, "Humidity is dangerously low.");
        else if (humid >= t.humidHighWarning) addIssue("warning", "humid", "high", `Humidity is getting high at ${fmt(humid)}%.`, "Humidity is getting high.");
        else if (humid <= t.humidLowWarning) addIssue("warning", "humid", "low", `Humidity is getting low at ${fmt(humid)}%.`, "Humidity is getting low.");

        if (dust >= t.dustDanger) addIssue("danger", "dust", "high", `Dust level is dangerously high at ${fmt(dust)}.`, "Dust level is dangerously high.");
        else if (dust >= t.dustWarning) addIssue("warning", "dust", "high", `Dust level is getting high at ${fmt(dust)}.`, "Dust level is getting high.");

        const readingsText = `Current readings: ${fmt(temp)}°C temperature, ${fmt(humid)}% humidity, ${fmt(dust)} dust.`;
        const hasDanger = issues.some((i) => i.status === "danger");

        if (hasDanger) {
            const reasons = issues.filter((i) => i.status === "danger").map((i) => i.text);
            return {
                status: "danger",
                severity: 2,
                icon: "!",
                note: `Environment danger. ${readingsText}`,
                reasons,
                shortReason: reasons.join(" "),
                issueMap,
                readingsText
            };
        }

        if (issues.length) {
            const reasons = issues.map((i) => i.text);
            return {
                status: "warning",
                severity: 1,
                icon: "⚠",
                note: `Environment warning. ${readingsText}`,
                reasons,
                shortReason: reasons.join(" "),
                issueMap,
                readingsText
            };
        }

        return {
            status: "safe",
            severity: 0,
            icon: "✓",
            note: `Environment safe. ${readingsText}`,
            reasons: [`Environment safe. Temperature ${fmt(temp)}°C is stable, humidity ${fmt(humid)}% is balanced, and dust ${fmt(dust)} indicates clean air.`],
            shortReason: `Environment safe. Temperature is stable, humidity is balanced, and the air is clean.`,
            issueMap,
            readingsText
        };
    }

    function renderAll() {
        renderOverview();
        renderSummary();
        renderCharts();
        renderHealth();
        renderLogs();
        renderAlerts();
        renderLab();
        renderFreshness();
    }

    function stateHeadline(status) {
        return status === "danger" ? "Environment Danger" : status === "warning" ? "Environment Warning" : "Environment Safe";
    }

    function statePillText(status) {
        return status === "danger" ? "DANGER" : status === "warning" ? "WARNING" : "SAFE";
    }

    function briefStatusText(status) {
        return status === "danger" ? "Immediate action needed" : status === "warning" ? "Needs attention" : "Safe to go outside";
    }

    function buildSafetyAdvice(record) {
        if (!record) return "Waiting for environmental data.";

        const reasons = (record.reasons || []).join(" ").toLowerCase();
        const hasTemp = reasons.includes("temperature");
        const hasDust = reasons.includes("dust");
        const hasHumid = reasons.includes("humidity");
        const hasHumidLow = hasHumid && reasons.includes("low");
        const hasHumidHigh = hasHumid && reasons.includes("high");

        if (record.status === "safe") {
            return "The environment is safe. You can go outside and enjoy fresh air normally.";
        }

        if (record.status === "warning") {
            const advice = ["The environment needs attention."];
            if (hasTemp) advice.push("Temperature is getting high, so avoid staying too long under direct sunlight and drink enough water.");
            if (hasHumidLow) advice.push("Humidity is getting low, so drink more water and avoid staying in very dry air for too long.");
            if (hasHumidHigh) advice.push("Humidity is getting high, so keep the area airy and ventilated.");
            if (hasDust) advice.push("Dust level is getting high, so limit long outdoor activity and consider wearing a mask.");
            advice.push("You can still go outside, but monitor the environment closely.");
            return advice.join(" ");
        }

        if (record.status === "danger") {
            const advice = ["The environment is dangerous."];
            if (hasTemp) advice.push("Stay indoors if possible, avoid direct sunlight, and cool the room immediately.");
            if (hasHumidLow) advice.push("Humidity is dangerously low, so use a humidifier if available and avoid dry air exposure.");
            if (hasHumidHigh) advice.push("Humidity is dangerously high, so stay in a ventilated place and reduce exposure to damp air.");
            if (hasDust) advice.push("Air quality is unhealthy, so avoid going outside unless necessary, keep windows closed, and wear a mask if you must go out.");
            advice.push("Check the sensor area and the real environment immediately.");
            return advice.join(" ");
        }

        return "Waiting for environmental data.";
    }

    function renderOverview() {
        const latest = state.latest;
        const previous = state.previous;
        setText("recordLoaded", `${state.records.length}`);

        if (!latest) {
            setText("mainStatus", "Waiting for data");
            setText("mainNote", "Đang chờ dữ liệu realtime từ Firebase.");
            setText("lastUpdate", "--");
            setStatusUi("safe", "SAFE", "✓");
            updateHeroFocus({ status: "safe", reasons: ["Waiting for incoming Firebase data..."], note: "No threshold is exceeded at the moment.", readingsText: "" });
            renderMetric("temp", null, null, "Waiting", "--");
            renderMetric("humid", null, null, "Waiting", "--");
            renderMetric("dust", null, null, "Waiting", "--");
            setText("briefText", "Waiting for Firebase data. A summary will appear here as soon as new readings arrive.");
            setHtml("recommendationList", `<div class="recommendation safe">✓ System is ready.</div>`);
            return;
        }

        const statusLabel = statePillText(latest.status);
        setStatusUi(latest.status, statusLabel, latest.icon);
        setText("mainStatus", stateHeadline(latest.status));
        setText("mainNote", latest.note);
        setText("lastUpdate", formatDateTime(latest.timestamp));
        updateHeroFocus(latest);

        renderMetric("temp", latest.nhiet_do, previous?.nhiet_do, getSingleLevel("temp", latest.nhiet_do), latest.issueMap?.temp || "Temperature is stable.");
        renderMetric("humid", latest.do_am, previous?.do_am, getSingleLevel("humid", latest.do_am), latest.issueMap?.humid || "Humidity is balanced.");
        renderMetric("dust", latest.bui, previous?.bui, getSingleLevel("dust", latest.bui), latest.issueMap?.dust || "Air quality is clean.");
        renderBrief();
        renderMiniAlerts();
    }

    function updateHeroFocus(latest) {
        const reasons = Array.isArray(latest?.reasons) && latest.reasons.length
            ? latest.reasons
            : ["Environment safe. Temperature is stable, humidity is balanced, and air quality is clean."];
        const count = latest?.status === "safe" ? 0 : reasons.length;
        const plural = count === 1 ? "" : "s";

        const title = latest?.status === "danger"
            ? "Immediate action needed"
            : latest?.status === "warning"
                ? "Monitor this area"
                : "Safe environment";

        // const note = latest?.status === "danger"
        //     ? `${count} danger condition${plural} detected. ${latest.readingsText || ""}`.trim()
        //     : latest?.status === "warning"
        //         ? `${count} warning condition${plural} detected. ${latest.readingsText || ""}`.trim()
        //         : latest?.readingsText || "Environment safe. Temperature is stable, humidity is balanced, and air quality is clean.";
        const note = buildSafetyAdvice(latest);

        setText("heroSeverityTitle", title);
        setText("heroSeverityNote", note);
        setText("heroSeverityText", briefStatusText(latest?.status || "safe"));

        const counter = $("heroAlertCount");
        if (counter) {
            counter.classList.remove("safe", "warning", "danger");
            counter.classList.add(latest?.status || "safe");
            counter.textContent = latest?.status === "safe" ? "Environment safe" : `${count} active alert${plural}`;
        }

        setHtml("heroReasonList", reasons.map((reason) => `<li class="${escapeHtml(latest?.status || "safe")}">${escapeHtml(reason)}</li>`).join(""));
    }

    function setStatusUi(status, label, icon) {
        const chip = $("mainStatusChip");
        const compass = $("statusCompass");
        const hero = $("heroCard");
        [chip, compass, hero].forEach((el) => {
            if (!el) return;
            el.classList.remove("safe", "warning", "danger");
            el.classList.add(status);
        });
        setText("mainStatusChip", label);
        setText("statusIcon", icon);
    }

    function renderMetric(name, value, previousValue, level, reason) {
        const isEmpty = value === null || value === undefined || !Number.isFinite(Number(value));
        const number = isEmpty ? null : Number(value);
        const status = level?.status || "safe";
        const tile = $(`${name}Tile`);
        const bar = $(`${name}Bar`);
        const valueEl = $(`${name}Value`);
        const trendEl = $(`${name}Trend`);
        const levelEl = $(`${name}Level`);
        const reasonEl = $(`${name}Reason`);
        const metricColor = levelColor(status);

        if (tile) {
            tile.classList.remove("safe", "warning", "danger");
            tile.classList.add(status);
            tile.dataset.status = status;
            tile.style.setProperty("--metric-color", metricColor);
        }

        setText(valueEl, isEmpty ? "--" : fmt(number));
        setText(levelEl, level?.label || "Waiting");
        setText(reasonEl, reason || "--");

        [valueEl, trendEl, levelEl, reasonEl].forEach((el) => {
            if (el) el.style.color = metricColor;
        });

        const percent = name === "temp" ? clamp((number / 55) * 100, 0, 100)
            : name === "humid" ? clamp(number, 0, 100)
                : clamp((number / 120) * 100, 0, 100);
        if (bar) {
            bar.style.width = isEmpty ? "0%" : `${percent}%`;
            bar.style.background = status === "danger"
                ? "linear-gradient(90deg, #ff9a87, #f2644d, #dc3f35)"
                : status === "warning"
                    ? "linear-gradient(90deg, #f2cf57, #e8ad37, #dc8c1d)"
                    : "linear-gradient(90deg, #79c9a3, #39b27d, #159565)";
        }

        setText(trendEl, getTrend(number, previousValue));
    }

    function levelColor(status) {
        const styles = getComputedStyle(document.body);
        if (status === "danger") return styles.getPropertyValue("--danger").trim() || "#df5b4f";
        if (status === "warning") return styles.getPropertyValue("--warning").trim() || "#d8941d";
        return styles.getPropertyValue("--safe").trim() || "#2f9e6d";
    }

    function getSingleLevel(type, value) {
        const v = Number(value);
        const t = state.thresholds;
        if (!Number.isFinite(v)) return { status: "safe", label: "Waiting" };

        if (type === "temp") {
            if (v >= t.tempDanger) return { status: "danger", label: "Danger" };
            if (v > t.tempWarning) return { status: "warning", label: "Warning" };
            return { status: "safe", label: "Safe" };
        }
        if (type === "humid") {
            if (v >= t.humidHighDanger || v <= t.humidLowDanger) return { status: "danger", label: "Danger" };
            if (v >= t.humidHighWarning || v <= t.humidLowWarning) return { status: "warning", label: "Warning" };
            return { status: "safe", label: "Safe" };
        }
        if (v >= t.dustDanger) return { status: "danger", label: "Danger" };
        if (v >= t.dustWarning) return { status: "warning", label: "Warning" };
        return { status: "safe", label: "Safe" };
    }

    function getTrend(current, previous) {
        if (!Number.isFinite(Number(current)) || !Number.isFinite(Number(previous))) return "--";
        const diff = Number(current) - Number(previous);
        if (Math.abs(diff) < 0.1) return "stable";
        return diff > 0 ? `↑ ${fmt(diff)}` : `↓ ${fmt(Math.abs(diff))}`;
    }

    function renderBrief() {
        const latest = state.latest;
        if (!latest) return;
        const lastRecords = state.records.slice(-6);
        const tempTrend = trendDirection(lastRecords.map((r) => r.nhiet_do));
        const humidTrend = trendDirection(lastRecords.map((r) => r.do_am));
        const dustTrend = trendDirection(lastRecords.map((r) => r.bui));

        const brief = latest.status === "safe"
            ? latest.reasons[0]
            : `${stateHeadline(latest.status)}. ${latest.shortReason} ${buildSafetyAdvice(latest)}`;
        setText("briefText", brief.trim());

        const items = [
            makeRecommendation(tempTrend, "Temperature"),
            makeRecommendation(humidTrend, "Humidity"),
            makeRecommendation(dustTrend, "Dust"),
            { status: latest.status, text: buildSafetyAdvice(latest) }
        ];

        setHtml("recommendationList", items.map((item) => `<div class="recommendation ${item.status}">${escapeHtml(item.text)}</div>`).join(""));
    }

    function makeRecommendation(direction, label) {
        if (direction === "up") return { status: label === "Dust" ? "warning" : "safe", text: `${label} is trending upward.` };
        if (direction === "down") return { status: "safe", text: `${label} is trending downward.` };
        return { status: "safe", text: `${label} is stable.` };
    }

    function trendDirection(values) {
        const clean = values.filter((v) => Number.isFinite(Number(v))).map(Number);
        if (clean.length < 3) return "stable";
        const first = clean.slice(0, Math.ceil(clean.length / 2)).reduce((a, b) => a + b, 0) / Math.ceil(clean.length / 2);
        const second = clean.slice(Math.floor(clean.length / 2)).reduce((a, b) => a + b, 0) / clean.slice(Math.floor(clean.length / 2)).length;
        if (second - first > 1) return "up";
        if (first - second > 1) return "down";
        return "stable";
    }

    function renderSummary() {
        const date = state.selectedDate || todayKey();
        setText("summaryTitle", formatDateKey(date));
        const dayRecords = recordsByDate(date);
        setText("dailyCount", dayRecords.length);

        if (dayRecords.length === 0) {
            ["avgTemp", "avgHumid", "avgDust", "maxTemp", "minTemp"].forEach((id) => setText(id, "--"));
            setText("dangerCount", "0");
            setText("warningCount", "0");
            return;
        }

        const temps = dayRecords.map((r) => r.nhiet_do);
        const humids = dayRecords.map((r) => r.do_am);
        const dusts = dayRecords.map((r) => r.bui);
        setText("avgTemp", `${fmt(avg(temps))}°C`);
        setText("avgHumid", `${fmt(avg(humids))}%`);
        setText("avgDust", fmt(avg(dusts)));
        setText("maxTemp", `${fmt(Math.max(...temps))}°C`);
        setText("minTemp", `${fmt(Math.min(...temps))}°C`);
        setText("dangerCount", dayRecords.filter((r) => r.status === "danger").length);
        setText("warningCount", dayRecords.filter((r) => r.status === "warning").length);
    }

    function renderCharts() {
        const data = getChartData(state.chartMode);
        const labels = data.map((r) => r.label || (state.chartMode === "daily" ? formatDateKey(dateKey(r.timestamp)) : formatTimeShort(r.timestamp)));
        const colors = cssColors();

        setText("chartCaption", state.chartMode === "daily" ? "Mỗi điểm là giá trị trung bình của một ngày."
            : state.chartMode === "selected" ? `Chi tiết dữ liệu ngày ${formatDateKey(state.selectedDate)}.`
                : "Latest records from Firebase.");

        const config = {
            type: "line",
            data: {
                labels,
                datasets: [
                    dataset("Temperature", data.map((r) => r.nhiet_do), colors.temp),
                    dataset("Humidity", data.map((r) => r.do_am), colors.humid),
                    dataset("Dust", data.map((r) => r.bui), colors.dust)
                ]
            },
            options: chartOptions(colors)
        };

        state.mainChart = updateChart(state.mainChart, "mainChart", config);
    }

    function renderLab() {
        const pageActive = $("page-lab")?.classList.contains("active");
        const mode = $("analysisMode")?.value || "latest";
        const data = getChartData(mode);
        const labels = data.map((r) => r.label || (mode === "daily" ? formatDateKey(dateKey(r.timestamp)) : formatTimeShort(r.timestamp)));
        const colors = cssColors();

        const config = {
            type: "bar",
            data: {
                labels,
                datasets: [
                    dataset("Temperature", data.map((r) => r.nhiet_do), colors.temp, "bar"),
                    dataset("Humidity", data.map((r) => r.do_am), colors.humid, "bar"),
                    dataset("Dust", data.map((r) => r.bui), colors.dust, "bar")
                ]
            },
            options: chartOptions(colors, true)
        };
        state.analysisChart = updateChart(state.analysisChart, "analysisChart", config);
        renderStatusChart();
        renderPatternNotes();
        if (!pageActive) return;
    }

    function renderStatusChart() {
        const colors = cssColors();
        const counts = countStatuses(state.records);
        const config = {
            type: "doughnut",
            data: {
                labels: ["Safe", "Warning", "Danger"],
                datasets: [{
                    data: [counts.safe, counts.warning, counts.danger],
                    backgroundColor: [colors.safe, colors.warning, colors.danger],
                    borderWidth: 0,
                    hoverOffset: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                cutout: "70%"
            }
        };
        state.statusChart = updateChart(state.statusChart, "statusChart", config);
        const total = Math.max(1, counts.safe + counts.warning + counts.danger);
        setHtml("ratioLegend", [
            ["Safe", counts.safe, "safe"],
            ["Warning", counts.warning, "warning"],
            ["Danger", counts.danger, "danger"]
        ].map(([label, count, cls]) => `<div><span class="status-pill ${cls}">${label}</span><strong>${count} (${Math.round(count / total * 100)}%)</strong></div>`).join(""));
    }

    function renderPatternNotes() {
        if (state.records.length === 0) {
            setHtml("patternNotes", `<div class="pattern-note warning">No data available for pattern detection.</div>`);
            return;
        }
        const recent = state.records.slice(-10);
        const dangers = recent.filter((r) => r.status === "danger").length;
        const warnings = recent.filter((r) => r.status === "warning").length;
        const notes = [];
        if (dangers > 0) notes.push({ status: "danger", text: `${dangers} danger record(s) appeared in the latest 10 readings.` });
        if (warnings > 0) notes.push({ status: "warning", text: `${warnings} warning record(s) appeared in the latest 10 readings.` });
        notes.push(makeRecommendation(trendDirection(recent.map((r) => r.nhiet_do)), "Temperature"));
        notes.push(makeRecommendation(trendDirection(recent.map((r) => r.do_am)), "Humidity"));
        notes.push(makeRecommendation(trendDirection(recent.map((r) => r.bui)), "Dust"));
        setHtml("patternNotes", notes.map((n) => `<div class="pattern-note ${n.status}">${escapeHtml(n.text)}</div>`).join(""));
    }

    function getChartData(mode) {
        if (mode === "daily") return dailyAverages(state.records);
        if (mode === "selected") return recordsByDate(state.selectedDate).slice(-120);
        return state.records.slice(-80);
    }

    function dataset(label, data, color, type = "line") {
        return {
            type,
            label,
            data,
            borderColor: color,
            backgroundColor: alpha(color, type === "bar" ? 0.5 : 0.16),
            tension: 0.42,
            borderWidth: 3,
            pointRadius: 0,
            pointHoverRadius: 5,
            fill: type !== "bar"
        };
    }

    function chartOptions(colors, stacked = false) {
        return {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
                legend: {
                    labels: {
                        color: colors.text,
                        usePointStyle: true,
                        boxWidth: 8,
                        font: { weight: "700" }
                    }
                },
                tooltip: {
                    backgroundColor: colors.tooltip,
                    titleColor: colors.tooltipText,
                    bodyColor: colors.tooltipText,
                    borderColor: colors.grid,
                    borderWidth: 1,
                    padding: 12
                }
            },
            scales: {
                x: {
                    grid: { color: colors.grid },
                    ticks: { color: colors.muted, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }
                },
                y: {
                    beginAtZero: true,
                    suggestedMax: 100,
                    stacked,
                    grid: { color: colors.grid },
                    ticks: { color: colors.muted }
                }
            }
        };
    }

    function updateChart(instance, canvasId, config) {
        const canvas = $(canvasId);
        if (!canvas || !window.Chart) return instance;
        if (instance) {
            instance.data = config.data;
            instance.options = config.options;
            instance.update();
            return instance;
        }
        return new Chart(canvas, config);
    }

    function buildLogReason(record) {
        if (!record) return "--";
        if (record.status === "safe") return record.shortReason || "Environment safe. Temperature is stable, humidity is balanced, and air quality is clean.";
        const reasons = (record.reasons || []).slice(0, 2).join(" ");
        return `${stateHeadline(record.status)}. ${reasons}`.trim();
    }

    function renderLogs() {
        const rows = getFilteredLogs();
        state.filteredLogs = rows;
        const visible = rows.slice(0, state.visibleLogs);
        setHtml("logTableBody", visible.map((r) => `
            <tr class="log-row ${r.status}">
                <td>${escapeHtml(formatDateTime(r.timestamp))}</td>
                <td><span class="status-pill ${r.status}">${statePillText(r.status)}</span></td>
                <td>${fmt(r.nhiet_do)}°C</td>
                <td>${fmt(r.do_am)}%</td>
                <td>${fmt(r.bui)}</td>
                <td>${escapeHtml(buildLogReason(r))}</td>
            </tr>
        `).join(""));

        setHtml("logCards", visible.map((r) => `
            <article class="log-card ${r.status}">
                <div class="log-card-head">
                    <span class="status-pill ${r.status}">${statePillText(r.status)}</span>
                    <small>${escapeHtml(formatDateTime(r.timestamp))}</small>
                </div>
                <div class="log-reading-line"><b>${fmt(r.nhiet_do)}°C</b><b>${fmt(r.do_am)}%</b><b>${fmt(r.bui)}</b></div>
                <p>${escapeHtml(buildLogReason(r))}</p>
            </article>
        `).join(""));

        const btn = $("loadMoreBtn");
        if (btn) btn.style.display = rows.length > state.visibleLogs ? "inline-flex" : "none";
    }

    function getFilteredLogs() {
        let rows = [...state.records];
        const search = ($("logSearch")?.value || $("globalSearch")?.value || "").trim().toLowerCase();
        const status = $("statusFilter")?.value || "all";
        const date = $("logDate")?.value || "";
        const sort = $("sortMode")?.value || "newest";

        if (search) {
            rows = rows.filter((r) => [r.status, r.note, r.reasons.join(" "), formatDateTime(r.timestamp), r.nhiet_do, r.do_am, r.bui]
                .join(" ").toLowerCase().includes(search));
        }
        if (status !== "all") rows = rows.filter((r) => r.status === status);
        if (date) rows = rows.filter((r) => dateKey(r.timestamp) === date);

        rows.sort((a, b) => {
            if (sort === "oldest") return timeMs(a.timestamp) - timeMs(b.timestamp);
            if (sort === "temp-high") return b.nhiet_do - a.nhiet_do;
            if (sort === "dust-high") return b.bui - a.bui;
            return timeMs(b.timestamp) - timeMs(a.timestamp);
        });
        return rows;
    }

    function renderAlerts() {
        const alerts = state.records
            .filter((r) => r.status !== "safe" && timeMs(r.timestamp) > state.alertsClearedAt)
            .sort((a, b) => timeMs(b.timestamp) - timeMs(a.timestamp));
        const allActiveAlerts = state.records.filter((r) => r.status !== "safe");
        const visibleAlerts = alerts.slice(0, 8);
        setText("sideAlertBadge", allActiveAlerts.length);
        setText("mobileAlertBadge", allActiveAlerts.length);

        setHtml("alertList", visibleAlerts.map((r) => `
            <article class="alert-item ${r.status}">
                <div class="alert-icon">${r.status === "danger" ? "!" : "⚠"}</div>
                <div class="alert-content">
                    <div class="alert-topline">
                        <h3>${stateHeadline(r.status)}</h3>
                        <span class="status-pill ${r.status}">${statePillText(r.status)}</span>
                    </div>
                    <p>${escapeHtml(buildLogReason(r))}</p>
                    <div class="alert-meta">
                        <span>${escapeHtml(formatDateTime(r.timestamp))}</span>
                        <span>${fmt(r.nhiet_do)}°C · ${fmt(r.do_am)}% · ${fmt(r.bui)}</span>
                    </div>
                </div>
            </article>
        `).join(""));

        $("emptyAlerts")?.classList.toggle("show", alerts.length === 0);
        renderMiniAlerts();
        updateNotificationUi();
    }

    function renderMiniAlerts() {
        const recent = state.records.filter((r) => r.status !== "safe").slice(-2).reverse();
        if (recent.length === 0) {
            setHtml("miniAlertList", `<div class="mini-alert safe">✓ No recent Warning/Danger records.</div>`);
            return;
        }
        setHtml("miniAlertList", recent.map((r) => `
            <div class="mini-alert ${r.status}">
                <strong>${stateHeadline(r.status)}</strong><br>
                ${escapeHtml(r.reasons[0] || r.note)}
            </div>
        `).join(""));
    }

    function renderHealth() {
        setHealth("firebaseHealth", state.firebaseConnected ? "Connected" : "Offline", state.firebaseConnected ? "online" : "offline");
        if (!state.latest) {
            setHealth("gatewayHealth", "No Data", "checking");
            setHealth("nodeHealth", "No Data", "checking");
            setHealth("qualityHealth", "Waiting", "checking");
            return;
        }
        const age = dataAgeSeconds(state.latest.timestamp);
        if (age <= 90) {
            setHealth("gatewayHealth", "Online", "online");
            setHealth("nodeHealth", "Active", "online");
        } else if (age <= 600) {
            setHealth("gatewayHealth", "Delayed", "warning");
            setHealth("nodeHealth", "Slow", "warning");
        } else {
            setHealth("gatewayHealth", "Stale", "offline");
            setHealth("nodeHealth", "Inactive", "offline");
        }
        const invalid = state.records.filter((r) => !Number.isFinite(r.nhiet_do) || !Number.isFinite(r.do_am) || !Number.isFinite(r.bui)).length;
        setHealth("qualityHealth", invalid === 0 ? "Good" : `${invalid} invalid`, invalid === 0 ? "online" : "warning");
    }

    function setHealth(id, text, cls) {
        const el = $(id);
        if (!el) return;
        el.className = cls;
        el.innerText = text;
    }

    function renderFreshness() {
        if (!state.latest) {
            setText("dataAge", "--");
            return;
        }
        setText("dataAge", humanAge(dataAgeSeconds(state.latest.timestamp)));
    }

    function updateClock() {
        setText("localClock", new Intl.DateTimeFormat("vi-VN", {
            timeZone: TIME_ZONE,
            hour12: false,
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        }).format(new Date()));
    }

    async function enableNotifications() {
        if (!("Notification" in window)) {
            toast("Trình duyệt này không hỗ trợ Web Notification.");
            return;
        }

        try {
            const permission = await Notification.requestPermission();
            if (permission === "granted") {
                state.notificationsEnabled = true;
                localStorage.setItem(STORAGE.notifications, "true");
                updateNotificationUi();
                await showSystemNotification({
                    status: "safe",
                    timestamp: Date.now(),
                    reasons: ["Notification enabled. Only Warning and Danger records will trigger alerts."],
                    key: "enabled"
                }, true);
                toast("Đã bật thông báo Warning/Danger.");
            } else {
                state.notificationsEnabled = false;
                localStorage.setItem(STORAGE.notifications, "false");
                updateNotificationUi();
                toast("Bạn chưa cấp quyền notification cho website.");
            }
        } catch (error) {
            toast(`Không bật được notification: ${error.message || error}`);
        }
    }

    function maybeNotifyLatest() {
        const r = state.latest;
        if (!r || r.status === "safe") return;
        if (!state.notificationsEnabled || Notification.permission !== "granted") return;

        const key = `${r.key}-${r.status}-${dateKey(r.timestamp)}-${formatTimeShort(r.timestamp)}`;
        const previousKey = localStorage.getItem(STORAGE.lastNotificationKey) || "";
        const previousTime = Number(localStorage.getItem(STORAGE.lastNotificationTime)) || 0;
        if (key === previousKey) return;
        if (Date.now() - previousTime < NOTIFICATION_COOLDOWN_MS) return;

        showSystemNotification(r).then(() => {
            localStorage.setItem(STORAGE.lastNotificationKey, key);
            localStorage.setItem(STORAGE.lastNotificationTime, String(Date.now()));
        });
    }

    async function showSystemNotification(record, silent = false) {
        const title = stateHeadline(record.status);
        const body = buildLogReason(record);
        const options = {
            body,
            icon: "icon.svg",
            badge: "icon.svg",
            tag: record.status === "safe" ? "terrapulse-ready" : `terrapulse-${record.status}`,
            renotify: record.status !== "safe",
            data: { url: "./index.html#alerts" },
            silent
        };
        if (!silent) options.vibrate = record.status === "danger" ? [120, 80, 120, 80, 180] : [90, 60, 90];

        if (navigator.serviceWorker && (await navigator.serviceWorker.getRegistration())) {
            const registration = await navigator.serviceWorker.ready;
            return registration.showNotification(title, options);
        }
        return new Notification(title, options);
    }

    function updateNotificationUi() {
        const supported = "Notification" in window;
        const permission = supported ? Notification.permission : "unsupported";
        const enabled = state.notificationsEnabled && permission === "granted";
        const title = !supported ? "Notification is not supported"
            : enabled ? "Warning/Danger notification is enabled"
                : permission === "denied" ? "Notification permission was blocked"
                    : "System notification is not enabled";
        const text = !supported ? "Trình duyệt này không hỗ trợ Web Notification."
            : enabled ? "Khi Firebase có dữ liệu Warning hoặc Danger mới, thiết bị sẽ nhận thông báo nếu trình duyệt/PWA cho phép."
                : permission === "denied" ? "Bạn cần mở quyền notification trong phần cài đặt trình duyệt."
                    : "Bấm Enable để nhận thông báo khi có Warning hoặc Danger mới từ Firebase.";
        setText("notificationTitle", title);
        setText("notificationText", text);
        setText("notifyBtn", enabled ? "🔔 On" : "🔔 Alerts");
        setText("notifyHeroBtn", enabled ? "Notifications enabled" : "Enable warning/danger alerts");
    }

    function clearViewedAlerts() {
        state.alertsClearedAt = Date.now();
        localStorage.setItem(STORAGE.clearedAt, String(state.alertsClearedAt));
        renderAlerts();
        toast("Đã ẩn các alert đang xem. Alert mới vẫn sẽ hiện lại.");
    }

    function resetLogFilters() {
        ["globalSearch", "logSearch", "logDate"].forEach((id) => { if ($(id)) $(id).value = ""; });
        if ($("statusFilter")) $("statusFilter").value = "all";
        if ($("sortMode")) $("sortMode").value = "newest";
        state.visibleLogs = 45;
        renderLogs();
    }

    function exportCsv() {
        const rows = state.filteredLogs.length ? state.filteredLogs : getFilteredLogs();
        const header = ["timestamp", "status", "temperature", "humidity", "dust", "reason"];
        const lines = [header.join(",")].concat(rows.map((r) => [
            csvCell(formatDateTime(r.timestamp)),
            csvCell(r.status),
            csvCell(r.nhiet_do),
            csvCell(r.do_am),
            csvCell(r.bui),
            csvCell(r.reasons.join("; "))
        ].join(",")));
        downloadFile(`terrapulse_logs_${todayKey()}.csv`, lines.join("\n"), "text/csv;charset=utf-8");
    }

    function exportJson() {
        const rows = state.filteredLogs.length ? state.filteredLogs : getFilteredLogs();
        downloadFile(`terrapulse_logs_${todayKey()}.json`, JSON.stringify(rows, null, 2), "application/json");
    }

    function downloadFile(filename, content, type) {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    function copyBrief() {
        const text = $("briefText")?.innerText || "";
        if (!text) return;
        navigator.clipboard?.writeText(text).then(() => toast("Đã copy brief."), () => toast(text));
    }

    function fillSettingsForm() {
        Object.entries(state.thresholds).forEach(([key, value]) => {
            if ($(key)) $(key).value = value;
        });
        if ($("themeSelect")) $("themeSelect").value = localStorage.getItem(STORAGE.theme) || "terra";
    }

    function saveSettings() {
        const next = { ...state.thresholds };
        Object.keys(DEFAULT_THRESHOLDS).forEach((key) => {
            const input = $(key);
            if (!input) return;
            const value = Number(input.value);
            if (Number.isFinite(value)) next[key] = value;
        });
        state.thresholds = next;
        localStorage.setItem(STORAGE.thresholds, JSON.stringify(next));
        state.records = state.records.map((r) => normalizeRecord(r.raw || r, r.key)).filter(Boolean);
        state.latest = state.records.at(-1) || null;
        state.previous = state.records.at(-2) || null;
        renderAll();
        toast("Đã lưu ngưỡng cảnh báo.");
    }

    function resetSettings() {
        state.thresholds = { ...DEFAULT_THRESHOLDS };
        localStorage.setItem(STORAGE.thresholds, JSON.stringify(state.thresholds));
        fillSettingsForm();
        saveSettings();
        toast("Đã reset ngưỡng mặc định.");
    }

    function syncRangeOutputs() {
        setText("simTempOut", `${$("simTemp")?.value || "38"}°C`);
        setText("simHumidOut", `${$("simHumid")?.value || "82"}%`);
        setText("simDustOut", `${$("simDust")?.value || "72"}`);
    }

    function simulateRecord() {
        const raw = {
            timestamp: Date.now(),
            nhiet_do: Number($("simTemp")?.value || 38),
            do_am: Number($("simHumid")?.value || 82),
            bui: Number($("simDust")?.value || 72)
        };
        const simulated = normalizeRecord(raw, `sim-${Date.now()}`);
        state.previous = state.latest;
        state.latest = simulated;
        state.records = [...state.records, simulated].slice(-state.thresholds.recordLimit);
        state.simulatedActive = true;
        renderAll();
        toast("Đã preview record mô phỏng. Dữ liệu này không ghi vào Firebase.");
    }

    function renderDemoFallback() {
        const now = Date.now();
        const samples = Array.from({ length: 24 }, (_, index) => {
            const i = 23 - index;
            return normalizeRecord({
                timestamp: now - i * 15 * 60 * 1000,
                nhiet_do: 28 + Math.sin(index / 3) * 4 + (index > 18 ? 5 : 0),
                do_am: 62 + Math.cos(index / 4) * 10,
                bui: 34 + Math.sin(index / 2) * 16 + (index > 19 ? 25 : 0)
            }, `demo-${index}`);
        }).filter(Boolean);
        state.records = samples;
        state.latest = samples.at(-1) || null;
        state.previous = samples.at(-2) || null;
        renderAll();
        toast("Đang hiển thị demo fallback vì chưa đọc được Firebase.");
    }

    function registerServiceWorker() {
        if (!("serviceWorker" in navigator)) return;
        window.addEventListener("load", () => {
            navigator.serviceWorker.register("sw.js").catch(() => { });
        });
    }

    // function applyTheme(theme) {
    //     const selected = ["terra", "sakura", "graphite"].includes(theme) ? theme : "terra";
    //     document.body.classList.remove("theme-terra", "theme-sakura", "theme-graphite");
    //     document.body.classList.add(`theme-${selected}`);
    //     localStorage.setItem(STORAGE.theme, selected);
    //     if ($("themeSelect")) $("themeSelect").value = selected;
    //     setTimeout(() => {
    //         renderCharts();
    //         renderLab();
    //     }, 0);
    // }

    function applyTheme(theme) {
        const themes = [
            "terra",
            "sakura",
            "graphite",
            "ocean",
            "lavender",
            "mocha",
            "forest"
        ];

        const selected = themes.includes(theme) ? theme : "terra";

        document.body.classList.remove(
            "theme-terra",
            "theme-sakura",
            "theme-graphite",
            "theme-ocean",
            "theme-lavender",
            "theme-mocha",
            "theme-forest"
        );

        document.body.classList.add(`theme-${selected}`);
        localStorage.setItem(STORAGE.theme, selected);

        if ($("themeSelect")) {
            $("themeSelect").value = selected;
        }

        setTimeout(() => {
            renderCharts();
            renderLab();
        }, 0);
    }

    function setConnection(connected, text) {
        state.firebaseConnected = connected;
        const pill = $("connectionPill");
        if (pill) {
            pill.classList.remove("connected", "disconnected", "checking");
            pill.classList.add(connected ? "connected" : text?.toLowerCase().includes("checking") ? "checking" : "disconnected");
        }
        setText("connectionText", text);
    }

    function setDateInputs(date) {
        state.selectedDate = date;
        if ($("datePicker")) $("datePicker").value = date;
        if ($("analysisDate")) $("analysisDate").value = date;
    }

    function setActiveChartMode(mode) {
        $$('[data-chart-mode]').forEach((btn) => btn.classList.toggle("active", btn.dataset.chartMode === mode));
    }

    function recordsByDate(date) {
        return state.records.filter((r) => dateKey(r.timestamp) === date);
    }

    function dailyAverages(records) {
        const groups = new Map();
        records.forEach((r) => {
            const key = dateKey(r.timestamp);
            if (!groups.has(key)) {
                groups.set(key, { label: formatDateKey(key), timestamp: r.timestamp, temp: 0, humid: 0, dust: 0, count: 0 });
            }
            const g = groups.get(key);
            g.temp += r.nhiet_do;
            g.humid += r.do_am;
            g.dust += r.bui;
            g.count += 1;
        });
        return Array.from(groups.values()).map((g) => ({
            label: g.label,
            timestamp: g.timestamp,
            nhiet_do: Number((g.temp / g.count).toFixed(2)),
            do_am: Number((g.humid / g.count).toFixed(2)),
            bui: Number((g.dust / g.count).toFixed(2))
        })).sort((a, b) => timeMs(a.timestamp) - timeMs(b.timestamp));
    }

    function countStatuses(records) {
        return records.reduce((acc, r) => {
            acc[r.status] = (acc[r.status] || 0) + 1;
            return acc;
        }, { safe: 0, warning: 0, danger: 0 });
    }

    function loadThresholds() {
        try {
            return { ...DEFAULT_THRESHOLDS, ...(JSON.parse(localStorage.getItem(STORAGE.thresholds) || "{}")) };
        } catch {
            return { ...DEFAULT_THRESHOLDS };
        }
    }

    function dateKey(timestamp) {
        const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone: TIME_ZONE,
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        }).formatToParts(new Date(timeMs(timestamp)));
        const y = parts.find((p) => p.type === "year")?.value;
        const m = parts.find((p) => p.type === "month")?.value;
        const d = parts.find((p) => p.type === "day")?.value;
        return `${y}-${m}-${d}`;
    }

    function todayKey() {
        return dateKey(Date.now());
    }

    function formatDateKey(key) {
        if (!key || !key.includes("-")) return "--";
        const [y, m, d] = key.split("-");
        return `${d}/${m}/${y}`;
    }

    function formatDateTime(timestamp) {
        return new Intl.DateTimeFormat("vi-VN", {
            timeZone: TIME_ZONE,
            hour12: false,
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        }).format(new Date(timeMs(timestamp)));
    }

    function formatTimeShort(timestamp) {
        return new Intl.DateTimeFormat("vi-VN", {
            timeZone: TIME_ZONE,
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        }).format(new Date(timeMs(timestamp)));
    }

    function timeMs(timestamp) {
        const n = Number(timestamp);
        if (!Number.isFinite(n)) return Date.now();
        return n < 1000000000000 ? n * 1000 : n;
    }

    function dataAgeSeconds(timestamp) {
        return Math.max(0, Math.floor((Date.now() - timeMs(timestamp)) / 1000));
    }

    function humanAge(seconds) {
        if (seconds < 60) return `${seconds}s ago`;
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
        return `${Math.floor(seconds / 86400)}d ago`;
    }

    function toNumber(value) {
        const n = Number(value);
        return Number.isFinite(n) ? n : 0;
    }

    function avg(values) {
        const clean = values.filter((v) => Number.isFinite(Number(v))).map(Number);
        return clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : 0;
    }

    function fmt(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return "--";
        return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function cssColors() {
        const s = getComputedStyle(document.body);
        return {
            temp: s.getPropertyValue("--accent-2").trim() || "#df7a46",
            humid: s.getPropertyValue("--accent").trim() || "#0f8b72",
            dust: s.getPropertyValue("--accent-3").trim() || "#e0b542",
            text: s.getPropertyValue("--text").trim() || "#1f261f",
            muted: s.getPropertyValue("--muted").trim() || "#81705a",
            grid: s.getPropertyValue("--chart-grid").trim() || "rgba(0,0,0,.1)",
            tooltip: s.getPropertyValue("--deep").trim() || "#14332b",
            tooltipText: s.getPropertyValue("--rail-text").trim() || "#fff8e6",
            safe: s.getPropertyValue("--safe").trim() || "#2f9e6d",
            warning: s.getPropertyValue("--warning").trim() || "#d8941d",
            danger: s.getPropertyValue("--danger").trim() || "#df5b4f"
        };
    }

    function alpha(color, opacity) {
        if (color.startsWith("#")) {
            const hex = color.replace("#", "");
            const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
            const r = parseInt(full.slice(0, 2), 16);
            const g = parseInt(full.slice(2, 4), 16);
            const b = parseInt(full.slice(4, 6), 16);
            return `rgba(${r}, ${g}, ${b}, ${opacity})`;
        }
        return color;
    }

    function setText(target, value) {
        const el = typeof target === "string" ? $(target) : target;
        if (el) el.innerText = value;
    }

    function setHtml(id, value) {
        const el = $(id);
        if (el) el.innerHTML = value;
    }

    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            "'": "&#039;",
            '"': "&quot;"
        }[char]));
    }

    function csvCell(value) {
        return `"${String(value ?? "").replace(/"/g, '""')}"`;
    }

    function toast(message) {
        const el = $("toast");
        if (!el) return;
        el.innerText = message;
        el.classList.add("show");
        clearTimeout(state.toastTimer);
        state.toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
    }
})();
