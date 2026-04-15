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

  // ———— Module data (English) ————
  const MODULES = [
    {
      id: 1,
      title: 'Who Emits?',
      sheet: 'M1 Scatter',
      question: {
        text: 'Which country has the highest greenhouse gas emissions per person?',
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
        text: 'Saudi Arabia: 24.1 tonnes per person — four times the global average. This number is the climate footprint one person leaves in a single year.'
      },
      explore: {
        prompt: 'Now switch to "Total emissions." How does the ranking change?',
        params: { p_Measure: 'TOTAL_GHG' },
        text: 'China: 13,532 Mt total — but only 9.8 tonnes per person. Change the frame and the world looks completely different.'
      },
      nameit: {
        concept: 'Total vs Per Capita',
        definition: 'The same data tells entirely different stories depending on how you divide it. Total shows a country\'s weight; per capita shows one person\'s footprint.'
      }
    },
    {
      id: 2,
      title: 'Who Is Changing?',
      sheet: 'M2 Line',
      question: {
        text: 'Which G7 country cut CO\u2082 the most between 2013 and 2023?',
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
        text: 'The UK: a 35% CO\u2082 reduction in ten years — the fastest decline among G7 nations. The reason? It nearly eliminated coal power.'
      },
      explore: {
        prompt: 'Now switch to "Coal CO\u2082." What really drove the UK\'s decline?',
        params: { p_TimeMeasure: 'OWID.COAL_CO2' },
        text: 'UK coal CO\u2082: 148 Mt \u2192 18 Mt. The coal phase-out was the single largest driver. Climate action starts with specific choices.'
      },
      nameit: {
        concept: 'The Coal Phase-Out Effect',
        definition: 'Replacing coal with gas and renewables delivers the fastest emission cuts. The UK proved this in under a decade.'
      }
    },
    {
      id: 3,
      title: 'The Energy Reality',
      sheet: 'M3 Map',
      question: {
        text: 'How many countries generate more than 50% of their electricity from renewables?',
        choices: [
          { label: 'Fewer than 10', value: 'lt10' },
          { label: 'About 25', value: 'about25' },
          { label: 'More than 50', value: 'mt50' },
          { label: 'Over 100', value: 'over100' }
        ],
        answer: 'mt50'
      },
      reveal: {
        params: { p_Module: 3, p_Measure: 'RENEWABLE_PCT', p_Phase: 'reveal' },
        text: 'More than 50 countries exceed 50% renewable electricity — mostly thanks to hydropower. But a high renewable share doesn\'t mean a clean economy.'
      },
      explore: {
        prompt: 'Now switch to "Carbon intensity." Does renewable electricity = a clean economy?',
        params: { p_Measure: 'CARBON_INTENSITY' },
        text: 'Many countries with high renewable shares still have carbon-intensive industry and transport. Clean electricity doesn\'t automatically mean a clean economy.'
      },
      nameit: {
        concept: 'Renewables \u2260 Clean Economy',
        definition: 'A high share of renewable electricity does not guarantee low overall emissions. You have to look at the full energy mix.'
      }
    },
    {
      id: 4,
      title: 'Promises vs Reality',
      sheet: 'M2 Line',
      question: {
        text: 'How many G20 countries are on track to meet their 2030 NDC targets?',
        choices: [
          { label: 'Most (15+)', value: 'most' },
          { label: 'About half (8\u201310)', value: 'half' },
          { label: 'A few (2\u20134)', value: 'few' },
          { label: 'None (0)', value: 'none' }
        ],
        answer: 'few'
      },
      reveal: {
        params: { p_Module: 4, p_TimeMeasure: 'OWID.TOTAL_GHG_EXCLUDING_LUCF', p_Phase: 'reveal' },
        text: 'Only 2\u20134 G20 members are on track. Most are falling far short of their own pledges. The gap between targets and reality is the heart of the climate crisis.'
      },
      explore: {
        prompt: 'Click South Korea. Its NDC target is \u221240% by 2030. Where is the actual trend heading?',
        params: {},
        filters: [{ sheet: 'M2 Line', field: 'Name', values: ['South Korea'] }],
        text: 'South Korea\'s target: 436 Mt by 2030. Current trend: 624 Mt. A gap of 188 Mt — roughly 43% over. Promises alone don\'t lower temperatures.'
      },
      nameit: {
        concept: 'The NDC Implementation Gap',
        definition: 'The distance between what a country has pledged (its NDC) and what it is actually doing. This is the central crisis of climate policy.'
      }
    },
    {
      id: 5,
      title: 'Climate Justice',
      sheet: 'M1 Scatter',
      question: {
        text: 'What share of cumulative global CO\u2082 emissions comes from Africa?',
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
        text: 'Africa: ~3% of cumulative CO\u2082, yet the highest climate vulnerability. Those who caused the crisis and those who suffer from it are not the same.'
      },
      explore: {
        prompt: 'Apply the "Low income" filter. Where do these countries sit on the chart?',
        params: {},
        filters: [{ sheet: 'M1 Scatter', field: 'Income Group', values: ['Low income'] }],
        text: 'Low-income countries cluster in the bottom left: lowest emissions, lowest GDP, highest vulnerability. They didn\'t create this crisis, yet they bear the greatest cost.'
      },
      nameit: {
        concept: 'The Climate Justice Gap',
        definition: 'Those who have contributed least to climate change suffer the most from its consequences. This inequality is the core moral challenge of the climate crisis.'
      }
    }
  ];

  // ———— Helpers ————
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  // ———— Phase rendering ————
  function renderQuestion(mod) {
    var panel = document.getElementById('literacy-panel');
    var isIso3 = mod.question.choices[0].iso3 !== undefined;

    var html = '<div class="iq-frame">';
    html += '<div class="iq-eyebrow">';
    html += '<span class="iq-eyebrow-title">' + mod.title + '</span>';
    html += '<span class="iq-eyebrow-rule"></span>';
    html += '<span class="iq-eyebrow-count">' + pad2(mod.id) + ' / 05</span>';
    html += '</div>';
    html += '<h2 class="iq-question">' + mod.question.text + '</h2>';
    html += '<ol class="iq-options">';
    mod.question.choices.forEach(function (c, i) {
      var val = isIso3 ? c.iso3 : c.value;
      html += '<li class="iq-option" data-answer="' + val + '">';
      html += '<span class="iq-option-num">' + pad2(i + 1) + '</span>';
      html += '<span class="iq-option-text">' + c.label + '</span>';
      html += '</li>';
    });
    html += '</ol>';
    html += '</div>';
    panel.innerHTML = html;

    panel.querySelectorAll('.iq-option').forEach(function (opt) {
      opt.addEventListener('click', async function () {
        // Disable all options
        panel.querySelectorAll('.iq-option').forEach(function (o) {
          o.classList.add('disabled');
        });

        var answer = opt.dataset.answer;
        var correct = answer === mod.question.answer;

        if (correct) {
          opt.classList.add('correct');
        } else {
          opt.classList.add('wrong');
          // Show the correct answer
          panel.querySelectorAll('.iq-option').forEach(function (o) {
            if (o.dataset.answer === mod.question.answer) {
              o.classList.add('correct');
            }
          });
        }

        // Dim non-relevant options
        panel.querySelectorAll('.iq-option').forEach(function (o) {
          if (!o.classList.contains('correct') && !o.classList.contains('wrong')) {
            o.classList.add('dim');
          }
        });

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
    var html = '<div class="iq-frame">';
    html += '<div class="iq-eyebrow">';
    html += '<span class="iq-eyebrow-title">' + mod.title + '</span>';
    html += '<span class="iq-eyebrow-rule"></span>';
    html += '<span class="iq-eyebrow-count">Reveal</span>';
    html += '</div>';
    html += '<h2 class="iq-question" style="font-size:clamp(16px,4.8vw,19px)">' + mod.reveal.text + '</h2>';
    html += '<div class="iq-continue" style="opacity:0.85" id="btn-explore">Explore further \u2192</div>';
    html += '</div>';
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
    var html = '<div class="iq-frame">';
    html += '<div class="iq-eyebrow">';
    html += '<span class="iq-eyebrow-title">' + mod.title + '</span>';
    html += '<span class="iq-eyebrow-rule"></span>';
    html += '<span class="iq-eyebrow-count">Explore</span>';
    html += '</div>';
    html += '<p class="iq-hook">' + mod.explore.prompt + '</p>';
    html += '<div class="iq-fact-slot revealed"><p>' + mod.explore.text + '</p></div>';
    html += '<div class="iq-continue revealed" id="btn-nameit">Name this concept \u2192</div>';
    html += '</div>';
    panel.innerHTML = html;

    document.getElementById('btn-nameit').addEventListener('click', function () {
      goToPhase('nameit');
    });
  }

  function renderNameIt(mod) {
    var panel = document.getElementById('literacy-panel');
    var isLast = mod.id >= MODULES.length;

    var html = '<div class="iq-frame iq-result">';
    html += '<div class="iq-eyebrow">';
    html += '<span class="iq-eyebrow-title">Key Concept</span>';
    html += '<span class="iq-eyebrow-rule"></span>';
    html += '</div>';
    html += '<div class="iq-score">';
    html += '<span class="iq-score-num" style="font-size:clamp(28px,9vw,36px)">' + mod.nameit.concept + '</span>';
    html += '</div>';
    html += '<p class="iq-verdict">' + mod.nameit.definition + '</p>';
    html += '<button class="iq-cta" id="btn-next">';
    html += isLast ? 'Start exploring \u2192' : 'Next module \u2192';
    html += '</button>';
    html += '</div>';
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
    var html = '<div class="iq-frame iq-result">';
    html += '<div class="iq-eyebrow">';
    html += '<span class="iq-eyebrow-title">Complete</span>';
    html += '<span class="iq-eyebrow-rule"></span>';
    html += '</div>';
    html += '<div class="iq-score">';
    html += '<span class="iq-score-num">05</span>';
    html += '<span class="iq-score-denom">/ 05</span>';
    html += '</div>';
    html += '<p class="iq-verdict">You\'ve learned <em>5 frames</em> for reading climate data.</p>';
    html += '<button class="iq-cta" id="btn-restart">Start over \u2192</button>';
    html += '</div>';
    panel.innerHTML = html;

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
  }
})();
