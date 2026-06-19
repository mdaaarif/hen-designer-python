# Pinch HEN Designer 🚀

An interactive, industrial-grade web application for **Pinch Analysis & Heat Exchanger Network (HEN) Synthesis**. This tool enables engineers to upload stream data, automatically solve thermodynamic targets, visually design a heat exchanger network on a grid, and run real-time physics-based validation simulations to check for thermodynamic crossovers and pinch rule violations.

🌐 **Live Web Service:** [hen-designer-python.onrender.com](https://hen-designer-python.onrender.com)  
💻 **GitHub Repository:** [github.com/mdaaarif/hen-designer-python](https://github.com/mdaaarif/hen-designer-python)

---

## Key Features

### 1. Thermodynamic Target Solver
*   **Problem Table Algorithm (PTA):** Automates the interval temperature shifting ($T \pm \Delta T_{min}/2$), interval heat load accumulation, and heat cascading to determine:
    *   Minimum Hot Utility ($Q_{H,min}$) and Cold Utility ($Q_{C,min}$) requirements.
    *   Shifted, Hot, and Cold Pinch temperatures.
    *   Minimum number of heat exchanger units ($N_{min}$).
*   **Interactive Composite Curves:** Renders high-performance, dynamic SVG plots of **Hot & Cold Composite Curves ($T$-$H$ diagram)** and the **Grand Composite Curve (GCC)** with hover coordinate inspection.

### 2. Interactive HEN Grid Designer
*   **Visual Stage Diagram:** Allows drag-and-drop or click-based placement of **heat exchangers**, **heaters**, and **coolers** across 8 network slots (divided into Above-Pinch and Below-Pinch regions).
*   **Real-Time Simulation:** Simulates heat transfer down the stream paths to calculate intermediate stream temperatures and utility duty coverage at every stage.

### 3. Rigorous Physics & Rule Validation
Every network modification instantly triggers a simulation validation engine returning alerts for:
*   **Temperature Crossovers:** Identifies exchangers with a negative temperature driving force ($T_{hot} < T_{cold}$).
*   **$\Delta T_{min}$ Violations:** Flags matches where the approach temperature is narrower than the defined minimum.
*   **Pinch Crossing Heat Transfers:** Warns if an exchanger transfers heat across the pinch boundary, violating second-law limits.
*   **Misplaced Utilities:** Flags heaters placed below the pinch or coolers placed above the pinch.
*   **Stream Satisfaction:** Tracks if every stream's target outlet temperature has been successfully satisfied.

### 4. Heuristic Auto-Design Engine
*   Includes a click-to-build **Auto-Design** algorithm that generates a thermodynamically feasible and near-optimal network layout based on the $mCp$ inequality rules adjacent to the pinch:
    *   *Above the Pinch:* $mCp_{hot} \le mCp_{cold}$
    *   *Below the Pinch:* $mCp_{hot} \ge mCp_{cold}$

### 5. Excel Upload Integration
*   Allows bulk stream importing using standard spreadsheets. The workbook expects a `Streams` sheet containing `Stream`, `Type` (hot/cold), `Tin` (supply temp), `Tout` (target temp), and `MCp` (heat capacity flow rate) headers, and a `Settings` sheet with `Tmin`.

---

## Mathematical Foundations

### 1. Shifted Temperatures
For a minimum approach temperature $\Delta T_{min}$, stream temperatures are shifted:
$$T_{\text{shifted}} = T - \frac{\Delta T_{min}}{2} \quad (\text{Hot Streams})$$
$$T_{\text{shifted}} = T + \frac{\Delta T_{min}}{2} \quad (\text{Cold Streams})$$

### 2. Heat Cascade
The net enthalpy balance of each shifted temperature interval $k$ is calculated as:
$$\Delta H_k = \left(\sum mCp_{hot} - \sum mCp_{cold}\right) \cdot (T_{k} - T_{k+1})$$
The heat cascade determines the feasible heat flow:
$$R_k = R_{k-1} + \Delta H_k$$
$$Q_{H,min} = \max(0, -\min(R))$$

---

## Tech Stack
*   **Backend:** Python 3.x, Flask (REST API), Pandas & Openpyxl (Excel parsing), NumPy.
*   **Frontend:** Vanilla JS (Asynchronous state engine, SVG curve geometry calculations), HTML5, CSS3 (Modern Glassmorphic Dark UI).
*   **Production Server:** Gunicorn.

---

## Installation & Local Execution

1.  **Clone the Repository:**
    ```bash
    git clone https://github.com/mdaaarif/hen-designer-python.git
    cd hen-designer-python
    ```

2.  **Set Up Virtual Environment:**
    ```bash
    python -m venv venv
    venv\Scripts\activate      # On Windows
    source venv/bin/activate   # On macOS/Linux
    ```

3.  **Install Dependencies:**
    ```bash
    pip install -r requirements.txt
    ```

4.  **Run the App:**
    ```bash
    python app.py
    ```
    *The app will automatically launch a browser window at `http://127.0.0.1:5000`!*

---

## Cloud Deployment (e.g., Render)

To deploy this app as a live web service on Render:
1.  Create a new **Web Service** and link your GitHub repository.
2.  Set **Runtime** to `Python`.
3.  Set **Build Command** to:
    ```bash
    pip install -r requirements.txt
    ```
4.  Set **Start Command** to:
    ```bash
    gunicorn app:app
    ```
