/**
 * timeseries-app.js — Visual Climate Timeseries Explorer Extension
 *
 * Supabase country_data 테이블에서 시계열을 직접 조회.
 * CountryClient.tsx의 실제 indicator_code 기반.
 *
 * 지원 그룹:
 *  emissions: EN.GHG.CO2.PC.CE.AR5, OWID.GHG_PER_CAPITA, OWID.CO2, etc.
 *  fuel: OWID.COAL_CO2, OWID.OIL_CO2, OWID.GAS_CO2, etc.
 *  sector: CTRACE.POWER, CTRACE.TRANSPORTATION, etc.
 *  energy: EMBER.RENEWABLE.PCT, EMBER.CARBON.INTENSITY, EG.FEC.RNEW.ZS
 *  economy: NY.GDP.PCAP.CD, SP.POP.TOTL, DERIVED.CO2_PER_GDP
 *  resilience: NDGAIN.VULNERABILITY, NDGAIN.READINESS
 *  other_ghg: OWID.METHANE, OWID.NITROUS_OXIDE
 */

(function () {
  'use strict';

  let currentISO3 = null;
  let currentData = []; // [{indicator_code, year, value, source}]

  // ———— Indicator 라벨 매핑 (schema.json + pull-from-supabase.ts 기반) ————
  const CODE_LABELS = {
    'EN.GHG.CO2.PC.CE.AR5': 'CO\u2082 per capita (WB, tCO\u2082/cap)',
    'OWID.GHG_PER_CAPITA': 'GHG per capita (OWID, tCO\u2082eq/cap)',
    'OWID.CO2': 'CO\u2082 fossil (OWID, MtCO\u2082)',
    'OWID.TOTAL_GHG_EXCLUDING_LUCF': 'Total GHG excl. LULUCF (MtCO\u2082eq)',
    'OWID.CONSUMPTION_CO2_PER_CAPITA': 'Consumption CO\u2082/cap (tCO\u2082)',
    'OWID.CO2_PER_GDP': 'CO\u2082 per GDP (kgCO\u2082/$)',
    'OWID.COAL_CO2': 'Coal CO\u2082 (MtCO\u2082)',
    'OWID.OIL_CO2': 'Oil CO\u2082 (MtCO\u2082)',
    'OWID.GAS_CO2': 'Gas CO\u2082 (MtCO\u2082)',
    'OWID.CEMENT_CO2': 'Cement CO\u2082 (MtCO\u2082)',
    'OWID.FLARING_CO2': 'Flaring CO\u2082 (MtCO\u2082)',
    'CTRACE.POWER': 'Power sector (MtCO\u2082eq)',
    'CTRACE.TRANSPORTATION': 'Transportation (MtCO\u2082eq)',
    'CTRACE.MANUFACTURING': 'Manufacturing (MtCO\u2082eq)',
    'CTRACE.AGRICULTURE': 'Agriculture (MtCO\u2082eq)',
    'CTRACE.BUILDINGS': 'Buildings (MtCO\u2082eq)',
    'CTRACE.WASTE': 'Waste (MtCO\u2082eq)',
    'CTRACE.MINERAL_EXTRACTION': 'Mineral extraction (MtCO\u2082eq)',
    'CTRACE.FLUORINATED_GASES': 'F-gases (MtCO\u2082eq)',
    'EMBER.RENEWABLE.PCT': 'Renewable electricity share (%)',
    'EMBER.CARBON.INTENSITY': 'Grid carbon intensity (gCO\u2082/kWh)',
    'EG.FEC.RNEW.ZS': 'Renewable final energy share (%, WB)',
    'NY.GDP.PCAP.CD': 'GDP per capita (USD)',
    'SP.POP.TOTL': 'Population',
    'DERIVED.CO2_PER_GDP': 'CO\u2082 per GDP (derived)',
    'NDGAIN.VULNERABILITY': 'ND-GAIN Vulnerability (0-1)',
    'NDGAIN.READINESS': 'ND-GAIN Readiness (0-1)',
    'OWID.METHANE': 'Methane (MtCO\u2082eq)',
    'OWID.NITROUS_OXIDE': 'N\u2082O (MtCO\u2082eq)',
  };

  // ———— 초기화 (setup screen 없이 즉시 시작) ————
  document.addEventListener('DOMContentLoaded', function () {
    if (typeof tableau === 'undefined' || !tableau.extensions) {
      console.warn('Tableau Extensions API not available. Running in standalone mode.');
      startApp();
      return;
    }

    tableau.extensions.initializeAsync().then(function () {
      startApp();
    });
  });

  async function startApp() {
    hideAll();
    document.getElementById('loading').style.display = 'flex';

    console.log('[Tableau Ext] startApp initialized. isStandalone:', VC.isStandaloneMode());

    // 그룹/지표 드롭다운 설정
    const groupSelect = document.getElementById('ts-group');
    const indicatorSelect = document.getElementById('ts-indicator');

    groupSelect.addEventListener('change', onGroupChange);
    indicatorSelect.addEventListener('change', onIndicatorChange);

    try {
      const iso3 = await VC.detectISO3FromDashboard();
      console.log('[Tableau Ext] Initial detected ISO3:', iso3);
      if (!iso3) {
        showEmptyState('Please select a country on the dashboard to view its Timeseries.');
      } else {
        await loadCountry(iso3);
      }
    } catch (e) {
      console.error('[Tableau Ext] Start error:', e);
      showEmptyState();
    }

    VC.onFilterChange(onDashboardChange);
    VC.onMarkSelection(onDashboardChange);
  }

  async function onDashboardChange() {
    try {
      const iso3 = await VC.detectISO3FromDashboard();
      console.log('[Tableau Ext] Dashboard changed. Detected ISO3:', iso3);
      if (iso3 && iso3 !== currentISO3) {
        await loadCountry(iso3);
      } else if (!iso3 && currentISO3) {
        currentISO3 = null;
        showEmptyState('Please select a country on the dashboard to view its Timeseries.');
      }
    } catch (e) {
      console.error('[Tableau Ext] Dashboard change error:', e);
    }
  }

  async function loadCountry(iso3) {
    hideAll();
    document.getElementById('loading').style.display = 'flex';
    currentISO3 = iso3;

    const country = await VC.getCountry(iso3);
    if (!country) { showEmptyState(); return; }

    // 현재 그룹의 코드로 시계열 조회
    const group = document.getElementById('ts-group').value;
    const codes = VC.TIMESERIES_GROUPS[group]?.codes || [];

    currentData = await VC.getMultiTimeseries(iso3, codes);

    hideAll();
    document.getElementById('ts-main').style.display = 'block';
    document.getElementById('ts-flag').textContent = VC.iso3ToFlag(iso3);
    document.getElementById('ts-name').textContent = country.name;
    document.getElementById('ts-iso3').textContent = iso3;

    populateIndicatorSelect(codes);
    renderChart();
  }

  function onGroupChange() {
    const group = document.getElementById('ts-group').value;
    const codes = VC.TIMESERIES_GROUPS[group]?.codes || [];
    populateIndicatorSelect(codes);

    // 새 그룹의 데이터 로드
    if (currentISO3) {
      document.getElementById('loading').style.display = 'flex';
      VC.getMultiTimeseries(currentISO3, codes).then(function (data) {
        currentData = data;
        document.getElementById('loading').style.display = 'none';
        renderChart();
      });
    }
  }

  function onIndicatorChange() {
    renderChart();
  }

  function populateIndicatorSelect(codes) {
    const sel = document.getElementById('ts-indicator');
    sel.innerHTML = '';

    // "All" 옵션
    const allOpt = document.createElement('option');
    allOpt.value = '__ALL__';
    allOpt.textContent = '\u2014 All indicators \u2014';
    sel.appendChild(allOpt);

    // 데이터가 있는 코드만 표시
    const availableCodes = new Set(currentData.map(r => r.indicator_code));
    for (const code of codes) {
      if (availableCodes.has(code)) {
        const opt = document.createElement('option');
        opt.value = code;
        opt.textContent = CODE_LABELS[code] || code;
        sel.appendChild(opt);
      }
    }
  }

  // ———— SVG 라인 차트 렌더링 ————
  function renderChart() {
    const container = document.getElementById('ts-chart');
    const selectedCode = document.getElementById('ts-indicator').value;

    // 데이터 필터링
    let filtered = currentData;
    if (selectedCode !== '__ALL__') {
      filtered = currentData.filter(r => r.indicator_code === selectedCode);
    }

    if (filtered.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No data available for this indicator.</p></div>';
      renderTable([]);
      return;
    }

    // 코드별 그룹핑
    const groups = {};
    for (const row of filtered) {
      if (!groups[row.indicator_code]) groups[row.indicator_code] = [];
      groups[row.indicator_code].push(row);
    }

    // 차트 크기
    const W = container.clientWidth || 600;
    const H = container.clientHeight || 350;
    const PAD = { top: 20, right: 20, bottom: 40, left: 60 };
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;

    // 전체 연도/값 범위
    const allYears = filtered.map(r => r.year);
    const allValues = filtered.map(r => r.value);
    const minYear = Math.min(...allYears);
    const maxYear = Math.max(...allYears);
    const minVal = Math.min(0, Math.min(...allValues));
    const maxVal = Math.max(...allValues) * 1.1;

    const xScale = (year) => PAD.left + ((year - minYear) / (maxYear - minYear || 1)) * plotW;
    const yScale = (val) => PAD.top + plotH - ((val - minVal) / (maxVal - minVal || 1)) * plotH;

    let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;

    // 격자선
    const yTicks = 5;
    for (let i = 0; i <= yTicks; i++) {
      const v = minVal + (maxVal - minVal) * (i / yTicks);
      const y = yScale(v);
      svg += `<line x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}" stroke="#E5E7EB" stroke-width="0.5"/>`;
      svg += `<text x="${PAD.left - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="#8888A0" font-family="JetBrains Mono,monospace">${formatTickVal(v)}</text>`;
    }

    // X축 연도
    const yearStep = Math.max(1, Math.floor((maxYear - minYear) / 8));
    for (let y = minYear; y <= maxYear; y += yearStep) {
      const x = xScale(y);
      svg += `<text x="${x}" y="${H - 8}" text-anchor="middle" font-size="9" fill="#8888A0" font-family="JetBrains Mono,monospace">${y}</text>`;
    }

    // 각 지표의 라인
    const COLORS = ['#0066FF', '#E5484D', '#00A67E', '#F59E0B', '#8B5CF6', '#FF6B6B', '#4ECDC4', '#45B7D1'];
    let colorIdx = 0;

    for (const [code, rows] of Object.entries(groups)) {
      const sorted = rows.sort((a, b) => a.year - b.year);
      const color = COLORS[colorIdx % COLORS.length];
      colorIdx++;

      // 라인 경로
      const pathParts = sorted.map((r, i) => {
        const x = xScale(r.year);
        const y = yScale(r.value);
        return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
      });
      svg += `<path d="${pathParts.join(' ')}" fill="none" stroke="${color}" stroke-width="2"/>`;

      // 호버 도트 (각 데이터 포인트, 마지막 제외)
      for (let j = 0; j < sorted.length - 1; j++) {
        const r = sorted[j];
        const hx = xScale(r.year);
        const hy = yScale(r.value);
        svg += `<circle cx="${hx}" cy="${hy}" r="4" fill="transparent" stroke="transparent" class="chart-dot" data-year="${r.year}" data-value="${r.value}" onmouseover="this.setAttribute('r','6');this.style.fill='${color}';this.style.stroke='white';this.style.strokeWidth='2'" onmouseout="this.setAttribute('r','4');this.style.fill='transparent';this.style.stroke='transparent'"/>`;
      }

      // 마지막 점 + 라벨
      const last = sorted[sorted.length - 1];
      const lx = xScale(last.year);
      const ly = yScale(last.value);
      svg += `<circle cx="${lx}" cy="${ly}" r="3" fill="${color}"/>`;

      const shortLabel = (CODE_LABELS[code] || code).substring(0, 20);
      const labelAnchor = lx >= (W - PAD.right - 20) ? 'end' : 'start';
      const labelOffsetX = lx >= (W - PAD.right - 20) ? -6 : 6;
      svg += `<text x="${lx + labelOffsetX}" y="${ly + 3}" text-anchor="${labelAnchor}" font-size="8" fill="${color}" font-family="Inter,sans-serif">${shortLabel}</text>`;
    }

    svg += '</svg>';
    container.innerHTML = svg;

    // 테이블
    renderTable(filtered);
  }

  function renderTable(data) {
    const container = document.getElementById('ts-table');
    if (data.length === 0) {
      container.innerHTML = '';
      return;
    }

    // 최근 10행만 (최신순)
    const sorted = [...data].sort((a, b) => b.year - a.year || a.indicator_code.localeCompare(b.indicator_code));
    const recent = sorted.slice(0, 20);

    let html = '<table style="width:100%;font-size:10px;border-collapse:collapse;">';
    html += '<tr style="border-bottom:1px solid #E5E7EB;"><th style="text-align:left;padding:3px;">Indicator</th><th>Year</th><th style="text-align:right;">Value</th><th>Source</th></tr>';
    for (const r of recent) {
      const label = (CODE_LABELS[r.indicator_code] || r.indicator_code).substring(0, 35);
      html += `<tr><td style="padding:3px;">${label}</td><td style="text-align:center;">${r.year}</td><td style="text-align:right;font-family:JetBrains Mono,monospace;">${VC.fmt(r.value, 2)}</td><td style="color:#8888A0;">${r.source || ''}</td></tr>`;
    }
    html += '</table>';
    container.innerHTML = html;
  }

  function formatTickVal(v) {
    if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    if (Math.abs(v) < 0.01) return v.toFixed(3);
    return v.toFixed(1);
  }

  // ———— UI 헬퍼 ————
  function hideAll() {
    ['setup-screen', 'loading', 'empty-state', 'ts-main'].forEach(function (id) {
      document.getElementById(id).style.display = 'none';
    });
  }
  function showEmptyState(msg) {
    hideAll();
    const el = document.getElementById('empty-state');
    el.style.display = 'flex';
    el.innerHTML = `<p>${msg || 'Select a country on the dashboard to view the Timeseries.'}</p>
                    <p style="font-size:11px;color:#8888A0;margin-top:8px;">
                      The extension detects ISO3 or Country Code from filters or selected marks.
                    </p>`;
  }
})();
