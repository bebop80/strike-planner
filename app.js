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

// 2. Controllo Franchigie Fisse e Mobili (Art. 8 Delibera 01/92)
function checkFranchigia(targetDate) {
  const y = targetDate.getFullYear();
  const m = targetDate.getMonth();
  const d = targetDate.getDate();

  if ((m === 11 && d >= 18) || (m === 0 && d <= 7)) {
    return { blocked: true, name: "Franchigia Natale / Capodanno / Epifania", interval: "18 Dicembre – 7 Gennaio", ref: "Art. 8 Del. 01/92" };
  }
  if ((m === 3 && d >= 24) || (m === 4 && d <= 2)) {
    return { blocked: true, name: "Franchigia Festa della Liberazione e 1° Maggio", interval: "24 Aprile – 2 Maggio", ref: "Art. 8 Del. 01/92" };
  }
  if ((m === 5 && d >= 27) || (m === 6 && d <= 4)) {
    return { blocked: true, name: "Franchigia Inizio Estate / Punte di Traffico", interval: "27 Giugno – 4 Luglio", ref: "Art. 8 Del. 01/92" };
  }
  if ((m === 6 && d >= 27) || m === 7 || (m === 8 && d <= 5)) {
    return { blocked: true, name: "Franchigia Esodo Estivo", interval: "27 Luglio – 5 Settembre", ref: "Art. 8 Del. 01/92" };
  }
  if ((m === 9 && d >= 30) || (m === 10 && d <= 5)) {
    return { blocked: true, name: "Franchigia Ponte di Ognissanti e Commemorazione Defunti", interval: "30 Ottobre – 5 Novembre", ref: "Art. 8 Del. 01/92" };
  }

  // Pasqua: da giovedì precedente a giovedì successivo
  const easter = getEaster(y);
  const thuBefore = new Date(easter);
  thuBefore.setDate(easter.getDate() - 3);
  const thuAfter = new Date(easter);
  thuAfter.setDate(easter.getDate() + 4);

  if (targetDate >= thuBefore && targetDate <= thuAfter) {
    const fmtStart = thuBefore.toLocaleDateString("it-IT");
    const fmtEnd = thuAfter.toLocaleDateString("it-IT");
    return { blocked: true, name: "Franchigia Pasquale mobile", interval: `dal ${fmtStart} al ${fmtEnd}`, ref: "Art. 8 Del. 01/92" };
  }

  // Franchigie Istituzionali / Consultazioni (±3 giorni dall'evento)
  const targetIso = targetDate.toISOString().split("T")[0];
  for (const win of blackoutWindows) {
    if (targetIso >= win.blocco_inizio && targetIso <= win.blocco_fine) {
      return {
        blocked: true,
        name: `Franchigia Istituzionale: ${win.evento}`,
        interval: `dal ${win.blocco_inizio} al ${win.blocco_fine}`,
        ref: "Art. 8 Del. 01/92 (-3/+3 giorni)"
      };
    }
  }

  return { blocked: false };
}

// 3. Calcolo giorni liberi (esclude giorno iniziale e finale)
function getFreeDays(d1, d2) {
  const t1 = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate()).getTime();
  const t2 = new Date(d2.getFullYear(), d2.getMonth(), d2.getDate()).getTime();
  const diffDays = Math.floor(Math.abs(t2 - t1) / (24 * 60 * 60 * 1000));
  return Math.max(0, diffDays - 1);
}

// 4. Motore di Valutazione e Spiegazione Normativa
function evaluateDay(targetDate, proclamationDate, actionType) {
  const result = {
    date: targetDate,
    status: "GREEN", // GREEN, YELLOW, RED
    blockingStrikes: [],
    reasons: [],
    recommendedHours: actionType === "first"
      ? "4 Ore (es. 13:00 - 17:00, al di fuori delle fasce di garanzia)"
      : "24 Ore (dalle 00:01 alle 23:59 con rispetto integrale delle fasce di garanzia)"
  };

  const targetIso = targetDate.toISOString().split("T")[0];

  // A. PREAVVISO MINIMO E MASSIMO (Artt. 4 e 5)
  const diffFromProclamation = Math.floor((targetDate - proclamationDate) / (24 * 60 * 60 * 1000));
  if (diffFromProclamation < 11) {
    result.status = "RED";
    result.reasons.push({
      type: "fail",
      title: "Preavviso di legge insufficiente",
      law: "Art. 4 Del. 01/92 e Art. 2 c. 1 L. 146/90",
      description: `Tra la data di proclamazione e la data dello sciopero intercorrono solo ${Math.max(0, diffFromProclamation)} giorni. La norma impone un preavviso minimo di 10 giorni liberi (nel computo è escluso il giorno iniziale di invio).`
    });
  } else if (diffFromProclamation > 45) {
    result.status = "RED";
    result.reasons.push({
      type: "fail",
      title: "Superamento preavviso massimo",
      law: "Art. 5 Del. 01/92",
      description: `Il preavviso supera i 45 giorni solari previsti come limite massimo per evitare proclamazioni preventive sleali.`
    });
  } else {
    result.reasons.push({
      type: "ok",
      title: "Termini di preavviso regolari",
      law: "Artt. 4 e 5 Del. 01/92",
      description: `Preavviso di ${diffFromProclamation} giorni conforme (finestra consentita: 10–45 giorni).`
    });
  }

  // B. FRANCHIGIE (Art. 8)
  const franchigia = checkFranchigia(targetDate);
  if (franchigia.blocked) {
    result.status = "RED";
    result.reasons.push({
      type: "fail",
      title: `Blocco per ${franchigia.name}`,
      law: franchigia.ref,
      description: `Periodo di franchigia assoluta (${franchigia.interval}). In queste date la legge vieta tassativamente qualsiasi azione di sciopero nel trasporto aereo a tutela della mobilità dei cittadini.`
    });
  } else {
    result.reasons.push({
      type: "ok",
      title: "Nessuna franchigia attiva",
      law: "Art. 8 Del. 01/92",
      description: "La data non coincide con ponti festivi, esodi estivi, festività natalizie o consultazioni."
    });
  }

  // C. VERIFICA CONFLITTI CON SCIOPERI AEREI GIÀ PROCLAMATI
  const aereoStrikes = strikesData.filter(s => s.settore === "AEREO");

  for (const s of aereoStrikes) {
    const sDate = new Date(s.date);
    const sIso = s.date;

    // 1. Concomitanza diretta (stesso identico giorno)
    if (targetIso === sIso) {
      result.status = "RED";
      const isEnav = s.ambito.toLowerCase().includes("enav") || s.ambito.toLowerCase().includes("assistenza al volo");
      const lawRef = isEnav 
        ? "Art. 17 Del. 01/92 e Delibera CGSSE 25/01/2007 (Divieto concentrazione assistenza volo)" 
        : "Art. 16 Del. 01/92 (Concomitanza sullo stesso bacino passeggeri)";
      
      result.blockingStrikes.push(s);
      result.reasons.push({
        type: "fail",
        title: `Concomitanza diretta con sciopero: ${s.ambito}`,
        law: lawRef,
        description: `È già proclamato uno sciopero aereo in questa data (${s.sindacato}). ${isEnav ? "La Commissione di Garanzia vieta la contemporaneità tra personale di volo di un vettore e addetti al controllo del volo ENAV poiché crea paralisi totale del traffico aereo." : "Vietata la concentrazione se produce grave pregiudizio agli utenti."}`
      });
      continue;
    }

    // 2. Rarefazione oggettiva 10 giorni liberi (Art. 16)
    const freeDays = getFreeDays(targetDate, sDate);
    if (freeDays < 10) {
      result.status = "RED";
      result.blockingStrikes.push(s);
      const isBefore = targetDate < sDate;
      result.reasons.push({
        type: "fail",
        title: `Violazione Rarefazione Oggettiva rispetto a: ${s.ambito}`,
        law: "Art. 16 Del. 01/92",
        description: `Tra questa data e lo sciopero aereo già fissato per il ${s.date} (${s.sindacato}) ci sono solo ${freeDays} giorni liberi. L'Art. 16 impone che tra due scioperi incidenti sullo stesso bacino di utenza trascorrano almeno 10 giorni liberi interi (${isBefore ? "troppo vicino prima" : "troppo vicino dopo"}).`
      });
    }
  }

  // D. VERIFICA CONCOMITANZA INTERMODALE TRASPORTI (Art. 12)
  const intermodalStrikes = strikesData.filter(s => s.settore === "INTERMODALE");
  const intermodalCollision = intermodalStrikes.find(s => s.date === targetIso);
  if (intermodalCollision) {
    if (result.status !== "RED") result.status = "YELLOW";
    result.reasons.push({
      type: "warn",
      title: `Attenzione: Sciopero concomitante in altro trasporto (${intermodalCollision.ambito})`,
      law: "Art. 12 Del. 01/92 (Divieto di contemporaneità intermodale)",
      description: `È presente uno sciopero nel settore ferroviario o del trasporto pubblico locale indetto da ${intermodalCollision.sindacato}. L'Art. 12 vieta lo sciopero aereo se coincide negli stessi giorni ed orari. È necessario calibrare la fascia oraria per evitare sovrapposizioni.`
    });
  }

  // E. FASCE DI GARANZIA INDEROGABILI (Artt. 9 e 20)
  result.reasons.push({
    type: "info",
    title: "Fasce orarie protette inderogabili",
    law: "Artt. 9 e 20 Del. 01/92",
    description: "In qualsiasi data autorizzata, tutti i voli programmati nelle fasce 07:00–10:00 e 18:00–21:00 devono operare regolarmente a tutela delle prestazioni indispensabili."
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
      statusEl.innerText = `Aggiornato al: ${syncDate} (${strikesData.length} scioperi rilevati)`;
    }
  } catch (err) {
    console.warn("Impossibile caricare data/scioperi.json:", err);
    statusEl.innerText = "Dati MIT offline";
  }

  try {
    const resWindows = await fetch("data/blackout_windows.json");
    blackoutWindows = await resWindows.json();
  } catch (err) {
    console.warn("Impossibile caricare data/blackout_windows.json:", err);
  }

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
      <span class="cell-tag">${evalData.status === "GREEN" ? "IDONEA" : evalData.status === "YELLOW" ? "ATTENZIONE" : "BLOCCO"}</span>
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

  let statusBadge = "";
  if (evalData.status === "GREEN") {
    statusBadge = '<span class="status-pill pill-green">DATA IDONEA PER LA PROCLAMAZIONE</span>';
  } else if (evalData.status === "YELLOW") {
    statusBadge = '<span class="status-pill pill-yellow">DATA CONDIZIONATA / VERIFICA ORARI</span>';
  } else {
    statusBadge = '<span class="status-pill pill-red">DATA NON AMMISSIBILE (BLOCCATA DALLA COMMISSIONE)</span>';
  }

  let html = `<div class="detail-header">
    <h3>${dateFmt}</h3>
    ${statusBadge}
  </div>`;

  html += `<p class="rec-hours"><strong>Formato Azione Consigliato:</strong> ${evalData.recommendedHours}</p>`;

  // SEZIONE SCIOPERI IMPEDITIVI
  if (evalData.blockingStrikes.length > 0) {
    html += `<div class="blocking-strikes-box">
      <h4>Scioperi già presenti che impediscono questa data:</h4>
      <ul>`;
    evalData.blockingStrikes.forEach(s => {
      html += `<li><strong>${s.date}</strong> — <em>${s.ambito}</em> (${s.sindacato}) [Fonte: ${s.fonte}]</li>`;
    });
    html += `</ul></div>`;
  }

  html += `<h4>Dettaglio delle Verifiche Normative:</h4>`;

  evalData.reasons.forEach(r => {
    const cls = r.type === "ok" ? "rule-ok" : r.type === "fail" ? "rule-fail" : r.type === "warn" ? "rule-warn" : "rule-info";
    html += `
      <div class="rule-check ${cls}">
        <div class="rule-title">
          <strong>${r.title}</strong>
          <span class="rule-law">${r.law}</span>
        </div>
        <div class="rule-desc">${r.description}</div>
      </div>
    `;
  });

  panel.innerHTML = html;
}

window.addEventListener("DOMContentLoaded", init);
