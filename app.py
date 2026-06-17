import os
import io
import webbrowser
from threading import Timer
from flask import Flask, request, jsonify, send_from_directory
import pandas as pd
import numpy as np

app = Flask(__name__, static_folder='static', static_url_path='/static')

# Serve index.html at root
@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')

# Serve static assets
@app.route('/<path:path>')
def static_proxy(path):
    return send_from_directory(app.static_folder, path)

# ==========================================================================
# PROBLEM TABLE ALGORITHM SOLVER
# ==========================================================================
def run_pinch_calculations(streams, delta_tmin):
    if not streams:
        return {
            "targets": {
                "QHmin": 0, "QCmin": 0, "pinchShifted": 0, "pinchHot": 0, "pinchCold": 0,
                "tempList": [], "Rcas": [], "nMin": 0
            },
            "curves": {}
        }

    shift = delta_tmin / 2.0

    # 1. Shift Temperatures
    shifted = []
    for s in streams:
        tin_s = s["Tin"] - shift if s["type"] == "hot" else s["Tin"] + shift
        tout_s = s["Tout"] - shift if s["type"] == "hot" else s["Tout"] + shift
        shifted.append({**s, "Tin_s": tin_s, "Tout_s": tout_s})

    # 2. Sorted Shifted Temperatures list (descending)
    all_temps = set()
    for s in shifted:
        all_temps.add(s["Tin_s"])
        all_temps.add(s["Tout_s"])
    temp_list = sorted(list(all_temps), reverse=True)

    # 3. Fk (flowrate boundaries)
    Fk = []
    for T in temp_list:
        fk = 0.0
        for s in shifted:
            if abs(T - s["Tin_s"]) < 1e-5: fk += s["MCp"]
            if abs(T - s["Tout_s"]) < 1e-5: fk -= s["MCp"]
        Fk.append(round(fk, 6))

    # 4. CumFk
    CumFk = []
    cumulative = 0.0
    for fk in Fk:
        cumulative += fk
        CumFk.append(round(cumulative, 6))

    # 5. Qk (Interval Heat loads)
    Qk = [0.0]
    for i in range(1, len(temp_list)):
        q = CumFk[i - 1] * (temp_list[i - 1] - temp_list[i])
        Qk.append(round(q, 6))

    # 6. Qcas
    Qcas = []
    cumulative_q = 0.0
    for q in Qk:
        cumulative_q += q
        Qcas.append(round(cumulative_q, 6))

    # 7. Rcas
    min_qcas = min(Qcas)
    Rcas = [round(q - min_qcas, 6) for q in Qcas]

    # Identify targets
    qh_min = Rcas[0]
    qc_min = Rcas[-1]
    pinch_idx = Rcas.index(0.0) if 0.0 in Rcas else 0
    pinch_shifted = temp_list[pinch_idx]
    pinch_hot = pinch_shifted + shift
    pinch_cold = pinch_shifted - shift

    # N_min Target
    hot_streams = [s for s in streams if s["type"] == "hot"]
    cold_streams = [s for s in streams if s["type"] == "cold"]
    above_h = [s for s in hot_streams if s["Tin"] > pinch_hot]
    above_c = [s for s in cold_streams if s["Tout"] > pinch_cold]
    below_h = [s for s in hot_streams if s["Tout"] < pinch_hot]
    below_c = [s for s in cold_streams if s["Tin"] < pinch_cold]

    n_above = len(above_h) + len(above_c) + 1 # + heater
    n_below = len(below_h) + len(below_c) + 1 # + cooler
    n_min = (n_above - 1) + (n_below - 1)

    targets = {
        "QHmin": qh_min,
        "QCmin": qc_min,
        "pinchShifted": pinch_shifted,
        "pinchHot": pinch_hot,
        "pinchCold": pinch_cold,
        "tempList": temp_list,
        "Rcas": Rcas,
        "nMin": n_min
    }

    # --- Composite Curves coordinate generation ---
    def build_composite_coords(stream_list):
        if not stream_list:
            return [], []
        temps = sorted(list(set(
            [s["Tin"] for s in stream_list] + [s["Tout"] for s in stream_list]
        )))
        coords_T = [temps[0]]
        coords_HD = [0.0]
        cum_hd = 0.0
        
        for i in range(len(temps) - 1):
            T_low = temps[i]
            T_high = temps[i + 1]
            mcp_total = 0.0
            for s in stream_list:
                t_min_s = min(s["Tin"], s["Tout"])
                t_max_s = max(s["Tin"], s["Tout"])
                if t_min_s <= T_low and t_max_s >= T_high:
                    mcp_total += s["MCp"]
            cum_hd += mcp_total * (T_high - T_low)
            coords_T.append(T_high)
            coords_HD.append(cum_hd)
            
        return coords_HD, coords_T

    def get_x_at_temp(coords_HD, coords_T, target_T):
        for i in range(len(coords_T) - 1):
            T1, T2 = coords_T[i], coords_T[i + 1]
            if T1 <= target_T <= T2:
                if abs(T2 - T1) < 1e-5:
                    return coords_HD[i]
                frac = (target_T - T1) / (T2 - T1)
                return coords_HD[i] + frac * (coords_HD[i + 1] - coords_HD[i])
        return 0.0

    hot_H, hot_T = build_composite_coords(hot_streams)
    cold_H, cold_T = build_composite_coords(cold_streams)
    cold_H_shifted = [h + qc_min for h in cold_H]

    px_hot = get_x_at_temp(hot_H, hot_T, pinch_hot)
    px_cold = get_x_at_temp(cold_H_shifted, cold_T, pinch_cold)

    h_max = max(max(hot_H) if hot_H else 0, max(cold_H_shifted) if cold_H_shifted else 0)
    t_min = min(min(hot_T) if hot_T else 0, min(cold_T) if cold_T else 0)
    t_max = max(max(hot_T) if hot_T else 0, max(cold_T) if cold_T else 0)

    curves = {
        "hot_H": hot_H,
        "hot_T": hot_T,
        "cold_H_shifted": cold_H_shifted,
        "cold_T": cold_T,
        "pinchHot": pinch_hot,
        "pinchCold": pinch_cold,
        "px_hot": px_hot,
        "px_cold": px_cold,
        "h_max": h_max,
        "t_min": t_min,
        "t_max": t_max
    }

    return {"targets": targets, "curves": curves}

# ==========================================================================
# SIMULATOR & VALIDATION
# ==========================================================================
def run_simulation(streams, delta_tmin, matches, utilities, targets):
    stream_temps = {}
    for s in streams:
        stream_temps[s["id"]] = [None] * 9

    hot_streams = [s for s in streams if s["type"] == "hot"]
    cold_streams = [s for s in streams if s["type"] == "cold"]

    # 1. Hot streams Left-to-Right
    for h in hot_streams:
        temps = stream_temps[h["id"]]
        temps[0] = h["Tin"]
        for slot in range(1, 9):
            match = next((m for m in matches if m["hotStreamId"] == h["id"] and m["slot"] == slot), None)
            cooler = next((u for u in utilities if u["streamId"] == h["id"] and u["slot"] == slot and u["type"] == "cooler"), None)
            
            load = 0.0
            if match: load = match["load"]
            if cooler: load = cooler["load"]
            
            temps[slot] = temps[slot - 1] - load / h["MCp"]

    # 2. Cold streams Right-to-Left
    for c in cold_streams:
        temps = stream_temps[c["id"]]
        temps[8] = c["Tin"]
        for slot in range(8, 0, -1):
            match = next((m for m in matches if m["coldStreamId"] == c["id"] and m["slot"] == slot), None)
            heater = next((u for u in utilities if u["streamId"] == c["id"] and u["slot"] == slot and u["type"] == "heater"), None)
            
            load = 0.0
            if match: load = match["load"]
            if heater: load = heater["load"]
            
            temps[slot - 1] = temps[slot] + load / c["MCp"]

    # Diagnostics & Feasibility
    diagnostics = []
    is_feasible = True

    actual_qh = sum(u["load"] for u in utilities if u["type"] == "heater")
    actual_qc = sum(u["load"] for u in utilities if u["type"] == "cooler")

    # Target alignment check
    target_qh = targets["QHmin"]
    target_qc = targets["QCmin"]
    if actual_qh < target_qh - 1e-2:
        diagnostics.append({"type": "warning", "text": f"Hot utility is below target ({actual_qh:.1f} / {target_qh:.1f} MW). Additional heat required."})
    elif actual_qh > target_qh + 1e-2:
        diagnostics.append({"type": "warning", "text": f"Hot utility exceeds target ({actual_qh:.1f} / {target_qh:.1f} MW). More heat recovery possible!"})

    # Stream satisfaction check
    satisfaction = {}
    for s in streams:
        temps = stream_temps[s["id"]]
        final_temp = temps[8] if s["type"] == "hot" else temps[0]
        total_req = abs(s["Tout"] - s["Tin"]) * s["MCp"]
        
        actual_trans = (s["Tin"] - final_temp) * s["MCp"] if s["type"] == "hot" else (final_temp - s["Tin"]) * s["MCp"]
        pct = min(100.0, max(0.0, (actual_trans / (total_req or 1.0)) * 100))
        is_sat = abs(final_temp - s["Tout"]) < 1e-2
        
        satisfaction[s["id"]] = {
            "percentage": pct,
            "finalTemp": final_temp,
            "isSatisfied": is_sat
        }
        
        if not is_sat:
            is_feasible = False
            diagnostics.append({"type": "error", "text": f"Stream {s['id']} unsatisfied: Outlet is {final_temp:.1f}°C (Target: {s['Tout']:.1f}°C)."})

    # Match approach check and pinch checks
    pinch_hot = targets["pinchHot"]
    pinch_cold = targets["pinchCold"]

    for m in matches:
        h_temps = stream_temps.get(m["hotStreamId"])
        c_temps = stream_temps.get(m["coldStreamId"])
        if not h_temps or not c_temps:
            continue
            
        slot = m["slot"]
        Th_in, Th_out = h_temps[slot - 1], h_temps[slot]
        Tc_in, Tc_out = c_temps[slot], c_temps[slot - 1]
        
        dt_left = Th_in - Tc_out
        dt_right = Th_out - Tc_in
        
        m["hasCrossover"] = False
        
        if dt_left < 0 or dt_right < 0:
            is_feasible = False
            m["hasCrossover"] = True
            diagnostics.append({"type": "error", "text": f"Match {m['id']} has Temp Crossover! (Left: {dt_left:.1f}°C, Right: {dt_right:.1f}°C)"})
        elif dt_left < delta_tmin or dt_right < delta_tmin:
            m["hasCrossover"] = True
            diagnostics.append({"type": "warning", "text": f"Match {m['id']} violates ΔTmin approach ({min(dt_left, dt_right):.1f}°C < {delta_tmin:.1f}°C)."})
            
        # Pinch crossover rule checks
        if slot <= 4: # Above Pinch
            if Th_out < pinch_hot - 1e-2 or Tc_in < pinch_cold - 1e-2:
                is_feasible = False
                diagnostics.append({"type": "error", "text": f"Match {m['id']} crosses the Pinch! Transfers heat to below-pinch region."})
        else: # Below Pinch
            if Th_in > pinch_hot + 1e-2 or Tc_out > pinch_cold + 1e-2:
                is_feasible = False
                diagnostics.append({"type": "error", "text": f"Match {m['id']} crosses the Pinch! Transfers heat from above-pinch region."})

    # Utility placement checks
    for u in utilities:
        if u["type"] == "heater" and u["slot"] >= 5:
            is_feasible = False
            diagnostics.append({"type": "error", "text": f"Heater {u['id']} placed below the Pinch! (No hot utility allowed below pinch)"})
        if u["type"] == "cooler" and u["slot"] <= 4:
            is_feasible = False
            diagnostics.append({"type": "error", "text": f"Cooler {u['id']} placed above the Pinch! (No cold utility allowed above pinch)"})

    if is_feasible and not any(d["type"] == "warning" for d in diagnostics):
        diagnostics.append({"type": "success", "text": "Feasible and optimal heat exchanger network achieved!"})

    return {
        "simulation": {
            "streamTemps": stream_temps,
            "streamSatisfaction": satisfaction,
            "diagnostics": diagnostics,
            "actualQH": actual_qh,
            "actualQC": actual_qc,
            "isFeasible": is_feasible
        },
        "matches": matches
    }

# ==========================================================================
# FLASK ROUTE ENDPOINTS
# ==========================================================================

@app.route('/api/solve', methods=['POST'])
def api_solve():
    data = request.json
    streams = data.get('streams', [])
    delta_tmin = float(data.get('deltaTmin', 10.0))
    res = run_pinch_calculations(streams, delta_tmin)
    return jsonify(res)

@app.route('/api/simulate', methods=['POST'])
def api_simulate():
    data = request.json
    streams = data.get('streams', [])
    delta_tmin = float(data.get('deltaTmin', 10.0))
    matches = data.get('matches', [])
    utilities = data.get('utilities', [])
    
    # Recalculate targets first to get pinch Hot/Cold values
    solve_res = run_pinch_calculations(streams, delta_tmin)
    targets = solve_res["targets"]
    
    res = run_simulation(streams, delta_tmin, matches, utilities, targets)
    return jsonify(res)

@app.route('/api/autodesign', methods=['POST'])
def api_autodesign():
    data = request.json
    streams = data.get('streams', [])
    delta_tmin = float(data.get('deltaTmin', 10.0))
    
    solve_res = run_pinch_calculations(streams, delta_tmin)
    targets = solve_res["targets"]
    
    hot_streams = [s for s in streams if s["type"] == "hot"]
    cold_streams = [s for s in streams if s["type"] == "cold"]
    
    if not hot_streams or not cold_streams:
        return jsonify({"matches": [], "utilities": []})
        
    ph, pc = targets["pinchHot"], targets["pinchCold"]
    
    above_h = {h["id"]: max(0.0, (h["Tin"] - max(h["Tout"], ph)) * h["MCp"]) for h in hot_streams}
    above_c = {c["id"]: max(0.0, (max(c["Tout"], pc) - max(c["Tin"], pc)) * c["MCp"]) for c in cold_streams}
    below_h = {h["id"]: max(0.0, (min(h["Tin"], ph) - h["Tout"]) * h["MCp"]) for h in hot_streams}
    below_c = {c["id"]: max(0.0, (min(c["Tout"], pc) - c["Tin"]) * c["MCp"]) for c in cold_streams}
    
    matches = []
    utilities = []
    match_idx = 1
    utility_idx = 1
    
    # --- ABOVE PINCH: Match streams adjacent to pinch (slot 4 down to 1) ---
    active_above_h = [h for h in hot_streams if above_h[h["id"]] > 0]
    active_above_c = [c for c in cold_streams if above_c[c["id"]] > 0]
    
    active_above_h.sort(key=lambda x: x["MCp"])
    active_above_c.sort(key=lambda x: x["MCp"])
    
    slot_above = 4
    for h in reversed(active_above_h):
        for c in reversed(active_above_c):
            h_rem = above_h[h["id"]]
            c_rem = above_c[c["id"]]
            if h_rem <= 0.1 or c_rem <= 0.1:
                continue
                
            load = min(h_rem, c_rem)
            matches.append({
                "id": f"M{match_idx}",
                "hotStreamId": h["id"],
                "coldStreamId": c["id"],
                "load": round(load, 1),
                "slot": slot_above,
                "hasCrossover": False
            })
            match_idx += 1
            above_h[h["id"]] -= load
            above_c[c["id"]] -= load
            slot_above = max(1, slot_above - 1)
            
    for c in cold_streams:
        rem = above_c[c["id"]]
        if rem > 0.1:
            utilities.append({
                "id": f"U{utility_idx}",
                "streamId": c["id"],
                "type": "heater",
                "load": round(rem, 1),
                "slot": 1
            })
            utility_idx += 1
            
    # --- BELOW PINCH: Match streams adjacent to pinch (slot 5 up to 8) ---
    active_below_h = [h for h in hot_streams if below_h[h["id"]] > 0]
    active_below_c = [c for c in cold_streams if below_c[c["id"]] > 0]
    
    active_below_h.sort(key=lambda x: x["MCp"], reverse=True)
    active_below_c.sort(key=lambda x: x["MCp"], reverse=True)
    
    slot_below = 5
    for h in active_below_h:
        for c in active_below_c:
            h_rem = below_h[h["id"]]
            c_rem = below_c[c["id"]]
            if h_rem <= 0.1 or c_rem <= 0.1:
                continue
                
            load = min(h_rem, c_rem)
            matches.append({
                "id": f"M{match_idx}",
                "hotStreamId": h["id"],
                "coldStreamId": c["id"],
                "load": round(load, 1),
                "slot": slot_below,
                "hasCrossover": False
            })
            match_idx += 1
            below_h[h["id"]] -= load
            below_c[c["id"]] -= load
            slot_below = min(8, slot_below + 1)
            
    for h in hot_streams:
        rem = below_h[h["id"]]
        if rem > 0.1:
            utilities.append({
                "id": f"U{utility_idx}",
                "streamId": h["id"],
                "type": "cooler",
                "load": round(rem, 1),
                "slot": 8
            })
            utility_idx += 1
            
    return jsonify({"matches": matches, "utilities": utilities})

@app.route('/api/upload_excel', methods=['POST'])
def api_upload_excel():
    if 'file' not in request.files:
        return jsonify({"error": "No file part in the request"}), 400
        
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No file selected"}), 400
        
    try:
        xls = pd.ExcelFile(io.BytesIO(file.read()))
        sheet_names = [s.strip().lower() for s in xls.sheet_names]
        
        # 1. Parse settings
        delta_tmin = 10.0
        settings_idx = next((i for i, name in enumerate(sheet_names) if name == "settings"), None)
        if settings_idx is not None:
            df_settings = pd.read_excel(xls, sheet_name=xls.sheet_names[settings_idx])
            if not df_settings.empty:
                first_col = df_settings.columns[0]
                tmin_row = df_settings[df_settings[first_col].astype(str).str.strip().str.lower() == "tmin"]
                if not tmin_row.empty:
                    val_col = df_settings.columns[1]
                    delta_tmin = float(tmin_row.iloc[0][val_col])
                    
        # 2. Parse streams
        streams_idx = next((i for i, name in enumerate(sheet_names) if name == "streams"), None)
        if streams_idx is None:
            return jsonify({"error": "Could not find a sheet named 'Streams' in the workbook."}), 400
            
        df_streams = pd.read_excel(xls, sheet_name=xls.sheet_names[streams_idx])
        if df_streams.empty:
            return jsonify({"error": "The 'Streams' sheet is empty."}), 400
            
        cols = [c.strip().lower() for c in df_streams.columns]
        def get_col_name(possible_names):
            idx = next((i for i, name in enumerate(cols) if any(pn in name for pn in possible_names)), None)
            return df_streams.columns[idx] if idx is not None else None
            
        col_id = get_col_name(["stream", "name", "id"])
        col_type = get_col_name(["type"])
        col_tin = get_col_name(["tin", "t_in", "supply"])
        col_tout = get_col_name(["tout", "t_out", "target"])
        col_mcp = get_col_name(["mcp", "fc_p", "fcp"])
        
        if not all([col_id, col_type, col_tin, col_tout, col_mcp]):
            return jsonify({"error": "Missing required headers in Streams sheet. Check for: Stream, Type, Tin, Tout, MCp."}), 400
            
        streams = []
        for idx, row in df_streams.iterrows():
            stream_id = str(row[col_id]).strip().upper()
            stream_type = str(row[col_type]).strip().lower()
            tin = float(row[col_tin])
            tout = float(row[col_tout])
            mcp = float(row[col_mcp])
            
            if stream_type not in ["hot", "cold"]:
                return jsonify({"error": f"Row {idx+2}: Type must be 'hot' or 'cold'. Found: '{stream_type}'"}), 400
            if np.isnan(tin) or np.isnan(tout) or np.isnan(mcp):
                return jsonify({"error": f"Row {idx+2} ({stream_id}): Invalid numerical values."}), 400
                
            streams.append({
                "id": stream_id,
                "name": stream_id,
                "type": stream_type,
                "Tin": tin,
                "Tout": tout,
                "MCp": mcp
            })
            
        return jsonify({
            "deltaTmin": delta_tmin,
            "streams": streams
        })
    except Exception as e:
        return jsonify({"error": f"Error parsing Excel: {str(e)}"}), 500

# ==========================================================================
# AUTO BROWSER LAUNCHER
# ==========================================================================
def start_browser():
    webbrowser.open("http://127.0.0.1:5000")

if __name__ == '__main__':
    # Prevent browser opening twice when reloader is active
    if not os.environ.get("WERKZEUG_RUN_MAIN"):
        Timer(1.5, start_browser).start()
    app.run(debug=True, port=5000)
