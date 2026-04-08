/**
 * app.js — Visual Climate Climate Card Extension
 *
 * 동작 흐름:
 * 1. tableau.extensions.initializeAsync()
 * 2. settings에서 Supabase URL/Key 로드
 *   → 없으면 setup screen 표시 → 사용자 입력 → settings에 저장
 * 3. 대시보드 워크시트에서 ISO3 탐지 (필터 또는 마크 선택)
 * 4. Supabase REST API로 country + REPORT.* 지표 조회
 * 5. Climate Card UI 렌더링
 * 6. FilterChanged / MarkSelectionChanged 이벤트로 자동 업데이트
 */

(function () {
  'use strict';

  let currentISO3 = null;

  // ———— 초기화 (setup screen 없이 즉시 시작) ————
  document.addEventListener('DOMContentLoaded', function () {
    if (typeof tableau === 'undefined' || !tableau.extensions) {
      // Standalone 모드: 즉시 시작
      console.warn('Tableau Extensions API not available. Running in standalone mode.');
      startApp();
      return;
    }

    tableau.extensions.initializeAsync().then(function () {
      startApp();
    }).catch(function (err) {
      console.error('Init error:', err);
      showError('Extension initialization failed: ' + err.message);
    });
  });

  // ———— 앱 시작 (Tableau/Standalone 공용) ————
  async function startApp() {
    hideAll();
    document.getElementById('loading').style.display = 'flex';

    console.log('[Tableau Ext] startApp initialized. isStandalone:', VC.isStandaloneMode());

    try {
      const iso3 = await VC.detectISO3FromDashboard();
      console.log('[Tableau Ext] Initial detected ISO3:', iso3);
      
      if (!iso3) {
        showEmptyState('Please select a country on the dashboard to view its Climate Card.');
      } else {
        await renderCard(iso3);
      }
    } catch (e) {
      console.error('[Tableau Ext] Start error:', e);
      showError('Failed to load data: ' + e.message);
    }

    // 이벤트 리스너
    VC.onFilterChange(onDashboardChange);
    VC.onMarkSelection(onDashboardChange);
  }

  async function onDashboardChange() {
    try {
      const iso3 = await VC.detectISO3FromDashboard();
      console.log('[Tableau Ext] Dashboard changed. Detected ISO3:', iso3);
      
      if (iso3 && iso3 !== currentISO3) {
        await renderCard(iso3);
      } else if (!iso3 && currentISO3) {
        currentISO3 = null;
        showEmptyState('Please select a country on the dashboard to view its Climate Card.');
      }
    } catch (e) {
      console.error('[Tableau Ext] Dashboard change error:', e);
      showError('ERROR: ' + e.message);
    }
  }

  // ———— Climate Card 렌더링 ————
  async function renderCard(iso3) {
    hideAll();
    document.getElementById('loading').style.display = 'flex';
    currentISO3 = iso3;

    try {
      // 병렬 조회
      const [card, peer] = await Promise.all([
        VC.getReportCard(iso3),
        VC.getPeerContext(iso3),
      ]);

      if (!card) {
        showEmptyState();
        return;
      }

      hideAll();
      document.getElementById('climate-card').style.display = 'block';

      // Header
      document.getElementById('card-flag').textContent = VC.iso3ToFlag(iso3);
      document.getElementById('card-name').textContent = card.name;
      document.getElementById('card-meta').textContent =
        `${iso3} \u00b7 ${card.region || '\u2014'} \u00b7 ${card.income_group || '\u2014'}`;

      // Score Hero
      const scoreEl = document.getElementById('card-score');
      scoreEl.classList.remove('score-animate');
      scoreEl.textContent =
        card.total_score != null ? VC.fmt(card.total_score) : '\u2014';
      scoreEl.classList.add('score-animate');

      const gradeEl = document.getElementById('card-grade');
      const grade = card.grade || '\u2014';
      gradeEl.textContent = grade;
      gradeEl.style.background = VC.GRADE_BG[grade] || '#F8F9FA';
      gradeEl.style.color = VC.GRADE_COLOR[grade] || '#1A1A2E';

      // Class Pill
      const classEl = document.getElementById('card-class');
      const className = VC.CLASS_LABEL[card.climate_class] || null;
      if (className) {
        classEl.textContent = className;
        classEl.style.background = VC.CLASS_COLOR[className];
        classEl.style.display = 'inline-block';
      } else {
        classEl.style.display = 'none';
      }

      // Rank
      document.getElementById('card-rank').textContent =
        peer.globalRank ? `#${peer.globalRank} / ${peer.totalCountries}` : '';

      // Domain Bars
      renderDomainBars(card);

      // Animate domain bar fills from 0% to target width
      requestAnimationFrame(() => {
        document.querySelectorAll('.domain-bar-fill').forEach(el => {
          const target = el.getAttribute('data-target-width');
          el.style.width = target;
        });
      });

      // Radar Chart
      RadarChart.render('domain-radar', {
        emissions: card.emissions_score,
        energy: card.energy_score,
        economy: card.economy_score,
        responsibility: card.responsibility_score,
        resilience: card.resilience_score,
      });

      // Key Insights
      renderInsights(card, peer);

    } catch (e) {
      console.error('Render error:', e);
      document.getElementById('empty-state').style.display = 'flex';
      document.getElementById('empty-state').innerHTML = 'ERROR: ' + e.message;
    }
  }

  function renderDomainBars(card) {
    const container = document.getElementById('domain-bar-list');
    container.innerHTML = '';

    // 글로벌 평균 (대략적 중앙값; 실제 계산은 getPeerContext에서 하되 여기서는 시각 참조용)
    // RAG 레포에서의 global avg는 약: Emissions 55, Energy 50, Economy 45, Responsibility 60, Resilience 40
    const GLOBAL_AVG = { emissions: 55, energy: 50, economy: 45, responsibility: 60, resilience: 40 };

    for (const d of VC.DOMAINS) {
      const score = card[d.scoreField];
      const pct = score != null ? Math.min(100, Math.max(0, score)) : 0;
      const avg = GLOBAL_AVG[d.key] || 50;

      const row = document.createElement('div');
      row.className = 'domain-bar-row';
      row.innerHTML = `
        <div class="domain-tooltip">${d.label}: ${score != null ? VC.fmt(score) + '/100' : 'No data'} · Weight: ${d.weight} · Global avg: ${avg}</div>
        <span class="domain-label">${d.label} <span style="font-size:9px;color:${VC.BRAND.textMuted}">(${d.weight})</span></span>
        <div class="domain-bar-track">
          <div class="domain-bar-fill" style="width:0%;background:${d.color};" data-target-width="${pct}%"></div>
          <div class="domain-bar-avg" style="left:${avg}%;" title="Global Avg: ${avg}"></div>
        </div>
        <span class="domain-bar-value" style="color:${score != null ? d.color : VC.BRAND.dataMissing}">${score != null ? VC.fmt(score) : '\u2014'}</span>
      `;
      container.appendChild(row);
    }
  }

  function renderInsights(card, peer) {
    const el = document.getElementById('insights');
    const lines = [];

    // 최고/최저 도메인 (ReportCardClient.tsx 로직)
    const domainScores = VC.DOMAINS
      .map(d => ({ label: d.label, score: card[d.scoreField] }))
      .filter(d => d.score != null)
      .sort((a, b) => b.score - a.score);

    if (domainScores.length > 0) {
      const best = domainScores[0];
      const worst = domainScores[domainScores.length - 1];
      lines.push(`<strong>Strongest:</strong> ${best.label} (${VC.fmt(best.score)}, ${VC.perfLabel(best.score)})`);
      if (domainScores.length > 1) {
        lines.push(`<strong>Weakest:</strong> ${worst.label} (${VC.fmt(worst.score)}, ${VC.perfLabel(worst.score)})`);
      }
    }

    // Climate Class 설명
    const className = VC.CLASS_LABEL[card.climate_class];
    if (className && VC.CLASS_EXPLAIN[className]) {
      lines.push(`<strong>Classification:</strong> ${className} \u2014 ${VC.CLASS_EXPLAIN[className]}`);
    }

    // 순위 컨텍스트
    if (peer.globalRank) {
      lines.push(`<strong>Global Rank:</strong> #${peer.globalRank} of ${peer.totalCountries} countries`);
    }
    if (peer.incomeRank) {
      lines.push(`<strong>Income Group Rank:</strong> #${peer.incomeRank} of ${peer.incomeTotal}`);
    }

    el.innerHTML = lines.join('<br>');
  }

  // ———— View Toggle ————
  window.showView = function (view) {
    const barsEl = document.getElementById('domain-bars');
    const radarEl = document.getElementById('domain-radar');
    const btnBars = document.getElementById('btn-bars');
    const btnRadar = document.getElementById('btn-radar');

    if (view === 'radar') {
      barsEl.style.display = 'none';
      radarEl.style.display = 'flex';
      btnBars.style.background = 'white'; btnBars.style.color = '#1A1A2E';
      btnRadar.style.background = '#0066FF'; btnRadar.style.color = 'white';
    } else {
      barsEl.style.display = 'block';
      radarEl.style.display = 'none';
      btnBars.style.background = '#0066FF'; btnBars.style.color = 'white';
      btnRadar.style.background = 'white'; btnRadar.style.color = '#1A1A2E';
    }
  };

  // ———— UI 헬퍼 ————
  function hideAll() {
    document.getElementById('setup-screen').style.display = 'none';
    document.getElementById('loading').style.display = 'none';
    document.getElementById('empty-state').style.display = 'none';
    document.getElementById('climate-card').style.display = 'none';
  }

  function showEmptyState(msg) {
    hideAll();
    const el = document.getElementById('empty-state');
    el.style.display = 'flex';
    el.innerHTML = `<p>${msg || 'Select a country on the dashboard to view its Climate Card.'}</p>
                    <p style="font-size:11px;color:#8888A0;margin-top:8px;">
                      The extension detects ISO3 or Country Code from filters or selected marks.
                    </p>`;
  }

  function showError(msg) {
    hideAll();
    const el = document.getElementById('empty-state');
    el.style.display = 'flex';
    el.innerHTML = `<p style="color:#E5484D">${msg}</p>`;
  }
})();
