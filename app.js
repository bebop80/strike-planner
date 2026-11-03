let strikesData = [];
let blackoutWindows = [];

// 1. Calcolo Pasqua (Algoritmo Meeus/Butcher)
function getEaster(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month, day);
}

// 2. Controllo Franchigie Fisse e Mobili (Art. 8 Del. 01/92)
function checkFranchigia(targetDate) {
  const y = targetDate.getFullYear();
  const m = targetDate.getMonth();
  const d = targetDate.getDate();

  // 18 Dicembre - 7 Gennaio
  if ((m === 11 && d >= 18) || (m === 0 && d <= 7)) {
    return { blocked: true, name: "Franchigia Natale / Capodanno / Epifania (18 dic - 7 gen)" };
  }
  // 24 Aprile - 2 Maggio
  if ((m === 3 && d >= 24) || (m === 4 && d <= 2)) {
    return { blocked: true, name: "Franchigia Festa Liberazione / 1° Maggio (24 apr - 2 mag)" };
  }
  // 27 Giugno - 4 Luglio
  if ((m === 5 && d >= 27) || (m === 6 && d <= 4)) {
    return { blocked: true, name: "Franchigia Inizio Estate (27 giu - 4 lug)" };
  }
  // 27 Luglio - 5 Settembre
  if ((m === 6 && d >= 27) || m === 7 || (m === 8 && d <= 5)) {
    return { blocked: true, name: "Franchigia Esodo Estivo (27 lug - 5 set)" };
  }
  // 30 Ottobre - 5 Novembre
  if ((m === 9 && d >= 30) || (m === 10 && d <= 5)) {
    return { blocked: true, name: "Franchigia Ognissanti / Defunti (30 ott - 5 nov)" };
  }

  // Franchigia Pasquale: da giovedì precedente a giovedì successivo a Pasqua
  const easter = getEaster(y);
  const thuBefore = new Date(easter);
  thuBefore.setDate(easter.getDate() - 3);
  const thuAfter = new Date(easter);
  thuAfter.setDate(easter.getDate() + 4);

  if (targetDate >= thuBefore && targetDate <= thuAfter) {
    return { blocked: true, name: "Franchigia Pasquale (Giovedì pre-Pasqua / Giovedì post-Pasqua)" };
  }

  // Franchigie Istituzionali / Sospensioni (Art. 8 calcolato a -3/+3 giorni)
  const targetIso = targetDate.toISOString().split("T")[0];
  for (const win of blackoutWindows) {
    if (targetIso >= win.blocco_inizio && targetIso <= win.blocco_fine) {
      return {
        blocked: true,
        name: `Franchigia Istituzionale Art. 8: ${win.evento} (${win.blocco_inizio} al ${win.blocco_fine})`
      };
    }
  }

  return { blocked: false };
}

// 3. Calcolo Giorni Liberi (esclude giorno di inizio e giorno finale)
function getFreeDays(d1, d2) {
  const t1 = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate()).getTime();
  const t2 = new Date(d2.getFullYear(), d2.getMonth(), d2.getDate()).getTime();
  const diffDays = Math.floor(Math.abs(t2 - t1) / (24 * 60 * 60 * 1000));
  return Math.max(0, diffDays - 1);
}

// 4. Valutazione Normativa Completa
function evaluateDay(targetDate, proclamationDate, actionType) {
  const result = {
    date: targetDate,
    status: "GREEN",
    checks: [],
    recommendedHours: actionType === "first" 
      ? "4 Ore (es. 13:00 - 17:00, al di fuori delle fasce di garanzia)" 
      : "24 Ore (dalle 00:01 alle 23:59, con fasce di garanzia rispettate)"
  };

  // Preavviso Minimo (Art. 4: 10 giorni escluso il giorno di invio)
  const diffFromProclamation = Math.floor((targetDate - proclamationDate) / (24 * 60 * 60 * 1000));
  if (diffFromProclamation < 11) {
    result.status = "RED";
    result.checks.push({
      type: "fail",
      msg: `Preavviso insufficiente: ${diffFromProclamation} giorni dalla proclamazione. Minimo di legge: 10 giorni interi escluso l'invio.`
    });
  } else {
    result.checks.push({
      type: "ok",
      msg: `Preavviso minimo rispettato: ${diffFromProclamation} giorni di anticipo.`
    });
  }

  // Preavviso Massimo (Art. 5: max 45 giorni)
  if (diffFromProclamation > 45) {
    result.status = "RED";
    result.checks.push({
      type: "fail",
      msg: `Preavviso superiore al limite di 45 giorni solari previsti dall'Art. 5.`
    });
  }

  // Franchigie di Legge (Art. 8)
  const fCheck = checkFranchigia(targetDate);
  if (fCheck.blocked) {
    result.status = "RED";
    result.checks.push({ type: "fail", msg: fCheck.name });
  } else {
    result.checks.push({ type: "ok", msg: "Nessuna franchigia di calendario o sospensione istituzionale attiva." });
  }

  // Rarefazione Oggettiva Trasporto Aereo (Art. 16: almeno 10 giorni liberi)
  const aereoStrikes = strikesData.filter(s => s.settore === "AEREO");
  for (const s of aereoStrikes) {
    const sDate = new Date(s.date);
    const freeDays = getFreeDays(targetDate, sDate);
    if (freeDays < 10) {
      result.status = "RED";
      result.checks.push({
        type: "fail",
        msg: `Violazione Rarefazione Oggettiva (Art. 16): solo ${freeDays} gg liberi dallo sciopero del settore aereo (${s.date} - ${s.ambito}). Richiesti almeno 10 gg liberi.`
      });
      break;
    }
  }

  // Concomitanza Intermodale Trasporti (Art. 12)
  if (result.status !== "RED") {
    const intermodalStrikes = strikesData.filter(s => s.settore === "INTERMODALE");
    const targetIso = targetDate.toISOString().split("T")[0];
    const collision = intermodalStrikes.find(s => s.date === targetIso);
    if (collision) {
      result.status = "YELLOW";
      result.checks.push({
        type: "warn",
        msg: `Concomitanza intermodale (Art. 12): sciopero programmato nei trasporti (${collision.ambito} - ${collision.sindacato}). Verificare orari precisi per evitare sovrapposizioni.`
      });
    } else {
      result.checks.push({ type: "ok", msg: "Nessun altro sciopero dei trasporti concomitante nella stessa giornata." });
    }
  }

  // Fasce di Garanzia (Artt. 9 e 20)
  result.checks.push({
    type: "info",
    msg: "Fasce orarie protette inderogabili: 07:00-10:00 e 18:00-21:00 (i voli programmati in tali fasce devono operare regolarmente)."
  });

  return result;
}

// Inizializzazione Applicazione
async function init() {
  const statusEl = document.getElementById("sync-status");

  try {
    const resStrikes = await fetch("data/scioperi.json");
    const jsonStrikes = await resStrikes.json();
    strikesData = jsonStrikes.strikes || [];
    if (jsonStrikes.last_sync) {
      const syncDate = new Date(jsonStrikes.last_sync).toLocaleDateString("it-IT");
      statusEl.innerText = `Dati sincronizzati: ${syncDate} (${strikesData.length} scioperi archiviati)`;
    }
  } catch (err) {
    console.warn("Impossibile caricare data/scioperi.json:", err);
    statusEl.innerText = "Dati locali non disponibili";
  }

  try {
    const resWindows = await fetch("data/blackout_windows.json");
    blackoutWindows = await resWindows.json();
  } catch (err) {
    console.warn("Impossibile caricare data/blackout_windows.json:", err);
  }

  // Imposta data odierna
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");

  document.getElementById("proclamation-date").value = `${yyyy}-${mm}-${dd}`;
  document.getElementById("month-select").value = `${yyyy}-${mm}`;

  document.getElementById("btn-recompute").addEventListener("click", renderCalendar);
  document.getElementById("month-select").addEventListener("change", renderCalendar);

  renderCalendar();
}

function renderCalendar() {
  const calEl = document.getElementById("calendar");
  calEl.innerHTML = "";

  const monthVal = document.getElementById("month-select").value;
  const [yearStr, monthStr] = monthVal.split("-");
  const year = parseInt(yearStr);
  const month = parseInt(monthStr) - 1;

  const proclamationVal = document.getElementById("proclamation-date").value;
  const [pY, pM, pD] = proclamationVal.split("-").map(Number);
  const proclamationDate = new Date(pY, pM - 1, pD);
  const actionType = document.getElementById("action-type").value;

  const weekdays = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
  weekdays.forEach(w => {
    const el = document.createElement("div");
    el.className = "cal-header";
    el.innerText = w;
    calEl.appendChild(el);
  });

  const firstDayIndex = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let i = 0; i < firstDayIndex; i++) {
    const empty = document.createElement("div");
    empty.className = "cal-cell empty";
    calEl.appendChild(empty);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const curDate = new Date(year, month, d);
    const evalData = evaluateDay(curDate, proclamationDate, actionType);

    const cell = document.createElement("div");
    cell.className = `cal-cell status-${evalData.status.toLowerCase()}`;
    cell.innerHTML = `
      <span class="cell-date">${d}</span>
      <span class="cell-tag">${evalData.status === "GREEN" ? "OK" : evalData.status}</span>
    `;

    cell.addEventListener("click", () => displayDetails(evalData));
    calEl.appendChild(cell);
  }
}

function displayDetails(evalData) {
  const panel = document.getElementById("details-content");
  const placeholder = document.querySelector(".placeholder-text");
  placeholder.style.display = "none";
  panel.style.display = "block";

  const dateFmt = evalData.date.toLocaleDateString("it-IT", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  });

  let html = `<h3>${dateFmt}</h3>`;
  html += `<p><strong>Orario di Astensione:</strong> ${evalData.recommendedHours}</p>`;
  html += `<div><strong>Verifiche di Legittimità:</strong></div>`;

  evalData.checks.forEach(c => {
    const cls = c.type === "ok" ? "rule-ok" : c.type === "fail" ? "rule-fail" : c.type === "warn" ? "rule-warn" : "rule-info";
    html += `<div class="rule-check ${cls}">${c.msg}</div>`;
  });

  panel.innerHTML = html;
}

window.addEventListener("DOMContentLoaded", init);