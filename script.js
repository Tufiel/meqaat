/** ---- CONFIG / STATE ---- **/
const COUNTRY = "IN";
const OPENWEATHER_API_KEY = "ad8a7c3f7676f68ebbb88339ac79d60f";

// single source of truth for location text input
let district = "Kulgam 192231"; 
let lastRawTimings = null; // keep last Aladhan timings for marquee/next calc

/** ---- UTILITIES ---- **/
function to12Hour(timeStr) {
  const [hStr, mStr] = timeStr.split(":");
  let h = Number(hStr), m = Number(mStr || 0);
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m.toString().padStart(2, "0")} ${ampm}`;
}

function addMinutes(timeStr, minsToAdd) {
  const [hStr, mStr] = timeStr.split(":");
  let h = Number(hStr), m = Number(mStr || 0);
  const d = new Date();
  d.setHours(h, m + minsToAdd, 0, 0);
  const hh = d.getHours();
  const mm = d.getMinutes();
  return `${hh.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}`;
}

// extract 5–6 digit pincode (if present)
function parsePin(s) {
  const m = (s || "").match(/\b\d{5,6}\b/);
  return m ? m[0] : null;
}

// best-effort city label for fallbacks
function parseCity(s) {
  if (!s) return "Kulgam";
  // take text before pincode or first comma
  const withoutPin = s.replace(/\b\d{5,6}\b/g, "").trim();
  const firstChunk = withoutPin.split(",")[0].trim();
  // fallback to first word if spaces
  return firstChunk || "Kulgam";
}

/** ---- FIQH ADJUSTMENTS (optional custom offsets) ---- **/
function adjustTimes(t, fiqh) {
  if (!t) return t;
  if (fiqh === "hanafi") {
    return {
      Fajr: to12Hour(addMinutes(t.Fajr, 40)),
      Sunrise: to12Hour(addMinutes(t.Sunrise, 10)),
      Dhuhr: "1:30 PM", // mosque fixed jamaat time (custom)
      Asr: to12Hour(addMinutes(t.Asr, 10)),
      Maghrib: to12Hour(addMinutes(t.Maghrib, 5)),
      Isha: to12Hour(addMinutes(t.Isha, 10)),
    };
  }
  return {
    Fajr: to12Hour(t.Fajr),
    Sunrise: to12Hour(t.Sunrise),
    Dhuhr: to12Hour(t.Dhuhr),
    Asr: to12Hour(t.Asr),
    Maghrib: to12Hour(t.Maghrib),
    Isha: to12Hour(t.Isha),
  };
}

/** ---- LOCATION RESOLUTION ---- **/
async function resolveLocation() {
  // Prefer PIN → coords for *accurate* timings
  const pin = parsePin(district);
  if (pin) {
    // OpenWeather ZIP geocoding: {name, lat, lon, country, zip}
    const geoUrl = `https://api.openweathermap.org/geo/1.0/zip?zip=${encodeURIComponent(pin)},${COUNTRY}&appid=${OPENWEATHER_API_KEY}`;
    const geoRes = await fetch(geoUrl);
    if (!geoRes.ok) throw new Error("PIN geocoding failed");
    const geo = await geoRes.json();
    return {
      pin,
      city: geo.name || parseCity(district),
      lat: geo.lat,
      lon: geo.lon,
    };
  }
  // Fallback: city-only; timings less accurate than PIN+coords
  return {
    pin: null,
    city: parseCity(district),
    lat: null,
    lon: null,
  };
}

/** ---- CORE FETCHERS ---- **/
async function fetchPrayerTimes(fiqh = "hanafi") {
  try {
    const loc = await resolveLocation();
    const school = fiqh === "hanafi" ? 1 : 0; // Aladhan: 0 = Shafi/Maliki/Hanbali, 1 = Hanafi

    let url;
    if (loc.lat != null && loc.lon != null) {
      // use coords (accurate for pincode)
      url = `https://api.aladhan.com/v1/timings?latitude=${loc.lat}&longitude=${loc.lon}&method=2&school=${school}`;
    } else {
      // fallback by address string
      const addr = encodeURIComponent(`${loc.city}, ${COUNTRY}`);
      url = `https://api.aladhan.com/v1/timingsByAddress?address=${addr}&method=2&school=${school}`;
    }

    const res = await fetch(url);
    if (!res.ok) throw new Error("Prayer API error");
    const data = await res.json();
    const t = data?.data?.timings;
    if (!t) throw new Error("Prayer timings missing");

    lastRawTimings = t;
    const adj = adjustTimes(t, fiqh);

    // Update DOM (guard each selector)
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    set("fajrTime", adj.Fajr);
    set("zuharTime", adj.Dhuhr);
    set("asrTime", adj.Asr);
    set("magribTime", adj.Maghrib);
    set("ishaTime", adj.Isha);
    set("jumahTime", "1:30 PM");
    set("azaanTime", adj.Maghrib);
    set("tomorrowTime", adj.Fajr);
    set("sahriIftarTime", adj.Sunrise);

    updateNextJamaat(t, fiqh);
    updateMarqueeFromTimings(t);
   let msg = document.getElementById("msgBox");
    msg.style.display = "block"; 
    msg.querySelector("#msg").innerText = `Prayer times updated for ${loc.city}${loc.pin ? " (" + loc.pin + ")" : ""}`;
    setTimeout(() => { msg.style.display = "none"; }, 5000); //
    console.log(`Prayer times updated for ${loc.city}${loc.pin ? " (" + loc.pin + ")" : ""}`);
  } catch (err) {
    let msg = document.getElementById("msgBox");
    msg.style.display = "block";
    msg.querySelector("#msg").innerText = `Error fetching prayer times: ${err.message || err}`;
    setTimeout(() => { msg.style.display = "none"; }, 5000); //
    console.error("fetchPrayerTimes:", err);
  }
}

async function fetchTemperature() {
  try {
    const loc = await resolveLocation();
    let lat = loc.lat, lon = loc.lon;

    // If we don't have coords (no PIN), try city geocoding for weather only
    if (lat == null || lon == null) {
      const city = loc.city || "Kulgam";
      const geoCityUrl = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(city)},${COUNTRY}&limit=1&appid=${OPENWEATHER_API_KEY}`;
      const gRes = await fetch(geoCityUrl);
      if (!gRes.ok) throw new Error("City geocoding failed");
      const arr = await gRes.json();
      if (!arr?.length) throw new Error("City not found");
      lat = arr[0].lat; lon = arr[0].lon;
    }

    const weatherUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${OPENWEATHER_API_KEY}`;
    const wr = await (await fetch(weatherUrl)).json();
    const el = document.querySelector("#temp span");
    if (el && wr?.main?.temp != null) el.textContent = Math.round(wr.main.temp);
  } catch (err) {
    console.error("fetchTemperature:", err);
  }
}

/** ---- CLOCK / NEXT JAMAAH / MARQUEE ---- **/
function startClock() {
  const tick = () => {
    const now = new Date();
    const el = document.getElementById("currentTime");
    if (el) el.textContent = now.toLocaleTimeString("en-US", { hour12: true });
  };
  tick();
  setInterval(tick, 1000);
}

function updateNextJamaat(timings, fiqh) {
  if (!timings) return;
  const adj = adjustTimes(timings, fiqh);
  const order = [
    { name: "Fajr", time: adj.Fajr },
    { name: "Dhuhr", time: adj.Dhuhr },
    { name: "Asr", time: adj.Asr },
    { name: "Maghrib", time: adj.Maghrib },
    { name: "Isha", time: adj.Isha },
  ];

  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();

  let next = order[0];
  for (const pr of order) {
    let [h, m] = pr.time.replace(/\s*(AM|PM)\s*/i, "").split(":").map(Number);
    const isPM = /PM/i.test(pr.time);
    const isAM = /AM/i.test(pr.time);
    if (isPM && h !== 12) h += 12;
    if (isAM && h === 12) h = 0;
    const mins = h * 60 + m;
    if (mins > nowMins) { next = pr; break; }
  }

  const tEl = document.getElementById("nextJamaatTime");
  if (tEl) tEl.textContent = next.time;
  const nEl = document.querySelector("#currentJamaatName span");
  if (nEl) nEl.textContent = next.name.toUpperCase();
}

function updateMarqueeFromTimings(t) {
  if (!t) return;
  const msgs = [
    `Sunrise: ${to12Hour(t.Sunrise)}`,
    `Sunset: ${to12Hour(t.Maghrib)}`,
    `Zawaal: Around Midday`,
    `Ishraaq: After Sunrise`,
  ];
  const h2 = document.querySelector("#marqueeDiv marquee h2");
  if (!h2) return;
  let idx = 0;
  h2.textContent = msgs[idx];
  idx = (idx + 1) % msgs.length;
  // clear any previous interval to avoid stacking
  if (window.__marqueeInterval) clearInterval(window.__marqueeInterval);
  window.__marqueeInterval = setInterval(() => {
    h2.textContent = msgs[idx];
    idx = (idx + 1) % msgs.length;
  }, 5000);
}

/** ---- SUGGESTIONS ---- **/
let suggestionTimeout;
async function fetchSuggestions(query) {
  const list = document.getElementById("suggestionsList");
  if (!list) return;
  list.innerHTML = "";
  if (!query || query.length < 3) return;

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}`
    );
    if (!res.ok) throw new Error("Suggestion request failed");
    const data = await res.json();

    data.slice(0, 5).forEach(place => {
      const li = document.createElement("li");
      li.textContent = place.display_name;
      li.style.cursor = "pointer";
      li.onclick = () => {
        const input = document.getElementById("districtInput");
        if (input) input.value = place.display_name;
        district = place.display_name; // update global
        list.innerHTML = "";
        fetchDataAndUpdate();
      };
      list.appendChild(li);
    });
  } catch (err) {
    console.error("Suggestion error:", err);
  }
}

/** ---- PUBLIC (GLOBAL) HANDLERS ---- **/
async function fetchDataAndUpdate() {
  const sel = document.getElementById("fiqhSelect");
  const fiqh = sel && sel.value ? sel.value : "hanafi";
  await fetchPrayerTimes(fiqh);
  await fetchTemperature();
}

function updateLocation() {
  const input = document.getElementById("districtInput");
  district = (input && input.value.trim()) || "Kulgam 192231";
  fetchDataAndUpdate();
}

// expose for inline onclick handlers
window.updateLocation = updateLocation;

/** ---- INIT ---- **/
document.addEventListener("DOMContentLoaded", () => {
  // listeners
  const sel = document.getElementById("fiqhSelect");
  if (sel) sel.addEventListener("change", e => fetchPrayerTimes(e.target.value));

  const inp = document.getElementById("districtInput");
  if (inp) {
    inp.addEventListener("input", e => {
      clearTimeout(suggestionTimeout);
      suggestionTimeout = setTimeout(() => fetchSuggestions(e.target.value), 300);
    });
  }

  // boot
  startClock();
  fetchDataAndUpdate();
  setInterval(fetchTemperature, 10 * 60 * 1000);
  setInterval(() => {
    const sel2 = document.getElementById("fiqhSelect");
    fetchPrayerTimes(sel2 && sel2.value ? sel2.value : "hanafi");
  }, 60 * 60 * 1000);
});
