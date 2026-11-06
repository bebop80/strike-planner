import os
import re
import json
from datetime import datetime, timedelta
import urllib3
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from bs4 import BeautifulSoup

# Disabilita i warning per certificati non verificati sui portali PA
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.join(BASE_DIR, "..")
DATA_DIR = os.path.join(ROOT_DIR, "data")
CONFIG_DIR = os.path.join(ROOT_DIR, "config")

MIT_URL = "https://scioperi.mit.gov.it/mit2/public/scioperi"
CGSSE_CALENDAR_URL = "https://www.cgsse.it/calendario-scioperi"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7"
}

AEREO_KEYWORDS = [
    "aereo", "aerea", "aerei", "aviazione", "enav", 
    "assistenza al volo", "navigazione aerea", "aeroportual", 
    "aeroporto", "handling", "vettore", "easyjet", "piloti", 
    "assistenti di volo", "cgsse", "enac"
]

INTERMODAL_KEYWORDS = [
    "ferrovi", "treni", "trenitalia", "italo", 
    "tpl", "autoferro", "trasporto pubblico locale", 
    "marittim", "traghetti"
]

def get_robust_session():
    session = requests.Session()
    retries = Retry(
        total=3,
        backoff_factor=1,
        status_forcelist=[500, 502, 503, 504]
    )
    adapter = HTTPAdapter(max_retries=retries)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session

def parse_date(date_str):
    if not date_str:
        return None
    match = re.search(r"(\d{2})[/.-](\d{2})[/.-](\d{4})", date_str)
    if match:
        day, month, year = match.groups()
        return f"{year}-{month}-{day}"
    match_iso = re.search(r"(\d{4})[/.-](\d{2})[/.-](\d{2})", date_str)
    if match_iso:
        year, month, day = match_iso.groups()
        return f"{year}-{month}-{day}"
    return None

def fetch_mit_strikes(session):
    print("Avvio interrogazione Cruscotto MIT...")
    strikes = []
    try:
        # verify=False gestisce eventuali handshake SSL bloccanti della PA
        resp = session.get(MIT_URL, headers=HEADERS, timeout=12, verify=False)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        table = soup.find("table")
        if not table:
            print("Tabella MIT non individuata.")
            return None

        rows = table.find_all("tr")[1:]
        for row in rows:
            cols = [td.get_text(strip=True) for td in row.find_all(["td", "th"])]
            if len(cols) >= 5:
                raw_start = cols[0]
                raw_end = cols[1]
                settore = cols[2].lower()
                ambito = cols[3]
                ambito_lower = ambito.lower()
                sindacati = cols[4]

                p_start = parse_date(raw_start)
                p_end = parse_date(raw_end) or p_start
                if not p_start:
                    continue

                is_aereo = any(k in settore for k in AEREO_KEYWORDS) or any(k in ambito_lower for k in AEREO_KEYWORDS)

                if is_aereo:
                    strikes.append({
                        "date": p_start,
                        "endDate": p_end,
                        "settore": "AEREO",
                        "ambito": ambito,
                        "sindacato": sindacati,
                        "fonte": "MIT"
                    })
                elif any(k in settore for k in INTERMODAL_KEYWORDS) or any(k in ambito_lower for k in INTERMODAL_KEYWORDS):
                    strikes.append({
                        "date": p_start,
                        "endDate": p_end,
                        "settore": "INTERMODALE",
                        "ambito": ambito,
                        "sindacato": sindacati,
                        "fonte": "MIT"
                    })
        print(f"Estratti con successo {len(strikes)} scioperi dal MIT.")
        return strikes
    except Exception as e:
        print(f"Avviso: Connessione al MIT non riuscita (timeout/geoblock): {e}")
        return None

def fetch_cgsse_blackouts(session):
    print("Verifica delibere su CGSSE (SSL bypass attivo)...")
    events = []
    try:
        resp = session.get(CGSSE_CALENDAR_URL, headers=HEADERS, timeout=10, verify=False)
        if resp.status_code == 200:
            soup = BeautifulSoup(resp.text, "html.parser")
            text_blocks = soup.find_all(string=re.compile(r"franchigia|sospensione", re.IGNORECASE))
            for t in text_blocks:
                parent_text = t.parent.get_text() if t.parent else ""
                dates_found = re.findall(r"\b(\d{2}/\d{2}/\d{4})\b", parent_text)
                for d in dates_found:
                    parsed = parse_date(d)
                    if parsed:
                        events.append({
                            "id": f"cgsse-{parsed}",
                            "descrizione": "Sospensione Istituzionale CGSSE",
                            "date": parsed,
                            "tipo": "istituzionale"
                        })
    except Exception as e:
        print(f"Verifica CGSSE online non disponibile (verrà usato config locale): {e}")
    return events

def build_blackout_windows(session):
    print("Elaborazione finestre di franchigia istituzionale (Art. 8)...")
    config_path = os.path.join(CONFIG_DIR, "blackout_dates.json")
    all_events = []

    if os.path.exists(config_path):
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                all_events.extend(json.load(f))
        except Exception as e:
            print(f"Errore lettura blackout_dates.json: {e}")

    online_events = fetch_cgsse_blackouts(session)
    known_dates = {ev["date"] for ev in all_events}
    for o_ev in online_events:
        if o_ev["date"] not in known_dates:
            all_events.append(o_ev)
            known_dates.add(o_ev["date"])

    windows = []
    for ev in all_events:
        try:
            base_d = datetime.strptime(ev["date"], "%Y-%m-%d").date()
            start_d = base_d - timedelta(days=3)
            end_d = base_d + timedelta(days=3)

            windows.append({
                "evento": ev.get("descrizione", "Sospensione Istituzionale"),
                "data_evento": ev["date"],
                "blocco_inizio": start_d.strftime("%Y-%m-%d"),
                "blocco_fine": end_d.strftime("%Y-%m-%d"),
                "tipo": ev.get("tipo", "nazionale"),
                "riferimento": "Art. 8 Del. 01/92 (-3/+3 gg)"
            })
        except Exception as err:
            print(f"Errore calcolo date per {ev}: {err}")

    return windows

def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(CONFIG_DIR, exist_ok=True)
    session = get_robust_session()

    strikes_file = os.path.join(DATA_DIR, "scioperi.json")
    
    # 1. Carica i dati attuali esistenti (per non azzerarli in caso di timeout della rete)
    existing_strikes = []
    if os.path.exists(strikes_file):
        try:
            with open(strikes_file, "r", encoding="utf-8") as f:
                old_payload = json.load(f)
                existing_strikes = old_payload.get("strikes", [])
        except Exception:
            existing_strikes = []

    # 2. Esecuzione scraping MIT
    new_strikes = fetch_mit_strikes(session)
    
    if new_strikes is not None and len(new_strikes) > 0:
        # Se la rete risponde, salviamo i nuovi dati
        final_strikes = new_strikes
        print(f"Aggiornato database con {len(final_strikes)} record online dal MIT.")
    else:
        # Se il server MIT va in timeout (es. da Codespaces estero), manteniamo la cache
        final_strikes = existing_strikes
        print(f"Mantenuta cache locale esistente ({len(final_strikes)} scioperi preservati).")

    strikes_payload = {
        "last_sync": datetime.now().isoformat(),
        "total_records": len(final_strikes),
        "strikes": final_strikes
    }
    with open(strikes_file, "w", encoding="utf-8") as f:
        json.dump(strikes_payload, f, ensure_ascii=False, indent=2)

    # 3. Aggiorna finestre franchigia
    blackouts = build_blackout_windows(session)
    blackouts_file = os.path.join(DATA_DIR, "blackout_windows.json")
    with open(blackouts_file, "w", encoding="utf-8") as f:
        json.dump(blackouts, f, ensure_ascii=False, indent=2)

    print(f"Esecuzione terminata. Scioperi memorizzati: {len(final_strikes)}.")

if __name__ == "__main__":
    main()