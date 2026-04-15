(function () {
  'use strict';

  let currentModule = 0;
  let currentPhase = 'question';
  let activeFilters = []; // [{sheet, field}]

  // ———— Tableau parameter control ————
  async function findParameter(name) {
    try {
      const params = await tableau.extensions.dashboardContent.dashboard.getParametersAsync();
      return params.find(p => p.name === name) || null;
    } catch (e) {
      return null;
    }
  }

  async function setParameter(name, value) {
    try {
      var param = await findParameter(name);
      if (!param) return;

      // Skip if already set to desired value
      var current = param.currentValue.value;
      if (String(current) === String(value)) return;

      // Always pass String — Tableau API serializes all types to string anyway
      await param.changeValueAsync(String(value));
    } catch (e) {
      // Silently continue — Tableau may have set the value despite the API error
      // ("Missing output parameter: parameterControl" is a known Tableau API issue)
    }
  }

  async function applyFilter(worksheetName, fieldName, values) {
    try {
      const dashboard = tableau.extensions.dashboardContent.dashboard;
      const ws = dashboard.worksheets.find(w => w.name === worksheetName);
      if (ws) {
        await ws.applyFilterAsync(fieldName, values,
          tableau.FilterUpdateType.REPLACE);
      }
    } catch (e) {
      // standalone mode
    }
  }

  async function clearActiveFilters() {
    for (var i = 0; i < activeFilters.length; i++) {
      try {
        var dashboard = tableau.extensions.dashboardContent.dashboard;
        var ws = dashboard.worksheets.find(function (w) { return w.name === activeFilters[i].sheet; });
        if (ws) await ws.clearFilterAsync(activeFilters[i].field);
      } catch (e) { /* standalone mode */ }
    }
    activeFilters = [];
  }

  async function selectCountry(worksheetName, iso3) {
    try {
      const dashboard = tableau.extensions.dashboardContent.dashboard;
      const ws = dashboard.worksheets.find(w => w.name === worksheetName);
      if (ws) {
        await ws.selectMarksByValueAsync(
          [{ fieldName: 'Iso3', value: [{ value: iso3 }] }],
          tableau.SelectionUpdateType.REPLACE
        );
      }
    } catch (e) {
      // standalone mode
    }
  }

  // ———— Module data ————
  const MODULES = [
    {
      id: 1,
      title: '누가 배출하는가?',
      sheet: 'M1 Scatter',
      question: {
        text: '1인당 온실가스를 가장 많이 배출하는 나라는?',
        choices: [
          { label: '중국', iso3: 'CHN' },
          { label: '미국', iso3: 'USA' },
          { label: '사우디', iso3: 'SAU' },
          { label: '인도', iso3: 'IND' }
        ],
        answer: 'SAU'
      },
      reveal: {
        params: { p_Module: 1, p_Measure: 'GHG_PER_CAPITA', p_Phase: 'reveal' },
        highlight: 'SAU',
        text: '사우디: 1인당 24.1톤. 세계 평균의 4배입니다. 이 숫자는 한 사람이 1년 동안 남기는 기후 발자국입니다.'
      },
      explore: {
        prompt: '이번엔 "총배출"로 바꿔보세요. 순위가 어떻게 달라질까요?',
        params: { p_Measure: 'TOTAL_GHG' },
        text: '중국: 총 13,532Mt \u2014 하지만 1인당으로는 9.8톤. 프레임이 바뀌면 세계가 달라 보입니다.'
      },
      nameit: {
        concept: '총량 vs 1인당',
        definition: '같은 데이터도 어떻게 나누느냐에 따라 전혀 다른 이야기를 합니다. 총량은 나라의 무게를, 1인당은 사람 한 명의 발자국을 보여줍니다.'
      }
    },
    {
      id: 2,
      title: "누가 변하고 있는가?",
      sheet: 'M2 Line',
      question: {
        text: '2013\u20132023 \uc0ac\uc774 CO\u2082\ub97c \uac00\uc7a5 \ub9ce\uc774 \uc904\uc778 G7 \uad6d\uac00\ub294?',
        choices: [
          { label: '독일', iso3: 'DEU' },
          { label: '영국', iso3: 'GBR' },
          { label: '일본', iso3: 'JPN' },
          { label: '프랑스', iso3: 'FRA' }
        ],
        answer: 'GBR'
      },
      reveal: {
        params: { p_Module: 2, p_TimeMeasure: 'OWID.CO2', p_Phase: 'reveal' },
        highlight: 'GBR',
        text: '영국: 10년 만에 CO\u2082 35% 감축 \u2014 G7 국가 중 가장 빠른 감소입니다. 석탄 발전을 거의 중단했기 때문입니다.'
      },
      explore: {
        prompt: "이번엔 '석탄 CO\u2082'로 바꿔보세요. 영국의 감축을 이끈 진짜 원인은?",
        params: { p_TimeMeasure: 'OWID.COAL_CO2' },
        text: '영국 석탄 CO\u2082: 148Mt → 18Mt로 급감. 석탄 단계적 폐지가 단일 최대 동력이었습니다. 기후 행동은 특정 선택에서 시작됩니다.'
      },
      nameit: {
        concept: '석탄 퇴출 효과',
        definition: '석탄을 가스와 재생에너지로 교체하면 가장 빠른 배출 감축이 일어납니다. 영국은 10년도 안 돼서 이를 증명했습니다.'
      }
    },
    {
      id: 3,
      title: '에너지의 현실',
      sheet: 'M3 Map',
      question: {
        text: '전기의 50% 이상을 재생에너지로 만드는 나라는 몇 개국일까요?',
        choices: [
          { label: '10개 미만', value: 'lt10' },
          { label: '약 25개국', value: 'about25' },
          { label: '50개 이상', value: 'mt50' },
          { label: '100개 이상', value: 'over100' }
        ],
        answer: 'mt50'
      },
      reveal: {
        params: { p_Module: 3, p_Measure: 'RENEWABLE_PCT', p_Phase: 'reveal' },
        text: '50개국 이상이 재생에너지 50%를 넘습니다 \u2014 대부분은 수력 덕분입니다. 하지만 재생에너지 비율이 높다고 경제 전체가 깨끗한 건 아닙니다.'
      },
      explore: {
        prompt: '이번엔 "탄소 집약도"로 바꿔보세요. 재생에너지 = 깨끗한 경제일까요?',
        params: { p_Measure: 'CARBON_INTENSITY' },
        text: '재생에너지 비율이 높아도 산업과 수송 부문의 탄소 집약도가 높은 나라가 많습니다. 전기가 깨끗해도 경제 전체가 저절로 깨끗해지진 않습니다.'
      },
      nameit: {
        concept: '재생에너지 \u2260 깨끗한 경제',
        definition: "전기 부문의 높은 재생에너지 비율이 전체 배출량이 낮다는 보장은 아닙니다. 전체 에너지 믹스를 봐야 합니다."
      }
    },
    {
      id: 4,
      title: '약속 vs 현실',
      sheet: 'M2 Line',
      question: {
        text: 'G20 국가 중 2030 NDC 목표를 달성할 궤도에 있는 나라는 몇 개국일까요?',
        choices: [
          { label: '대부분 (15개 이상)', value: 'most' },
          { label: '약 절반 (8\u201310개)', value: 'half' },
          { label: '소수 (2\u20134개)', value: 'few' },
          { label: '없음 (0개)', value: 'none' }
        ],
        answer: 'few'
      },
      reveal: {
        params: { p_Module: 4, p_TimeMeasure: 'OWID.TOTAL_GHG_EXCLUDING_LUCF', p_Phase: 'reveal' },
        text: 'G20 중 단 2\u20134개국만 궤도에 있습니다. 대부분은 자신의 약속보다 훨씬 뒤처져 있습니다. 목표와 현실 사이의 간극이 기후 위기의 핵심입니다.'
      },
      explore: {
        prompt: "한국을 클릭해보세요. NDC 목표는 2030년까지 \u221240%입니다. 실제 추세는 어디로 가고 있을까요?",
        params: {},
        filters: [{ sheet: 'M2 Line', field: 'Name', values: ['South Korea'] }],
        text: "한국 목표: 2030년 436Mt. 현재 추세: 624Mt. 188Mt 격차 \u2014 약 43% 초과입니다. 약속만으로는 기온이 내려가지 않습니다."
      },
      nameit: {
        concept: 'NDC 이행 격차',
        definition: "국가가 약속한 것(NDC)과 실제로 하고 있는 것 사이의 간극입니다. 이것이 기후 정책의 핵심 위기입니다."
      }
    },
    {
      id: 5,
      title: '기후 정의',
      sheet: 'M1 Scatter',
      question: {
        text: "아프리카의 누적 CO\u2082 배출 비중은 전 세계의 약 몇 %일까요?",
        choices: [
          { label: '약 20%', value: '20pct' },
          { label: '약 10%', value: '10pct' },
          { label: '약 3%', value: '3pct' },
          { label: '1% 미만', value: 'lt1pct' }
        ],
        answer: '3pct'
      },
      reveal: {
        params: { p_Module: 5, p_Measure: 'VULNERABILITY', p_Phase: 'reveal' },
        text: '아프리카: 누적 CO\u2082의 ~3%를 배출했지만, 기후 취약도는 가장 높습니다. 원인을 만든 곳과 피해를 받는 곳이 다릅니다.'
      },
      explore: {
        prompt: '"저소득국" 필터를 적용해보세요. 차트에서 어디에 위치할까요?',
        params: {},
        filters: [{ sheet: 'M1 Scatter', field: 'Income Group', values: ['Low income'] }],
        text: "저소득국은 왼쪽 아래에 몰려 있습니다: 가장 낮은 배출, 가장 낮은 GDP, 가장 높은 취약도. 위기를 만들지 않았지만 가장 큰 피해를 받습니다."
      },
      nameit: {
        concept: '기후 정의 격차',
        definition: '기후변화에 가장 적게 기여한 사람들이 가장 큰 피해를 받습니다. 이 불평등이 기후 위기의 핵심 도덕적 과제입니다.'
      }
    }
  ];

  // ———— Phase rendering ————
  function renderQuestion(mod) {
    var panel = document.getElementById('literacy-panel');
    var isIso3 = mod.question.choices[0].iso3 !== undefined;
    var html = '<div class="lit-module-header">';
    html += '<span class="lit-module-tag">Module ' + mod.id + '</span>';
    html += '<span class="lit-module-title">' + mod.title + '</span>';
    html += '</div>';
    html += '<p class="lit-question-text">' + mod.question.text + '</p>';
    html += '<div class="lit-choices">';
    mod.question.choices.forEach(function (c) {
      var val = isIso3 ? c.iso3 : c.value;
      html += '<button class="lit-choice-btn" data-answer="' + val + '">' + c.label + '</button>';
    });
    html += '</div>';
    panel.innerHTML = html;

    panel.querySelectorAll('.lit-choice-btn').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        panel.querySelectorAll('.lit-choice-btn').forEach(function (b) {
          b.disabled = true;
        });

        var answer = btn.dataset.answer;
        var correct = answer === mod.question.answer;
        btn.classList.add(correct ? 'lit-correct' : 'lit-wrong');

        if (!correct) {
          panel.querySelectorAll('.lit-choice-btn').forEach(function (b) {
            if (b.dataset.answer === mod.question.answer) {
              b.classList.add('lit-correct');
            }
          });
        }

        if (isIso3) {
          await selectCountry(mod.sheet, answer);
        }
        setTimeout(function () { goToPhase('reveal'); }, 1200);
      });
    });
  }

  async function renderReveal(mod) {
    for (var key in mod.reveal.params) {
      await setParameter(key, mod.reveal.params[key]);
    }
    if (mod.reveal.highlight) {
      await selectCountry(mod.sheet, mod.reveal.highlight);
    }

    var panel = document.getElementById('literacy-panel');
    var html = '<div class="lit-module-header">';
    html += '<span class="lit-module-tag">Module ' + mod.id + '</span>';
    html += '<span class="lit-module-title">' + mod.title + '</span>';
    html += '</div>';
    html += '<div class="lit-reveal-card">';
    html += '<div class="lit-reveal-icon">&#128161;</div>';
    html += '<div class="lit-reveal-text">' + mod.reveal.text + '</div>';
    html += '</div>';
    html += '<button class="lit-next-btn" id="btn-explore">더 탐색하기 <span class="lit-arrow">&rarr;</span></button>';
    panel.innerHTML = html;

    document.getElementById('btn-explore').addEventListener('click', function () {
      goToPhase('explore');
    });
  }

  async function renderExplore(mod) {
    for (var key in mod.explore.params) {
      await setParameter(key, mod.explore.params[key]);
    }
    if (mod.explore.filters) {
      for (var i = 0; i < mod.explore.filters.length; i++) {
        var f = mod.explore.filters[i];
        await applyFilter(f.sheet, f.field, f.values);
        activeFilters.push({ sheet: f.sheet, field: f.field });
      }
    }

    var panel = document.getElementById('literacy-panel');
    var html = '<div class="lit-module-header">';
    html += '<span class="lit-module-tag">Module ' + mod.id + '</span>';
    html += '<span class="lit-module-title">' + mod.title + '</span>';
    html += '</div>';
    html += '<p class="lit-explore-prompt">' + mod.explore.prompt + '</p>';
    html += '<div class="lit-explore-card">';
    html += '<div class="lit-explore-text">' + mod.explore.text + '</div>';
    html += '</div>';
    html += '<button class="lit-next-btn" id="btn-nameit">개념 이름 붙이기 <span class="lit-arrow">&rarr;</span></button>';
    panel.innerHTML = html;

    document.getElementById('btn-nameit').addEventListener('click', function () {
      goToPhase('nameit');
    });
  }

  function renderNameIt(mod) {
    var panel = document.getElementById('literacy-panel');
    var isLast = mod.id >= MODULES.length;
    var html = '<div class="lit-module-header">';
    html += '<span class="lit-module-tag">Module ' + mod.id + '</span>';
    html += '<span class="lit-module-title">' + mod.title + '</span>';
    html += '</div>';
    html += '<div class="lit-concept-card">';
    html += '<div class="lit-concept-label">핵심 개념</div>';
    html += '<div class="lit-concept-name">' + mod.nameit.concept + '</div>';
    html += '<div class="lit-concept-def">' + mod.nameit.definition + '</div>';
    html += '</div>';
    html += '<button class="lit-next-btn" id="btn-next">';
    html += isLast ? '탐색 시작하기 <span class="lit-arrow">&rarr;</span>' : '다음 모듈 <span class="lit-arrow">&rarr;</span>';
    html += '</button>';
    panel.innerHTML = html;

    document.getElementById('btn-next').addEventListener('click', function () {
      if (isLast) {
        renderComplete();
      } else {
        currentModule++;
        goToPhase('question');
      }
    });
  }

  function renderComplete() {
    var panel = document.getElementById('literacy-panel');
    panel.innerHTML =
      '<div class="lit-complete">' +
      '<div class="lit-complete-icon">&#127891;</div>' +
      '<div class="lit-complete-title">모듈 완료!</div>' +
      '<p class="lit-complete-text">기후 데이터를 읽는 5가지 프레임을 학습했습니다. 이제 대시보드를 자유롭게 탐색해보세요.</p>' +
      '<button class="lit-next-btn" id="btn-restart">다시 시작 <span class="lit-arrow">&rarr;</span></button>' +
      '</div>';
    document.getElementById('btn-restart').addEventListener('click', function () {
      currentModule = 0;
      goToPhase('question');
    });
  }

  // ———— Phase navigation ————
  async function goToPhase(phase) {
    currentPhase = phase;
    if (phase === 'question') {
      await clearActiveFilters();
      var mod = MODULES[currentModule];
      await setParameter('p_Module', mod.id);
      if (mod.sheet === 'M1 Scatter') {
        await setParameter('p_Measure', 'GHG_PER_CAPITA');
      } else if (mod.sheet === 'M2 Line') {
        await setParameter('p_TimeMeasure', 'OWID.CO2');
      } else if (mod.sheet === 'M3 Map') {
        await setParameter('p_Measure', 'RENEWABLE_PCT');
      }
    }
    await setParameter('p_Phase', phase);
    var mod = MODULES[currentModule];
    switch (phase) {
      case 'question': renderQuestion(mod); break;
      case 'reveal': await renderReveal(mod); break;
      case 'explore': await renderExplore(mod); break;
      case 'nameit': renderNameIt(mod); break;
    }
    updateProgress();
  }

  function updateProgress() {
    var total = MODULES.length * 4;
    var phaseIndex = ['question', 'reveal', 'explore', 'nameit'].indexOf(currentPhase);
    var current = currentModule * 4 + phaseIndex + 1;
    var pct = (current / total) * 100;
    var fill = document.getElementById('progress-fill');
    if (fill) {
      fill.style.width = pct + '%';
    }
  }

  // ———— Init ————
  document.addEventListener('DOMContentLoaded', function () {
    if (typeof tableau === 'undefined' || !tableau.extensions) {
      startLiteracy();
      return;
    }
    tableau.extensions.initializeAsync().then(startLiteracy);
  });

  async function startLiteracy() {
    currentModule = 0;
    currentPhase = 'question';
    await setParameter('p_Module', 1);
    await setParameter('p_Phase', 'question');
    await setParameter('p_Measure', 'GHG_PER_CAPITA');
    renderQuestion(MODULES[0]);
    updateProgress();
  }
})();
