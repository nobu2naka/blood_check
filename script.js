document.addEventListener('DOMContentLoaded', () => {



    const STORAGE_KEY = 'bp_tracker_data_v2';
    const OLD_STORAGE_KEY = 'bp_tracker_data';
    let bpData = {};
    let useLocalStorage = true; // Always use LocalStorage for Standalone operation



    // Chart instances
    let bpChartDataInstance = null;
    let bpChartAxisInstance = null;
    let pulseChartDataInstance = null;
    let pulseChartAxisInstance = null;

    // Create custom point style for medication (Capsule emoji)
    const capsuleIcon = document.createElement('canvas');
    capsuleIcon.width = 14;
    capsuleIcon.height = 14;
    const emojiCtx = capsuleIcon.getContext('2d');
    emojiCtx.font = '12px serif';
    emojiCtx.textAlign = 'center';
    emojiCtx.textBaseline = 'middle';
    emojiCtx.fillText('💊', 7, 7);

    // --- Global Chart Settings ---
    if (typeof Chart !== 'undefined') {
        const systemFonts = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Outfit', 'Noto Sans JP', sans-serif";
        Chart.defaults.font.family = systemFonts;
        Chart.defaults.font.size = 13;
        Chart.defaults.color = '#334155'; // slate-700
    }

    // Data Structure:
    // bpData = {
    //   "YYYY-MM-DD": {
    //     morning: { sys, dia, pul, medication: boolean, raw: { ... } },
    //     evening: { sys, dia, pul, raw: { ... } }
    //   }
    // }


    // --- DOM Elements ---
    const elements = {
        form: document.getElementById('bpForm'),
        tableBody: document.querySelector('#bpTable tbody'),
        noDataMessage: document.getElementById('noDataMessage'),
        clearBtn: document.getElementById('clearBtn'),
        exportBtn: document.getElementById('exportBtn'),
        dateInput: document.getElementById('date'),
        importFile: document.getElementById('importFile'),
        importBtn: document.getElementById('importBtn'),
        printBtn: document.getElementById('printBtn'),
        rangeFilter: document.getElementById('rangeFilter'),
        medicationCheck: document.getElementById('medication')
    };



    const { form, tableBody, noDataMessage, clearBtn, exportBtn, printBtn, rangeFilter, dateInput, importFile, importBtn, medicationCheck } = elements;
    const periodInputs = document.getElementsByName('period');

    // --- Initialization ---
    if (rangeFilter) rangeFilter.value = '1';
    initDateTimeInputs();

    // 1. Initialize charts
    try {
        if (typeof Chart === 'undefined') {
            console.error('Chart.js is not loaded');
        } else {
            initCharts();
            initScrollSync();
        }
    } catch (e) {
        console.error('Chart init failed', e);
    }

    // 2. Load data

    fetchData().then(() => {
        renderTable();
        updateChart();
    }).catch(err => {
        console.error('Fetch sequence failed', err);
    });

    // --- Event Listeners ---
    form.addEventListener('submit', handleFormSubmit);
    clearBtn.addEventListener('click', () => {
        form.reset();
        initDateTimeInputs();
    });
    exportBtn.addEventListener('click', exportData);
    printBtn.addEventListener('click', () => {
        window.print();
    });
    rangeFilter.addEventListener('change', () => {
        renderTable();
        updateChart();
    });

    // Prevent context menu (long press popup) on charts for better mobile feel
    document.querySelectorAll('canvas').forEach(canvas => {
        canvas.addEventListener('contextmenu', e => e.preventDefault());
    });

    document.querySelectorAll('input[name="chartMode"]').forEach(radio => {
        radio.addEventListener('change', () => {
            updateChart();
        });
    });

    // --- Tab Switching Logic ---
    window.setActiveTab = function (targetId) {
        const panes = document.querySelectorAll('.tab-pane');
        const buttons = document.querySelectorAll('.tab-btn');

        panes.forEach(p => {
            p.classList.toggle('active', p.id === targetId);
        });
        buttons.forEach(b => {
            b.classList.toggle('active', b.getAttribute('data-tab') === targetId);
        });

        if (targetId === 'chart-view') {
            if (typeof updateChart === 'function') updateChart();
            setTimeout(() => {
                if (bpChartDataInstance && bpChartDataInstance.resize) bpChartDataInstance.resize();
                if (pulseChartDataInstance && pulseChartDataInstance.resize) pulseChartDataInstance.resize();
            }, 200);
        }
        window.scrollTo(0, 0);
    };

    // Attach listener
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.onclick = (e) => {
            const id = btn.getAttribute('data-tab');
            if (id) window.setActiveTab(id);
        };
    });

    // Force initial state
    window.setActiveTab('chart-view');

    // Handle chart resize for printing
    window.addEventListener('beforeprint', () => {
        [bpChartDataInstance, bpChartAxisInstance, pulseChartDataInstance, pulseChartAxisInstance].forEach(chart => {
            if (chart) {
                // Adjust for print: Lower rotation and bolder font
                if (chart.options.scales.x) {
                    chart.options.scales.x.ticks.maxRotation = 45;
                    chart.options.scales.x.ticks.minRotation = 45;
                    chart.options.scales.x.ticks.font = { weight: 'bold', size: 10 };
                }
                chart.update('none');
                chart.resize();
            }
        });
    });
    window.addEventListener('afterprint', () => {
        [bpChartDataInstance, bpChartAxisInstance, pulseChartDataInstance, pulseChartAxisInstance].forEach(chart => {
            if (chart) {
                // Restore for screen
                if (chart.options.scales.x) {
                    chart.options.scales.x.ticks.maxRotation = 90;
                    chart.options.scales.x.ticks.minRotation = 90;
                    chart.options.scales.x.ticks.font = { weight: 'normal', size: 13 };
                }
                updateChart(); // Full restoration
            }
        });
    });

    // Dynamic data loading when switching periods
    document.querySelectorAll('input[name="period"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const date = dateInput.value;
            const period = e.target.value;
            // Only load if we have data for this date (editing mode context)
            if (bpData[date]) {
                loadFormData(date, period);
            }
        });
    });

    // Import Listeners
    importBtn.addEventListener('click', () => {
        if (typeof XLSX === 'undefined') {
            alert('Excelライブラリの読み込みに失敗しました。インターネット接続を確認して再読み込みしてください。');
            return;
        }
        importFile.click();
    });
    importFile.addEventListener('change', handleImport);

    tableBody.addEventListener('click', (e) => {
        if (e.target.closest('.btn-icon-delete')) {
            const btn = e.target.closest('.btn-icon-delete');
            const date = btn.dataset.date;
            if (confirm(`${date} のデータを削除しますか？`)) {
                delete bpData[date];
                deleteRecord(date); // API call
                renderTable();
                updateChart();
            }
        } else if (e.target.closest('.btn-icon-edit')) {
            const btn = e.target.closest('.btn-icon-edit');
            const date = btn.dataset.date;

            // Set date
            dateInput.value = date;

            // Determine which data to load (Morning default, or Evening if Morning empty)
            let targetPeriod = 'morning';
            if (bpData[date]) {
                if (!bpData[date].morning && bpData[date].evening) {
                    targetPeriod = 'evening';
                }
            }
            // Set radio
            document.querySelector(`input[name="period"][value="${targetPeriod}"]`).checked = true;

            // Load values
            loadFormData(date, targetPeriod);

            // Mobile: Switch to input tab
            const inputTabBtn = document.querySelector('.tab-btn[data-tab="input-view"]');
            if (inputTabBtn && window.getComputedStyle(document.querySelector('.tab-nav')).display !== 'none') {
                inputTabBtn.click();
            } else {
                // PC: Scroll to form
                document.querySelector('.input-section').scrollIntoView({ behavior: 'smooth' });
            }

            // Toggle the detail row for this entry
            // Toggle the detail row for this entry
            const row = btn.closest('tr');
            const toggleElement = row.querySelector('.date-toggle');
            if (toggleElement) {
                const targetClass = toggleElement.dataset.target;
                const detailRows = document.querySelectorAll(`.${targetClass}`);
                detailRows.forEach(r => r.classList.add('visible'));
            }

        } else if (e.target.closest('.date-toggle')) {
            const btn = e.target.closest('.date-toggle');
            const targetClass = btn.dataset.target;
            const detailRows = document.querySelectorAll(`.${targetClass}`);

            detailRows.forEach(row => {
                row.classList.toggle('visible');
            });
        }
    });

    // --- Functions ---

    function initDateTimeInputs() {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');

        dateInput.value = `${yyyy}-${mm}-${dd}`;

        // Auto-select morning/evening based on hour
        const hour = now.getHours();
        const isEvening = hour >= 15; // After 3 PM defaults to evening

        if (isEvening) {
            document.querySelector('input[name="period"][value="evening"]').checked = true;
        } else {
            document.querySelector('input[name="period"][value="morning"]').checked = true;
        }
    }

    function initScrollSync() {
        const scrollBoxes = document.querySelectorAll('.chart-scroll-box');
        if (scrollBoxes.length !== 2) return; // Need exactly 2 (BP and Pulse)

        const [bpScrollBox, pulseScrollBox] = scrollBoxes;
        let isSyncing = false; // Flag to prevent infinite loop

        bpScrollBox.addEventListener('scroll', () => {
            if (isSyncing) return;
            isSyncing = true;
            pulseScrollBox.scrollLeft = bpScrollBox.scrollLeft;
            requestAnimationFrame(() => { isSyncing = false; });
        });

        pulseScrollBox.addEventListener('scroll', () => {
            if (isSyncing) return;
            isSyncing = true;
            bpScrollBox.scrollLeft = pulseScrollBox.scrollLeft;
            requestAnimationFrame(() => { isSyncing = false; });
        });
    }

    // --- API & Persistence ---
    // Mode Detection (already declared above)


    // Initial check: if not file protocol, try to ping server. 
    // If usage is mixed, we might default to server, but failover to local.

    async function fetchData() {
        loadFromLocal();
        console.log(`Standalone Mode: Loaded ${Object.keys(bpData).length} items from LocalStorage.`);
    }

    function loadFromLocal() {
        let local = localStorage.getItem(STORAGE_KEY);

        // Migration check
        if (!local) {
            local = localStorage.getItem(OLD_STORAGE_KEY);
            if (local) {
                console.log('Migrating from old storage key...');
                localStorage.setItem(STORAGE_KEY, local);
                // Optional: localStorage.removeItem(OLD_STORAGE_KEY);
            }
        }

        if (local) {
            try {
                bpData = JSON.parse(local);
                // Ensure bpData is an object
                if (typeof bpData !== 'object' || bpData === null) bpData = {};
            } catch (e) {
                console.error('Failed to parse local data', e);
                bpData = {};
            }
        }
    }

    function saveToLocal() {
        if (!bpData) return;
        console.log('Backing up to LocalStorage...', Object.keys(bpData).length, 'keys');
        localStorage.setItem(STORAGE_KEY, JSON.stringify(bpData));
    }

    async function saveRecord(date, data) {
        saveToLocal();
    }

    async function deleteRecord(date) {
        saveToLocal();
    }

    async function saveBatch(batchData) {
        console.log('Saving batch to LocalStorage');
        saveToLocal();
    }

    // Legacy functions removed: saveData, loadData
    function handleFormSubmit(e) {
        e.preventDefault();

        const date = dateInput.value;
        const period = document.querySelector('input[name="period"]:checked').value;

        // Get values
        const sys1 = parseInt(document.getElementById('sys1').value) || 0;
        const dia1 = parseInt(document.getElementById('dia1').value) || 0;
        const pul1 = parseInt(document.getElementById('pul1').value) || 0;

        const sys2 = parseInt(document.getElementById('sys2').value) || 0;
        const dia2 = parseInt(document.getElementById('dia2').value) || 0;
        const pul2 = parseInt(document.getElementById('pul2').value) || 0;

        // Calculate Averages (Round to nearest integer)
        const avgSys = Math.round((sys1 + sys2) / 2);
        const avgDia = Math.round((dia1 + dia2) / 2);
        const avgPul = Math.round((pul1 + pul2) / 2);

        // Update Data
        if (!bpData[date]) {
            bpData[date] = {};
        }

        const entryData = {
            sys: avgSys,
            dia: avgDia,
            pul: avgPul,
            raw: {
                m1: { sys: sys1, dia: dia1, pul: pul1 },
                m2: { sys: sys2, dia: dia2, pul: pul2 }
            }
        };

        if (period === 'morning') {
            entryData.medication = medicationCheck.checked; // Save medication status for morning
        }

        bpData[date][period] = entryData;

        // Save to Server
        saveRecord(date, bpData[date]);

        // Update UI
        renderTable();
        updateChart();
        saveToLocal(); // Final save check
        console.log(`Saved entry for ${date} (${period})`);
    }

    function loadFormData(date, period) {
        if (!bpData[date] || !bpData[date][period]) return;

        const entry = bpData[date][period];
        const raw = entry.raw || {};
        const m1 = raw.m1 || {};
        const m2 = raw.m2 || {};

        document.getElementById('sys1').value = m1.sys || '';
        document.getElementById('dia1').value = m1.dia || '';
        document.getElementById('pul1').value = m1.pul || '';

        document.getElementById('sys2').value = m2.sys || '';
        document.getElementById('dia2').value = m2.dia || '';
        document.getElementById('pul2').value = m2.pul || '';

        if (period === 'morning' && entry.medication !== undefined) {
            medicationCheck.checked = entry.medication;
        }
    }

    function deleteEntry(date) {
        if (!bpData[date]) return;
        if (confirm(`${date} の全データを削除しますか？`)) {
            delete bpData[date];
            deleteRecord(date); // Use API/Local logic
            renderTable();
            updateChart();
        }
    }

    function getFilteredDates() {
        const allDates = Object.keys(bpData).sort();
        if (rangeFilter.value === 'all') return allDates;

        const months = parseInt(rangeFilter.value);
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - months);
        // Normalize today to start of day for comparison
        cutoff.setHours(0, 0, 0, 0);

        return allDates.filter(dateStr => {
            const d = new Date(dateStr);
            return d >= cutoff;
        });
    }

    function renderTable() {
        tableBody.innerHTML = '';

        const dates = getFilteredDates().reverse(); // Newest first

        if (dates.length === 0) {
            noDataMessage.style.display = 'block';
            return;
        } else {
            noDataMessage.style.display = 'none';
        }

        dates.forEach((date, i) => {
            const entry = bpData[date] || {};
            const m = entry.morning || {};
            const e = entry.evening || {};

            const mSys = m.sys || '-';
            const mDia = m.dia || '-';
            const mPul = m.pul || '-';
            const mMed = m.medication ? '<span class="med-icon" title="服薬あり">💊</span>' : '';

            const eSys = e.sys || '-';
            const eDia = e.dia || '-';
            const ePul = e.pul || '-';

            const detailClass = `detail-group-${i}`;

            // Check if this is today's date
            const today = new Date();
            const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            const isToday = date === todayStr;

            // Day of week calculation
            const dayLabels = ['日', '月', '火', '水', '木', '金', '土'];
            const d = new Date(date);
            const dayOfWeek = dayLabels[d.getDay()];
            const isSunday = d.getDay() === 0;

            // Main Row
            const row = document.createElement('tr');
            row.className = 'main-row';
            row.innerHTML = `
                <td class="date-toggle cell-date" data-target="${detailClass}" data-label="日付" style="cursor: pointer; user-select: none; color: var(--primary-color); font-weight: 500;">
                    ${date} <span class="${isSunday ? 'sunday-text' : ''}" style="color: ${isSunday ? '#ef4444' : 'var(--text-secondary)'}; font-size: 0.85em;">(${dayOfWeek})</span>
                </td>
                <td class="cell-m-sys" data-label="朝・最高" style="${mSys >= 135 ? 'color:var(--accent-red); font-weight:bold;' : ''}">${mSys}</td>
                <td class="cell-m-dia" data-label="朝・最低" style="${mDia >= 85 ? 'color:var(--accent-red); font-weight:bold;' : ''}">${mDia}</td>
                <td class="cell-m-pul" data-label="朝・脈拍">${mPul}</td>
                <td class="cell-e-sys" data-label="晩・最高" style="${eSys >= 135 ? 'color:var(--accent-red); font-weight:bold;' : ''}">${eSys}</td>
                <td class="cell-e-dia" data-label="晩・最低" style="${eDia >= 85 ? 'color:var(--accent-red); font-weight:bold;' : ''}">${eDia}</td>
                <td class="cell-e-pul" data-label="晩・脈拍">${ePul}</td>
                <td class="cell-med" data-label="服薬">${mMed}</td>
                <td class="col-actions cell-edit" data-label="編集">
                    <button class="btn-icon-edit" data-date="${date}" title="データを編集">✏️</button>
                </td>
            `;
            tableBody.appendChild(row);

            // Raw Data Helpers
            const rawM = (m.raw) ? m.raw : { m1: {}, m2: {} };
            const rawE = (e.raw) ? e.raw : { m1: {}, m2: {} };
            const safeVal = (val) => val || '-';

            // Detail Row 1 (1st Measurement)
            const detailRow1 = document.createElement('tr');
            detailRow1.className = `detail-row ${detailClass}`;
            // Smaller font, lighter color, narrower height
            const detailStyle = 'font-size: 0.85rem; color: #64748b; background-color: #f8fafc; height: 1.8rem;';

            detailRow1.innerHTML = `
                <td style="${detailStyle} padding-left: 2rem;">1回目</td>
                <td style="${detailStyle}">${safeVal(rawM.m1.sys)}</td>
                <td style="${detailStyle}">${safeVal(rawM.m1.dia)}</td>
                <td style="${detailStyle}">${safeVal(rawM.m1.pul)}</td>
                <td style="${detailStyle}">${safeVal(rawE.m1.sys)}</td>
                <td style="${detailStyle}">${safeVal(rawE.m1.dia)}</td>
                <td style="${detailStyle}">${safeVal(rawE.m1.pul)}</td>
                <td style="${detailStyle}"></td>
                <td style="${detailStyle}"></td>
            `;
            tableBody.appendChild(detailRow1);

            // Detail Row 2 (2nd Measurement)
            const detailRow2 = document.createElement('tr');
            detailRow2.className = `detail-row ${detailClass}`;
            detailRow2.innerHTML = `
                <td style="${detailStyle} padding-left: 2rem;">2回目</td>
                <td style="${detailStyle}">${safeVal(rawM.m2.sys)}</td>
                <td style="${detailStyle}">${safeVal(rawM.m2.dia)}</td>
                <td style="${detailStyle}">${safeVal(rawM.m2.pul)}</td>
                <td style="${detailStyle}">${safeVal(rawE.m2.sys)}</td>
                <td style="${detailStyle}">${safeVal(rawE.m2.dia)}</td>
                <td style="${detailStyle}">${safeVal(rawE.m2.pul)}</td>
                <td style="${detailStyle}"></td>
                <td style="${detailStyle}"></td>
            `;
            tableBody.appendChild(detailRow2);
        });
    }
    // --- Chart Logic ---

    function initCharts() {
        const isMobile = window.innerWidth <= 600;
        const commonOptions = {
            responsive: true,
            maintainAspectRatio: false,
            // Only respond to these events to avoid "sticky" click behavior on mobile
            events: ['mousemove', 'mouseout', 'touchstart', 'touchmove', 'touchend'],
            interaction: {
                mode: 'index',
                intersect: false,
                axis: 'x'
            },
            plugins: {
                legend: { display: false },
                title: { display: false },
                tooltip: {
                    enabled: false
                }
            },
            onHover: (event, activeElements) => {
                const callout = document.getElementById('chart-callout');
                if (!callout) return;

                if (!activeElements || activeElements.length === 0) {
                    callout.classList.remove('active');
                    callout.innerHTML = `<span class="callout-hint">${isMobile ? 'グラフをタッチで詳細表示' : 'ポイントにマウスを重ねて表示'}</span>`;
                    return;
                }

                callout.classList.add('active');
                const chart = activeElements[0].element.$context.chart;
                const index = activeElements[0].index;
                const labels = chart.data.labels;
                const datasets = chart.data.datasets;

                let html = `<div class="callout-data">`;
                html += `<span>${labels[index]}</span>`;

                datasets.forEach(ts => {
                    const val = ts.data[index];
                    if (val !== null && val !== undefined) {
                        html += `<span>${ts.label} ${val}</span>`;
                    }
                });
                html += `</div>`;
                callout.innerHTML = html;
            },
            layout: {
                padding: 0
            }
        };

        // --- BP Charts ---

        // 1. Data Chart (Scrollable, No Y Axis)
        const ctxBP = document.getElementById('bpChart').getContext('2d');
        bpChartDataInstance = new Chart(ctxBP, {
            type: 'line',
            data: { labels: [], datasets: [] }, // Populated in updateChart
            options: {
                ...commonOptions,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        display: true,
                        position: 'bottom',
                        afterFit: (scale) => { scale.height = 70; },
                        ticks: {
                            autoSkip: true,
                            maxRotation: window.innerWidth <= 600 ? 45 : 90,
                            minRotation: window.innerWidth <= 600 ? 45 : 90,
                            padding: 0,
                            font: {
                                size: window.innerWidth <= 600 ? 11 : 13
                            }
                        },
                        grid: {
                            display: true,
                            drawOnChartArea: true,
                            drawTicks: true,
                            color: '#e2e8f0'
                        },
                        border: {
                            display: false
                        }
                    },
                    y: {
                        display: true,
                        min: 50,
                        max: 180,
                        beginAtZero: false,
                        ticks: {
                            display: false,
                            stepSize: 10
                        },
                        grid: {
                            drawTicks: false,
                            color: (ctx) => ctx.tick.value === 50 ? '#1e293b' : '#e2e8f0',
                            lineWidth: (ctx) => ctx.tick.value === 50 ? 3 : 1,
                            z: 1
                        },
                        border: {
                            display: false
                        }
                    }
                }
            }
        });

        // 2. Axis Chart (Fixed, No X Axis, No Data visible)
        const ctxBPAxis = document.getElementById('bpChartAxis').getContext('2d');
        bpChartAxisInstance = new Chart(ctxBPAxis, {
            type: 'line',
            data: { labels: [], datasets: [] },
            options: {
                ...commonOptions,
                plugins: { legend: { display: false }, tooltip: { enabled: false } },
                scales: {
                    x: {
                        display: true,
                        afterFit: (scale) => { scale.height = 70; }, // Match data chart height
                        ticks: { display: false },
                        grid: { display: false },
                        border: {
                            display: true,
                            width: 3,
                            color: '#1e293b'
                        }
                    },
                    y: {
                        display: true,
                        position: 'left',
                        min: 50,
                        max: 180,
                        beginAtZero: false,
                        afterFit: (axis) => { axis.width = 49; },
                        ticks: {
                            stepSize: 10,
                            padding: 5
                        },
                        grid: {
                            drawOnChartArea: false
                        },
                        border: {
                            display: true,
                            width: 3,
                            color: '#1e293b'
                        }
                    }
                }
            }
        });

        // --- Pulse Charts ---

        // 3. Pulse Data Chart
        const ctxPulse = document.getElementById('pulseChart').getContext('2d');
        pulseChartDataInstance = new Chart(ctxPulse, {
            type: 'line',
            data: { labels: [], datasets: [] },
            options: {
                ...commonOptions,
                scales: {
                    x: {
                        display: true,
                        position: 'bottom',
                        afterFit: (scale) => { scale.height = 70; },
                        ticks: {
                            autoSkip: true,
                            maxRotation: window.innerWidth <= 600 ? 45 : 90,
                            minRotation: window.innerWidth <= 600 ? 45 : 90,
                            padding: 0,
                            font: {
                                size: window.innerWidth <= 600 ? 11 : 13
                            }
                        },
                        grid: {
                            display: true,
                            drawOnChartArea: true,
                            drawTicks: true,
                            color: '#e2e8f0'
                        },
                        border: {
                            display: false
                        }
                    },
                    y: {
                        display: true,
                        min: 50,
                        max: 100,
                        beginAtZero: false,
                        ticks: {
                            display: false,
                            stepSize: 10
                        },
                        grid: {
                            drawTicks: false,
                            color: (ctx) => ctx.tick.value === 50 ? '#1e293b' : '#e2e8f0',
                            lineWidth: (ctx) => ctx.tick.value === 50 ? 3 : 1,
                            z: 1
                        },
                        border: {
                            display: false
                        }
                    }
                }
            }
        });

        // 4. Pulse Axis Chart
        const ctxPulseAxis = document.getElementById('pulseChartAxis').getContext('2d');
        pulseChartAxisInstance = new Chart(ctxPulseAxis, {
            type: 'line',
            data: { labels: [], datasets: [] },
            options: {
                ...commonOptions,
                plugins: { legend: { display: false }, tooltip: { enabled: false } },
                scales: {
                    x: {
                        display: true,
                        afterFit: (scale) => { scale.height = 70; },
                        ticks: { display: false },
                        grid: { display: false },
                        border: {
                            display: true,
                            width: 3,
                            color: '#1e293b'
                        }
                    },
                    y: {
                        display: true,
                        position: 'left',
                        min: 50,
                        max: 100,
                        beginAtZero: false,
                        afterFit: (axis) => { axis.width = 49; },
                        ticks: {
                            stepSize: 10,
                            padding: 5
                        },
                        grid: {
                            drawOnChartArea: false
                        },
                        border: {
                            display: true,
                            width: 3,
                            color: '#1e293b'
                        }
                    }
                }
            }
        });

        updateChart();
    }

    function updateChart() {
        if (!bpChartDataInstance) return;

        // 1. Get Mode
        const modeRadio = document.querySelector('input[name="chartMode"]:checked');
        const mode = modeRadio ? modeRadio.value : 'unified';

        const displayDates = getFilteredDates();

        if (displayDates.length === 0) {
            console.log('UpdateChart: No data. Clearing charts...');
            [bpChartDataInstance, bpChartAxisInstance, pulseChartDataInstance, pulseChartAxisInstance].forEach(chart => {
                if (chart) {
                    chart.data.labels = [];
                    chart.data.datasets = [];
                    chart.update();
                }
            });
            noDataMessage.style.display = 'block';
            return;
        }
        noDataMessage.style.display = 'none';

        // Stabilized axis ranges
        const maxBP = 180;
        const minBP = 50;
        const maxPul = 100;
        const minPul = 50;

        // Colors
        const colSysM = '#ff9f43'; const colSysE = '#d35400';
        const colDiaM = '#54a0ff'; const colDiaE = '#0984e3';
        const colPulM = '#10b981'; const colPulE = '#047857';

        // Arrays for Chart Data
        let labels = [];
        let datasetsBP = [];
        let datasetsPul = [];

        if (mode === 'unified') {
            const sysData = [];
            const diaData = [];
            const pulData = [];
            const medData = [];
            const tSys = [];
            const tDia = [];
            const pointStyles = [];
            const sysPointColors = [];
            const diaPointColors = [];
            const pulPointColors = [];

            displayDates.forEach(date => {
                const day = bpData[date];
                if (!day || typeof day !== 'object') return;

                const parts = String(date).trim().split('-');
                const shortDate = (parts.length >= 3) ? `${parts[1]}/${parts[2]}` : date;

                // --- Morning ---
                const m = day.morning || {};
                labels.push(`${shortDate} 朝`);

                sysData.push(m.sys ? parseInt(m.sys) : null);
                diaData.push(m.dia ? parseInt(m.dia) : null);
                pulData.push(m.pul ? parseInt(m.pul) : null);
                pointStyles.push('circle');

                sysPointColors.push(colSysM);
                diaPointColors.push(colDiaM);
                pulPointColors.push(colPulM);

                if (m.medication) {
                    medData.push(maxBP - 8);
                } else {
                    medData.push(null);
                }
                tSys.push(125);
                tDia.push(75);

                // --- Evening ---
                const e = day.evening || {};
                labels.push(`${shortDate} 晩`);

                sysData.push(e.sys ? parseInt(e.sys) : null);
                diaData.push(e.dia ? parseInt(e.dia) : null);
                pulData.push(e.pul ? parseInt(e.pul) : null);
                pointStyles.push('rectRot');

                sysPointColors.push(colSysE);
                diaPointColors.push(colDiaE);
                pulPointColors.push(colPulE);

                medData.push(null);
                tSys.push(125);
                tDia.push(75);
            });

            datasetsBP = [
                {
                    label: '最高血圧',
                    data: sysData,
                    borderColor: '#ff9f43',
                    backgroundColor: '#ff9f43',
                    pointBackgroundColor: sysPointColors,
                    pointBorderColor: sysPointColors,
                    tension: 0.1,
                    pointStyle: pointStyles,
                    pointRadius: 4,
                    spanGaps: true
                },
                {
                    label: '最低血圧',
                    data: diaData,
                    borderColor: '#54a0ff',
                    backgroundColor: '#54a0ff',
                    pointBackgroundColor: diaPointColors,
                    pointBorderColor: diaPointColors,
                    tension: 0.1,
                    pointStyle: pointStyles,
                    pointRadius: 4,
                    spanGaps: true
                },
                { label: '目標 (125)', data: tSys, borderColor: '#9ca3af', borderWidth: 1, borderDash: [5, 5], pointRadius: 0 },
                { label: '目標 (75)', data: tDia, borderColor: '#9ca3af', borderWidth: 1, borderDash: [5, 5], pointRadius: 0 },
                {
                    label: '💊 服薬',
                    data: medData,
                    borderColor: '#10b981',
                    backgroundColor: '#10b981',
                    pointRadius: 7,
                    pointStyle: capsuleIcon,
                    showLine: false,
                    spanGaps: false
                }
            ];

            datasetsPul = [
                {
                    label: '脈拍',
                    data: pulData,
                    borderColor: '#10b981',
                    backgroundColor: '#10b981',
                    pointBackgroundColor: pulPointColors,
                    pointBorderColor: pulPointColors,
                    tension: 0.1,
                    pointStyle: pointStyles,
                    pointRadius: 4,
                    spanGaps: true
                }
            ];

        } else {
            // --- Separate Mode (Morning / Evening Lines) ---
            const mSys = [], mDia = [], mPul = [];
            const eSys = [], eDia = [], ePul = [];
            const medData = [];
            const tSys = [], tDia = [];

            displayDates.forEach(date => {
                const day = bpData[date];
                if (!day || typeof day !== 'object') return;

                const parts = String(date).trim().split('-');
                const shortDate = (parts.length >= 3) ? `${parts[1]}/${parts[2]}` : date;
                labels.push(shortDate);

                const m = day.morning || {};
                const e = day.evening || {};

                mSys.push(m.sys || null);
                mDia.push(m.dia || null);
                mPul.push(m.pul || null);

                eSys.push(e.sys || null);
                eDia.push(e.dia || null);
                ePul.push(e.pul || null);

                medData.push(m.medication ? maxBP - 8 : null);

                tSys.push(125);
                tDia.push(75);
            });

            datasetsBP = [
                {
                    label: '朝・最高',
                    data: mSys,
                    borderColor: colSysM,
                    backgroundColor: colSysM,
                    tension: 0.1,
                    pointStyle: 'circle',
                    pointRadius: 4,
                    spanGaps: true
                },
                {
                    label: '晩・最高',
                    data: eSys,
                    borderColor: colSysE,
                    backgroundColor: colSysE,
                    tension: 0.1,
                    pointStyle: 'rectRot',
                    pointRadius: 4,
                    spanGaps: true
                },
                {
                    label: '朝・最低',
                    data: mDia,
                    borderColor: colDiaM,
                    backgroundColor: colDiaM,
                    tension: 0.1,
                    pointStyle: 'circle',
                    pointRadius: 4,
                    spanGaps: true
                },
                {
                    label: '晩・最低',
                    data: eDia,
                    borderColor: colDiaE,
                    backgroundColor: colDiaE,
                    tension: 0.1,
                    pointStyle: 'rectRot',
                    pointRadius: 4,
                    spanGaps: true
                },
                { label: '目標 (125)', data: tSys, borderColor: '#9ca3af', borderWidth: 1, borderDash: [5, 5], pointRadius: 0 },
                { label: '目標 (75)', data: tDia, borderColor: '#9ca3af', borderWidth: 1, borderDash: [5, 5], pointRadius: 0 },
                {
                    label: '💊 服薬',
                    data: medData,
                    borderColor: '#10b981',
                    pointStyle: capsuleIcon,
                    pointRadius: 7,
                    showLine: false
                }
            ];

            datasetsPul = [
                {
                    label: '朝・脈拍',
                    data: mPul,
                    borderColor: colPulM,
                    backgroundColor: colPulM,
                    tension: 0.1,
                    pointStyle: 'circle',
                    spanGaps: true
                },
                {
                    label: '晩・脈拍',
                    data: ePul,
                    borderColor: colPulE,
                    backgroundColor: colPulE,
                    tension: 0.1,
                    pointStyle: 'rectRot',
                    spanGaps: true
                }
            ];
        }

        // --- Resize Logic ---
        const scrollBox = document.querySelectorAll('.chart-scroll-box');
        const scrollInner = document.querySelectorAll('.chart-scroll-video-inner');
        const containerWidth = scrollBox[0] ? scrollBox[0].clientWidth : 800;

        // Calculate total points for width logic
        // Unified: 2 points per day. Separate: 1 point per day.
        const effectivePoints = labels.length;
        // Denominator for 1-month fit. Unified: ~62 pts. Separate: ~31 pts.
        const fitDenominator = (mode === 'unified') ? 62 : 31;

        const finalDataPointWidth = containerWidth / fitDenominator;
        const requiredWidth = Math.max(containerWidth, effectivePoints * finalDataPointWidth);

        scrollInner.forEach(el => {
            el.style.width = requiredWidth + 'px';
        });

        // --- Apply to Charts ---
        bpChartDataInstance.data.labels = labels;
        bpChartDataInstance.data.datasets = datasetsBP;

        // Sync Scales
        bpChartDataInstance.options.scales.y.min = minBP;
        bpChartDataInstance.options.scales.y.max = maxBP;
        bpChartDataInstance.update();

        bpChartAxisInstance.data.labels = labels;
        bpChartAxisInstance.options.scales.y.min = minBP;
        bpChartAxisInstance.options.scales.y.max = maxBP;
        bpChartAxisInstance.update();

        if (pulseChartDataInstance) {
            pulseChartDataInstance.data.labels = labels;
            pulseChartDataInstance.data.datasets = datasetsPul;
            pulseChartDataInstance.options.scales.y.min = minPul;
            pulseChartDataInstance.options.scales.y.max = maxPul;
            pulseChartDataInstance.update();
        }

        if (pulseChartAxisInstance) {
            pulseChartAxisInstance.data.labels = labels;
            pulseChartAxisInstance.options.scales.y.min = minPul; // Sync min
            pulseChartAxisInstance.options.scales.y.max = maxPul; // Sync max
            pulseChartAxisInstance.update();
        }

        // --- 6. Auto-scroll & Force Persistence ---
        if (useLocalStorage) saveToLocal();

        const scrollBoxes = document.querySelectorAll('.chart-scroll-box');
        scrollBoxes.forEach(box => {
            setTimeout(() => {
                box.scrollLeft = box.scrollWidth;
            }, 100);
        });
    }

    async function exportData() {
        const dataStr = JSON.stringify(bpData, null, 2);
        const fileName = `bp_data_v2_${new Date().toISOString().slice(0, 10)}.json`;

        // Modern browsers with File System Access API
        if ('showSaveFilePicker' in window) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: fileName,
                    types: [{
                        description: 'JSON Files',
                        accept: { 'application/json': ['.json'] },
                    }],
                });
                const writable = await handle.createWritable();
                await writable.write(dataStr);
                await writable.close();
                return; // Success
            } catch (err) {
                if (err.name === 'AbortError') return; // User cancelled
                console.error('File Picker failed, falling back to download', err);
            }
        }

        // Fallback for older browsers or if picker fails
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function handleImport(e) {
        const file = e.target.files[0];
        if (!file) return;

        const fileName = file.name.toLowerCase();
        const reader = new FileReader();
        reader.onload = function (e) {
            if (fileName.endsWith('.json')) {
                try {
                    const json = JSON.parse(new TextDecoder().decode(e.target.result));
                    // Validate structure simply
                    if (typeof json === 'object' && json !== null) {
                        bpData = (json.data && typeof json.data === 'object') ? json.data : json;

                        const count = Object.keys(bpData).length;

                        // 1. Render immediately
                        renderTable();
                        updateChart();

                        // 2. Async save & Force Local Update
                        saveToLocal(); // Backup immediately

                        saveBatch(bpData).then(() => {
                            console.log('Batch update successful');
                        }).catch(e => {
                            console.error('Batch update failed', e);
                        });
                    } else {
                        alert('JSON形式が正しくありません。');
                    }
                } catch (err) {
                    console.error('Parse error:', err);
                    alert('JSON解析エラーが発生しました。詳細はコンソールを確認してください。');
                }
                return;
            }

            // Excel Import
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });

            // Assume first sheet
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];

            // Get all data as array of arrays
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

            if (jsonData.length === 0) {
                alert('データが見つかりませんでした。');
                return;
            }

            // 1. Find Header Rows
            let dateColIdx = -1;
            let headerRow1Idx = -1;

            // Scan for "日付"
            for (let i = 0; i < Math.min(jsonData.length, 20); i++) {
                const row = jsonData[i];
                if (!row) continue;

                const foundIdx = row.findIndex(cell => String(cell).includes('日付') || String(cell).toLowerCase().includes('date'));
                if (foundIdx !== -1) {
                    headerRow1Idx = i;
                    dateColIdx = foundIdx;
                    break;
                }
            }

            if (headerRow1Idx === -1) {
                alert('「日付」列が見つかりませんでした。');
                importFile.value = '';
                return;
            }

            // 2. Map Columns based on Row 1 (Session) and Row 2 (Measurement Type)

            const row1 = jsonData[headerRow1Idx];
            // Row 2 might contain High/Low/Pulse
            const row2 = (headerRow1Idx + 1 < jsonData.length) ? jsonData[headerRow1Idx + 1] : [];

            let colMap = {
                m1: { sys: -1, dia: -1, pul: -1 },
                m2: { sys: -1, dia: -1, pul: -1 },
                e1: { sys: -1, dia: -1, pul: -1 },
                e2: { sys: -1, dia: -1, pul: -1 },
                med: -1 // Medication column
            };

            // Helper to determine session from a cell text
            const getSession = (str) => {
                const s = String(str).trim();
                if (s.includes('朝') && s.includes('1')) return 'm1';
                if (s.includes('朝') && s.includes('2')) return 'm2';
                if (s.includes('夜') || s.includes('晩')) {
                    if (s.includes('1')) return 'e1';
                    if (s.includes('2')) return 'e2';
                }
                return null;
            };

            // State to carry over merged header label
            let currentSession = null;

            // Iterate columns starting from dateCol + 1
            for (let c = 0; c < row1.length; c++) {
                const cell1 = row1[c];
                const cleanCell1 = cell1 ? String(cell1).trim() : '';

                // Medication check (Row 1 usually has "服薬" centered vertically, or spanning)
                if (cleanCell1.includes('服薬') || cleanCell1.includes('薬')) {
                    colMap.med = c;
                    currentSession = null;
                    continue;
                }

                if (cleanCell1) {
                    const session = getSession(cleanCell1);
                    if (session) {
                        currentSession = session;
                    } else if (cleanCell1.includes('日付')) {
                        // ignore
                    } else {
                        if (!cleanCell1.match(/朝|夜|晩/)) currentSession = null;
                    }
                }

                // Now check row 2 if session is active
                if (currentSession) {
                    const cell2 = row2[c] ? String(row2[c]).trim().toLowerCase() : '';
                    if (cell2.includes('high') || cell2.includes('sys') || cell2.includes('上') || cell2 === 'High') {
                        colMap[currentSession].sys = c;
                    } else if (cell2.includes('low') || cell2.includes('dia') || cell2.includes('下') || cell2 === 'Low') {
                        colMap[currentSession].dia = c;
                    } else if (cell2.includes('脈') || cell2.includes('pul') || cell2 === '脈拍') {
                        colMap[currentSession].pul = c;
                    }
                }
            }

            console.log("Column Mapping:", colMap);

            let importCount = 0;
            // Data starts after headers. If headers assume 2 rows, start +2.
            const dataStartIdx = headerRow1Idx + 2;

            for (let i = dataStartIdx; i < jsonData.length; i++) {
                const row = jsonData[i];
                if (!row) continue;

                // Date
                const dateVal = row[dateColIdx];
                if (!dateVal) continue;

                let dateStr = '';
                if (typeof dateVal === 'number') {
                    const d = new Date(Math.round((dateVal - 25569) * 86400 * 1000));
                    if (!isNaN(d.getTime())) {
                        dateStr = d.toISOString().slice(0, 10);
                    }
                } else {
                    const d = new Date(dateVal);
                    if (!isNaN(d.getTime())) {
                        dateStr = d.toISOString().slice(0, 10);
                    } else {
                        const match = String(dateVal).match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
                        if (match) {
                            dateStr = `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
                        }
                    }
                }

                if (!dateStr) continue;

                // Helper to get numbers
                const getNum = (idx) => {
                    if (idx === -1) return 0;
                    const v = row[idx];
                    return parseInt(v) || 0;
                };

                const m1 = {
                    sys: getNum(colMap.m1.sys),
                    dia: getNum(colMap.m1.dia),
                    pul: getNum(colMap.m1.pul)
                };
                const m2 = {
                    sys: getNum(colMap.m2.sys),
                    dia: getNum(colMap.m2.dia),
                    pul: getNum(colMap.m2.pul)
                };
                const e1 = {
                    sys: getNum(colMap.e1.sys),
                    dia: getNum(colMap.e1.dia),
                    pul: getNum(colMap.e1.pul)
                };
                const e2 = {
                    sys: getNum(colMap.e2.sys),
                    dia: getNum(colMap.e2.dia),
                    pul: getNum(colMap.e2.pul)
                };

                // Medication check (0 means medication taken in user's Excel)
                let tookMed = false;
                if (colMap.med !== -1) {
                    const medVal = row[colMap.med];
                    // Check if value is 0 (medication taken) or other truthy values
                    if (medVal === 0 || medVal === '0') {
                        tookMed = true;
                    }
                }

                if (m1.sys === 0 && m2.sys === 0 && e1.sys === 0 && e2.sys === 0) continue;

                // Build Morning Entry
                const mSysAvg = Math.round(((m1.sys || m2.sys) + (m2.sys || m1.sys)) / 2) || (m1.sys || m2.sys);
                const mDiaAvg = Math.round(((m1.dia || m2.dia) + (m2.dia || m1.dia)) / 2) || (m1.dia || m2.dia);
                const mPulAvg = Math.round(((m1.pul || m2.pul) + (m2.pul || m1.pul)) / 2) || (m1.pul || m2.pul);

                // Build Evening Entry
                const eSysAvg = Math.round(((e1.sys || e2.sys) + (e2.sys || e1.sys)) / 2) || (e1.sys || e2.sys);
                const eDiaAvg = Math.round(((e1.dia || e2.dia) + (e2.dia || e1.dia)) / 2) || (e1.dia || e2.dia);
                const ePulAvg = Math.round(((e1.pul || e2.pul) + (e2.pul || e1.pul)) / 2) || (e1.pul || e2.pul);

                // Initialize if not exists
                if (!bpData[dateStr]) bpData[dateStr] = {};

                // Update Morning
                if (mSysAvg > 0) {
                    bpData[dateStr].morning = {
                        sys: mSysAvg,
                        dia: mDiaAvg,
                        pul: mPulAvg,
                        medication: tookMed, // Import medication status
                        raw: { m1, m2 }
                    };
                }

                // Update Evening
                if (eSysAvg > 0) {
                    bpData[dateStr].evening = {
                        sys: eSysAvg,
                        dia: eDiaAvg,
                        pul: ePulAvg,
                        raw: { m1: e1, m2: e2 }
                    };
                }

                // Track for batch save
                // (Optimally we only track *new* items, but here we scan all valid rows)
                // For simplicity, we just save the whole bpData or just these entries?
                // Providing just the changed ones is better for bandwidth
                if (!window.currentImportBatch) window.currentImportBatch = {};
                window.currentImportBatch[dateStr] = bpData[dateStr];

                importCount++;
            }

            if (importCount > 0) {
                renderTable();
                updateChart();
                saveToLocal(); // Backup immediately

                saveBatch(bpData).then(() => {
                    console.log('Batch save successful');
                }).catch(e => {
                    console.error('Save failed:', e);
                });
            } else {
                alert('有効なデータが見つかりませんでした。ファイル形式や内容を確認してください。');
                console.log('Import failed: No valid data found');
            }
            importFile.value = '';
        };
        reader.readAsArrayBuffer(file);
    }
});
