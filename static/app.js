/* ==========================================================================
   CORE JAVASCRIPT FOR PINCHHEN DESIGNER (PYTHON FLASK HYBRID VERSION)
   ========================================================================== */

// --- Global Application State ---
const state = {
  deltaTmin: 10,
  streams: [],
  matches: [],
  utilities: [],
  selectedMatchId: null,
  selectedUtilityId: null,
  draggedMatchId: null,
  
  // Interaction states
  interactionMode: 'normal', // 'normal', 'add-exchanger-step1', 'add-exchanger-step2', 'add-utility'
  pendingHotStreamId: null,
  pendingColdStreamId: null,

  // Calculation outputs (populated by Python Flask backend)
  calculatedTargets: {
    QHmin: 0,
    QCmin: 0,
    pinchShifted: 0,
    pinchHot: 0,
    pinchCold: 0,
    tempList: [],
    Rcas: [],
    nMin: 0
  },
  
  // Curves data computed by Python Flask
  curvesData: {
    hot_H: [],
    hot_T: [],
    cold_H_shifted: [],
    cold_T: [],
    pinchHot: 0,
    pinchCold: 0,
    px_hot: 0,
    px_cold: 0,
    h_max: 0,
    t_min: 0,
    t_max: 0
  },

  // Network simulation outputs
  simulation: {
    streamTemps: {}, // streamId -> array of temperatures at slot boundaries [0...8]
    actualQH: 0,
    actualQC: 0,
    diagnostics: [],
    streamSatisfaction: {} // streamId -> % satisfied
  }
};

// --- Preloaded Examples Data (kept locally for fast initial loading) ---
const EXAMPLES = {
  example4: {
    deltaTmin: 10,
    streams: [
      { id: 'H1', name: 'H1 (Hot 1)', type: 'hot', Tin: 150, Tout: 60, MCp: 20 },
      { id: 'H2', name: 'H2 (Hot 2)', type: 'hot', Tin: 150, Tout: 30, MCp: 80 },
      { id: 'C1', name: 'C1 (Cold 1)', type: 'cold', Tin: 20, Tout: 135, MCp: 80 },
      { id: 'C2', name: 'C2 (Cold 2)', type: 'cold', Tin: 80, Tout: 140, MCp: 40 }
    ],
    matches: [],
    utilities: []
  },
  example5: {
    deltaTmin: 15,
    streams: [
      { id: 'H1', name: 'H1 (Feed Preheat)', type: 'hot', Tin: 250, Tout: 120, MCp: 10 },
      { id: 'H2', name: 'H2 (Kero Reflux)', type: 'hot', Tin: 200, Tout: 80, MCp: 20 },
      { id: 'H3', name: 'H3 (Diesel Product)', type: 'hot', Tin: 180, Tout: 50, MCp: 5 },
      { id: 'C1', name: 'C1 (Crude Stream A)', type: 'cold', Tin: 60, Tout: 180, MCp: 15 },
      { id: 'C2', name: 'C2 (Crude Stream B)', type: 'cold', Tin: 90, Tout: 220, MCp: 25 }
    ],
    matches: [],
    utilities: []
  }
};

// --- Page Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
  await loadExample('example4');
  setupEventListeners();
  initExcelUpload();
});

// --- Setup Event Listeners ---
function setupEventListeners() {
  // Example Select
  document.getElementById('example-select').addEventListener('change', async (e) => {
    if (e.target.value !== 'custom') {
      await loadExample(e.target.value);
    }
  });

  // Slider
  const slider = document.getElementById('tmin-slider');
  const valueDisplay = document.getElementById('tmin-value');
  slider.addEventListener('input', async (e) => {
    state.deltaTmin = parseInt(e.target.value);
    valueDisplay.textContent = `${state.deltaTmin} °C`;
    await runPinchAnalysis();
    await simulateNetwork();
    renderAll();
  });

  // Upload Header Button
  document.getElementById('upload-header-btn').addEventListener('click', () => {
    document.getElementById('upload-modal').classList.remove('hidden');
    document.getElementById('file-name-display').textContent = '';
  });

  // Reset Button
  document.getElementById('reset-btn').addEventListener('click', async () => {
    await loadExample('example4');
  });

  // Add Stream Button
  document.getElementById('add-stream-btn').addEventListener('click', async () => {
    await addNewStreamRow();
  });

  // Tab buttons
  const tabButtons = document.querySelectorAll('.tab-nav .tab-btn');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      const tabId = btn.getAttribute('data-tab');
      document.querySelectorAll('.tab-pane').forEach(pane => {
        pane.classList.remove('active');
      });
      document.getElementById(tabId).classList.add('active');
      
      // Force SVG re-render to handle sizing/dimensions correctly
      renderAll();
    });
  });

  // Exchanger / Match controls
  document.getElementById('add-exchanger-btn').addEventListener('click', () => {
    enterInteractionMode('add-exchanger-step1');
  });

  document.getElementById('add-utility-btn').addEventListener('click', () => {
    enterInteractionMode('add-utility');
  });

  document.getElementById('clear-design-btn').addEventListener('click', async () => {
    state.matches = [];
    state.utilities = [];
    state.selectedMatchId = null;
    state.selectedUtilityId = null;
    await simulateNetwork();
    renderAll();
  });

  document.getElementById('auto-design-btn').addEventListener('click', async () => {
    await autoDesignNetwork();
  });

  // Editor Cancel/Delete/Save
  document.getElementById('cancel-edit-btn').addEventListener('click', () => {
    closeEditor();
  });

  document.getElementById('delete-match-btn').addEventListener('click', async () => {
    await deleteSelectedDevice();
  });

  document.getElementById('save-edit-btn').addEventListener('click', async () => {
    await saveExchangerEdit();
  });

  // Dragging event handlers for Grid SVG
  const svg = document.getElementById('hen-svg');
  svg.addEventListener('mousemove', handleSvgMouseMove);
  svg.addEventListener('mouseup', handleSvgMouseUp);
  svg.addEventListener('mouseleave', handleSvgMouseUp);
  
  // Touch dragging support
  svg.addEventListener('touchmove', handleSvgTouchMove, { passive: false });
  svg.addEventListener('touchend', handleSvgMouseUp);

  // View mode toggles
  document.getElementById('btn-view-scroll').addEventListener('click', () => {
    setViewMode('scroll');
  });
  document.getElementById('btn-view-fit').addEventListener('click', () => {
    setViewMode('fit');
  });
}

// --- Load Selected Example ---
async function loadExample(key) {
  const ex = EXAMPLES[key];
  if (!ex) return;

  state.deltaTmin = ex.deltaTmin;
  state.streams = JSON.parse(JSON.stringify(ex.streams));
  state.matches = JSON.parse(JSON.stringify(ex.matches));
  state.utilities = JSON.parse(JSON.stringify(ex.utilities));
  state.selectedMatchId = null;
  state.selectedUtilityId = null;

  // Sync UI controls
  document.getElementById('example-select').value = key;
  document.getElementById('tmin-slider').value = state.deltaTmin;
  document.getElementById('tmin-value').textContent = `${state.deltaTmin} °C`;

  await runPinchAnalysis();
  await simulateNetwork();
  renderAll();
}

// ==========================================================================
// EXCEL / SPREADSHEET LOADER (DELEGATED TO PYTHON BACKEND)
// ==========================================================================
function initExcelUpload() {
  const modal = document.getElementById('upload-modal');
  const skipBtn = document.getElementById('skip-modal-btn');
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');

  // Skip Modal
  skipBtn.addEventListener('click', () => {
    modal.classList.add('hidden');
  });

  // Click drop zone triggers file selector
  dropZone.addEventListener('click', () => {
    fileInput.click();
  });

  // File selector change
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleExcelUpload(file);
  });

  // Drag over / drag leave effects
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) handleExcelUpload(file);
  });
}

async function handleExcelUpload(file) {
  if (!file) return;

  const display = document.getElementById('file-name-display');
  display.textContent = `Processing: ${file.name}...`;
  display.style.color = 'var(--text-highlight)';

  const formData = new FormData();
  formData.append('file', file);

  try {
    const response = await fetch('/api/upload_excel', {
      method: 'POST',
      body: formData
    });
    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.error || 'Failed to parse spreadsheet');
    }
    const data = await response.json();

    // Update State
    state.deltaTmin = data.deltaTmin;
    state.streams = data.streams;
    state.matches = [];
    state.utilities = [];

    // Update Controls
    document.getElementById('tmin-slider').value = state.deltaTmin;
    document.getElementById('tmin-value').textContent = `${state.deltaTmin} °C`;
    document.getElementById('example-select').value = 'custom';

    // Solve & simulate
    await runPinchAnalysis();
    await simulateNetwork();
    renderAll();

    // Close Modal
    const modal = document.getElementById('upload-modal');
    modal.classList.add('hidden');
    display.textContent = '';
  } catch (err) {
    console.error(err);
    display.textContent = `Error: ${err.message}`;
    display.style.color = 'var(--color-danger)';
  }
}

// --- Dynamic Stream Table ---
function populateStreamTable() {
  const tbody = document.getElementById('streams-body');
  tbody.innerHTML = '';

  state.streams.forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="sat-name ${s.type}">${s.id}</span></td>
      <td>
        <button class="stream-type-btn ${s.type}" onclick="toggleStreamType('${s.id}')">
          ${s.type}
        </button>
      </td>
      <td><input type="number" value="${s.Tin}" onchange="updateStreamField('${s.id}', 'Tin', this.value)"></td>
      <td><input type="number" value="${s.Tout}" onchange="updateStreamField('${s.id}', 'Tout', this.value)"></td>
      <td><input type="number" step="0.1" value="${s.MCp}" onchange="updateStreamField('${s.id}', 'MCp', this.value)"></td>
      <td><button class="delete-row-btn" onclick="deleteStream('${s.id}')">×</button></td>
    `;
    tbody.appendChild(tr);
  });
}

async function updateStreamField(id, field, value) {
  const stream = state.streams.find(s => s.id === id);
  if (stream) {
    stream[field] = parseFloat(value);
    // Clear network elements if stream properties change drastically
    state.matches = [];
    state.utilities = [];
    await runPinchAnalysis();
    await simulateNetwork();
    renderAll();
  }
}

async function toggleStreamType(id) {
  const stream = state.streams.find(s => s.id === id);
  if (stream) {
    stream.type = stream.type === 'hot' ? 'cold' : 'hot';
    state.matches = [];
    state.utilities = [];
    await runPinchAnalysis();
    await simulateNetwork();
    renderAll();
  }
}

async function deleteStream(id) {
  state.streams = state.streams.filter(s => s.id !== id);
  state.matches = [];
  state.utilities = [];
  await runPinchAnalysis();
  await simulateNetwork();
  renderAll();
}

async function addNewStreamRow() {
  const id = prompt("Enter Unique Stream ID (e.g. H3, C3):");
  if (!id) return;
  if (state.streams.some(s => s.id.toLowerCase() === id.toLowerCase())) {
    alert("Stream ID already exists!");
    return;
  }

  const type = id.toUpperCase().startsWith('C') ? 'cold' : 'hot';
  state.streams.push({
    id: id.toUpperCase(),
    name: `${id.toUpperCase()} (Stream)`,
    type: type,
    Tin: type === 'hot' ? 120 : 30,
    Tout: type === 'hot' ? 40 : 110,
    MCp: 10
  });

  state.matches = [];
  state.utilities = [];
  await runPinchAnalysis();
  await simulateNetwork();
  renderAll();
}

// ==========================================================================
// SOLVER CORE — DELEGATED TO PYTHON FLASK BACKEND
// ==========================================================================
async function runPinchAnalysis() {
  if (state.streams.length === 0) return;

  try {
    const res = await fetch('/api/solve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        streams: state.streams,
        deltaTmin: state.deltaTmin
      })
    });
    
    if (!res.ok) throw new Error("Flask solver failed.");
    const data = await res.json();
    
    state.calculatedTargets = data.targets;
    state.curvesData = data.curves;

    // Update HUD elements
    document.getElementById('target-qh').innerHTML = `${state.calculatedTargets.QHmin.toFixed(1)} <span class="unit">MW</span>`;
    document.getElementById('target-qc').innerHTML = `${state.calculatedTargets.QCmin.toFixed(1)} <span class="unit">MW</span>`;
    document.getElementById('target-pinch-shifted').innerHTML = `${state.calculatedTargets.pinchShifted.toFixed(1)} <span class="unit">°C</span>`;
    document.getElementById('target-pinch-real').innerHTML = `${state.calculatedTargets.pinchHot.toFixed(1)} / ${state.calculatedTargets.pinchCold.toFixed(1)} <span class="unit">°C</span>`;
    document.getElementById('target-nmin').innerHTML = `${state.calculatedTargets.nMin} <span class="unit">units</span>`;
  } catch (err) {
    console.error("API Solve error:", err);
  }
}

// ==========================================================================
// SIMULATOR CORE — DELEGATED TO PYTHON FLASK BACKEND
// ==========================================================================
async function simulateNetwork() {
  try {
    const res = await fetch('/api/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        streams: state.streams,
        deltaTmin: state.deltaTmin,
        matches: state.matches,
        utilities: state.utilities
      })
    });
    
    if (!res.ok) throw new Error("Flask simulation failed.");
    const data = await res.json();
    
    state.simulation = data.simulation;
    state.matches = data.matches; // contains updated crossover flags

    // Update diagnostics HUD details
    const targetQH = state.calculatedTargets.QHmin;
    const targetQC = state.calculatedTargets.QCmin;
    const actualQH = state.simulation.actualQH;
    const actualQC = state.simulation.actualQC;

    document.getElementById('diag-qh-actual').textContent = actualQH.toFixed(1);
    document.getElementById('diag-qh-target').textContent = targetQH.toFixed(1);
    document.getElementById('diag-qc-actual').textContent = actualQC.toFixed(1);
    document.getElementById('diag-qc-target').textContent = targetQC.toFixed(1);

    const fillQH = document.getElementById('fill-qh');
    const fillQC = document.getElementById('fill-qc');
    fillQH.style.width = `${Math.min(100, (actualQH / (targetQH || 1)) * 100)}%`;
    fillQC.style.width = `${Math.min(100, (actualQC / (targetQC || 1)) * 100)}%`;

    // Update status badge
    const badge = document.getElementById('network-status-badge');
    const isFeasible = state.simulation.isFeasible;
    const diagnostics = state.simulation.diagnostics;

    if (isFeasible && diagnostics.every(d => d.type !== 'warning')) {
      badge.className = 'badge badge-success';
      badge.textContent = 'Feasible';
    } else if (diagnostics.some(d => d.type === 'error')) {
      badge.className = 'badge badge-danger';
      badge.textContent = 'Violations';
    } else {
      badge.className = 'badge badge-warning';
      badge.textContent = 'Suboptimal';
    }
  } catch (err) {
    console.error("API Simulate error:", err);
  }
}

// ==========================================================================
// RENDERERS (COMPOSITE CURVES SVG, GCC SVG, HEN GRID SVG)
// ==========================================================================
function renderAll() {
  populateStreamTable();
  renderDiagnostics();
  renderSatisfaction();

  // Redraw canvases using coordinates received from Python
  drawCompositeCurves();
  drawGrandCompositeCurve();
  drawHenGrid();
}

function renderDiagnostics() {
  const container = document.getElementById('diagnostic-list');
  container.innerHTML = '';

  state.simulation.diagnostics.forEach(d => {
    const item = document.createElement('div');
    item.className = `diagnostic-item ${d.type}`;
    
    // Icon selection
    let icon = '';
    if (d.type === 'success') {
      icon = `<svg class="diagnostic-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
    } else if (d.type === 'warning') {
      icon = `<svg class="diagnostic-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
    } else {
      icon = `<svg class="diagnostic-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
    }

    item.innerHTML = `${icon} <span>${d.text}</span>`;
    container.appendChild(item);
  });
}

function renderSatisfaction() {
  const container = document.getElementById('satisfaction-list');
  container.innerHTML = '';

  state.streams.forEach(s => {
    const sat = state.simulation.streamSatisfaction[s.id] || { percentage: 0, finalTemp: s.Tin, isSatisfied: false };
    const item = document.createElement('div');
    item.className = 'satisfaction-item';
    
    item.innerHTML = `
      <div class="sat-header">
        <span class="sat-name ${s.type}">${s.id} (${s.type === 'hot' ? 'cooling' : 'heating'})</span>
        <span class="sat-temps">${s.Tin}°C → ${sat.finalTemp.toFixed(1)} / ${s.Tout}°C</span>
      </div>
      <div class="sat-progress-row">
        <div class="sat-progress-bar">
          <div class="sat-progress-fill ${s.type}" style="width: ${sat.percentage}%"></div>
        </div>
        <span class="sat-status ${sat.isSatisfied ? 'complete' : ''}">
          ${sat.percentage.toFixed(0)}%
        </span>
      </div>
    `;
    container.appendChild(item);
  });
}

// --- Render SVG Composite Curves ---
function drawCompositeCurves() {
  const svg = document.getElementById('composite-svg');
  svg.innerHTML = '';

  const { hot_H, hot_T, cold_H_shifted, cold_T, pinchHot, pinchCold, px_hot, px_cold, h_max, t_min, t_max } = state.curvesData;
  if (!hot_H || hot_H.length === 0 || !cold_H_shifted || cold_H_shifted.length === 0) return;

  // Coordinate transformations
  const padding = 50;
  const w = 800;
  const h = 500;
  
  const scaleX = (val) => padding + (val / (h_max || 1)) * (w - 2 * padding);
  const scaleY = (val) => h - padding - ((val - t_min) / ((t_max - t_min) || 1)) * (h - 2 * padding);

  // Draw Grid lines
  const gridGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  for (let t = Math.floor(t_min / 20) * 20; t <= t_max; t += 20) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', padding);
    line.setAttribute('y1', scaleY(t));
    line.setAttribute('x2', w - padding);
    line.setAttribute('y2', scaleY(t));
    line.setAttribute('class', 'chart-grid-line');
    gridGroup.appendChild(line);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', padding - 10);
    text.setAttribute('y', scaleY(t) + 4);
    text.setAttribute('text-anchor', 'end');
    text.setAttribute('class', 'chart-axis-text');
    text.textContent = t;
    gridGroup.appendChild(text);
  }

  for (let x = 0; x <= h_max; x += Math.ceil(h_max / 5 / 100) * 100) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', scaleX(x));
    line.setAttribute('y1', padding);
    line.setAttribute('x2', scaleX(x));
    line.setAttribute('y2', h - padding);
    line.setAttribute('class', 'chart-grid-line');
    gridGroup.appendChild(line);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', scaleX(x));
    text.setAttribute('y', h - padding + 15);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('class', 'chart-axis-text');
    text.textContent = x.toFixed(0);
    gridGroup.appendChild(text);
  }
  svg.appendChild(gridGroup);

  // Draw Axes
  const axes = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const ax = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  ax.setAttribute('x1', padding); ax.setAttribute('y1', h - padding); ax.setAttribute('x2', w - padding); ax.setAttribute('y2', h - padding);
  ax.setAttribute('class', 'chart-axis-line');
  const ay = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  ay.setAttribute('x1', padding); ay.setAttribute('y1', padding); ay.setAttribute('x2', padding); ay.setAttribute('y2', h - padding);
  ay.setAttribute('class', 'chart-axis-line');
  axes.appendChild(ax); axes.appendChild(ay);
  
  // Axes labels
  const xl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  xl.setAttribute('x', w / 2); xl.setAttribute('y', h - 10); xl.setAttribute('text-anchor', 'middle'); xl.setAttribute('class', 'chart-axis-text');
  xl.setAttribute('style', 'font-size:12px; fill:#fff;');
  xl.textContent = 'Enthalpy Heat Duty (MW)';
  const yl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  yl.setAttribute('x', 15); yl.setAttribute('y', h / 2); yl.setAttribute('text-anchor', 'middle'); yl.setAttribute('class', 'chart-axis-text');
  yl.setAttribute('transform', `rotate(-90, 15, ${h / 2})`);
  yl.setAttribute('style', 'font-size:12px; fill:#fff;');
  yl.textContent = 'Temperature (°C)';
  axes.appendChild(xl); axes.appendChild(yl);
  svg.appendChild(axes);

  // Curves drawing helper
  const drawCurve = (ccX, ccY, className, markerClass) => {
    const pathGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    let pathD = '';
    ccX.forEach((x, idx) => {
      const sx = scaleX(x);
      const sy = scaleY(ccY[idx]);
      pathD += `${idx === 0 ? 'M' : 'L'} ${sx} ${sy}`;
      
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', sx);
      circle.setAttribute('cy', sy);
      circle.setAttribute('r', 4);
      circle.setAttribute('class', `chart-marker ${markerClass}`);
      pathGroup.appendChild(circle);
    });

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathD);
    path.setAttribute('class', `chart-curve ${className}`);
    pathGroup.insertBefore(path, pathGroup.firstChild);
    svg.appendChild(pathGroup);
  };

  drawCurve(hot_H, hot_T, 'hot', 'hot');
  drawCurve(cold_H_shifted, cold_T, 'cold', 'cold');

  // Draw Pinch indicators
  const pinchGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  
  const dashLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  dashLine.setAttribute('x1', scaleX(px_hot));
  dashLine.setAttribute('y1', scaleY(pinchCold));
  dashLine.setAttribute('x2', scaleX(px_hot));
  dashLine.setAttribute('y2', scaleY(pinchHot));
  dashLine.setAttribute('stroke', '#fff');
  dashLine.setAttribute('stroke-dasharray', '4 4');
  dashLine.setAttribute('stroke-width', '1.5');
  pinchGroup.appendChild(dashLine);

  const m1 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  m1.setAttribute('cx', scaleX(px_hot)); m1.setAttribute('cy', scaleY(pinchHot));
  m1.setAttribute('r', 6); m1.setAttribute('class', 'chart-pinch-marker');
  const m2 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  m2.setAttribute('cx', scaleX(px_cold)); m2.setAttribute('cy', scaleY(pinchCold));
  m2.setAttribute('r', 6); m2.setAttribute('class', 'chart-pinch-marker');
  pinchGroup.appendChild(m1); pinchGroup.appendChild(m2);

  const pText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  pText.setAttribute('x', scaleX(px_hot) + 12);
  pText.setAttribute('y', scaleY((pinchHot + pinchCold) / 2) + 4);
  pText.setAttribute('fill', 'var(--color-pinch)');
  pText.setAttribute('style', 'font-size: 11px; font-weight: 600;');
  pText.textContent = `Pinch (${pinchHot.toFixed(0)}°C / ${pinchCold.toFixed(0)}°C)`;
  pinchGroup.appendChild(pText);

  svg.appendChild(pinchGroup);
}

// --- Draw SVG Grand Composite Curve (GCC) ---
function drawGrandCompositeCurve() {
  const svg = document.getElementById('gcc-svg');
  svg.innerHTML = '';

  const { tempList, Rcas, pinchShifted } = state.calculatedTargets;
  if (!tempList || tempList.length === 0) return;

  const padding = 50;
  const w = 600;
  const h = 500;

  const rMax = Math.max(...Rcas);
  const tMin = Math.min(...tempList);
  const tMax = Math.max(...tempList);

  const scaleX = (val) => padding + (val / (rMax || 1)) * (w - 2 * padding);
  const scaleY = (val) => h - padding - ((val - tMin) / ((tMax - tMin) || 1)) * (h - 2 * padding);

  // Ticks & Grid
  const gridGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  for (let t = Math.floor(tMin / 20) * 20; t <= tMax; t += 20) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', padding); line.setAttribute('y1', scaleY(t)); line.setAttribute('x2', w - padding); line.setAttribute('y2', scaleY(t));
    line.setAttribute('class', 'chart-grid-line');
    gridGroup.appendChild(line);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', padding - 10); text.setAttribute('y', scaleY(t) + 4); text.setAttribute('text-anchor', 'end');
    text.setAttribute('class', 'chart-axis-text');
    text.textContent = t;
    gridGroup.appendChild(text);
  }

  for (let x = 0; x <= rMax; x += Math.ceil(rMax / 4 / 50) * 50) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', scaleX(x)); line.setAttribute('y1', padding); line.setAttribute('x2', scaleX(x)); line.setAttribute('y2', h - padding);
    line.setAttribute('class', 'chart-grid-line');
    gridGroup.appendChild(line);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', scaleX(x)); text.setAttribute('y', h - padding + 15); text.setAttribute('text-anchor', 'middle');
    text.setAttribute('class', 'chart-axis-text');
    text.textContent = x.toFixed(0);
    gridGroup.appendChild(text);
  }
  svg.appendChild(gridGroup);

  // Axes
  const axes = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const ax = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  ax.setAttribute('x1', padding); ax.setAttribute('y1', h - padding); ax.setAttribute('x2', w - padding); ax.setAttribute('y2', h - padding);
  ax.setAttribute('class', 'chart-axis-line');
  const ay = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  ay.setAttribute('x1', padding); ay.setAttribute('y1', padding); ay.setAttribute('x2', padding); ay.setAttribute('y2', h - padding);
  ay.setAttribute('class', 'chart-axis-line');
  axes.appendChild(ax); axes.appendChild(ay);

  // Labels
  const xl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  xl.setAttribute('x', w / 2); xl.setAttribute('y', h - 10); xl.setAttribute('text-anchor', 'middle'); xl.setAttribute('class', 'chart-axis-text');
  xl.setAttribute('style', 'font-size:12px; fill:#fff;');
  xl.textContent = 'Revised Cascade Heat Flow (MW)';
  const yl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  yl.setAttribute('x', 15); yl.setAttribute('y', h / 2); yl.setAttribute('text-anchor', 'middle'); yl.setAttribute('class', 'chart-axis-text');
  yl.setAttribute('transform', `rotate(-90, 15, ${h / 2})`);
  yl.setAttribute('style', 'font-size:12px; fill:#fff;');
  yl.textContent = 'Shifted Temperature (°C)';
  axes.appendChild(xl); axes.appendChild(yl);
  svg.appendChild(axes);

  // Draw GCC Curve
  const pathGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  let pathD = '';
  Rcas.forEach((x, idx) => {
    const sx = scaleX(x);
    const sy = scaleY(tempList[idx]);
    pathD += `${idx === 0 ? 'M' : 'L'} ${sx} ${sy}`;

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', sx);
    circle.setAttribute('cy', sy);
    circle.setAttribute('r', 4);
    circle.setAttribute('class', 'chart-marker gcc');
    pathGroup.appendChild(circle);
  });

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', pathD);
  path.setAttribute('class', 'chart-curve gcc');
  pathGroup.insertBefore(path, pathGroup.firstChild);
  svg.appendChild(pathGroup);

  // Draw Pinch shifted line marker
  const pinchGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const horizLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  horizLine.setAttribute('x1', scaleX(0)); horizLine.setAttribute('y1', scaleY(pinchShifted));
  horizLine.setAttribute('x2', w - padding); horizLine.setAttribute('y2', scaleY(pinchShifted));
  horizLine.setAttribute('stroke', 'var(--color-pinch)');
  horizLine.setAttribute('stroke-dasharray', '5 3');
  horizLine.setAttribute('stroke-width', '1');
  pinchGroup.appendChild(horizLine);

  const pinchMarker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  pinchMarker.setAttribute('cx', scaleX(0)); pinchMarker.setAttribute('cy', scaleY(pinchShifted));
  pinchMarker.setAttribute('r', 6); pinchMarker.setAttribute('class', 'chart-pinch-marker');
  pinchGroup.appendChild(pinchMarker);

  const pText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  pText.setAttribute('x', scaleX(0) + 12); pText.setAttribute('y', scaleY(pinchShifted) + 4);
  pText.setAttribute('fill', 'var(--color-pinch)');
  pText.setAttribute('style', 'font-size: 11px; font-weight: 600;');
  pText.textContent = `Pinch (${pinchShifted.toFixed(1)}°C shifted)`;
  pinchGroup.appendChild(pText);

  svg.appendChild(pinchGroup);
}

// ==========================================================================
// INTERACTIVE HEN GRID DIAGRAM RENDERER
// ==========================================================================
function drawHenGrid() {
  const svg = document.getElementById('hen-svg');
  svg.innerHTML = '';

  const hotStreams = state.streams.filter(s => s.type === 'hot');
  const coldStreams = state.streams.filter(s => s.type === 'cold');
  if (hotStreams.length === 0 && coldStreams.length === 0) return;

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = `
    <linearGradient id="hot-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="var(--color-hot-start)" />
      <stop offset="100%" stop-color="var(--color-hot-end)" />
    </linearGradient>
    <linearGradient id="cold-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="var(--color-cold-end)" />
      <stop offset="100%" stop-color="var(--color-cold-start)" />
    </linearGradient>
  `;
  svg.appendChild(defs);

  const w = 1000;
  const paddingLeft = 100;
  const paddingRight = 100;
  const activeW = w - paddingLeft - paddingRight;
  const colSpacing = activeW / 9;
  const getSlotX = (slotNum) => paddingLeft + slotNum * colSpacing;
  
  const streamY = {};
  let currentY = 50;
  hotStreams.forEach(h => {
    streamY[h.id] = currentY;
    currentY += 60;
  });
  
  currentY += 40;
  
  coldStreams.forEach(c => {
    streamY[c.id] = currentY;
    currentY += 60;
  });

  svg.setAttribute('height', currentY + 30);
  svg.setAttribute('width', w);
  svg.setAttribute('viewBox', `0 0 ${w} ${currentY + 30}`);

  // 1. Pinch Line
  const pinchX = (getSlotX(4) + getSlotX(5)) / 2;
  const pLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  pLine.setAttribute('x1', pinchX);
  pLine.setAttribute('y1', 20);
  pLine.setAttribute('x2', pinchX);
  pLine.setAttribute('y2', currentY);
  pLine.setAttribute('class', 'svg-pinch-line');
  svg.appendChild(pLine);

  // 2. Horizontal Stream Lines
  state.streams.forEach(s => {
    const y = streamY[s.id];
    const isHot = s.type === 'hot';
    
    const lineGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    lineGroup.setAttribute('cursor', 'pointer');
    
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', paddingLeft);
    line.setAttribute('y1', y);
    line.setAttribute('x2', w - paddingRight);
    line.setAttribute('y2', y);
    line.setAttribute('class', `svg-stream-line ${s.type}`);
    line.addEventListener('click', () => handleStreamLineClick(s.id));
    lineGroup.appendChild(line);

    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const ax = isHot ? w - paddingRight + 10 : paddingLeft - 10;
    const arrowD = isHot 
      ? `M ${ax-10} ${y-6} L ${ax} ${y} L ${ax-10} ${y+6} Z`
      : `M ${ax+10} ${y-6} L ${ax} ${y} L ${ax+10} ${y+6} Z`;
    arrow.setAttribute('d', arrowD);
    arrow.setAttribute('fill', isHot ? 'var(--color-hot-end)' : 'var(--color-cold-end)');
    lineGroup.appendChild(arrow);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', paddingLeft - 20);
    label.setAttribute('y', y + 4);
    label.setAttribute('text-anchor', 'end');
    label.setAttribute('class', 'svg-stream-label');
    label.textContent = `${s.id} [CP=${s.MCp}]`;
    lineGroup.appendChild(label);

    const tempLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    tempLabel.setAttribute('x', w - paddingRight + 20);
    tempLabel.setAttribute('y', y + 4);
    tempLabel.setAttribute('text-anchor', 'start');
    tempLabel.setAttribute('class', 'svg-stream-temp');
    tempLabel.textContent = `${s.Tout}°C`;
    lineGroup.appendChild(tempLabel);

    const temps = state.simulation.streamTemps[s.id];
    if (temps) {
      for (let slot = 0; slot <= 8; slot++) {
        const tempX = slot === 0 ? paddingLeft + 5 : getSlotX(slot);
        const tempY = isHot ? y - 10 : y + 18;
        const tempVal = temps[slot];
        
        if (tempVal !== null && tempVal !== undefined) {
          const tText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          tText.setAttribute('x', tempX);
          tText.setAttribute('y', tempY);
          tText.setAttribute('text-anchor', 'middle');
          tText.setAttribute('class', 'svg-stream-temp');
          tText.setAttribute('style', 'font-size: 9px; opacity: 0.85;');
          tText.textContent = `${tempVal.toFixed(0)}°`;
          lineGroup.appendChild(tText);
        }
      }
    }

    svg.appendChild(lineGroup);
  });

  // 3. Draw Matches
  state.matches.forEach(m => {
    const x = getSlotX(m.slot);
    const yHot = streamY[m.hotStreamId];
    const yCold = streamY[m.coldStreamId];
    if (yHot === undefined || yCold === undefined) return;

    const matchGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    
    const link = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    link.setAttribute('x1', x); link.setAttribute('y1', yHot);
    link.setAttribute('x2', x); link.setAttribute('y2', yCold);
    link.setAttribute('class', 'svg-match-link');
    matchGroup.appendChild(link);

    const nodeClass = m.slot <= 4 ? 'above-pinch-node' : 'below-pinch-node';

    const c1 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c1.setAttribute('cx', x); c1.setAttribute('cy', yHot); c1.setAttribute('r', 10);
    c1.setAttribute('class', `svg-exchanger-circle ${nodeClass} ${m.hasCrossover ? 'crossover' : ''} ${state.selectedMatchId === m.id ? 'selected' : ''}`);
    c1.addEventListener('mousedown', (e) => startMatchDrag(e, m.id));
    c1.addEventListener('touchstart', (e) => startMatchDragTouch(e, m.id), { passive: false });
    c1.addEventListener('click', (e) => selectMatch(e, m.id));
    matchGroup.appendChild(c1);

    const c2 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c2.setAttribute('cx', x); c2.setAttribute('cy', yCold); c2.setAttribute('r', 10);
    c2.setAttribute('class', `svg-exchanger-circle ${nodeClass} ${m.hasCrossover ? 'crossover' : ''} ${state.selectedMatchId === m.id ? 'selected' : ''}`);
    c2.addEventListener('mousedown', (e) => startMatchDrag(e, m.id));
    c2.addEventListener('touchstart', (e) => startMatchDragTouch(e, m.id), { passive: false });
    c2.addEventListener('click', (e) => selectMatch(e, m.id));
    matchGroup.appendChild(c2);

    const loadText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    loadText.setAttribute('x', x + 6);
    loadText.setAttribute('y', (yHot + yCold) / 2 + 3);
    loadText.setAttribute('class', 'svg-exchanger-label');
    loadText.textContent = `${m.load.toFixed(1)} MW`;
    matchGroup.appendChild(loadText);

    svg.appendChild(matchGroup);
  });

  // 4. Draw Utilities
  state.utilities.forEach(u => {
    const x = getSlotX(u.slot);
    const y = streamY[u.streamId];
    if (y === undefined) return;
    const isHeater = u.type === 'heater';

    const utGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', x); circle.setAttribute('cy', y); circle.setAttribute('r', 14);
    circle.setAttribute('class', `svg-utility-circle ${u.type} ${state.selectedUtilityId === u.id ? 'selected' : ''}`);
    circle.addEventListener('click', (e) => selectUtility(e, u.id));
    utGroup.appendChild(circle);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', x); text.setAttribute('y', y + 3); text.setAttribute('text-anchor', 'middle');
    text.setAttribute('class', 'svg-utility-text');
    text.textContent = isHeater ? 'H' : 'C';
    utGroup.appendChild(text);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', x);
    label.setAttribute('y', isHeater ? y - 20 : y + 28);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('class', 'svg-exchanger-label');
    label.textContent = `${u.load.toFixed(1)} MW`;
    utGroup.appendChild(label);

    svg.appendChild(utGroup);
  });
}

// --- Placement Workflows ---
function enterInteractionMode(mode) {
  state.interactionMode = mode;
  state.selectedMatchId = null;
  state.selectedUtilityId = null;
  closeEditor();

  if (mode === 'add-exchanger-step1') {
    document.getElementById('add-exchanger-btn').className = 'btn btn-secondary btn-primary';
    document.getElementById('add-exchanger-btn').textContent = 'Click Hot Stream...';
  } else if (mode === 'add-utility') {
    document.getElementById('add-utility-btn').className = 'btn btn-secondary btn-primary';
    document.getElementById('add-utility-btn').textContent = 'Click Stream...';
  }
}

async function handleStreamLineClick(streamId) {
  const stream = state.streams.find(s => s.id === streamId);
  if (!stream) return;

  if (state.interactionMode === 'add-exchanger-step1') {
    if (stream.type !== 'hot') {
      alert("Please select a HOT stream first!");
      return;
    }
    state.pendingHotStreamId = streamId;
    state.interactionMode = 'add-exchanger-step2';
    document.getElementById('add-exchanger-btn').textContent = 'Click Cold Stream...';
  } 
  else if (state.interactionMode === 'add-exchanger-step2') {
    if (stream.type !== 'cold') {
      alert("Please select a COLD stream!");
      return;
    }
    state.pendingColdStreamId = streamId;
    
    const matchId = `M${state.matches.length + 1}`;
    const slot = 4; // default slot
    
    // Calculate default tick-off load
    const hTemps = state.simulation.streamTemps[state.pendingHotStreamId];
    const cTemps = state.simulation.streamTemps[state.pendingColdStreamId];
    const hotRemaining = Math.max(0, (hTemps[0] - hTemps[8]) * state.streams.find(s => s.id === state.pendingHotStreamId).MCp);
    const coldRemaining = Math.max(0, (cTemps[0] - cTemps[8]) * state.streams.find(s => s.id === state.pendingColdStreamId).MCp);
    const defaultLoad = Math.min(100, Math.min(hotRemaining || 100, coldRemaining || 100));

    state.matches.push({
      id: matchId,
      hotStreamId: state.pendingHotStreamId,
      coldStreamId: state.pendingColdStreamId,
      load: Number(defaultLoad.toFixed(1)),
      slot: slot
    });

    resetInteractionMode();
    await simulateNetwork();
    renderAll();
    
    state.selectedMatchId = matchId;
    openEditor(matchId, 'match');
  }
  else if (state.interactionMode === 'add-utility') {
    const isHot = stream.type === 'hot';
    const utId = `U${state.utilities.length + 1}`;
    
    state.utilities.push({
      id: utId,
      streamId: streamId,
      type: isHot ? 'cooler' : 'heater',
      load: 100,
      slot: isHot ? 8 : 1
    });

    resetInteractionMode();
    await simulateNetwork();
    renderAll();
    
    state.selectedUtilityId = utId;
    openEditor(utId, 'utility');
  }
}

function resetInteractionMode() {
  state.interactionMode = 'normal';
  state.pendingHotStreamId = null;
  state.pendingColdStreamId = null;
  
  document.getElementById('add-exchanger-btn').className = 'btn btn-secondary';
  document.getElementById('add-exchanger-btn').textContent = '+ Add Exchanger Match';
  document.getElementById('add-utility-btn').className = 'btn btn-secondary';
  document.getElementById('add-utility-btn').textContent = '+ Add Utility (Heater/Cooler)';
}

// --- Drag and Drop Exchangers ---
function startMatchDrag(e, matchId) {
  e.stopPropagation();
  e.preventDefault();
  state.draggedMatchId = matchId;
}

async function handleSvgMouseMove(e) {
  if (!state.draggedMatchId) return;

  const svg = document.getElementById('hen-svg');
  const rect = svg.getBoundingClientRect();
  const w = 1000;
  const scaleFactor = rect.width ? (w / rect.width) : 1;
  const mouseX = (e.clientX - rect.left) * scaleFactor;

  const paddingLeft = 100;
  const paddingRight = 100;
  const activeW = w - paddingLeft - paddingRight;
  const colSpacing = activeW / 9;

  let slot = Math.round((mouseX - paddingLeft) / colSpacing);
  slot = Math.max(1, Math.min(8, slot));

  const match = state.matches.find(m => m.id === state.draggedMatchId);
  if (match && match.slot !== slot) {
    match.slot = slot;
    await simulateNetwork();
    renderAll();
  }
}

function handleSvgMouseUp() {
  state.draggedMatchId = null;
}

function startMatchDragTouch(e, matchId) {
  e.stopPropagation();
  state.draggedMatchId = matchId;
}

async function handleSvgTouchMove(e) {
  if (!state.draggedMatchId) return;
  e.preventDefault(); // Stop scrolling while dragging the match node

  const svg = document.getElementById('hen-svg');
  const rect = svg.getBoundingClientRect();
  const touch = e.touches[0];
  const w = 1000;
  const scaleFactor = rect.width ? (w / rect.width) : 1;
  const mouseX = (touch.clientX - rect.left) * scaleFactor;

  const paddingLeft = 100;
  const paddingRight = 100;
  const activeW = w - paddingLeft - paddingRight;
  const colSpacing = activeW / 9;

  let slot = Math.round((mouseX - paddingLeft) / colSpacing);
  slot = Math.max(1, Math.min(8, slot));

  const match = state.matches.find(m => m.id === state.draggedMatchId);
  if (match && match.slot !== slot) {
    match.slot = slot;
    await simulateNetwork();
    renderAll();
  }
}

// --- Editor Functions ---
function selectMatch(e, matchId) {
  e.stopPropagation();
  state.selectedMatchId = matchId;
  state.selectedUtilityId = null;
  renderAll();
  openEditor(matchId, 'match');
}

// --- Editor Functions ---
function selectUtility(e, utId) {
  e.stopPropagation();
  state.selectedUtilityId = utId;
  state.selectedMatchId = null;
  renderAll();
  openEditor(utId, 'utility');
}

function openEditor(id, type) {
  const panel = document.getElementById('editor-panel');
  const loadInput = document.getElementById('edit-load');
  
  let item = null;
  if (type === 'match') {
    item = state.matches.find(m => m.id === id);
  } else {
    item = state.utilities.find(u => u.id === id);
  }

  if (item) {
    loadInput.value = item.load;
    panel.classList.remove('hidden');
  }
}

function closeEditor() {
  document.getElementById('editor-panel').classList.add('hidden');
  state.selectedMatchId = null;
  state.selectedUtilityId = null;
}

async function saveExchangerEdit() {
  const loadVal = parseFloat(document.getElementById('edit-load').value);
  if (isNaN(loadVal) || loadVal <= 0) return;

  if (state.selectedMatchId) {
    const match = state.matches.find(m => m.id === state.selectedMatchId);
    if (match) match.load = loadVal;
  } else if (state.selectedUtilityId) {
    const ut = state.utilities.find(u => u.id === state.selectedUtilityId);
    if (ut) ut.load = loadVal;
  }

  await simulateNetwork();
  renderAll();
  closeEditor();
}

async function deleteSelectedDevice() {
  if (state.selectedMatchId) {
    state.matches = state.matches.filter(m => m.id !== state.selectedMatchId);
  } else if (state.selectedUtilityId) {
    state.utilities = state.utilities.filter(u => u.id !== state.selectedUtilityId);
  }

  await simulateNetwork();
  renderAll();
  closeEditor();
}

// ==========================================================================
// HEURISTIC NETWORK AUTO-DESIGN (DELEGATED TO PYTHON FLASK BACKEND)
// ==========================================================================
async function autoDesignNetwork() {
  try {
    const res = await fetch('/api/autodesign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        streams: state.streams,
        deltaTmin: state.deltaTmin
      })
    });
    
    if (!res.ok) throw new Error("Auto-design failed.");
    const data = await res.json();
    
    state.matches = data.matches;
    state.utilities = data.utilities;
    
    await simulateNetwork();
    renderAll();
  } catch (err) {
    console.error("Auto design error:", err);
  }
}

// --- View Mode Selector (Scrollable vs Fit Screen) ---
function setViewMode(mode) {
  state.viewMode = mode;
  const svg = document.getElementById('hen-svg');
  const btnScroll = document.getElementById('btn-view-scroll');
  const btnFit = document.getElementById('btn-view-fit');

  if (mode === 'fit') {
    svg.classList.add('fit-screen');
    btnScroll.className = 'btn btn-xs btn-outline';
    btnFit.className = 'btn btn-xs btn-primary active';
  } else {
    svg.classList.remove('fit-screen');
    btnScroll.className = 'btn btn-xs btn-primary active';
    btnFit.className = 'btn btn-xs btn-outline';
  }
}
