import os
import re
import json
from datetime import datetime, timedelta
import requests
from bs4 import BeautifulSoup

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.join(BASE_DIR, "..")
DATA_DIR = os.path.join(ROOT_DIR, "data")
CONFIG_DIR = os.path.join(ROOT_DIR, "config")

MIT_URL = "https://scioperi.mit.gov.it/mit2/public/scioperi"
CGSSE_CALENDAR_URL = "https://www.cgsse.it/calendario-scioperi"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
}

def parse_date(date_str):
    if not date_str:
        return None
    match = re.search(r"(\d{2})[/.-](\d{2})[/.-](\d{4})", date_str)
    if match:
        day, month, year = match.groups()
        return f"{year}-{month}-{day}"
    return None

def fetch_mit_strikes():
    print("Avvio scraping Cruscotto MIT...")
    strikes = []
    try:
        resp = requests.get(MIT_URL, headers=HEADERS, timeout=25)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        table = soup.find("table")
        if not table:
            print("Tabella MIT non individuata.")
            return strikes

        rows = table.find_all("tr")[1:]
        for row in rows:
            cols = [td.get_text(strip=True) for td in row.find_all(["td", "th"])]
            if len(cols) >= 5:
                raw_start = cols[0]
                raw_end = cols[1]
                settore = cols[2].lower()
                ambito = cols[3]
                sindacati = cols[4]

                p_start = parse_date(raw_start)
                p_end = parse_date(raw_end) or p_start
                if not p_start:
                    continue

                if "aereo" in settore:
                    strikes.append({
                        "date": p_start,
                        "endDate": p_end,
                        "settore": "AEREO",
                        "ambito": ambito,
                        "sindacato": sindacati,
                        "fonte": "MIT"
                    })
                elif any(k in settore for k in ["ferroviari", "tpl", "marittimo", "trasporto"]):
                    strikes.append({
                        "date": p_start,
                        "endDate": p_end,
                        "settore": "INTERMODALE",
                        "ambito": ambito,
                        "sindacato": sindacati,
                        "fonte": "MIT"
                    })
        print(f"Estratti {len(strikes)} scioperi dal MIT.")
    except Exception as e:
        print(f"Errore recupero MIT: {e}")

    return strikes

def fetch_cgsse_blackouts():
    print("Tentativo di estrazione sospensioni da CGSSE...")
    events = []
    try:
        resp = requests.get(CGSSE_CALENDAR_URL, headers=HEADERS, timeout=15)
        if resp.status_code == 200:
            soup = BeautifulSoup(resp.text, "html.parser")
            # Estrazione testuale di date in formato DD/MM/YYYY associate a periodi di franchigia o blocco
            text_blocks = soup.find_all(text=re.compile(r"franchigia|sospensione", re.IGNORECASE))
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
        print(f"Nota: recupero CGSSE non critico completato con fallback: {e}")
    return events

def build_blackout_windows():
    print("Costruzione finestre di blocco ex Art. 8...")
    config_path = os.path.join(CONFIG_DIR, "blackout_dates.json")
    all_events = []

    # 1. Carica eventi da config/blackout_dates.json
    if os.path.exists(config_path):
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                all_events.extend(json.load(f))
        except Exception as e:
            print(f"Errore lettura blackout_dates.json: {e}")

    # 2. Aggiunge eventi rilevati da CGSSE
    online_events = fetch_cgsse_blackouts()
    known_dates = {ev["date"] for ev in all_events}
    for o_ev in online_events:
        if o_ev["date"] not in known_dates:
            all_events.append(o_ev)
            known_dates.add(o_ev["date"])

    windows = []
    # 3. Calcola l'estensione dell'Art. 8: 3 giorni prima e 3 giorni dopo
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
            print(f"Errore elaborazione data {ev}: {err}")

    return windows

def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(CONFIG_DIR, exist_ok=True)

    # Aggiorna scioperi
    strikes = fetch_mit_strikes()
    strikes_payload = {
        "last_sync": datetime.now().isoformat(),
        "total_records": len(strikes),
        "strikes": strikes
    }
    with open(os.path.join(DATA_DIR, "scioperi.json"), "w", encoding="utf-8") as f:
        json.dump(strikes_payload, f, ensure_ascii=False, indent=2)

    # Aggiorna blackout windows
    blackouts = build_blackout_windows()
    with open(os.path.join(DATA_DIR, "blackout_windows.json"), "w", encoding="utf-8") as f:
        json.dump(blackouts, f, ensure_ascii=False, indent=2)

    print("Pipeline sincronizzazione completata con successo.")

if __name__ == "__main__":
    main()