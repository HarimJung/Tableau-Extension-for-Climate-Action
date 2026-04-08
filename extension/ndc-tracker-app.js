/**
 * ndc-tracker-app.js — Visual Climate NDC Gap Tracker Extension
 *
 * ndc-targets-v2.json의 20국 데이터 + Supabase 실배출 시계열로
 * 실제 배출 궤적 vs NDC 목표를 시각화.
 *
 * 갭 계산식 (calculated-fields.md CF04/CF05 기반):
 *  CF04 = projected_2030 - ndc_2030_target
 *  CF05 = On Track / Narrow Gap / Significant Gap / Critical Gap
 *
 * 실배출 데이터 소스:
 *  OWID.TOTAL_GHG_EXCLUDING_LUCF (MtCO2eq) — 가장 포괄적
 *  fallback: OWID.CO2 (MtCO2) — CO2만
 */

(function () {
  'use strict';

  var currentISO3 = null;

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

    try {
      var iso3 = await VC.detectISO3FromDashboard();
      console.log('[Tableau Ext] Initial detected ISO3:', iso3);
      if (!iso3) {
        showEmptyState('Please select a country on the dashboard to view the NDC Gap Tracker.');
      } else if (VC.NDC_TARGETS[iso3]) {
        await renderNDC(iso3);
      } else {
        showNotCovered(iso3);
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
        if (VC.NDC_TARGETS[iso3]) {
          await renderNDC(iso3);
        } else {
          showNotCovered(iso3);
        }
      } else if (!iso3 && currentISO3) {
        currentISO3 = null;
        showEmptyState('Please select a country on the dashboard to view the NDC Gap Tracker.');
      }
    } catch (e) {
      console.error('[Tableau Ext] Dashboard change error:', e);
    }
  }

  // ———— NDC Tracker 렌더링 ————
  async function renderNDC(iso3) {
    hideAll();
    document.getElementById('loading').style.display = 'flex';
    currentISO3 = iso3;

    var target = VC.NDC_TARGETS[iso3];
    var country = await VC.getCountry(iso3);

    // 실배출 시계열 조회
    var emissionsTS = await VC.getTimeseries(iso3, 'OWID.TOTAL_GHG_EXCLUDING_LUCF');
    if (emissionsTS.length === 0) {
      emissionsTS = await VC.getTimeseries(iso3, 'OWID.CO2');
    }

    hideAll();
    document.getElementById('ndc-main').style.display = 'block';

    // Header
    document.getElementById('ndc-flag').textContent = VC.iso3ToFlag(iso3);
    document.getElementById('ndc-name').textContent = country?.name || target.name;

    // CAT Rating
    var catEl = document.getElementById('ndc-cat');
    if (target.cat) {
      var catColor = VC.CAT_COLOR[target.cat] || '#CCCCCC';
      var catLabel = target.cat.replace(/_/g, ' ');
      catEl.innerHTML = `CAT: <span style="color:${catColor};font-weight:700;">${catLabel}</span>`;
    } else {
      catEl.textContent = 'CAT: Not rated';
    }

    // KPIs
    document.getElementById('kpi-target').textContent = `-${target.ndc2030_pct}%`;
    document.getElementById('kpi-target').style.color = 'var(--vc-primary)';

    document.getElementById('kpi-nz').textContent = target.nz_year || '\u2014';
    document.getElementById('kpi-nz').style.color = target.nz_year ? 'var(--vc-text)' : 'var(--vc-missing)';

    // Net Zero Countdown (CF08: nz_year - current year)
    var currentYear = new Date().getFullYear();
    var countdown = target.nz_year ? (target.nz_year - currentYear) : null;
    document.getElementById('kpi-countdown').textContent = countdown != null ? `${countdown}yr` : '\u2014';

    // Gap 계산
    var gapInfo = calculateGap(emissionsTS, target);
    var gapBadge = document.getElementById('ndc-gap-badge');
    gapBadge.textContent = gapInfo.severity;
    gapBadge.style.background = gapInfo.severity === 'No Data' ? '#CCCCCC' : (VC.GAP_COLOR[gapInfo.severity] || '#CCCCCC');

    // 차트
    renderNDCChart(emissionsTS, target, gapInfo);

    // NDC 3.0 정보
    var ndc3El = document.getElementById('ndc3-info');
    if (target.ndc3) {
      ndc3El.style.display = 'block';
      ndc3El.innerHTML = `
        <strong>NDC 3.0 Submitted</strong> (${target.ndc3_date || ''})<br>
        ${target.ndc3_pct ? `2035 target: -${target.ndc3_pct}% from ${target.ref_year || 'ref year'}` : 'Details pending'}
      `;
    } else {
      ndc3El.style.display = 'block';
      ndc3El.innerHTML = `<strong>NDC 3.0:</strong> Not yet submitted as of April 2026`;
    }

    // Detail Table
    var detailEl = document.getElementById('ndc-detail');
    detailEl.innerHTML = `
      <tr><td>Reference type</td><td style="text-align:right;">${target.ref_type}</td></tr>
      ${target.ref_year ? `<tr><td>Reference year</td><td style="text-align:right;">${target.ref_year}</td></tr>` : ''}
      ${target.ref_mt ? `<tr><td>Reference emissions</td><td style="text-align:right;">${VC.fmt(target.ref_mt)} MtCO\u2082eq</td></tr>` : ''}
      ${target.target_mt ? `<tr><td>2030 target emissions</td><td style="text-align:right;">${VC.fmt(target.target_mt)} MtCO\u2082eq</td></tr>` : ''}
      <tr><td>Net-zero legal status</td><td style="text-align:right;">${target.nz_legal.replace(/_/g, ' ')}</td></tr>
      ${gapInfo.latestEmissions ? `<tr><td>Latest emissions (${gapInfo.latestYear})</td><td style="text-align:right;">${VC.fmt(gapInfo.latestEmissions)} MtCO\u2082eq</td></tr>` : ''}
      ${gapInfo.projected2030 != null ? `<tr><td>Projected 2030 (linear)</td><td style="text-align:right;">${VC.fmt(gapInfo.projected2030)} MtCO\u2082eq</td></tr>` : ''}
      ${gapInfo.gapMt != null ? `<tr><td style="font-weight:600;">Gap (projected \u2212 target)</td><td style="text-align:right;font-weight:600;color:${VC.GAP_COLOR[gapInfo.severity] || '#000'}">${gapInfo.gapMt > 0 ? '+' : ''}${VC.fmt(gapInfo.gapMt)} MtCO\u2082eq</td></tr>` : ''}
    `;
  }

  // ———— Gap 계산 (CF04/CF05 로직) ————
  function calculateGap(ts, target) {
    var result = {
      severity: 'No Data',
      latestEmissions: null,
      latestYear: null,
      projected2030: null,
      gapMt: null,
      trendCAGR: null,
    };

    if (ts.length < 3) return result;

    // 최근 데이터
    var sorted = ts.slice().sort(function (a, b) { return b.year - a.year; });
    var latest = sorted[0];
    result.latestEmissions = latest.value;
    result.latestYear = latest.year;

    // 10년 추세로 2030 투영 (CAGR)
    var tenYearAgo = sorted.find(function (r) { return r.year <= latest.year - 10; });
    if (tenYearAgo && tenYearAgo.value > 0) {
      var years = latest.year - tenYearAgo.year;
      var cagr = Math.pow(latest.value / tenYearAgo.value, 1 / years) - 1;
      result.trendCAGR = cagr;
      result.projected2030 = latest.value * Math.pow(1 + cagr, 2030 - latest.year);
    } else {
      // fallback: 선형 추세
      var fiveYearAgo = sorted.find(function (r) { return r.year <= latest.year - 5; });
      if (fiveYearAgo) {
        var slope = (latest.value - fiveYearAgo.value) / (latest.year - fiveYearAgo.year);
        result.projected2030 = latest.value + slope * (2030 - latest.year);
      }
    }

    // absolute 타입만 직접 갭 계산 가능
    if (target.ref_type === 'absolute' && target.target_mt && result.projected2030 != null) {
      result.gapMt = result.projected2030 - target.target_mt;

      // CF05 로직
      if (result.gapMt <= 0) {
        result.severity = 'On Track';
      } else if (result.gapMt / target.target_mt < 0.1) {
        result.severity = 'Narrow Gap';
      } else if (result.gapMt / target.target_mt < 0.3) {
        result.severity = 'Significant Gap';
      } else {
        result.severity = 'Critical Gap';
      }
    } else if (target.ref_type === 'intensity' || target.ref_type === 'bau') {
      // intensity/BAU 타입은 직접 비교 불가 → 추세만 표시
      if (result.trendCAGR != null) {
        result.severity = result.trendCAGR <= -0.02 ? 'On Track' :
                    result.trendCAGR <= 0 ? 'Narrow Gap' :
                    result.trendCAGR <= 0.02 ? 'Significant Gap' : 'Critical Gap';
      }
    }

    return result;
  }

  // ———— NDC 차트 (배출 궤적 + 목표선) ————
  function renderNDCChart(ts, target, gapInfo) {
    var container = document.getElementById('ndc-chart');
    if (ts.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No emissions data available.</p></div>';
      return;
    }

    var sorted = ts.slice().sort(function (a, b) { return a.year - b.year; });
    // 2000년 이후만 표시
    var recent = sorted.filter(function (r) { return r.year >= 2000; });
    if (recent.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No post-2000 data.</p></div>';
      return;
    }

    var W = container.clientWidth || 500;
    var H = 260;
    var PAD = { top: 15, right: 50, bottom: 35, left: 55 };
    var plotW = W - PAD.left - PAD.right;
    var plotH = H - PAD.top - PAD.bottom;

    // 범위: x = 2000~2035, y = 자동
    var minYear = 2000;
    var maxYear = 2035;
    var values = recent.map(function (r) { return r.value; });
    var extras = [];
    if (target.target_mt) extras.push(target.target_mt);
    if (target.ref_mt) extras.push(target.ref_mt);
    if (gapInfo.projected2030) extras.push(gapInfo.projected2030);
    var allVals = values.concat(extras).filter(function (v) { return v != null; });
    var minVal = Math.min(0, Math.min.apply(null, allVals)) * 0.9;
    var maxVal = Math.max.apply(null, allVals) * 1.15;

    function xScale(year) { return PAD.left + ((year - minYear) / (maxYear - minYear)) * plotW; }
    function yScale(val) { return PAD.top + plotH - ((val - minVal) / (maxVal - minVal)) * plotH; }

    var svg = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" style="overflow:visible">';

    // 그리드
    for (var i = 0; i <= 4; i++) {
      var v = minVal + (maxVal - minVal) * (i / 4);
      var y = yScale(v);
      svg += '<line x1="' + PAD.left + '" y1="' + y + '" x2="' + (W - PAD.right) + '" y2="' + y + '" stroke="var(--vc-border)" stroke-width="0.5"/>';
      svg += '<text x="' + (PAD.left - 4) + '" y="' + (y + 3) + '" text-anchor="end" font-size="8" fill="var(--vc-text-muted)" font-family="JetBrains Mono,monospace">' + formatVal(v) + '</text>';
    }

    // X축
    for (var yr = 2000; yr <= 2035; yr += 5) {
      var x = xScale(yr);
      svg += '<line x1="' + x + '" y1="' + PAD.top + '" x2="' + x + '" y2="' + (PAD.top + plotH) + '" stroke="var(--vc-border)" stroke-width="0.3"/>';
      svg += '<text x="' + x + '" y="' + (H - 10) + '" text-anchor="middle" font-size="8" fill="var(--vc-text-muted)" font-family="JetBrains Mono,monospace">' + yr + '</text>';
    }

    // 2030 목표선 (absolute 타입)
    if (target.target_mt && target.ref_type === 'absolute') {
      var ty = yScale(target.target_mt);
      svg += '<line x1="' + PAD.left + '" y1="' + ty + '" x2="' + (W - PAD.right) + '" y2="' + ty + '" stroke="var(--vc-talker)" stroke-width="1.5" stroke-dasharray="6,3"/>';
      svg += '<text x="' + (W - PAD.right + 3) + '" y="' + (ty + 3) + '" font-size="8" fill="var(--vc-talker)" font-family="Inter,sans-serif" font-weight="600">Target ' + VC.fmt(target.target_mt, 0) + '</text>';
    }

    // 갭 영역 (projected와 target 사이)
    if (gapInfo.projected2030 != null && target.target_mt && target.ref_type === 'absolute') {
      var latestX = xScale(gapInfo.latestYear);
      var projX = xScale(2030);
      var projY = yScale(gapInfo.projected2030);
      var targetY = yScale(target.target_mt);
      var gapColor = gapInfo.gapMt > 0 ? 'rgba(229,72,77,0.1)' : 'rgba(0,166,126,0.1)';
      svg += '<polygon points="' + latestX + ',' + yScale(gapInfo.latestEmissions) + ' ' + projX + ',' + projY + ' ' + projX + ',' + targetY + ' ' + latestX + ',' + targetY + '" fill="' + gapColor + '"/>';
    }

    // 실배출 라인 (area fill + line)
    // Area fill
    var areaPath = 'M ' + xScale(recent[0].year) + ' ' + (PAD.top + plotH);
    for (var j = 0; j < recent.length; j++) {
      areaPath += ' L ' + xScale(recent[j].year) + ' ' + yScale(recent[j].value);
    }
    areaPath += ' L ' + xScale(recent[recent.length - 1].year) + ' ' + (PAD.top + plotH) + ' Z';
    svg += '<path d="' + areaPath + '" fill="rgba(0,102,255,0.06)"/>';

    // Line
    var pathParts = recent.map(function (r, idx) {
      var px = xScale(r.year);
      var py = yScale(r.value);
      return idx === 0 ? ('M ' + px + ' ' + py) : ('L ' + px + ' ' + py);
    });
    svg += '<path d="' + pathParts.join(' ') + '" fill="none" stroke="var(--vc-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';

    // 투영 점선 (latest → 2030)
    if (gapInfo.projected2030 != null && gapInfo.latestEmissions != null) {
      var lx = xScale(gapInfo.latestYear);
      var ly = yScale(gapInfo.latestEmissions);
      var px = xScale(2030);
      var py = yScale(gapInfo.projected2030);
      svg += '<line x1="' + lx + '" y1="' + ly + '" x2="' + px + '" y2="' + py + '" stroke="var(--vc-primary)" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.5"/>';
      svg += '<circle cx="' + px + '" cy="' + py + '" r="3.5" fill="var(--vc-primary)" opacity="0.5"/>';
      svg += '<text x="' + (px + 5) + '" y="' + (py + 3) + '" font-size="8" fill="var(--vc-primary)" font-family="JetBrains Mono,monospace">' + VC.fmt(gapInfo.projected2030, 0) + '</text>';
    }

    // 최신 데이터 포인트 (강조)
    if (recent.length > 0) {
      var last = recent[recent.length - 1];
      svg += '<circle cx="' + xScale(last.year) + '" cy="' + yScale(last.value) + '" r="4" fill="var(--vc-primary)" stroke="white" stroke-width="1.5"/>';
    }

    // 크로스헤어 라인 (initially hidden, controlled by JS)
    svg += '<line class="crosshair-x" x1="0" y1="' + PAD.top + '" x2="0" y2="' + (PAD.top + plotH) + '" stroke="rgba(15,23,42,0.15)" stroke-width="1" stroke-dasharray="3,3" style="display:none"/>';
    svg += '<line class="crosshair-y" x1="' + PAD.left + '" y1="0" x2="' + (W - PAD.right) + '" y2="0" stroke="rgba(15,23,42,0.15)" stroke-width="1" stroke-dasharray="3,3" style="display:none"/>';
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

    // Build data point array for nearest-point lookup
    var dataPoints = recent.map(function (r) {
      return { x: xScale(r.year), y: yScale(r.value), year: r.year, value: r.value };
    });

    overlay.addEventListener('mousemove', function (e) {
      var rect = svgEl.getBoundingClientRect();
      var mouseX = e.clientX - rect.left;

      // Find nearest data point by x
      var nearest = null;
      var minDist = Infinity;
      for (var k = 0; k < dataPoints.length; k++) {
        var dist = Math.abs(dataPoints[k].x - mouseX);
        if (dist < minDist) {
          minDist = dist;
          nearest = dataPoints[k];
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
        crossDot.style.display = '';

        // Show tooltip
        tooltip.innerHTML =
          '<div class="tt-year">' + nearest.year + '</div>' +
          '<div class="tt-value">' + formatVal(nearest.value) + '</div>' +
          '<div class="tt-label">MtCO\u2082eq</div>';
        tooltip.style.display = 'block';

        // Position tooltip (avoid overflow)
        var ttX = e.clientX + 14;
        var ttY = e.clientY - 50;
        if (ttX + 120 > window.innerWidth) ttX = e.clientX - 130;
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
  }

  function formatVal(v) {
    if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'Gt';
    return v.toFixed(0) + 'Mt';
  }

  function showNotCovered(iso3) {
    hideAll();
    var el = document.getElementById('empty-state');
    el.style.display = 'flex';
    el.innerHTML = '<p>' + iso3 + ' is not in the 20-country NDC target list.</p>' +
      '<p style="font-size:11px;color:var(--vc-text-muted);margin-top:8px;">' +
      'Covered countries: ' + Object.keys(VC.NDC_TARGETS).join(', ') +
      '</p>';
  }

  function hideAll() {
    ['setup-screen', 'loading', 'empty-state', 'ndc-main'].forEach(function (id) {
      document.getElementById(id).style.display = 'none';
    });
  }

  function showEmptyState(msg) {
    hideAll();
    var el = document.getElementById('empty-state');
    el.style.display = 'flex';
    el.innerHTML = '<p>' + (msg || 'Select a country on the dashboard to view the NDC Gap Tracker.') + '</p>' +
                    '<p style="font-size:11px;color:var(--vc-text-muted);margin-top:8px;">' +
                    'The extension detects ISO3 or Country Code from filters or selected marks.</p>';
  }
})();
