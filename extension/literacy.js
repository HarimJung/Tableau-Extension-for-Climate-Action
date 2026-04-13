(function () {
  'use strict';

  let currentModule = 0;
  let currentPhase = 'question';
  let activeFilters = []; // [{sheet, field}]

  // ———— Tableau parameter control ————
  async function findParameter(name) {
    try {
      const dashboard = tableau.extensions.dashboardContent.dashboard;
      const worksheets = dashboard.worksheets;
      if (worksheets.length > 0) {
        const params = await worksheets[0].getParametersAsync();
        return params.find(p => p.name === name);
      }
    } catch (e) {
      // standalone mode — no Tableau
    }
    return null;
  }

  async function setParameter(name, value) {
    const param = await findParameter(name);
    if (param) {
      await param.changeValueAsync(value);
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
      title: 'Who Emits?',
      sheet: 'M1 Scatter',
      question: {
        text: 'Which country emits the MOST greenhouse gas per person?',
        choices: [
          { label: 'China', iso3: 'CHN' },
          { label: 'United States', iso3: 'USA' },
          { label: 'Saudi Arabia', iso3: 'SAU' },
          { label: 'India', iso3: 'IND' }
        ],
        answer: 'SAU'
      },
      reveal: {
        params: { p_Module: 1, p_Measure: 'GHG_PER_CAPITA', p_Phase: 'reveal' },
        highlight: 'SAU',
        text: 'Saudi Arabia: 24.1 tCO\u2082eq per person. Almost 4\u00d7 the world average.'
      },
      explore: {
        prompt: 'Now switch to TOTAL emissions. Which country leads?',
        params: { p_Measure: 'TOTAL_GHG' },
        text: 'China emits 13,532 Mt total \u2014 but only 9.8t per person. Framing changes everything.'
      },
      nameit: {
        concept: 'Total vs Per Capita',
        definition: 'The same data tells different stories depending on whether you measure by country or by person.'
      }
    },
    {
      id: 2,
      title: "Who's Changing?",
      sheet: 'M2 Line',
      question: {
        text: '2013\u20132023 \uc0ac\uc774 CO\u2082\ub97c \uac00\uc7a5 \ub9ce\uc774 \uc904\uc778 G7 \uad6d\uac00\ub294?',
        choices: [
          { label: 'Germany', iso3: 'DEU' },
          { label: 'United Kingdom', iso3: 'GBR' },
          { label: 'Japan', iso3: 'JPN' },
          { label: 'France', iso3: 'FRA' }
        ],
        answer: 'GBR'
      },
      reveal: {
        params: { p_Module: 2, p_TimeMeasure: 'OWID.CO2', p_Phase: 'reveal' },
        highlight: 'GBR',
        text: 'UK cut CO\u2082 by 35% in 10 years \u2014 the fastest reduction among G7 nations.'
      },
      explore: {
        prompt: "Switch to Coal CO\u2082. What drove the UK\u2019s reduction?",
        params: { p_TimeMeasure: 'OWID.COAL_CO2' },
        text: 'UK coal CO\u2082 dropped from 148 Mt to 18 Mt. Coal phase-out was the single biggest driver.'
      },
      nameit: {
        concept: 'Coal Phase-out Effect',
        definition: 'Replacing coal with gas and renewables delivers the fastest emissions reduction. The UK proved it in under a decade.'
      }
    },
    {
      id: 3,
      title: 'Energy Reality',
      sheet: 'M3 Map',
      question: {
        text: 'How many countries generate more than 50% of electricity from renewables?',
        choices: [
          { label: 'Less than 10', value: 'lt10' },
          { label: 'About 25', value: 'about25' },
          { label: 'More than 50', value: 'mt50' },
          { label: 'Over 100', value: 'over100' }
        ],
        answer: 'mt50'
      },
      reveal: {
        params: { p_Module: 3, p_Measure: 'RENEWABLE_PCT', p_Phase: 'reveal' },
        text: 'Over 50 countries exceed 50% renewable electricity \u2014 mostly thanks to hydropower.'
      },
      explore: {
        prompt: 'Now switch to Carbon Intensity. Does renewable = clean?',
        params: { p_Measure: 'CARBON_INTENSITY' },
        text: 'Some high-renewable countries still have high carbon intensity in industry and transport. Renewable electricity \u2260 clean economy.'
      },
      nameit: {
        concept: 'Renewable \u2260 Clean',
        definition: "High renewable electricity share doesn\u2019t guarantee low overall emissions. The full energy mix matters."
      }
    },
    {
      id: 4,
      title: 'Promises vs Reality',
      sheet: 'M2 Line',
      question: {
        text: 'How many G20 countries are on track to meet their 2030 NDC targets?',
        choices: [
          { label: 'Most of them (15+)', value: 'most' },
          { label: 'About half (8\u201310)', value: 'half' },
          { label: 'A few (2\u20134)', value: 'few' },
          { label: 'None (0)', value: 'none' }
        ],
        answer: 'few'
      },
      reveal: {
        params: { p_Module: 4, p_TimeMeasure: 'OWID.TOTAL_GHG_EXCLUDING_LUCF', p_Phase: 'reveal' },
        text: 'Only 2\u20134 G20 nations are on track. Most are far behind their own promises.'
      },
      explore: {
        prompt: "Look at South Korea: NDC target is \u221240% by 2030. Where is the trend heading?",
        params: {},
        filters: [{ sheet: 'M2 Line', field: 'Name', values: ['South Korea'] }],
        text: "Korea\u2019s target: 436 Mt by 2030. Current trend: 624 Mt. That\u2019s a 188 Mt gap \u2014 nearly 43% overshoot."
      },
      nameit: {
        concept: 'NDC Implementation Gap',
        definition: "The gap between what countries promise (NDC) and what they\u2019re actually doing. This is the core crisis of climate policy."
      }
    },
    {
      id: 5,
      title: 'Climate Justice',
      sheet: 'M1 Scatter',
      question: {
        text: "Africa\u2019s share of global cumulative CO\u2082 emissions is approximately:",
        choices: [
          { label: 'About 20%', value: '20pct' },
          { label: 'About 10%', value: '10pct' },
          { label: 'About 3%', value: '3pct' },
          { label: 'Less than 1%', value: 'lt1pct' }
        ],
        answer: '3pct'
      },
      reveal: {
        params: { p_Module: 5, p_Measure: 'VULNERABILITY', p_Phase: 'reveal' },
        text: 'Africa contributed ~3% of cumulative CO\u2082 but faces the highest climate vulnerability scores.'
      },
      explore: {
        prompt: 'Filter to Low Income countries only. Where do they sit on the chart?',
        params: {},
        filters: [{ sheet: 'M1 Scatter', field: 'Income Group', values: ['Low income'] }],
        text: "Low-income countries cluster at bottom-left: lowest emissions, lowest GDP, highest vulnerability. They didn\u2019t cause the crisis but bear the worst consequences."
      },
      nameit: {
        concept: 'Climate Justice Gap',
        definition: 'Those who contributed least to climate change suffer its worst impacts. This inequity is the central moral challenge of the climate crisis.'
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
    html += '<button class="lit-next-btn" id="btn-explore">Explore further <span class="lit-arrow">&rarr;</span></button>';
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
    html += '<button class="lit-next-btn" id="btn-nameit">Name this concept <span class="lit-arrow">&rarr;</span></button>';
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
    html += '<div class="lit-concept-label">Key Concept</div>';
    html += '<div class="lit-concept-name">' + mod.nameit.concept + '</div>';
    html += '<div class="lit-concept-def">' + mod.nameit.definition + '</div>';
    html += '</div>';
    html += '<button class="lit-next-btn" id="btn-next">';
    html += isLast ? 'Start Exploring <span class="lit-arrow">&rarr;</span>' : 'Next Module <span class="lit-arrow">&rarr;</span>';
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
      '<div class="lit-complete-title">Module Complete!</div>' +
      '<p class="lit-complete-text">You\'ve completed all available modules. More coming soon.</p>' +
      '<button class="lit-next-btn" id="btn-restart">Restart <span class="lit-arrow">&rarr;</span></button>' +
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
