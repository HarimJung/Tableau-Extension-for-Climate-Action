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

  let currentISO3 = null;

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
      const iso3 = await VC.detectISO3FromDashboard();
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
      const iso3 = await VC.detectISO3FromDashboard();
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

    const target = VC.NDC_TARGETS[iso3];
    const country = await VC.getCountry(iso3);

    // 실배출 시계열 조회
    let emissionsTS = await VC.getTimeseries(iso3, 'OWID.TOTAL_GHG_EXCLUDING_LUCF');
    if (emissionsTS.length === 0) {
      emissionsTS = await VC.getTimeseries(iso3, 'OWID.CO2');
    }

    hideAll();
    document.getElementById('ndc-main').style.display = 'block';

    // Header
    document.getElementById('ndc-flag').textContent = VC.iso3ToFlag(iso3);
    document.getElementById('ndc-name').textContent = country?.name || target.name;

    // CAT Rating
    const catEl = document.getElementById('ndc-cat');
    if (target.cat) {
      const catColor = VC.CAT_COLOR[target.cat] || '#CCCCCC';
      const catLabel = target.cat.replace(/_/g, ' ');
      catEl.innerHTML = `CAT: <span style="color:${catColor};font-weight:600;">${catLabel}</span>`;
    } else {
      catEl.textContent = 'CAT: Not rated';
    }

    // KPIs
    document.getElementById('kpi-target').textContent = `-${target.ndc2030_pct}%`;
    document.getElementById('kpi-target').style.color = VC.BRAND.primary;

    document.getElementById('kpi-nz').textContent = target.nz_year || '\u2014';
    document.getElementById('kpi-nz').style.color = target.nz_year ? VC.BRAND.textPrimary : VC.BRAND.dataMissing;

    // Net Zero Countdown (CF08: nz_year - current year)
    const currentYear = new Date().getFullYear();
    const countdown = target.nz_year ? (target.nz_year - currentYear) : null;
    document.getElementById('kpi-countdown').textContent = countdown != null ? `${countdown}yr` : '\u2014';

    // Gap 계산
    const gapInfo = calculateGap(emissionsTS, target);
    const gapBadge = document.getElementById('ndc-gap-badge');
    gapBadge.textContent = gapInfo.severity;
    gapBadge.style.background = VC.GAP_COLOR[gapInfo.severity] || '#CCCCCC';

    // 차트
    renderNDCChart(emissionsTS, target, gapInfo);

    // NDC 3.0 정보
    const ndc3El = document.getElementById('ndc3-info');
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
    const detailEl = document.getElementById('ndc-detail');
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
    const result = {
      severity: 'No Data',
      latestEmissions: null,
      latestYear: null,
      projected2030: null,
      gapMt: null,
      trendCAGR: null,
    };

    if (ts.length < 3) return result;

    // 최근 데이터
    const sorted = [...ts].sort((a, b) => b.year - a.year);
    const latest = sorted[0];
    result.latestEmissions = latest.value;
    result.latestYear = latest.year;

    // 10년 추세로 2030 투영 (CAGR)
    const tenYearAgo = sorted.find(r => r.year <= latest.year - 10);
    if (tenYearAgo && tenYearAgo.value > 0) {
      const years = latest.year - tenYearAgo.year;
      const cagr = Math.pow(latest.value / tenYearAgo.value, 1 / years) - 1;
      result.trendCAGR = cagr;
      result.projected2030 = latest.value * Math.pow(1 + cagr, 2030 - latest.year);
    } else {
      // fallback: 선형 추세
      const fiveYearAgo = sorted.find(r => r.year <= latest.year - 5);
      if (fiveYearAgo) {
        const slope = (latest.value - fiveYearAgo.value) / (latest.year - fiveYearAgo.year);
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
    const container = document.getElementById('ndc-chart');
    if (ts.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No emissions data available.</p></div>';
      return;
    }

    const sorted = [...ts].sort((a, b) => a.year - b.year);
    // 2000년 이후만 표시
    const recent = sorted.filter(r => r.year >= 2000);
    if (recent.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No post-2000 data.</p></div>';
      return;
    }

    const W = container.clientWidth || 500;
    const H = 260;
    const PAD = { top: 15, right: 50, bottom: 35, left: 55 };
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;

    // 범위: x = 2000~2035, y = 자동
    const minYear = 2000;
    const maxYear = 2035;
    const values = recent.map(r => r.value);
    const extras = [];
    if (target.target_mt) extras.push(target.target_mt);
    if (target.ref_mt) extras.push(target.ref_mt);
    if (gapInfo.projected2030) extras.push(gapInfo.projected2030);
    const allVals = [...values, ...extras].filter(v => v != null);
    const minVal = Math.min(0, Math.min(...allVals)) * 0.9;
    const maxVal = Math.max(...allVals) * 1.15;

    const xScale = (year) => PAD.left + ((year - minYear) / (maxYear - minYear)) * plotW;
    const yScale = (val) => PAD.top + plotH - ((val - minVal) / (maxVal - minVal)) * plotH;

    let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;

    // 그리드
    for (let i = 0; i <= 4; i++) {
      const v = minVal + (maxVal - minVal) * (i / 4);
      const y = yScale(v);
      svg += `<line x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}" stroke="#E5E7EB" stroke-width="0.5"/>`;
      svg += `<text x="${PAD.left - 4}" y="${y + 3}" text-anchor="end" font-size="8" fill="#8888A0" font-family="JetBrains Mono,monospace">${formatVal(v)}</text>`;
    }

    // X축
    for (let y = 2000; y <= 2035; y += 5) {
      const x = xScale(y);
      svg += `<line x1="${x}" y1="${PAD.top}" x2="${x}" y2="${PAD.top + plotH}" stroke="#E5E7EB" stroke-width="0.3"/>`;
      svg += `<text x="${x}" y="${H - 10}" text-anchor="middle" font-size="8" fill="#8888A0" font-family="JetBrains Mono,monospace">${y}</text>`;
    }

    // 2030 목표선 (absolute 타입)
    if (target.target_mt && target.ref_type === 'absolute') {
      const ty = yScale(target.target_mt);
      svg += `<line x1="${PAD.left}" y1="${ty}" x2="${W - PAD.right}" y2="${ty}" stroke="#E5484D" stroke-width="1.5" stroke-dasharray="6,3"/>`;
      svg += `<text x="${W - PAD.right + 3}" y="${ty + 3}" font-size="8" fill="#E5484D" font-family="Inter,sans-serif" font-weight="600">Target ${VC.fmt(target.target_mt, 0)}</text>`;
    }

    // 갭 영역 (projected와 target 사이)
    if (gapInfo.projected2030 != null && target.target_mt && target.ref_type === 'absolute') {
      const latestX = xScale(gapInfo.latestYear);
      const projX = xScale(2030);
      const projY = yScale(gapInfo.projected2030);
      const targetY = yScale(target.target_mt);
      const gapColor = gapInfo.gapMt > 0 ? 'rgba(229,72,77,0.12)' : 'rgba(0,166,126,0.12)';
      svg += `<polygon points="${latestX},${yScale(gapInfo.latestEmissions)} ${projX},${projY} ${projX},${targetY} ${latestX},${targetY}" fill="${gapColor}"/>`;
    }

    // 실배출 라인 (실선)
    const pathParts = recent.map((r, i) => {
      const x = xScale(r.year);
      const y = yScale(r.value);
      return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
    });
    svg += `<path d="${pathParts.join(' ')}" fill="none" stroke="#0066FF" stroke-width="2"/>`;

    // 투영 점선 (latest → 2030)
    if (gapInfo.projected2030 != null && gapInfo.latestEmissions != null) {
      const lx = xScale(gapInfo.latestYear);
      const ly = yScale(gapInfo.latestEmissions);
      const px = xScale(2030);
      const py = yScale(gapInfo.projected2030);
      svg += `<line x1="${lx}" y1="${ly}" x2="${px}" y2="${py}" stroke="#0066FF" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.6"/>`;
      svg += `<circle cx="${px}" cy="${py}" r="4" fill="#0066FF" opacity="0.6"/>`;
      svg += `<text x="${px + 5}" y="${py + 3}" font-size="8" fill="#0066FF" font-family="JetBrains Mono,monospace">${VC.fmt(gapInfo.projected2030, 0)}</text>`;
    }

    // 최신 데이터 포인트
    if (recent.length > 0) {
      const last = recent[recent.length - 1];
      svg += `<circle cx="${xScale(last.year)}" cy="${yScale(last.value)}" r="4" fill="#0066FF"/>`;
    }

    svg += '</svg>';
    container.innerHTML = svg;
  }

  function formatVal(v) {
    if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(0) + 'Gt';
    return v.toFixed(0) + 'Mt';
  }

  function showNotCovered(iso3) {
    hideAll();
    const el = document.getElementById('empty-state');
    el.style.display = 'flex';
    el.innerHTML = `<p>${iso3} is not in the 20-country NDC target list.</p>
      <p style="font-size:11px;color:#8888A0;margin-top:8px;">
        Covered countries: ${Object.keys(VC.NDC_TARGETS).join(', ')}
      </p>`;
  }

  function hideAll() {
    ['setup-screen', 'loading', 'empty-state', 'ndc-main'].forEach(function (id) {
      document.getElementById(id).style.display = 'none';
    });
  }

  function showEmptyState(msg) {
    hideAll();
    const el = document.getElementById('empty-state');
    el.style.display = 'flex';
    el.innerHTML = `<p>${msg || 'Select a country on the dashboard to view the NDC Gap Tracker.'}</p>
                    <p style="font-size:11px;color:#8888A0;margin-top:8px;">
                      The extension detects ISO3 or Country Code from filters or selected marks.
                    </p>`;
  }
})();
