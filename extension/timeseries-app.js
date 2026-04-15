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

  var currentISO3 = null;
  var currentData = []; // [{indicator_code, year, value, source}]

  // ———— Indicator 라벨 매핑 (schema.json + pull-from-supabase.ts 기반) ————
  var CODE_LABELS = {
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
    var groupSelect = document.getElementById('ts-group');
    var indicatorSelect = document.getElementById('ts-indicator');

    groupSelect.addEventListener('change', onGroupChange);
    indicatorSelect.addEventListener('change', onIndicatorChange);

    try {
      var iso3 = await VC.detectISO3FromDashboard();
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
      var iso3 = await VC.detectISO3FromDashboard();
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

    var country = await VC.getCountry(iso3);
    if (!country) { showEmptyState(); return; }

    // 현재 그룹의 코드로 시계열 조회
    var group = document.getElementById('ts-group').value;
    var codes = VC.TIMESERIES_GROUPS[group]?.codes || [];

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
    var group = document.getElementById('ts-group').value;
    var codes = VC.TIMESERIES_GROUPS[group]?.codes || [];
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
    var sel = document.getElementById('ts-indicator');
    sel.innerHTML = '';

    // "All" 옵션
    var allOpt = document.createElement('option');
    allOpt.value = '__ALL__';
    allOpt.textContent = '\u2014 All indicators \u2014';
    sel.appendChild(allOpt);

    // 데이터가 있는 코드만 표시
    var availableCodes = {};
    for (var i = 0; i < currentData.length; i++) {
      availableCodes[currentData[i].indicator_code] = true;
    }
    for (var j = 0; j < codes.length; j++) {
      var code = codes[j];
      if (availableCodes[code]) {
        var opt = document.createElement('option');
        opt.value = code;
        opt.textContent = CODE_LABELS[code] || code;
        sel.appendChild(opt);
      }
    }
  }

  // ———— SVG 라인 차트 렌더링 ————
  function renderChart() {
    var container = document.getElementById('ts-chart');
    var selectedCode = document.getElementById('ts-indicator').value;

    // 데이터 필터링
    var filtered = currentData;
    if (selectedCode !== '__ALL__') {
      filtered = currentData.filter(function (r) { return r.indicator_code === selectedCode; });
    }

    if (filtered.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No data available for this indicator.</p></div>';
      renderTable([]);
      return;
    }

    // 코드별 그룹핑
    var groups = {};
    for (var i = 0; i < filtered.length; i++) {
      var row = filtered[i];
      if (!groups[row.indicator_code]) groups[row.indicator_code] = [];
      groups[row.indicator_code].push(row);
    }

    // 차트 크기
    var W = container.clientWidth || 600;
    var H = container.clientHeight || 350;
    var PAD = { top: 20, right: 20, bottom: 40, left: 60 };
    var plotW = W - PAD.left - PAD.right;
    var plotH = H - PAD.top - PAD.bottom;

    // 전체 연도/값 범위
    var allYears = filtered.map(function (r) { return r.year; });
    var allValues = filtered.map(function (r) { return r.value; });
    var minYear = Math.min.apply(null, allYears);
    var maxYear = Math.max.apply(null, allYears);
    var minVal = Math.min(0, Math.min.apply(null, allValues));
    var maxVal = Math.max.apply(null, allValues) * 1.1;

    function xScale(year) { return PAD.left + ((year - minYear) / (maxYear - minYear || 1)) * plotW; }
    function yScale(val) { return PAD.top + plotH - ((val - minVal) / (maxVal - minVal || 1)) * plotH; }

    var svg = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" style="overflow:visible">';

    // 격자선
    var yTicks = 5;
    for (var t = 0; t <= yTicks; t++) {
      var v = minVal + (maxVal - minVal) * (t / yTicks);
      var gy = yScale(v);
      svg += '<line x1="' + PAD.left + '" y1="' + gy + '" x2="' + (W - PAD.right) + '" y2="' + gy + '" stroke="var(--vc-border)" stroke-width="0.5"/>';
      svg += '<text x="' + (PAD.left - 6) + '" y="' + (gy + 3) + '" text-anchor="end" font-size="9" fill="var(--vc-text-muted)" font-family="JetBrains Mono,monospace">' + formatTickVal(v) + '</text>';
    }

    // X축 연도
    var yearStep = Math.max(1, Math.floor((maxYear - minYear) / 8));
    for (var yr = minYear; yr <= maxYear; yr += yearStep) {
      var gx = xScale(yr);
      svg += '<text x="' + gx + '" y="' + (H - 8) + '" text-anchor="middle" font-size="9" fill="var(--vc-text-muted)" font-family="JetBrains Mono,monospace">' + yr + '</text>';
    }

    // 각 지표의 라인
    var COLORS = ['#C2410C', '#0B6B3A', '#B45309', '#6D28D9', '#8B1C1C', '#2563EB', '#0F766E', '#92400E'];
    var colorIdx = 0;

    // Store all data points for tooltip tracking (flattened, with color)
    var allDataPoints = [];

    var groupEntries = Object.keys(groups);
    for (var gi = 0; gi < groupEntries.length; gi++) {
      var code = groupEntries[gi];
      var rows = groups[code];
      var sorted = rows.slice().sort(function (a, b) { return a.year - b.year; });
      var color = COLORS[colorIdx % COLORS.length];
      colorIdx++;

      // Area fill (subtle)
      if (groupEntries.length === 1) {
        var areaPath = 'M ' + xScale(sorted[0].year) + ' ' + (PAD.top + plotH);
        for (var ai = 0; ai < sorted.length; ai++) {
          areaPath += ' L ' + xScale(sorted[ai].year) + ' ' + yScale(sorted[ai].value);
        }
        areaPath += ' L ' + xScale(sorted[sorted.length - 1].year) + ' ' + (PAD.top + plotH) + ' Z';
        svg += '<path d="' + areaPath + '" fill="' + color + '" opacity="0.06"/>';
      }

      // 라인 경로
      var pathParts = sorted.map(function (r, idx) {
        var px = xScale(r.year);
        var py = yScale(r.value);
        return idx === 0 ? ('M ' + px + ' ' + py) : ('L ' + px + ' ' + py);
      });
      svg += '<path d="' + pathParts.join(' ') + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';

      // Store data points
      for (var di = 0; di < sorted.length; di++) {
        allDataPoints.push({
          x: xScale(sorted[di].year),
          y: yScale(sorted[di].value),
          year: sorted[di].year,
          value: sorted[di].value,
          code: code,
          color: color
        });
      }

      // 마지막 점 + 라벨
      var last = sorted[sorted.length - 1];
      var lx = xScale(last.year);
      var ly = yScale(last.value);
      svg += '<circle cx="' + lx + '" cy="' + ly + '" r="3" fill="' + color + '" stroke="white" stroke-width="1.5"/>';

      var shortLabel = (CODE_LABELS[code] || code).substring(0, 22);
      var labelAnchor = lx >= (W - PAD.right - 20) ? 'end' : 'start';
      var labelOffsetX = lx >= (W - PAD.right - 20) ? -6 : 6;
      svg += '<text x="' + (lx + labelOffsetX) + '" y="' + (ly + 3) + '" text-anchor="' + labelAnchor + '" font-size="8" fill="' + color + '" font-family="Inter,sans-serif" font-weight="600">' + shortLabel + '</text>';
    }

    // 크로스헤어 라인 (initially hidden)
    svg += '<line class="crosshair-x" x1="0" y1="' + PAD.top + '" x2="0" y2="' + (PAD.top + plotH) + '" stroke="rgba(42,36,30,0.15)" stroke-width="1" stroke-dasharray="3,3" style="display:none"/>';
    svg += '<line class="crosshair-y" x1="' + PAD.left + '" y1="0" x2="' + (W - PAD.right) + '" y2="0" stroke="rgba(42,36,30,0.15)" stroke-width="1" stroke-dasharray="3,3" style="display:none"/>';
    svg += '<circle class="crosshair-dot" cx="0" cy="0" r="5" fill="none" stroke="var(--vc-primary)" stroke-width="2" style="display:none"/>';

    // 인비저블 오버레이 for mouse tracking
    svg += '<rect x="' + PAD.left + '" y="' + PAD.top + '" width="' + plotW + '" height="' + plotH + '" fill="transparent" class="chart-overlay" style="cursor:crosshair"/>';

    svg += '</svg>';
    container.innerHTML = svg;

    // ———— Interactive tooltip + crosshair ————
    var svgEl = container.querySelector('svg');
    var crossX = svgEl.querySelector('.crosshair-x');
    var crossY = svgEl.querySelector('.crosshair-y');
    var crossDot = svgEl.querySelector('.crosshair-dot');
    var overlay = svgEl.querySelector('.chart-overlay');
    var tooltip = document.getElementById('chart-tooltip');

    overlay.addEventListener('mousemove', function (e) {
      var rect = svgEl.getBoundingClientRect();
      var mouseX = e.clientX - rect.left;

      // Find nearest data point by x distance
      var nearest = null;
      var minDist = Infinity;
      for (var k = 0; k < allDataPoints.length; k++) {
        var dp = allDataPoints[k];
        var dist = Math.abs(dp.x - mouseX);
        if (dist < minDist) {
          minDist = dist;
          nearest = dp;
        }
      }

      if (nearest && minDist < 40) {
        // Show crosshair
        crossX.setAttribute('x1', nearest.x);
        crossX.setAttribute('x2', nearest.x);
        crossX.style.display = '';

        crossY.setAttribute('y1', nearest.y);
        crossY.setAttribute('y2', nearest.y);
        crossY.style.display = '';

        crossDot.setAttribute('cx', nearest.x);
        crossDot.setAttribute('cy', nearest.y);
        crossDot.style.stroke = nearest.color;
        crossDot.style.display = '';

        // Show tooltip
        var label = (CODE_LABELS[nearest.code] || nearest.code).substring(0, 30);
        tooltip.innerHTML =
          '<div class="tt-year">' + nearest.year + '</div>' +
          '<div class="tt-value">' + formatTickVal(nearest.value) + '</div>' +
          '<div class="tt-label">' + label + '</div>';
        tooltip.style.display = 'block';

        // Position tooltip
        var ttX = e.clientX + 14;
        var ttY = e.clientY - 56;
        if (ttX + 140 > window.innerWidth) ttX = e.clientX - 150;
        if (ttY < 4) ttY = e.clientY + 14;
        tooltip.style.left = ttX + 'px';
        tooltip.style.top = ttY + 'px';
      } else {
        hideCrosshair();
      }
    });

    overlay.addEventListener('mouseleave', hideCrosshair);

    function hideCrosshair() {
      crossX.style.display = 'none';
      crossY.style.display = 'none';
      crossDot.style.display = 'none';
      if (tooltip) tooltip.style.display = 'none';
    }

    // 테이블
    renderTable(filtered);
  }

  function renderTable(data) {
    var container = document.getElementById('ts-table');
    if (data.length === 0) {
      container.innerHTML = '';
      return;
    }

    // 최근 20행 (최신순)
    var sorted = data.slice().sort(function (a, b) {
      return b.year - a.year || a.indicator_code.localeCompare(b.indicator_code);
    });
    var recent = sorted.slice(0, 20);

    var html = '<table style="width:100%;font-size:10px;border-collapse:collapse;">';
    html += '<tr><th style="text-align:left;padding:6px 6px;">Indicator</th><th>Year</th><th style="text-align:right;">Value</th><th>Source</th></tr>';
    for (var i = 0; i < recent.length; i++) {
      var r = recent[i];
      var label = (CODE_LABELS[r.indicator_code] || r.indicator_code).substring(0, 35);
      html += '<tr><td style="padding:5px 6px;">' + label + '</td><td style="text-align:center;">' + r.year + '</td><td style="text-align:right;font-family:JetBrains Mono,monospace;">' + VC.fmt(r.value, 2) + '</td><td style="color:var(--vc-text-muted);">' + (r.source || '') + '</td></tr>';
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
    var el = document.getElementById('empty-state');
    el.style.display = 'flex';
    el.innerHTML = '<p>' + (msg || 'Select a country on the dashboard to view the Timeseries.') + '</p>' +
                    '<p style="font-size:11px;color:var(--vc-text-muted);margin-top:8px;">' +
                    'The extension detects ISO3 or Country Code from filters or selected marks.</p>';
  }
})();
