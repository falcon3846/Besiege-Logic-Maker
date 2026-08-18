let PPS = 100; 
let MAX_SECONDS = 10;
let TICK_STEP = 0.5;

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        let r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// ご要望に合わせた初期設定
let tracksData = [
    { id: 1, guid: generateUUID(), type: 'input', name: 'Input', color: 'color-orange', activateType: 'key', activateValues: [], emulateType: 'key', emulateValues: ['UpArrow'], 
      inputType: 'finite', clips: [{ start: 0, duration: 5.0 }], events: [] },

    { id: 2, guid: generateUUID(), type: 'wheel', name: 'MainLoop', color: 'color-purple', 
      activateType: 'key', activateValues: ['UpArrow'], emulateType: 'key', emulateValues: [], 
      period: 2.0, isToggle: false, angleData: [] },

    { id: 3, guid: generateUUID(), type: 'length_detector', name: 'Up', color: 'color-green', 
      activateType: 'key', activateValues: ['UpArrow'], emulateType: 'var', emulateValues: ['up'], 
      targetTrackId: 2, minAngle: 0, maxAngle: 45, holdToActivate: true, isToggle: false, monitorPeriods: [], activePeriods: [] },

    { id: 4, guid: generateUUID(), type: 'length_detector', name: 'Go', color: 'color-green', 
      activateType: 'key', activateValues: ['UpArrow'], emulateType: 'var', emulateValues: ['go'], 
      targetTrackId: 2, minAngle: 45, maxAngle: 90, holdToActivate: true, isToggle: false, monitorPeriods: [], activePeriods: [] },

    { id: 5, guid: generateUUID(), type: 'length_detector', name: 'Down', color: 'color-green', 
      activateType: 'key', activateValues: ['UpArrow'], emulateType: 'var', emulateValues: ['down'], 
      targetTrackId: 2, minAngle: 180, maxAngle: 225, holdToActivate: true, isToggle: false, monitorPeriods: [], activePeriods: [] },

    { id: 6, guid: generateUUID(), type: 'length_detector', name: 'Back', color: 'color-green', 
      activateType: 'key', activateValues: ['UpArrow'], emulateType: 'var', emulateValues: ['back'], 
      targetTrackId: 2, minAngle: 225, maxAngle: 270, holdToActivate: true, isToggle: false, monitorPeriods: [], activePeriods: [] }
];

let dragState = { isDragging: false, mode: null, trackId: null, clipIndex: null, startX: 0, startWait: 0, startDuration: 0, evStart: 0, evEnd: 0 };
let draggedTrackId = null;
let editingTrackId = null;
let editingTarget = null;
let tempValues = [];

const colorsMap = {
    'color-gray': '#888', 'color-red': '#d32f2f', 'color-blue': '#1976d2',
    'color-green': '#388e3c', 'color-yellow': '#fbc02d', 'color-orange': '#e67e22', 'color-purple': '#c778dd', 'color-pink': '#e91e63'
};

function updateSettings() {
    const newMax = Number(document.getElementById('max-time-input').value);
    if (newMax && newMax > 0) MAX_SECONDS = newMax;
    PPS = Number(document.getElementById('zoom-slider').value);
    TICK_STEP = Number(document.getElementById('tick-step').value);
    simulate(); renderRuler(); renderTracks();
}

function updatePeriod(periods, state, sec) {
    if (state) {
        if (periods.length === 0 || periods[periods.length - 1].end !== null) periods.push({ start: sec, end: null });
    } else {
        if (periods.length > 0 && periods[periods.length - 1].end === null) {
            if (Math.abs(sec - MAX_SECONDS) < 0.05) sec = MAX_SECONDS;
            periods[periods.length - 1].end = sec;
        }
    }
}

function getAngleAt(track, t) {
    if (!track || !track.angleData || track.angleData.length === 0) return 0;
    const data = track.angleData;
    if (t <= data[0].t) return data[0].a;
    if (t >= data[data.length - 1].t) return data[data.length - 1].a;
    for (let i = 0; i < data.length - 1; i++) {
        if (t >= data[i].t && t <= data[i + 1].t) {
            let a1 = data[i].a; let a2 = data[i+1].a;
            if (Math.abs(a1 - a2) > 180) { return Math.abs(t - data[i].t) < Math.abs(t - data[i + 1].t) ? a1 : a2; }
            let ratio = (t - data[i].t) / (data[i+1].t - data[i].t);
            return a1 + (a2 - a1) * ratio;
        }
    }
    return 0;
}

function simulate() {
    tracksData.forEach(track => {
        track.events = []; track._state = 'IDLE'; track._timerMs = 0; track._isOutputting = false;
        if (track.type === 'input') {
            if (track.inputType === 'infinite') track.events.push({ waitStart: 0, actionStart: 0, actionEnd: MAX_SECONDS, interruptedAt: null, isDummy: false });
            else track.clips.forEach(clip => track.events.push({ waitStart: clip.start, actionStart: clip.start, actionEnd: clip.start + clip.duration, interruptedAt: null, isDummy: false }));
        } 
        else if (track.type === 'wheel' || track.type === 'large_wheel') {
            track._angle = 0; track._forwardActive = false; track._backwardActive = false; track.angleData = [{ t: 0, a: 0 }];
        }
        else if (track.type === 'angle' || track.type === 'length_detector') {
            track._isMonitoring = false; track.monitorPeriods = []; track.activePeriods = []; track._potentialPeriods = []; 
        }
        track._lastInput = false; track._lastFw = false; track._lastBw = false;
    });

    const dtMs = 20; const maxTimeMs = MAX_SECONDS * 1000;

    for (let tMs = 0; tMs <= maxTimeMs; tMs += dtMs) {
        let currentSignals = { key: {}, var: {} };

        tracksData.forEach(track => {
            if (track.type === 'input') {
                const sec = tMs / 1000;
                if (track.events.some(ev => sec >= ev.actionStart && (sec < ev.actionEnd || (sec === MAX_SECONDS && ev.actionEnd === MAX_SECONDS)))) {
                    track.emulateValues.forEach(val => { if (val) currentSignals[track.emulateType][val] = true; });
                }
            } else if ((track.type === 'timer' || track.type === 'angle' || track.type === 'length_detector') && track._isOutputting) {
                track.emulateValues.forEach(val => { if (val) currentSignals[track.emulateType][val] = true; });
            }
        });

        tracksData.forEach(track => {
            if (track.type === 'wheel' || track.type === 'large_wheel') {
                let fwOn = false; track.activateValues.forEach(val => { if (val && currentSignals[track.activateType][val]) fwOn = true; });
                let bwOn = false; track.emulateValues.forEach(val => { if (val && currentSignals[track.emulateType][val]) bwOn = true; });
                
                let fwEdge = fwOn && !track._lastFw; let bwEdge = bwOn && !track._lastBw;
                track._lastFw = fwOn; track._lastBw = bwOn;

                if (track.isToggle) {
                    if (fwEdge) track._forwardActive = !track._forwardActive;
                    if (bwEdge) track._backwardActive = !track._backwardActive;
                } else { track._forwardActive = fwOn; track._backwardActive = bwOn; }

                let delta = 0; let p = track.period > 0 ? track.period : 2.0; let spd = 360 / p;
                if (tMs > 0) { 
                    if (track._forwardActive) delta += spd * (dtMs / 1000);
                    if (track._backwardActive) delta -= spd * (dtMs / 1000);
                }

                track._angle = (track._angle + delta) % 360;
                if (track._angle < 0) track._angle += 360;
                track.angleData.push({ t: tMs / 1000, a: track._angle });
            }
        });

        tracksData.forEach(track => {
            let inputOn = false; track.activateValues.forEach(val => { if (val && currentSignals[track.activateType][val]) inputOn = true; });
            let inputEdge = inputOn && !track._lastInput; track._lastInput = inputOn;

            if (track.type === 'timer') {
                let waitMs = Math.round(track.baseWait * 1000); let durMs = Math.round(track.baseDuration * 1000);
                if (track.holdToActivate) {
                    if (!inputOn) {
                        if (track._state === 'WAITING' && track._currentEvent) { track._currentEvent.interruptedAt = tMs / 1000; track.events.push(track._currentEvent); } 
                        else if (track._state === 'EMULATING' && track._currentEvent) { track._currentEvent.actionEnd = tMs / 1000; track.events.push(track._currentEvent); }
                        track._currentEvent = null; track._state = 'IDLE'; track._timerMs = 0; track._isOutputting = false;
                    } else {
                        if (track._state === 'IDLE') { track._state = 'WAITING'; track._timerMs = 0; track._currentEvent = { waitStart: tMs / 1000, actionStart: null, actionEnd: null, interruptedAt: null, isDummy: false }; }
                        if (track._state === 'WAITING') { track._timerMs += dtMs; if (track._timerMs >= waitMs) { track._state = 'EMULATING'; track._timerMs = 0; track._isOutputting = true; track._currentEvent.actionStart = tMs / 1000; } } 
                        else if (track._state === 'EMULATING') { track._timerMs += dtMs; if (track._timerMs >= durMs) { track._currentEvent.actionEnd = tMs / 1000; track.events.push(track._currentEvent); track._currentEvent = null; track._isOutputting = false; if (track.loop) { track._state = 'WAITING'; track._timerMs = 0; track._currentEvent = { waitStart: tMs / 1000, actionStart: null, actionEnd: null, interruptedAt: null, isDummy: false }; } else { track._state = 'DONE'; } } }
                    }
                } else {
                    if (track.canStop && inputEdge && track._state !== 'IDLE') {
                        if (track._state === 'WAITING' && track._currentEvent) { track._currentEvent.interruptedAt = tMs / 1000; track.events.push(track._currentEvent); } 
                        else if (track._state === 'EMULATING' && track._currentEvent) { track._currentEvent.actionEnd = tMs / 1000; track.events.push(track._currentEvent); }
                        track._currentEvent = null; track._state = 'IDLE'; track._timerMs = 0; track._isOutputting = false;
                    } else if (inputEdge && track._state === 'IDLE') {
                        track._state = 'WAITING'; track._timerMs = 0; track._currentEvent = { waitStart: tMs / 1000, actionStart: null, actionEnd: null, interruptedAt: null, isDummy: false };
                    }
                    if (track._state === 'WAITING') { track._timerMs += dtMs; if (track._timerMs >= waitMs) { track._state = 'EMULATING'; track._timerMs = 0; track._isOutputting = true; track._currentEvent.actionStart = tMs / 1000; } } 
                    else if (track._state === 'EMULATING') { track._timerMs += dtMs; if (track._timerMs >= durMs) { track._currentEvent.actionEnd = tMs / 1000; track.events.push(track._currentEvent); track._currentEvent = null; track._isOutputting = false; if (track.loop) { track._state = 'WAITING'; track._timerMs = 0; track._currentEvent = { waitStart: tMs / 1000, actionStart: null, actionEnd: null, interruptedAt: null, isDummy: false }; } else { track._state = 'IDLE'; } } }
                }
            } 
            else if (track.type === 'angle' || track.type === 'length_detector') {
                if (track.holdToActivate) { track._isMonitoring = inputOn; }
                else if (track.isToggle) { if (inputEdge) track._isMonitoring = !track._isMonitoring; }
                else { track._isMonitoring = true; } 

                let isPotential = false;
                if (track.targetTrackId) {
                    const target = tracksData.find(t => t.id == track.targetTrackId);
                    if (target && ((track.type === 'angle' && target.type === 'large_wheel') || (track.type === 'length_detector' && target.type === 'wheel'))) {
                        const a = target._angle;
                        if (track.minAngle > track.maxAngle) { isPotential = (a >= track.minAngle || a <= track.maxAngle); } 
                        else { isPotential = (a >= track.minAngle && a <= track.maxAngle); }
                    }
                }

                let isInRange = track._isMonitoring && isPotential;

                const sec = tMs / 1000;
                updatePeriod(track.monitorPeriods, track._isMonitoring, sec);
                updatePeriod(track.activePeriods, isInRange, sec);
                updatePeriod(track._potentialPeriods, isPotential, sec);
                track._isOutputting = isInRange;
            }
        });
    }

    tracksData.forEach(track => {
        if (track.type === 'timer') {
            if (track._currentEvent) {
                if (track._state === 'WAITING') { track._currentEvent.interruptedAt = maxTimeMs / 1000; track.events.push(track._currentEvent); } 
                else if (track._state === 'EMULATING') { track._currentEvent.actionEnd = maxTimeMs / 1000; track.events.push(track._currentEvent); }
            }
            if (track.events.length === 0) {
                let currentWait = track.baseWait; let currentDur = track.baseDuration;
                if (track.loop) {
                    let time = 0; let maxLoops = 10000;
                    for (let i = 0; i < maxLoops; i++) { let ws = time; let as = ws + currentWait; let ae = as + currentDur; if (ws > MAX_SECONDS) break; track.events.push({ waitStart: ws, actionStart: as, actionEnd: ae, interruptedAt: null, isDummy: true }); time = ae; }
                } else { track.events.push({ waitStart: 0, actionStart: currentWait, actionEnd: currentWait + currentDur, interruptedAt: null, isDummy: true }); }
            }
        } 
        else if (track.type === 'angle' || track.type === 'length_detector') {
            updatePeriod(track.monitorPeriods, false, maxTimeMs / 1000);
            updatePeriod(track.activePeriods, false, maxTimeMs / 1000);
            updatePeriod(track._potentialPeriods, false, maxTimeMs / 1000);
            
            track.activePeriods.forEach(p => {
                if (p.end !== null && Math.abs(p.end - MAX_SECONDS) < 0.05) {
                    p.end = MAX_SECONDS;
                }
            });

            if (track.monitorPeriods.length === 0) {
                track.monitorPeriods.push({start: 0, end: MAX_SECONDS, isDummy: true});
                if (track._potentialPeriods && track._potentialPeriods.length > 0) {
                    track.activePeriods = track._potentialPeriods.map(p => ({start: p.start, end: p.end, isDummy: true}));
                }
            }
        }
    });
}

function renderRuler() {
    const ruler = document.getElementById('ruler'); ruler.innerHTML = '';
    ruler.style.width = `${MAX_SECONDS * PPS + 50}px`;
    const steps = Math.floor(MAX_SECONDS / TICK_STEP);
    for (let s = 0; s <= steps; s++) {
        let timeVal = Math.round(s * TICK_STEP * 100) / 100;
        const tick = document.createElement('div'); tick.className = 'tick'; tick.style.left = `${timeVal * PPS}px`;
        const label = document.createElement('div'); label.className = 'tick-label'; label.innerText = `${timeVal}s`;
        const mark = document.createElement('div'); mark.className = 'tick-mark'; mark.style.height = Number.isInteger(timeVal) ? '15px' : '10px';
        tick.appendChild(label); tick.appendChild(mark); ruler.appendChild(tick);
    }
}

const formatIO = (type, vals) => {
    const joined = vals.filter(v=>v).join(type === 'var' ? ';' : ',');
    return `${type==='var'?'var':'key'}:${joined}`;
};

function renderTracks() {
    const container = document.getElementById('tracks-container'); container.innerHTML = '';

    tracksData.forEach((track, index) => {
        const trackEl = document.createElement('div'); trackEl.className = 'track';

        trackEl.addEventListener('dragstart', (e) => { draggedTrackId = track.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', track.id); setTimeout(() => trackEl.classList.add('dragging'), 0); });
        trackEl.addEventListener('dragend', () => { draggedTrackId = null; trackEl.classList.remove('dragging'); document.querySelectorAll('.track').forEach(t => t.classList.remove('drag-over-top', 'drag-over-bottom')); });
        trackEl.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; const rect = trackEl.getBoundingClientRect(); const midY = rect.top + rect.height / 2; if(e.clientY < midY) { trackEl.classList.add('drag-over-top'); trackEl.classList.remove('drag-over-bottom'); } else { trackEl.classList.add('drag-over-bottom'); trackEl.classList.remove('drag-over-top'); } });
        trackEl.addEventListener('dragleave', () => { trackEl.classList.remove('drag-over-top', 'drag-over-bottom'); });
        trackEl.addEventListener('drop', (e) => {
            e.preventDefault(); trackEl.classList.remove('drag-over-top', 'drag-over-bottom');
            if (draggedTrackId === null || draggedTrackId === track.id) return;
            const rect = trackEl.getBoundingClientRect(); const midY = rect.top + rect.height / 2; const insertAfter = e.clientY >= midY;
            const draggedIndex = tracksData.findIndex(t => t.id === draggedTrackId); const [draggedItem] = tracksData.splice(draggedIndex, 1);
            const newTargetIndex = tracksData.findIndex(t => t.id === track.id); tracksData.splice(insertAfter ? newTargetIndex + 1 : newTargetIndex, 0, draggedItem);
            simulate(); renderTracks();
        });

        const headerEl = document.createElement('div'); headerEl.className = 'track-header';
        const contentEl = document.createElement('div'); contentEl.className = 'track-content';
        contentEl.style.width = `${MAX_SECONDS * PPS + 50}px`;

        let isDummyTrack = false;
        if (track.type === 'timer') { isDummyTrack = track.events.length > 0 && track.events.every(ev => ev.isDummy); } 
        else if (track.type === 'angle' || track.type === 'length_detector') { isDummyTrack = track.monitorPeriods.length > 0 && track.monitorPeriods.every(p => p.isDummy); }
        if (isDummyTrack) { headerEl.classList.add('dummy-track'); contentEl.classList.add('dummy-track'); }

        const numEl = document.createElement('div'); numEl.className = 'col-num';
        const dragHandle = document.createElement('span'); dragHandle.className = 'drag-handle'; dragHandle.innerText = '≡';
        dragHandle.addEventListener('mousedown', () => trackEl.draggable = true); dragHandle.addEventListener('mouseup', () => trackEl.draggable = false); dragHandle.addEventListener('mouseleave', () => trackEl.draggable = false);
        numEl.appendChild(dragHandle); numEl.appendChild(document.createTextNode(index + 1));

        const typeEl = document.createElement('div'); typeEl.className = 'col-type';
        let typeStr = '';
        if (track.type === 'timer') typeStr = 'Timer';
        else if (track.type === 'wheel') typeStr = 'Wheel';
        else if (track.type === 'large_wheel') typeStr = 'Large<br>Wheel';
        else if (track.type === 'angle') typeStr = 'Anglometer';
        else if (track.type === 'length_detector') typeStr = 'Length<br>Detector';
        else typeStr = 'INPUT';
        typeEl.innerHTML = typeStr;

        if (track.type === 'wheel' || track.type === 'large_wheel') { 
            typeEl.style.cursor = 'pointer'; typeEl.style.color = track.color === 'color-pink' ? '#e91e63' : '#c778dd'; 
            typeEl.addEventListener('click', () => { 
                track.type = track.type === 'wheel' ? 'large_wheel' : 'wheel'; 
                track.color = track.type === 'wheel' ? 'color-purple' : 'color-pink';
                renderTracks(); 
            }); 
        }
        if (track.type === 'angle' || track.type === 'length_detector') { 
            typeEl.style.cursor = 'pointer'; typeEl.style.color = track.color === 'color-green' ? '#388e3c' : '#fbc02d'; 
            typeEl.addEventListener('click', () => { 
                track.type = track.type === 'angle' ? 'length_detector' : 'angle'; 
                track.color = track.type === 'angle' ? 'color-yellow' : 'color-green';
                renderTracks(); 
            }); 
        }

        const tagEl = document.createElement('div'); tagEl.className = 'col-tag'; tagEl.innerText = track.name;
        tagEl.contentEditable = true; tagEl.spellcheck = false;
        tagEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); tagEl.blur(); } });
        tagEl.addEventListener('blur', () => { const newName = tagEl.innerText.trim(); if (newName) track.name = newName; else tagEl.innerText = track.name; });

        const setEl = document.createElement('div'); setEl.className = 'col-set'; setEl.innerHTML = '⚙️';
        setEl.title = "詳細設定を開く";
        setEl.addEventListener('click', () => openModal(track.id, 'property'));

        const inEl = document.createElement('div'); inEl.className = 'col-in'; 
        const refEl = document.createElement('div'); refEl.className = 'col-ref'; 
        const outEl = document.createElement('div'); outEl.className = 'col-out';

        if (track.type === 'input') {
            if (track.inputType === 'finite') {
                inEl.innerText = '+ Clip'; inEl.style.cursor = 'pointer'; inEl.style.color = '#e67e22';
                inEl.addEventListener('click', () => { const lastClip = track.clips.length > 0 ? track.clips[track.clips.length - 1] : null; track.clips.push({ start: lastClip ? lastClip.start + lastClip.duration + 0.5 : 0, duration: 1.0 }); simulate(); renderTracks(); });
            } else { inEl.innerText = '-'; }
            refEl.innerText = '-';
            outEl.innerText = formatIO(track.emulateType, track.emulateValues);
            outEl.style.cursor = 'pointer'; outEl.style.color = '#1976d2';
            outEl.addEventListener('click', () => openModal(track.id, 'emulate'));
        } 
        else if (track.type === 'wheel' || track.type === 'large_wheel') {
            inEl.innerText = formatIO(track.activateType, track.activateValues); 
            inEl.style.color = '#388e3c'; inEl.style.cursor = 'pointer'; 
            inEl.addEventListener('click', () => openModal(track.id, 'activate'));
            
            refEl.innerText = formatIO(track.emulateType, track.emulateValues); 
            refEl.style.color = '#d32f2f'; refEl.style.cursor = 'pointer'; 
            refEl.addEventListener('click', () => openModal(track.id, 'emulate'));
            
            outEl.innerText = '-';
        } 
        else if (track.type === 'angle' || track.type === 'length_detector') {
            inEl.innerText = formatIO(track.activateType, track.activateValues); 
            inEl.style.color = '#388e3c'; inEl.style.cursor = 'pointer'; 
            inEl.addEventListener('click', () => openModal(track.id, 'activate'));
            
            if (track.targetTrackId) {
                const targetIdx = tracksData.findIndex(t => t.id == track.targetTrackId);
                const target = tracksData[targetIdx];
                if (target && ((track.type === 'angle' && target.type === 'large_wheel') || (track.type === 'length_detector' && target.type === 'wheel'))) {
                    refEl.innerText = `No.${targetIdx + 1}`;
                } else { refEl.innerText = '(未設定)'; }
            } else { refEl.innerText = '(未設定)'; }
            refEl.style.color = '#fbc02d'; refEl.style.cursor = 'pointer'; 
            refEl.addEventListener('click', () => openModal(track.id, 'property'));
            
            outEl.innerText = formatIO(track.emulateType, track.emulateValues); 
            outEl.style.color = '#1976d2'; outEl.style.cursor = 'pointer'; 
            outEl.addEventListener('click', () => openModal(track.id, 'emulate'));
        }
        else { // timer
            inEl.innerText = formatIO(track.activateType, track.activateValues); 
            inEl.style.color = '#388e3c'; inEl.style.cursor = 'pointer'; 
            inEl.addEventListener('click', () => openModal(track.id, 'activate'));
            
            refEl.innerText = '-';
            
            outEl.innerText = formatIO(track.emulateType, track.emulateValues); 
            outEl.style.color = '#1976d2'; outEl.style.cursor = 'pointer'; 
            outEl.addEventListener('click', () => openModal(track.id, 'emulate'));
        }

        headerEl.appendChild(numEl); headerEl.appendChild(typeEl); headerEl.appendChild(tagEl); 
        headerEl.appendChild(setEl); headerEl.appendChild(inEl); headerEl.appendChild(refEl); headerEl.appendChild(outEl);
        
        if (track.type === 'wheel' || track.type === 'large_wheel') {
            const svgNS = "http://www.w3.org/2000/svg"; const svg = document.createElementNS(svgNS, "svg");
            svg.style.position = 'absolute'; svg.style.top = '0'; svg.style.left = '0'; svg.style.width = '100%'; svg.style.height = '100%'; svg.style.pointerEvents = 'none';
            [0, 90, 180, 270, 360].forEach(deg => {
                const y = 45 - (deg / 360) * 40; const line = document.createElementNS(svgNS, "line");
                line.setAttribute("x1", "0"); line.setAttribute("y1", y); line.setAttribute("x2", "100%"); line.setAttribute("y2", y);
                if (deg === 0 || deg === 360) { line.setAttribute("stroke", "#555"); line.setAttribute("stroke-width", "1"); } 
                else { line.setAttribute("stroke", "#444"); line.setAttribute("stroke-width", "1"); line.setAttribute("stroke-dasharray", "2 2"); }
                svg.appendChild(line);
            });
            if (track.angleData && track.angleData.length > 0) {
                let paths = []; let currentPath = []; let prevA = null;
                track.angleData.forEach(d => {
                    if (prevA !== null && Math.abs(d.a - prevA) > 180) { paths.push(currentPath); currentPath = []; }
                    currentPath.push(`${d.t * PPS},${45 - (d.a / 360) * 40}`); prevA = d.a;
                });
                paths.push(currentPath);
                paths.forEach(pts => { if(pts.length > 0) { const polyline = document.createElementNS(svgNS, "polyline"); polyline.setAttribute("points", pts.join(' ')); polyline.setAttribute("stroke", colorsMap[track.color] || "#c778dd"); polyline.setAttribute("stroke-width", "2"); polyline.setAttribute("fill", "none"); svg.appendChild(polyline); } });
            }
            contentEl.appendChild(svg);
        } 
        else if (track.type === 'angle' || track.type === 'length_detector') {
            track.monitorPeriods.forEach(p => {
                if (p.end > p.start) {
                    const el = document.createElement('div'); el.className = 'clip-monitor';
                    el.style.left = `${p.start * PPS}px`; el.style.width = `${(p.end - p.start) * PPS}px`;
                    el.style.borderBottomColor = p.isDummy ? '#e74c3c' : (colorsMap[track.color] || '#fbc02d');
                    contentEl.appendChild(el);
                }
            });
            
            track.activePeriods.forEach((p, index) => {
                if (p.end > p.start) {
                    const actionEl = document.createElement('div'); actionEl.className = `clip-action-sensor ${track.color}`;
                    actionEl.style.left = `${p.start * PPS}px`; actionEl.style.width = `${(p.end - p.start) * PPS}px`;
                    
                    if (p.isDummy) { 
                        actionEl.style.opacity = '0.5'; 
                        actionEl.style.background = 'repeating-linear-gradient(-45deg, rgba(255,255,255,0.2), rgba(255,255,255,0.2) 8px, transparent 8px, transparent 16px), #d32f2f';
                        actionEl.style.borderColor = '#b71c1c';
                    }

                    let dispLeft = track.minAngle; let dispRight = track.maxAngle;
                    const target = tracksData.find(t => t.id == track.targetTrackId);
                    
                    if (target && !p.isDummy && ((track.type === 'angle' && target.type === 'large_wheel') || (track.type === 'length_detector' && target.type === 'wheel'))) {
                        let startA = getAngleAt(target, p.start);
                        let distToMin = Math.min(Math.abs(startA - track.minAngle), 360 - Math.abs(startA - track.minAngle));
                        let distToMax = Math.min(Math.abs(startA - track.maxAngle), 360 - Math.abs(startA - track.maxAngle));
                        if (distToMin <= distToMax) { dispLeft = track.minAngle; dispRight = track.maxAngle; } else { dispLeft = track.maxAngle; dispRight = track.minAngle; }
                    }

                    const txtDiv = document.createElement('div');
                    txtDiv.style.display = 'flex'; txtDiv.style.justifyContent = 'space-between'; txtDiv.style.width = '100%'; 
                    txtDiv.style.padding = '0 5px'; txtDiv.style.boxSizing = 'border-box'; txtDiv.style.pointerEvents = 'none'; 
                    txtDiv.style.fontSize = '10px'; txtDiv.style.color = '#fff'; txtDiv.style.lineHeight = '24px';
                    txtDiv.style.textShadow = '1px 1px 2px rgba(0,0,0,0.8)';
                    txtDiv.innerHTML = `<span>${dispLeft}°</span><span>${dispRight}°</span>`;
                    actionEl.appendChild(txtDiv);

                    const handleLeft = document.createElement('div'); handleLeft.className = 'handle handle-left';
                    handleLeft.addEventListener('mousedown', (e) => startDrag(e, track.id, 'resize-left', index, p.start, p.end));
                    actionEl.appendChild(handleLeft);

                    const handleRight = document.createElement('div'); handleRight.className = 'handle handle-right';
                    handleRight.addEventListener('mousedown', (e) => startDrag(e, track.id, 'resize-right', index, p.start, p.end));
                    actionEl.appendChild(handleRight);

                    actionEl.addEventListener('mousedown', (e) => { if (e.target.classList.contains('handle')) return; startDrag(e, track.id, 'move', index, p.start, p.end); });
                    contentEl.appendChild(actionEl);
                }
            });
        }
        else {
            track.events.forEach((ev, index) => {
                let waitEnd = ev.waitStart; if (ev.actionStart !== null) waitEnd = ev.actionStart; else if (ev.interruptedAt !== null) waitEnd = ev.interruptedAt;
                const waitLen = waitEnd - ev.waitStart;
                if (waitLen > 0) { const waitEl = document.createElement('div'); waitEl.className = 'clip-wait'; waitEl.style.left = `${ev.waitStart * PPS}px`; waitEl.style.width = `${waitLen * PPS}px`; if (ev.isDummy) waitEl.style.backgroundColor = '#e74c3c'; contentEl.appendChild(waitEl); }
                if (ev.actionStart !== null && ev.actionEnd !== null) {
                    const actionLen = ev.actionEnd - ev.actionStart; const actionEl = document.createElement('div'); actionEl.className = `clip-action ${track.color}`; actionEl.style.left = `${ev.actionStart * PPS}px`; actionEl.style.width = `${actionLen * PPS}px`;
                    if (ev.isDummy) actionEl.style.opacity = '0.4';
                    if (!(track.type === 'input' && track.inputType === 'infinite')) {
                        const textEl = document.createElement('span'); textEl.className = 'clip-text'; let durText = track.type === 'input' ? track.clips[index].duration : track.baseDuration; textEl.innerText = `${durText}s`; actionEl.appendChild(textEl);
                        const handleLeft = document.createElement('div'); handleLeft.className = 'handle handle-left'; handleLeft.addEventListener('mousedown', (e) => startDrag(e, track.id, 'resize-left', index)); actionEl.appendChild(handleLeft);
                        const handleRight = document.createElement('div'); handleRight.className = 'handle handle-right'; handleRight.addEventListener('mousedown', (e) => startDrag(e, track.id, 'resize-right', index)); actionEl.appendChild(handleRight);
                        actionEl.addEventListener('mousedown', (e) => { if (e.target.classList.contains('handle')) return; startDrag(e, track.id, 'move', index); });
                        actionEl.addEventListener('dblclick', (e) => { if (track.type === 'input') { track.clips.splice(index, 1); simulate(); renderTracks(); } });
                    } else { const textEl = document.createElement('span'); textEl.className = 'clip-text'; textEl.innerText = 'ON'; actionEl.appendChild(textEl); }
                    contentEl.appendChild(actionEl);
                }
            });
        }
        trackEl.appendChild(headerEl); trackEl.appendChild(contentEl); container.appendChild(trackEl);
    });
}

function startDrag(e, trackId, mode, clipIndex = null, evStart = 0, evEnd = 0) {
    e.preventDefault(); const track = tracksData.find(t => t.id === trackId); if (!track) return;
    let sWait = 0; let sDur = 0;
    if (track.type === 'timer') { sWait = track.baseWait; sDur = track.baseDuration; } 
    else if (track.type === 'input') { sWait = track.clips[clipIndex].start; sDur = track.clips[clipIndex].duration; }
    
    dragState = { 
        isDragging: true, mode: mode, trackId: trackId, clipIndex: clipIndex, 
        startX: e.clientX, startWait: sWait, startDuration: sDur,
        evStart: evStart, evEnd: evEnd
    };
    document.body.style.cursor = mode === 'move' ? 'move' : 'ew-resize';
}

document.addEventListener('mousemove', (e) => {
    if (!dragState.isDragging) return;
    const track = tracksData.find(t => t.id === dragState.trackId); if (!track) return;
    const deltaS = (e.clientX - dragState.startX) / PPS;
    
    if (track.type === 'angle' || track.type === 'length_detector') {
        const target = tracksData.find(t => t.id == track.targetTrackId);
        if (target && target.angleData && target.angleData.length > 0 && 
           ((track.type === 'angle' && target.type === 'large_wheel') || (track.type === 'length_detector' && target.type === 'wheel'))) {
            let newStartT = dragState.evStart; let newEndT = dragState.evEnd;
            if (dragState.mode === 'move') { newStartT += deltaS; newEndT += deltaS; } 
            else if (dragState.mode === 'resize-left') { newStartT = Math.min(newStartT + deltaS, newEndT - 0.05); } 
            else if (dragState.mode === 'resize-right') { newEndT = Math.max(newStartT + 0.05, newEndT + deltaS); }

            newStartT = Math.max(0, Math.min(newStartT, MAX_SECONDS));
            newEndT = Math.max(0, Math.min(newEndT, MAX_SECONDS));

            let a1 = getAngleAt(target, newStartT); let a2 = getAngleAt(target, newEndT);
            let aMid = getAngleAt(target, (newStartT + newEndT) / 2);
            let isForwardSweep = (a1 > a2) ? (aMid >= a1 || aMid <= a2) : (aMid >= a1 && aMid <= a2);

            if (isForwardSweep) { track.minAngle = Math.round(a1); track.maxAngle = Math.round(a2); } 
            else { track.minAngle = Math.round(a2); track.maxAngle = Math.round(a1); }
        }
    } else {
        let newWait = dragState.startWait; let newDuration = dragState.startDuration;
        if (dragState.mode === 'move') { newWait = Math.max(0, dragState.startWait + deltaS); } 
        else if (dragState.mode === 'resize-right') { newDuration = Math.max(0.05, dragState.startDuration + deltaS); } 
        else if (dragState.mode === 'resize-left') {
            const maxDelta = dragState.startDuration - 0.05; const clampedDeltaS = Math.min(Math.max(-dragState.startWait, deltaS), maxDelta);
            newWait = dragState.startWait + clampedDeltaS; newDuration = dragState.startDuration - clampedDeltaS;
        }

        if (track.type === 'timer') { track.baseWait = Math.round(newWait * 100) / 100; track.baseDuration = Math.round(newDuration * 100) / 100; } 
        else if (track.type === 'input') { track.clips[dragState.clipIndex].start = Math.round(newWait * 100) / 100; track.clips[dragState.clipIndex].duration = Math.round(newDuration * 100) / 100; }
    }
    simulate(); renderTracks();
});

document.addEventListener('mouseup', () => { if (!dragState.isDragging) return; dragState.isDragging = false; document.body.style.cursor = ''; });
document.getElementById('prop-hold').addEventListener('change', (e) => { if (e.target.checked) document.getElementById('prop-stop').checked = false; });
document.getElementById('prop-stop').addEventListener('change', (e) => { if (e.target.checked) document.getElementById('prop-hold').checked = false; });
document.getElementById('prop-angle-hold').addEventListener('change', (e) => { if (e.target.checked) document.getElementById('prop-angle-toggle').checked = false; });
document.getElementById('prop-angle-toggle').addEventListener('change', (e) => { if (e.target.checked) document.getElementById('prop-angle-hold').checked = false; });

function openModal(trackId, target) {
    editingTrackId = trackId; editingTarget = target;
    const track = tracksData.find(t => t.id === trackId); if (!track) return;

    const propSec = document.getElementById('property-section');
    const ioSec = document.getElementById('io-section');
    
    propSec.style.display = 'none';
    ioSec.style.display = 'none';

    document.getElementById('timer-properties').style.display = 'none';
    document.getElementById('input-properties').style.display = 'none';
    document.getElementById('rotation-properties').style.display = 'none';
    document.getElementById('angle-properties').style.display = 'none';

    if (target === 'property') {
        propSec.style.display = 'block';
        document.getElementById('modal-title').innerText = `${track.name} の詳細設定`;

        if (track.type === 'timer') {
            document.getElementById('timer-properties').style.display = 'block'; 
            document.getElementById('prop-wait').value = track.baseWait;
            document.getElementById('prop-duration').value = track.baseDuration;
            document.getElementById('prop-hold').checked = track.holdToActivate; 
            document.getElementById('prop-stop').checked = track.canStop; 
            document.getElementById('prop-loop').checked = track.loop;
        } else if (track.type === 'input') {
            document.getElementById('input-properties').style.display = 'block'; 
            const radios = document.getElementsByName('input-type'); radios.forEach(r => r.checked = (r.value === track.inputType));
        } else if (track.type === 'wheel' || track.type === 'large_wheel') {
            document.getElementById('rotation-properties').style.display = 'block'; 
            document.getElementById('prop-toggle').checked = track.isToggle; document.getElementById('prop-period').value = track.period;
        } else if (track.type === 'angle' || track.type === 'length_detector') {
            document.getElementById('angle-properties').style.display = 'block';
            document.getElementById('prop-angle-min').value = track.minAngle; document.getElementById('prop-angle-max').value = track.maxAngle;
            document.getElementById('prop-angle-hold').checked = track.holdToActivate; document.getElementById('prop-angle-toggle').checked = track.isToggle;
            
            const selectEl = document.getElementById('prop-target-track'); selectEl.innerHTML = '<option value="">(未選択)</option>';
            tracksData.forEach((t, idx) => { 
                if ((track.type === 'angle' && t.type === 'large_wheel') || (track.type === 'length_detector' && t.type === 'wheel')) { 
                    const opt = document.createElement('option'); opt.value = t.id; opt.innerText = `No.${idx + 1} - ${t.name}`; 
                    if (t.id == track.targetTrackId) opt.selected = true; 
                    selectEl.appendChild(opt); 
                } 
            });
        }
    } else {
        ioSec.style.display = 'block';
        let titleStr = '';
        if (target === 'activate') {
            if (track.type === 'wheel' || track.type === 'large_wheel') titleStr = '正転入力 (Forward)';
            else if (track.type === 'angle' || track.type === 'length_detector') titleStr = '有効化 (Active)';
            else titleStr = '入力';
        } else {
            if (track.type === 'wheel' || track.type === 'large_wheel') titleStr = '逆転入力 (Backward)';
            else titleStr = '出力';
        }
        document.getElementById('modal-title').innerText = `${track.name} の ${titleStr}`;

        const currentType = target === 'activate' ? track.activateType : track.emulateType;
        const currentValues = target === 'activate' ? track.activateValues : track.emulateValues;
        document.getElementsByName('io-type').forEach(r => r.checked = (r.value === currentType));
        tempValues = [...currentValues]; if (tempValues.length === 0) tempValues.push("");
        renderIOList();
    }
    
    document.getElementById('property-modal').classList.add('active');
}

function closeModal() { document.getElementById('property-modal').classList.remove('active'); editingTrackId = null; editingTarget = null; }

function renderIOList() {
    const listEl = document.getElementById('io-list'); listEl.innerHTML = '';
    tempValues.forEach((val, index) => {
        const row = document.createElement('div'); row.className = 'input-row';
        const input = document.createElement('input'); input.type = 'text'; input.value = val; input.placeholder = "例: UpArrow, C, 変数名"; input.oninput = (e) => { tempValues[index] = e.target.value; };
        const delBtn = document.createElement('button'); delBtn.className = 'danger-btn'; delBtn.innerText = '×'; delBtn.onclick = () => removeIOField(index);
        row.appendChild(input); row.appendChild(delBtn); listEl.appendChild(row);
    });
    const addBtn = document.getElementById('add-io-btn'); addBtn.disabled = tempValues.length >= 5; addBtn.style.opacity = tempValues.length >= 5 ? '0.5' : '1';
}

function addIOField() { if (tempValues.length < 5) { tempValues.push(""); renderIOList(); } }
function removeIOField(index) { tempValues.splice(index, 1); if (tempValues.length === 0) tempValues.push(""); renderIOList(); }

function saveModal() {
    const track = tracksData.find(t => t.id === editingTrackId);
    if (track) {
        if (editingTarget === 'property') {
            if (track.type === 'timer') { 
                track.baseWait = Number(document.getElementById('prop-wait').value) || 0;
                track.baseDuration = Number(document.getElementById('prop-duration').value) || 0.1;
                track.holdToActivate = document.getElementById('prop-hold').checked; 
                track.canStop = document.getElementById('prop-stop').checked; 
                track.loop = document.getElementById('prop-loop').checked; 
            } 
            else if (track.type === 'input') { const checkedInputType = document.querySelector('input[name="input-type"]:checked'); track.inputType = checkedInputType ? checkedInputType.value : 'finite'; } 
            else if (track.type === 'wheel' || track.type === 'large_wheel') { track.isToggle = document.getElementById('prop-toggle').checked; track.period = Number(document.getElementById('prop-period').value) || 2.0; } 
            else if (track.type === 'angle' || track.type === 'length_detector') {
                track.targetTrackId = Number(document.getElementById('prop-target-track').value) || null;
                track.minAngle = Number(document.getElementById('prop-angle-min').value) || 0; track.maxAngle = Number(document.getElementById('prop-angle-max').value) || 0;
                track.holdToActivate = document.getElementById('prop-angle-hold').checked; track.isToggle = document.getElementById('prop-angle-toggle').checked;
            }
        } else {
            const checkedRadio = document.querySelector('input[name="io-type"]:checked'); const newType = checkedRadio ? checkedRadio.value : 'key';
            const newValues = tempValues.filter(v => v.trim() !== "");
            if (editingTarget === 'activate') { track.activateType = newType; track.activateValues = newValues; } else { track.emulateType = newType; track.emulateValues = newValues; }
        }
    }
    closeModal(); simulate(); renderTracks();
}

function addTrack(type) {
    const newId = tracksData.length > 0 ? Math.max(...tracksData.map(t => t.id)) + 1 : 1;
    if (type === 'timer') { tracksData.push({ id: newId, guid: generateUUID(), type: 'timer', name: 'NEW_TIMER', color: 'color-blue', activateType: 'key', activateValues: ['B'], emulateType: 'key', emulateValues: ['C'], baseWait: 1.0, baseDuration: 1.0, holdToActivate: false, canStop: false, loop: false, events: [] }); } 
    else if (type === 'input') { tracksData.push({ id: newId, guid: generateUUID(), type: 'input', name: 'NEW_INPUT', color: 'color-orange', activateType: null, activateValues: [], emulateType: 'key', emulateValues: ['NewKey'], inputType: 'finite', clips: [{ start: 0, duration: 1.0 }], events: [] }); } 
    else if (type === 'wheel') { tracksData.push({ id: newId, guid: generateUUID(), type: 'wheel', name: 'NEW_WHEEL', color: 'color-purple', activateType: 'key', activateValues: ['UpArrow'], emulateType: 'key', emulateValues: ['DownArrow'], period: 2.0, isToggle: false, angleData: [] }); } 
    else if (type === 'angle') { tracksData.push({ id: newId, guid: generateUUID(), type: 'angle', name: 'NEW_SENSOR', color: 'color-yellow', activateType: 'key', activateValues: [], emulateType: 'key', emulateValues: ['C'], targetTrackId: null, minAngle: 0, maxAngle: 90, holdToActivate: false, isToggle: false, monitorPeriods: [], activePeriods: [] }); }
    simulate(); renderTracks();
}

function deleteTrack() { 
    tracksData = tracksData.filter(t => t.id !== editingTrackId); 
    closeModal(); simulate(); renderTracks(); 
}

function duplicateTrack() {
    const trackIndex = tracksData.findIndex(t => t.id === editingTrackId);
    if (trackIndex === -1) return;
    const track = tracksData[trackIndex];
    
    const newId = tracksData.length > 0 ? Math.max(...tracksData.map(t => t.id)) + 1 : 1;
    const newTrack = JSON.parse(JSON.stringify(track)); 
    newTrack.id = newId;
    newTrack.guid = generateUUID(); 
    newTrack.name = newTrack.name + '_copy';
    
    tracksData.splice(trackIndex + 1, 0, newTrack);
    closeModal(); simulate(); renderTracks();
}

function exportData() {
    let xml = '<?xml version="1.0" encoding="utf-8"?>\n';
    xml += '<!--Besiege machine save file.-->\n';
    xml += '<Machine version="1" bsgVersion="1.4" name="logics">\n';
    xml += '  <Global>\n';
    xml += '    <Position x="0" y="5.05" z="0" />\n';
    xml += '    <Rotation x="0" y="0" z="0" w="1" />\n';
    xml += '  </Global>\n';
    xml += '  <Data>\n';
    xml += '    <StringArray key="requiredMods" />\n';
    xml += '  </Data>\n';
    xml += '  <Blocks>\n';
    
    let xPosTimer = 0;
    let xPosWheel = 0;
    let coords = {};
    let wheelCoords = {};
    let wheelSensorCount = {};

    tracksData.forEach(track => {
        if (track.type === 'timer') {
            coords[track.id] = { x: xPosTimer, y: 0, z: 0.5 };
            xPosTimer += 1;
        } else if (track.type === 'wheel' || track.type === 'large_wheel') {
            coords[track.id] = { x: xPosWheel, y: 4, z: 0.5 };
            wheelCoords[track.id] = { x: xPosWheel, y: 4, z: 0.5 };
            wheelSensorCount[track.id] = [];
            xPosWheel += 3;
        }
    });

    tracksData.forEach(track => {
        if (track.type === 'angle' || track.type === 'length_detector') {
            if (track.targetTrackId && wheelCoords[track.targetTrackId]) {
                if (!wheelSensorCount[track.targetTrackId]) wheelSensorCount[track.targetTrackId] = [];
                
                let a1 = track.minAngle;
                let a2 = track.maxAngle;
                let diff = Math.abs(a1 - a2);
                let midAngle = (a1 + a2) / 2;
                
                if (diff > 180) {
                    midAngle = (a1 + a2 + 360) / 2;
                    if (midAngle >= 360) midAngle -= 360;
                    diff = 360 - diff;
                }
                
                track._midAngle = midAngle;
                
                let radMid = midAngle * Math.PI / 180;
                let halfDiffRad = (diff / 2) * Math.PI / 180;

                let targetAngles = [0, 90, 180, 270];
                let bestIdx = -1;
                let minDiff = 999;
                
                for (let i = 0; i < 4; i++) {
                    if (wheelSensorCount[track.targetTrackId].includes(i)) continue;
                    let d = Math.abs(midAngle - targetAngles[i]);
                    if (d > 180) d = 360 - d;
                    if (d < minDiff) { minDiff = d; bestIdx = i; }
                }

                if (bestIdx !== -1) {
                    wheelSensorCount[track.targetTrackId].push(bestIdx);
                    let wPos = wheelCoords[track.targetTrackId];
                    
                    if (track.type === 'angle') {
                        let angOffsets = [
                            { dx: 0, dy: 1, dz: 1.0 },
                            { dx: -1, dy: 0, dz: 1.0 },
                            { dx: 0, dy: -1, dz: 1.0 },
                            { dx: 1, dy: 0, dz: 1.0 }
                        ];
                        coords[track.id] = { x: wPos.x + angOffsets[bestIdx].dx, y: wPos.y + angOffsets[bestIdx].dy, z: wPos.z + angOffsets[bestIdx].dz };
                    } else {
                        let dx = 0.5 * Math.sin(radMid);
                        let dy = 0.5 * Math.cos(radMid);
                        
                        coords[track.id] = { x: wPos.x + dx, y: wPos.y + dy, z: wPos.z + 0.4 };

                        track._ldLocalEnd = {
                            x: -dx,
                            y: -1.0 - dy,
                            z: -0.9
                        };

                        let boundDx = 0.5 * Math.sin(halfDiffRad);
                        let boundDy = 0.5 * Math.cos(halfDiffRad);
                        let exactLength = Math.sqrt(Math.pow(-boundDx, 2) + Math.pow(-1.0 - boundDy, 2) + Math.pow(-0.9, 2));
                        track._ldThreshold = Math.round(exactLength * 1000) / 1000;
                    }
                } else {
                    coords[track.id] = { x: xPosTimer, y: 0, z: 0.5 };
                    xPosTimer += 1;
                }
            } else {
                coords[track.id] = { x: xPosTimer, y: 0, z: 0.5 };
                xPosTimer += 1;
            }
        }
    });

    tracksData.forEach(track => {
        if (track.type === 'input') return;

        let blockId = 66; 
        if (track.type === 'wheel') blockId = 2;
        if (track.type === 'large_wheel') blockId = 46;
        if (track.type === 'angle') blockId = 69;
        if (track.type === 'length_detector') blockId = 75; 
        
        let pos = coords[track.id];

        if (track.type === 'wheel' || track.type === 'large_wheel') {
            xml += `    <Block id="63" guid="${generateUUID()}">\n`;
            xml += `      <Transform>\n`;
            xml += `        <Position x="${pos.x}" y="1.5" z="0" />\n`;
            xml += `        <Rotation x="-0.7071068" y="0" z="0" w="0.7071068" />\n`;
            xml += `        <Scale x="1" y="1" z="1" />\n`;
            xml += `      </Transform>\n`;
            xml += `      <Data>\n`;
            xml += `        <Integer key="bmt-version">1</Integer>\n`;
            xml += `        <Integer key="bmt-ExchangeMenu">0</Integer>\n`;
            xml += `        <Boolean key="bmt-Exchange">False</Boolean>\n`;
            xml += `        <Integer key="bmt-Group">0</Integer>\n`;
            xml += `        <Boolean key="bmt-change-length">False</Boolean>\n`;
            xml += `        <Integer key="length">3</Integer>\n`;
            xml += `      </Data>\n`;
            xml += `    </Block>\n`;

            xml += `    <Block id="57" guid="${generateUUID()}">\n`;
            xml += `      <Transform>\n`;
            xml += `        <Position x="${pos.x}" y="3" z="0" />\n`;
            xml += `        <Rotation x="0" y="0" z="0" w="1" />\n`;
            xml += `        <Scale x="1" y="1" z="1" />\n`;
            xml += `      </Transform>\n`;
            xml += `      <Data>\n`;
            xml += `        <StringArray key="bmt-unpin">\n`;
            xml += `          <String>P</String>\n`;
            xml += `        </StringArray>\n`;
            xml += `        <Boolean key="bmt-hide-visual">False</Boolean>\n`;
            xml += `        <Boolean key="bmt-pin-all-hit">False</Boolean>\n`;
            xml += `        <Integer key="bmt-Group">0</Integer>\n`;
            xml += `      </Data>\n`;
            xml += `    </Block>\n`;
        }

        xml += `    <Block id="${blockId}" guid="${track.guid}">\n`;
        xml += `      <Transform>\n`;
        
        if (track.type === 'wheel' || track.type === 'large_wheel') {
            xml += `        <Position x="${pos.x}" y="4" z="0.4999998" />\n`;
            xml += `        <Rotation x="5.960464E-08" y="0" z="0" w="1" />\n`;
        } else {
            xml += `        <Position x="${pos.x}" y="${pos.y}" z="${pos.z}" />\n`;
            xml += `        <Rotation x="0" y="0" z="0" w="1" />\n`;
        }
        
        xml += `        <Scale x="1" y="1" z="1" />\n`;
        xml += `      </Transform>\n`;
        xml += `      <Data>\n`;

        const buildKeyData = (keyName, type, vals) => {
            if (!vals || vals.length === 0) return;
            xml += `        <StringArray key="${keyName}">\n`;
            if (type === 'var') {
                xml += `          <String>None</String>\n`;
                xml += `          <String>Message=${vals.join(';')}</String>\n`;
                xml += `          <String>Use=True</String>\n`;
            } else {
                vals.forEach(v => {
                    xml += `          <String>${v}</String>\n`;
                });
            }
            xml += `        </StringArray>\n`;
        };

        if (track.type === 'timer') {
            buildKeyData('bmt-activate', track.activateType, track.activateValues);
            buildKeyData('bmt-emulate', track.emulateType, track.emulateValues);
            xml += `        <Boolean key="bmt-automatic">False</Boolean>\n`;
            xml += `        <Boolean key="bmt-hold-to-activate">${track.holdToActivate ? 'True' : 'False'}</Boolean>\n`;
            xml += `        <Boolean key="bmt-can-stop">${track.canStop ? 'True' : 'False'}</Boolean>\n`;
            xml += `        <Boolean key="bmt-loop">${track.loop ? 'True' : 'False'}</Boolean>\n`;
            xml += `        <Single key="bmt-wait">${track.baseWait}</Single>\n`;
            xml += `        <Single key="bmt-emulation-time">${track.baseDuration}</Single>\n`;
            xml += `        <Integer key="bmt-ExchangeMenu">0</Integer>\n`;
            xml += `        <Boolean key="bmt-Exchange">False</Boolean>\n`;
            xml += `        <Integer key="bmt-Group">0</Integer>\n`;
        } 
        else if (track.type === 'wheel' || track.type === 'large_wheel') {
            let baseRpm = track.type === 'wheel' ? 99.00 : 96.36;
            let calcSpeed = 60 / (track.period * baseRpm);

            xml += `        <Integer key="bmt-version">1</Integer>\n`;
            xml += `        <Single key="bmt-speed">${calcSpeed}</Single>\n`;
            xml += `        <Single key="bmt-acceleration">Infinity</Single>\n`;
            xml += `        <Boolean key="bmt-automatic">False</Boolean>\n`;
            xml += `        <Boolean key="bmt-toggle-mode">${track.isToggle ? 'True' : 'False'}</Boolean>\n`;
            xml += `        <Boolean key="bmt-auto-brake">True</Boolean>\n`;
            buildKeyData('bmt-forward', track.activateType, track.activateValues);
            buildKeyData('bmt-backward', track.emulateType, track.emulateValues);
            xml += `        <Boolean key="bmt-opt-collider">True</Boolean>\n`;
            xml += `        <Single key="bmt-contact">0.1</Single>\n`;
            xml += `        <Integer key="bmt-ExchangeMenu">0</Integer>\n`;
            xml += `        <Boolean key="bmt-Exchange">False</Boolean>\n`;
            xml += `        <Integer key="bmt-Group">0</Integer>\n`;
            
            if (track.type === 'wheel') {
                xml += `        <Boolean key="flipped">False</Boolean>\n`;
            } else {
                xml += `        <Boolean key="flipped">True</Boolean>\n`;
            }
        }
        else if (track.type === 'angle') {
            buildKeyData('bmt-activate', track.activateType, track.activateValues);
            buildKeyData('bmt-emulate', track.emulateType, track.emulateValues);
            xml += `        <Boolean key="bmt-non-automatic">${track.isToggle ? 'True' : 'False'}</Boolean>\n`;
            xml += `        <Boolean key="bmt-hold-to-activate">${track.holdToActivate ? 'True' : 'False'}</Boolean>\n`;
            xml += `        <Boolean key="bmt-reverse">False</Boolean>\n`;
            xml += `        <Integer key="bmt-alignment">0</Integer>\n`;
            xml += `        <Single key="bmt-start-a">${track.minAngle}</Single>\n`;
            xml += `        <Single key="bmt-end-a">${track.maxAngle}</Single>\n`;
            xml += `        <Integer key="bmt-ExchangeMenu">0</Integer>\n`;
            xml += `        <Boolean key="bmt-Exchange">False</Boolean>\n`;
            xml += `        <Integer key="bmt-Group">0</Integer>\n`;
        }
        else if (track.type === 'length_detector') {
            buildKeyData('bmt-activate', track.activateType, track.activateValues);
            buildKeyData('bmt-emulate', track.emulateType, track.emulateValues);
            xml += `        <Boolean key="bmt-non-automatic">${track.isToggle ? 'True' : 'False'}</Boolean>\n`;
            xml += `        <Boolean key="bmt-hold-to-activate">${track.holdToActivate ? 'True' : 'False'}</Boolean>\n`;
            xml += `        <Boolean key="bmt-reverse">False</Boolean>\n`;
            xml += `        <Boolean key="bmt-hide">False</Boolean>\n`;
            
            let thresh = track._ldThreshold ? track._ldThreshold : 1.1;
            xml += `        <Single key="bmt-length">${thresh}</Single>\n`;
            
            xml += `        <Integer key="bmt-Group">0</Integer>\n`;
            xml += `        <Boolean key="bmt-adjust-by-percentage">False</Boolean>\n`;
            xml += `        <Single key="bmt-length-percentage">100</Single>\n`;
            xml += `        <Vector3 key="start-position">\n          <X>0</X>\n          <Y>0</Y>\n          <Z>0</Z>\n        </Vector3>\n`;
            
            let eX = track._ldLocalEnd ? track._ldLocalEnd.x : 0;
            let eY = track._ldLocalEnd ? track._ldLocalEnd.y : -1.0;
            let eZ = track._ldLocalEnd ? track._ldLocalEnd.z : -0.9;
            xml += `        <Vector3 key="end-position">\n          <X>${eX}</X>\n          <Y>${eY}</Y>\n          <Z>${eZ}</Z>\n        </Vector3>\n`;
            
            let rZ = track._midAngle !== undefined ? -track._midAngle : 0;
            
            xml += `        <Vector3 key="start-rotation">\n          <X>0</X>\n          <Y>0</Y>\n          <Z>${rZ}</Z>\n        </Vector3>\n`;
            xml += `        <Vector3 key="end-rotation">\n          <X>0</X>\n          <Y>0</Y>\n          <Z>${rZ}</Z>\n        </Vector3>\n`;
        }

        xml += `      </Data>\n`;
        xml += `    </Block>\n`;
    });

    xml += '  </Blocks>\n';
    xml += '</Machine>\n';

    const blob = new Blob([xml], {type: 'application/xml'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url; // 必須！

    const now = new Date();
    const YY = String(now.getFullYear()).slice(-2);
    const MM = String(now.getMonth() + 1).padStart(2, '0');
    const DD = String(now.getDate()).padStart(2, '0');
    const HH = String(now.getHours()).padStart(2, '0');
    const MIN = String(now.getMinutes()).padStart(2, '0');
    
    a.download = `logic_${YY}${MM}${DD}${HH}${MIN}.bsg`;

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

simulate(); renderRuler(); renderTracks();