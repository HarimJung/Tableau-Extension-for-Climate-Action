(function () {
  'use strict';

  let currentModule = 0;
  let currentPhase = 'question';
  let activeFilters = []; // [{sheet, field}]
  var exploreMode = false;
  var m5CardActive = false;
  var m5ListenerRegistered = false;
  var _highlightParam = null; // cached p_HighlightISO3 reference

  // ———— Utility functions ————
  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function animateNumber(el, target, duration, suffix) {
    suffix = suffix || '';
    return new Promise(function (resolve) {
      var start = performance.now();
      function tick(now) {
        var t = Math.min((now - start) / duration, 1);
        var eased = 1 - Math.pow(1 - t, 4); // ease-out-quart
        var current = eased * target;
        if (target % 1 !== 0) {
          el.textContent = current.toFixed(1) + suffix;
        } else {
          el.textContent = Math.round(current) + suffix;
        }
        if (t < 1) {
          requestAnimationFrame(tick);
        } else {
          resolve();
        }
      }
      requestAnimationFrame(tick);
    });
  }

  function typeText(elementId, text, speed) {
    return new Promise(function (resolve) {
      var el = document.getElementById(elementId);
      if (!el) { resolve(); return; }
      var i = 0;
      function type() {
        if (i < text.length) {
          el.textContent += text.charAt(i);
          i++;
          setTimeout(type, speed);
        } else {
          resolve();
        }
      }
      type();
    });
  }

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
      if (!param) {
        debugMsg('setParameter FAIL: "' + name + '" not found among dashboard parameters');
        return;
      }

      // Skip if already set to desired value
      var current = param.currentValue.value;
      if (String(current) === String(value)) {
        debugMsg('setParameter SKIP: "' + name + '" already = "' + value + '"');
        return;
      }

      // Always pass String — Tableau API serializes all types to string anyway
      await param.changeValueAsync(String(value));
      debugMsg('setParameter OK: "' + name + '" → "' + value + '"');
    } catch (e) {
      debugMsg('setParameter ERR: "' + name + '" → "' + value + '" — ' + e.message);
      // Silently continue — Tableau may have set the value despite the API error
      // ("Missing output parameter: parameterControl" is a known Tableau API issue)
    }
  }

  // Fast path for p_HighlightISO3 — skips getParametersAsync() lookup
  function setHighlight(iso3) {
    if (!_highlightParam) return;
    _highlightParam.changeValueAsync(String(iso3)).catch(function () { /* silent */ });
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

  // ———— 워크시트에서 ISO3 필드명 자동 탐지 ————
  async function findIso3FieldName(ws) {
    try {
      var dt = await ws.getSummaryDataAsync();
      var columns = dt.columns;
      for (var i = 0; i < columns.length; i++) {
        var fn = (columns[i].fieldName || '').toLowerCase().replace(/[\s_\-]/g, '');
        if (fn === 'iso3' || fn === 'countryiso3' || fn === 'countrycode') {
          return columns[i].fieldName; // 실제 Tableau 필드명 반환
        }
      }
      // 못 찾으면 caption도 확인
      for (var j = 0; j < columns.length; j++) {
        var cap = (columns[j].caption || '').toLowerCase().replace(/[\s_\-]/g, '');
        if (cap === 'iso3' || cap === 'countryiso3' || cap === 'countrycode') {
          return columns[j].fieldName;
        }
      }
    } catch (e) {
      // 에러 시 기본값
    }
    return 'Iso3'; // fallback
  }

  async function selectCountry(worksheetName, iso3) {
    try {
      var dashboard = tableau.extensions.dashboardContent.dashboard;
      var ws = dashboard.worksheets.find(function (w) { return w.name === worksheetName; });
      if (!ws) {
        debugMsg('ERR: no sheet "' + worksheetName + '"');
        return;
      }
      var fieldName = await findIso3FieldName(ws);
      debugMsg('selectCountry: ' + iso3 + ' on ' + worksheetName + ' field=' + fieldName);

      // 방법 1: 단순 문자열 배열
      await ws.selectMarksByValueAsync(
        [{ fieldName: fieldName, value: [iso3] }],
        tableau.SelectionUpdateType.Replace
      );
      debugMsg('OK: selected ' + iso3);
    } catch (e1) {
      debugMsg('Method1 failed: ' + e1.message + ' — trying method2');
      try {
        // 방법 2: DataValue 객체 (formattedValue 포함)
        var ws2 = tableau.extensions.dashboardContent.dashboard.worksheets.find(function (w) { return w.name === worksheetName; });
        var fieldName2 = await findIso3FieldName(ws2);
        await ws2.selectMarksByValueAsync(
          [{ fieldName: fieldName2, value: [{ value: String(iso3), formattedValue: String(iso3) }] }],
          tableau.SelectionUpdateType.Replace
        );
        debugMsg('OK method2: selected ' + iso3);
      } catch (e2) {
        debugMsg('Both methods failed: ' + e2.message);
      }
    }
  }

  async function highlightCountries(worksheetName, iso3Array) {
    try {
      var dashboard = tableau.extensions.dashboardContent.dashboard;
      var ws = dashboard.worksheets.find(function (w) { return w.name === worksheetName; });
      if (!ws) {
        debugMsg('ERR: sheet not found: "' + worksheetName + '"');
        return;
      }
      var fieldName = await findIso3FieldName(ws);
      debugMsg('highlight: ' + iso3Array.join(',') + ' on ' + worksheetName + ' field=' + fieldName);

      // 방법 1: 단순 문자열 배열
      await ws.selectMarksByValueAsync(
        [{ fieldName: fieldName, value: iso3Array.map(String) }],
        tableau.SelectionUpdateType.Replace
      );
      debugMsg('OK: highlighted ' + iso3Array.join(','));
    } catch (e1) {
      debugMsg('HL Method1 failed: ' + e1.message + ' — trying method2');
      try {
        var ws2 = tableau.extensions.dashboardContent.dashboard.worksheets.find(function (w) { return w.name === worksheetName; });
        var fieldName2 = await findIso3FieldName(ws2);
        await ws2.selectMarksByValueAsync(
          [{ fieldName: fieldName2, value: iso3Array.map(function(code) { return { value: String(code), formattedValue: String(code) }; }) }],
          tableau.SelectionUpdateType.Replace
        );
        debugMsg('OK HL method2: highlighted ' + iso3Array.join(','));
      } catch (e2) {
        debugMsg('HL both failed: ' + e2.message);
      }
    }
  }

  // ———— 디버그 (콘솔만) ————
  function debugMsg(msg) {
    console.log('[LITERACY] ' + msg);
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
        text: 'Saudi Arabia: 24.1 tonnes per person \u2014 four times the global average.',
        bigNumber: 24.1,
        bigUnit: 't CO\u2082eq per person',
        statNumber: '24.1 t/person'
      },
      explore: {
        prompt: 'Now switch to "Total emissions." How does the ranking change?',
        params: { p_Measure: 'TOTAL_GHG' },
        text: 'China: 13,532 Mt total \u2014 but only 9.8 tonnes per person. Change the frame and the world looks completely different.'
      },
      nudge: {
        question: 'Look at the chart \u2014 find the four highlighted dots and compare their heights.',
        reveal: 'Click other countries on the chart to compare their values.',
        preSwitch: 'Before switching, read the Y-axis title. You\'re looking at "per person" right now.',
        postSwitch: 'The Y-axis changed. Find who\'s on top now.',
        nameit: 'Click Saudi Arabia, then China. Same data, different story.'
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
        text: 'The UK cut CO\u2082 by 35% in ten years \u2014 the steepest decline among G7 nations.',
        bigNumber: 35,
        bigUnit: '% CO\u2082 reduction (2013\u21922023)',
        statNumber: '\u221235%'
      },
      explore: {
        prompt: 'Why did the UK drop so fast? Let\'s trace the cause.',
        switch1: {
          label: 'Show Coal CO\u2082',
          params: { p_TimeMeasure: 'OWID.COAL_CO2' },
          text: 'UK coal CO\u2082 collapsed \u2014 148 Mt to 18 Mt. Killing coal was the single biggest lever.'
        },
        switch2: {
          label: 'Show Renewable %',
          params: { p_TimeMeasure: 'EMBER.RENEWABLE.PCT' },
          text: 'UK renewables surged from 15% to 42%. Wind and solar filled the gap coal left behind.'
        },
        params: {}
      },
      nudge: {
        question: 'Find the line that drops the steepest after 2013.',
        reveal: 'Click the UK line. Check the exact % change.',
        preSwitch1: 'You see total CO\u2082 dropping. But which fuel caused it?',
        postSwitch1: 'Coal nearly hit zero. So what replaced it?',
        preSwitch2: 'Coal vanished. What filled the gap?',
        postSwitch2: 'CO\u2082 down \u2192 Coal gone \u2192 Renewables up. One cause-and-effect chain.',
        nameit: 'Click UK, then China. One quit coal. One doubled down.'
      },
      nameit: {
        concept: 'The Coal Phase-Out Effect',
        definition: 'Replacing coal with renewables delivers the fastest emission cuts. The UK proved a single fuel decision can reshape a nation\'s climate trajectory in under a decade.'
      }
    },
    {
      id: 3,
      title: 'The Energy Reality',
      sheet: 'M3 Waffle',
      question: {
        text: 'How many countries generate more than 50% of electricity from renewables?',
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
        text: '64 countries exceed 50% \u2014 each green square is one country. Most rely on hydropower. But does "renewable" mean "clean"?',
        bigNumber: 64,
        bigUnit: 'countries above 50% renewable electricity',
        statNumber: '64 countries'
      },
      explore: {
        prompt: 'Now watch the colors change. Same squares, different story.',
        params: { p_Measure: 'CARBON_INTENSITY' },
        text: 'Some green squares turned red. High renewables \u2260 low carbon intensity. Biomass burns, hydro fluctuates, and industry still runs on fossil fuels.'
      },
      nudge: {
        question: 'Each square = one country. Green = above 50%. Count the greens.',
        reveal: 'Click a green square to see which country it is.',
        preSwitch: 'These 64 countries look "green." But are they truly clean?',
        postSwitch: 'Same countries, new colors. Which green squares turned red?',
        nameit: 'Find Brazil. Green in renewables, but what color in intensity?'
      },
      nameit: {
        concept: 'Renewables \u2260 Clean Economy',
        definition: 'A high share of renewable electricity does not guarantee low carbon intensity. Hydropower variability, biomass emissions, and fossil-dependent industry can keep the carbon footprint high.'
      }
    },
    {
      id: 4,
      title: 'Promises vs Reality',
      sheet: 'M4 Dumbbell',
      question: {
        text: 'Of the G20 nations, how many increased total greenhouse gas emissions between 2013 and 2023?',
        choices: [
          { label: 'Almost none (1\u20132)', value: 'none' },
          { label: 'A few (4\u20136)', value: 'few' },
          { label: 'About half (8\u201310)', value: 'half' },
          { label: 'Most (15+)', value: 'most' }
        ],
        answer: 'few'
      },
      reveal: {
        params: { p_Module: 4, p_TimeMeasure: 'OWID.TOTAL_GHG_EXCLUDING_LUCF', p_Phase: 'reveal' },
        text: '6 G20 nations actually increased emissions. The lines going up show who\u2019s moving in the wrong direction \u2014 despite their climate pledges.',
        bigNumber: 6,
        bigUnit: 'G20 nations increased emissions (2013\u20132023)',
        statNumber: '6 of 20'
      },
      explore: {
        prompt: 'What if we look at per-capita instead of total?',
        params: { p_TimeMeasure: 'OWID.GHG_PER_CAPITA' },
        text: 'Per capita tells a different story. Some countries with rising totals actually decreased per person \u2014 population growth masks the progress.'
      },
      nudge: {
        question: 'Count the lines pointing upward. That\u2019s how many increased.',
        reveal: 'Find the longest upward line. Who increased the most?',
        preSwitch: 'You see total emissions. But what about per person?',
        postSwitch: 'Same countries, different frame. Did any arrows flip direction?',
        nameit: 'Compare South Korea\'s arrow in total vs per capita.'
      },
      nameit: {
        concept: 'The Implementation Gap',
        definition: 'The distance between what countries promised and what actually happened. Most G20 nations are moving too slowly \u2014 or in the wrong direction entirely.'
      }
    },
    {
      id: 5,
      title: 'Climate Justice',
      sheet: 'M1 Scatter',
      question: {
        text: 'Do richer countries produce cleaner electricity?',
        choices: [
          { label: 'Yes \u2014 they can afford clean tech', value: 'yes' },
          { label: 'No \u2014 many rich countries are still dirty', value: 'no' },
          { label: 'Only European countries are clean', value: 'europe' },
          { label: 'There is no pattern', value: 'none' }
        ],
        answer: 'no'
      },
      reveal: {
        params: { p_Module: 5, p_Measure: 'CARBON_INTENSITY', p_Phase: 'reveal' },
        text: 'Wealth doesn\u2019t guarantee clean energy. Some of the richest nations still burn dirty \u2014 while poorer countries with hydro power score better.',
        bigNumber: 6,
        bigUnit: 'of the 10 richest nations have carbon intensity above 350 gCO\u2082/kWh'
      },
      explore: {
        prompt: 'Click any country to see its climate report card.',
        switches: [
          { label: 'Carbon Intensity', measure: 'CARBON_INTENSITY' },
          { label: 'GHG per Capita', measure: 'GHG_PER_CAPITA' }
        ]
      },
      nameit: {
        concept: 'Wealth \u2260 Clean Energy',
        definition: 'Money can buy efficiency, but not responsibility. The richest nations often have the dirtiest energy.'
      }
    }
  ];

  // ———— Helpers ————
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  // ———— Transition wrapper ————
  async function transitionTo(renderFn) {
    var frame = document.querySelector('.iq-frame');
    if (frame) {
      frame.classList.add('iq-exit');
      await delay(280);
    }
    await renderFn();
    var newFrame = document.querySelector('.iq-frame');
    if (newFrame) {
      newFrame.classList.add('iq-enter');
      newFrame.offsetHeight; // force reflow
      newFrame.classList.add('iq-enter-active');
    }
  }

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
    if (mod.nudge && mod.nudge.question) {
      html += '<p class="iq-nudge">' + mod.nudge.question + '</p>';
    }
    html += '<ol class="iq-options">';
    mod.question.choices.forEach(function (c, i) {
      var val = isIso3 ? c.iso3 : c.value;
      html += '<li class="iq-option" data-answer="' + val + '" style="animation-delay:' + (280 + i * 80) + 'ms">';
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
          opt.insertAdjacentHTML('beforeend', '<span class="iq-feedback-icon">\u2713</span>');
        } else {
          opt.classList.add('wrong');
          opt.classList.add('iq-shake');
          opt.insertAdjacentHTML('beforeend', '<span class="iq-feedback-icon">\u2717</span>');
          // Show the correct answer
          panel.querySelectorAll('.iq-option').forEach(function (o) {
            if (o.dataset.answer === mod.question.answer) {
              o.classList.add('correct');
              o.insertAdjacentHTML('beforeend', '<span class="iq-feedback-icon">\u2713</span>');
            }
          });
        }

        // Insert stat reveal on correct option + dim others
        panel.querySelectorAll('.iq-option').forEach(function (o) {
          if (o.dataset.answer === mod.question.answer && mod.reveal.statNumber) {
            o.insertAdjacentHTML('beforeend', '<span class="iq-stat-reveal">' + mod.reveal.statNumber + '</span>');
          }
          if (!o.classList.contains('correct') && !o.classList.contains('wrong')) {
            o.classList.add('dim');
          }
        });

        if (isIso3) {
          await selectCountry(mod.sheet, answer);
          setHighlight(answer);
        }
        if (mod.id === 3) {
          // 자동 전환 대신 넛지 버튼 표시
          setTimeout(function () {
            var nudgeHtml = '<div class="iq-map-nudge" id="map-nudge">';
            nudgeHtml += '<p class="iq-map-nudge-text">Maps can be deceiving \u2014 large countries catch your eye, but how many are there exactly?</p>';
            nudgeHtml += '<button class="iq-switch-btn iq-map-switch" id="btn-map-to-waffle">';
            nudgeHtml += '<span class="iq-switch-icon">\u25E7</span> Count it differently';
            nudgeHtml += '</button>';
            nudgeHtml += '</div>';
            panel.insertAdjacentHTML('beforeend', nudgeHtml);

            // 애니메이션으로 등장
            var nudgeEl = document.getElementById('map-nudge');
            if (nudgeEl) {
              nudgeEl.offsetHeight;
              nudgeEl.classList.add('iq-map-nudge-visible');
            }

            document.getElementById('btn-map-to-waffle').addEventListener('click', async function () {
              await setParameter('p_M3View', 'waffle');
              goToPhase('reveal');
            });
          }, 1200);
        } else {
          setTimeout(function () { goToPhase('reveal'); }, 1800);
        }
      });

      if (isIso3) {
        opt.addEventListener('mouseenter', function () {
          var iso3 = this.dataset.answer;
          selectCountry(mod.sheet, iso3);
          setHighlight(iso3);
        });
        opt.addEventListener('mouseleave', function () {
          var iso3List = mod.question.choices.map(function(c) { return c.iso3; });
          setHighlight(iso3List[0]); // reset to a valid ISO3
          highlightCountries(mod.sheet, iso3List);
        });
      }
    });

    if (isIso3) {
      // DZV 시트 전환 후 Tableau가 새 시트를 렌더링할 시간을 줌
      setTimeout(function () {
        var iso3List = mod.question.choices.map(function(c) { return c.iso3; });
        highlightCountries(mod.sheet, iso3List);
      }, 1500);  // 800 → 1500ms로 증가
    }
  }

  async function renderReveal(mod) {
    for (var key in mod.reveal.params) {
      await setParameter(key, mod.reveal.params[key]);
    }
    if (mod.reveal.highlight) {
      await selectCountry(mod.sheet, mod.reveal.highlight);
      setHighlight(mod.reveal.highlight);
    }

    var panel = document.getElementById('literacy-panel');
    var html = '<div class="iq-frame">';
    html += '<div class="iq-eyebrow">';
    html += '<span class="iq-eyebrow-title">' + mod.title + '</span>';
    html += '<span class="iq-eyebrow-rule"></span>';
    html += '<span class="iq-eyebrow-count">Reveal</span>';
    html += '</div>';

    if (mod.reveal.bigNumber != null) {
      html += '<div class="iq-big-number-card">';
      html += '<span id="reveal-number">0</span>';
      html += '<span class="iq-big-unit">' + mod.reveal.bigUnit + '</span>';
      html += '</div>';
    }

    html += '<h2 class="iq-question" style="font-size:clamp(17px,5vw,21px)">' + mod.reveal.text + '</h2>';
    if (mod.nudge && mod.nudge.reveal) {
      html += '<p class="iq-nudge">' + mod.nudge.reveal + '</p>';
    }
    html += '<div class="iq-back" id="btn-back-question">\u2190 Back to question</div>';
    html += '<div class="iq-continue" id="btn-explore">Explore further \u2192</div>';
    html += '</div>';
    panel.innerHTML = html;

    document.getElementById('btn-back-question').addEventListener('click', function () {
      goToPhase('question');
    });
    document.getElementById('btn-explore').addEventListener('click', function () {
      goToPhase('explore');
    });

    // Post-render: count-up then reveal continue button
    (async function () {
      if (mod.reveal.bigNumber != null) {
        await delay(350);
        var numEl = document.getElementById('reveal-number');
        if (numEl) await animateNumber(numEl, mod.reveal.bigNumber, 1000);
      }
      var btn = document.getElementById('btn-explore');
      if (btn) btn.classList.add('revealed');
    })();
  }

  async function renderExplore(mod) {
    var hasSwitch1 = mod.explore.switch1 != null;
    var hasSwitch2 = mod.explore.switch2 != null;
    var hasParams = mod.explore.params && Object.keys(mod.explore.params).length > 0;

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

    if (hasSwitch1) {
      if (mod.nudge && mod.nudge.preSwitch1) {
        html += '<p class="iq-nudge" id="nudge-pre1">' + mod.nudge.preSwitch1 + '</p>';
      }
      html += '<button class="iq-switch-btn" id="btn-switch1"><span class="iq-switch-icon">\u25C9</span> ' + mod.explore.switch1.label + '</button>';
      html += '<div class="iq-fact-slot" id="fact1"><p>' + mod.explore.switch1.text + '</p></div>';
      if (mod.nudge && mod.nudge.postSwitch1) {
        html += '<p class="iq-nudge iq-nudge-hidden" id="nudge-post1">' + mod.nudge.postSwitch1 + '</p>';
      }
      if (hasSwitch2) {
        if (mod.nudge && mod.nudge.preSwitch2) {
          html += '<p class="iq-nudge iq-nudge-hidden" id="nudge-pre2">' + mod.nudge.preSwitch2 + '</p>';
        }
        html += '<button class="iq-switch-btn iq-switch-hidden" id="btn-switch2"><span class="iq-switch-icon">\u25C9</span> ' + mod.explore.switch2.label + '</button>';
        html += '<div class="iq-fact-slot" id="fact2"><p>' + mod.explore.switch2.text + '</p></div>';
        if (mod.nudge && mod.nudge.postSwitch2) {
          html += '<p class="iq-nudge iq-nudge-hidden" id="nudge-post2">' + mod.nudge.postSwitch2 + '</p>';
        }
      }
      html += '<div class="iq-back" id="btn-back-reveal">\u2190 Back to reveal</div>';
      html += '<div class="iq-continue" id="btn-nameit">Name this concept \u2192</div>';
    } else if (hasParams) {
      if (mod.nudge && mod.nudge.preSwitch) {
        html += '<p class="iq-nudge" id="nudge-pre">' + mod.nudge.preSwitch + '</p>';
      }
      html += '<button class="iq-switch-btn" id="btn-switch"><span class="iq-switch-icon">\u25C9</span> Switch the frame</button>';
      html += '<div class="iq-fact-slot"><p>' + mod.explore.text + '</p></div>';
      if (mod.nudge && mod.nudge.postSwitch) {
        html += '<p class="iq-nudge iq-nudge-hidden iq-nudge-post" id="nudge-post">' + mod.nudge.postSwitch + '</p>';
      }
      html += '<div class="iq-back" id="btn-back-reveal">\u2190 Back to reveal</div>';
      html += '<div class="iq-continue" id="btn-nameit">Name this concept \u2192</div>';
    } else if (mod.explore.switches) {
      html += '<div class="iq-measure-pills">';
      mod.explore.switches.forEach(function (s, i) {
        var cls = i === 0 ? ' iq-pill-active' : '';
        html += '<button class="iq-pill' + cls + '" data-measure="' + s.measure + '">' + s.label + '</button>';
      });
      html += '</div>';
      html += '<div id="explore-card-slot"></div>';
      html += '<div class="iq-back" id="btn-back-reveal">\u2190 Back to reveal</div>';
      html += '<div class="iq-continue revealed" id="btn-nameit">Name this concept \u2192</div>';
    } else {
      html += '<div class="iq-fact-slot revealed"><p>' + mod.explore.text + '</p></div>';
      html += '<div class="iq-back" id="btn-back-reveal">\u2190 Back to reveal</div>';
      html += '<div class="iq-continue revealed" id="btn-nameit">Name this concept \u2192</div>';
    }

    html += '</div>';
    panel.innerHTML = html;

    if (hasSwitch1) {
      document.getElementById('btn-switch1').addEventListener('click', async function () {
        this.disabled = true;
        this.classList.add('iq-switch-active');
        for (var key in mod.explore.switch1.params) {
          await setParameter(key, mod.explore.switch1.params[key]);
        }
        var pre1 = document.getElementById('nudge-pre1');
        if (pre1) pre1.classList.add('iq-nudge-hidden');
        await delay(600);
        var fact1 = document.getElementById('fact1');
        if (fact1) fact1.classList.add('revealed');
        var post1 = document.getElementById('nudge-post1');
        if (post1) post1.classList.remove('iq-nudge-hidden');
        if (hasSwitch2) {
          await delay(400);
          var pre2 = document.getElementById('nudge-pre2');
          if (pre2) pre2.classList.remove('iq-nudge-hidden');
          var btn2 = document.getElementById('btn-switch2');
          if (btn2) btn2.classList.remove('iq-switch-hidden');
        } else {
          var nameBtn = document.getElementById('btn-nameit');
          if (nameBtn) nameBtn.classList.add('revealed');
        }
        this.style.display = 'none';
        if (mod.id === 2) {
          await delay(800);
          await selectCountry(mod.sheet, 'GBR');
          setHighlight('GBR');
        }
      });
      if (hasSwitch2) {
        document.getElementById('btn-switch2').addEventListener('click', async function () {
          this.disabled = true;
          this.classList.add('iq-switch-active');
          for (var key in mod.explore.switch2.params) {
            await setParameter(key, mod.explore.switch2.params[key]);
          }
          var pre2 = document.getElementById('nudge-pre2');
          if (pre2) pre2.classList.add('iq-nudge-hidden');
          await delay(600);
          var fact2 = document.getElementById('fact2');
          if (fact2) fact2.classList.add('revealed');
          var post2 = document.getElementById('nudge-post2');
          if (post2) post2.classList.remove('iq-nudge-hidden');
          var nameBtn = document.getElementById('btn-nameit');
          if (nameBtn) nameBtn.classList.add('revealed');
          this.style.display = 'none';
          if (mod.id === 2) {
            await delay(800);
            await selectCountry(mod.sheet, 'GBR');
            setHighlight('GBR');
          }
        });
      }
    } else if (hasParams) {
      document.getElementById('btn-switch').addEventListener('click', async function () {
        this.disabled = true;
        this.classList.add('iq-switch-active');
        for (var key in mod.explore.params) {
          await setParameter(key, mod.explore.params[key]);
        }
        var preNudge = document.getElementById('nudge-pre');
        if (preNudge) preNudge.classList.add('iq-nudge-hidden');
        await delay(600);
        var factSlot = panel.querySelector('.iq-fact-slot');
        var continueBtn = document.getElementById('btn-nameit');
        var postNudge = document.getElementById('nudge-post');
        if (factSlot) factSlot.classList.add('revealed');
        if (postNudge) postNudge.classList.remove('iq-nudge-hidden');
        if (continueBtn) continueBtn.classList.add('revealed');
        this.style.display = 'none';
        if (mod.id === 1) {
          await delay(800);
          await selectCountry(mod.sheet, 'CHN');
          setHighlight('CHN');
        }
      });
    }

    if (mod.explore.switches) {
      var pills = panel.querySelectorAll('.iq-pill');
      pills.forEach(function (pill) {
        pill.addEventListener('click', async function () {
          pills.forEach(function (p) { p.classList.remove('iq-pill-active'); });
          this.classList.add('iq-pill-active');
          await setParameter('p_Measure', this.getAttribute('data-measure'));
        });
      });
      m5CardActive = true;
      if (!m5ListenerRegistered) {
        m5ListenerRegistered = true;
        VC.onMarkSelection(async function () {
          if (!m5CardActive) return;
          var iso3 = await VC.detectISO3FromDashboard();
          if (iso3) renderCountryCard(iso3);
        });
      }
    }

    document.getElementById('btn-back-reveal').addEventListener('click', function () {
      goToPhase('reveal');
    });
    document.getElementById('btn-nameit').addEventListener('click', function () {
      goToPhase('nameit');
    });
  }

  async function renderCountryCard(iso3) {
    var results = await Promise.all([VC.getReportCard(iso3), VC.getPeerContext(iso3)]);
    var card = results[0];
    var peer = results[1];
    if (!card) return;
    var slot = document.getElementById('explore-card-slot');
    if (!slot) return;

    var grade = card.grade || '\u2014';
    var gradeBg = VC.GRADE_BG[grade] || '#F8F9FA';
    var gradeColor = VC.GRADE_COLOR[grade] || '#1A1A2E';
    var className = VC.CLASS_LABEL[card.climate_class] || null;
    var classColor = className ? (VC.CLASS_COLOR[className] || '#9A9A9A') : '#9A9A9A';
    var GLOBAL_AVG = { emissions: 55, energy: 50, economy: 45, responsibility: 60, resilience: 40 };

    var html = '<div class="climate-card" style="display:block;padding:0;">';

    // Header
    html += '<div class="card-header">';
    html += '<span class="card-flag">' + VC.iso3ToFlag(iso3) + '</span>';
    html += '<div>';
    html += '<div class="card-country-name">' + card.name + '</div>';
    html += '<div class="card-meta">' + iso3 + ' \u00B7 ' + (card.region || '\u2014') + ' \u00B7 ' + (card.income_group || '\u2014') + '</div>';
    html += '</div>';
    html += '</div>';

    // Score Hero
    html += '<div class="score-hero">';
    html += '<div><span class="score-big" id="card-score-num">0</span><span class="score-unit">/100</span></div>';
    html += '<span class="grade-badge" style="background:' + gradeBg + ';color:' + gradeColor + '">' + grade + '</span>';
    html += '<div>';
    if (className) {
      html += '<span class="class-pill" style="background:' + classColor + ';display:inline-block">' + className + '</span>';
    }
    if (peer && peer.globalRank) {
      html += '<div class="rank-text" style="margin-top:4px">#' + peer.globalRank + ' / ' + peer.totalCountries + '</div>';
    }
    html += '</div>';
    html += '</div>';

    // Domain Bars
    html += '<div class="domain-section"><h3>Domain Breakdown</h3>';
    VC.DOMAINS.forEach(function (d) {
      var score = card[d.scoreField];
      var pct = score != null ? Math.min(100, Math.max(0, score)) : 0;
      var avg = GLOBAL_AVG[d.key] || 50;
      html += '<div class="domain-bar-row">';
      html += '<div class="domain-tooltip">' + d.label + ': ' + (score != null ? VC.fmt(score) + '/100' : 'No data') + ' \u00B7 Weight: ' + d.weight + ' \u00B7 Global avg: ' + avg + '</div>';
      html += '<span class="domain-label">' + d.label + ' <span style="font-size:9px;color:var(--vc-text-muted)">(' + d.weight + ')</span></span>';
      html += '<div class="domain-bar-track">';
      html += '<div class="domain-bar-fill" style="width:0%;background:' + d.color + '" data-target-width="' + pct + '%"></div>';
      html += '<div class="domain-bar-avg" style="left:' + avg + '%" title="Global Avg: ' + avg + '"></div>';
      html += '</div>';
      html += '<span class="domain-bar-value" style="color:' + (score != null ? d.color : 'var(--vc-missing)') + '">' + (score != null ? VC.fmt(score) : '\u2014') + '</span>';
      html += '</div>';
    });
    html += '</div>';

    // Key Insights
    var lines = [];
    var domainScores = VC.DOMAINS
      .map(function (d) { return { label: d.label, score: card[d.scoreField] }; })
      .filter(function (d) { return d.score != null; })
      .sort(function (a, b) { return b.score - a.score; });
    if (domainScores.length > 0) {
      var best = domainScores[0];
      var worst = domainScores[domainScores.length - 1];
      lines.push('<strong>Strongest:</strong> ' + best.label + ' (' + VC.fmt(best.score) + ', ' + VC.perfLabel(best.score) + ')');
      if (domainScores.length > 1) {
        lines.push('<strong>Weakest:</strong> ' + worst.label + ' (' + VC.fmt(worst.score) + ', ' + VC.perfLabel(worst.score) + ')');
      }
    }
    if (className && VC.CLASS_EXPLAIN[className]) {
      lines.push('<strong>Classification:</strong> ' + className + ' \u2014 ' + VC.CLASS_EXPLAIN[className]);
    }
    if (peer && peer.globalRank) {
      lines.push('<strong>Global Rank:</strong> #' + peer.globalRank + ' of ' + peer.totalCountries + ' countries');
    }
    if (peer && peer.incomeRank) {
      lines.push('<strong>Income Group Rank:</strong> #' + peer.incomeRank + ' of ' + peer.incomeTotal);
    }
    if (lines.length > 0) {
      html += '<div class="insights">' + lines.join('<br>') + '</div>';
    }

    html += '</div>';
    slot.innerHTML = html;

    // Post-render: animate score count-up + domain bar fills
    await delay(200);
    var scoreEl = document.getElementById('card-score-num');
    if (scoreEl) animateNumber(scoreEl, card.total_score, 800);
    slot.querySelectorAll('.domain-bar-fill').forEach(function (el) {
      el.style.width = el.getAttribute('data-target-width');
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
    html += '<div class="iq-concept-card">';
    html += '<span class="iq-concept-label">Remember this:</span>';
    html += '<span id="concept-type"></span>';
    html += '<span class="iq-concept-line"></span>';
    html += '<span class="iq-concept-def" id="concept-def">' + mod.nameit.definition + '</span>';
    html += '</div>';
    if (mod.nudge && mod.nudge.nameit) {
      html += '<p class="iq-nudge">' + mod.nudge.nameit + '</p>';
    }
    html += '<div class="iq-back" id="btn-back-explore">\u2190 Back to explore</div>';
    html += '<button class="iq-cta" id="btn-next">';
    html += isLast ? 'See your journey \u2192' : 'Next module \u2192';
    html += '</button>';
    html += '</div>';
    panel.innerHTML = html;

    // Post-render: typewriter effect then fade-in definition
    (async function () {
      await delay(400);
      await typeText('concept-type', mod.nameit.concept, 50);
      var defEl = document.getElementById('concept-def');
      if (defEl) defEl.classList.add('visible');
    })();

    document.getElementById('btn-back-explore').addEventListener('click', function () {
      goToPhase('explore');
    });
    document.getElementById('btn-next').addEventListener('click', function () {
      if (isLast) {
        transitionTo(function () { renderComplete(); });
        // Progress to 100%
        var fill = document.getElementById('literacy-progress-fill');
        if (fill) fill.style.width = '100%';
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
    html += '<span class="iq-score-num" id="complete-count">0</span>';
    html += '<span class="iq-score-denom">/ 05</span>';
    html += '</div>';
    html += '<p class="iq-verdict">You\'ve learned <em>5 frames</em> for reading climate data.</p>';

    html += '<div class="iq-concepts-summary">';
    MODULES.forEach(function (m, i) {
      html += '<div class="iq-concept-mini" data-idx="' + i + '">';
      html += '<span class="iq-concept-mini-num">' + pad2(i + 1) + '</span>';
      html += '<span class="iq-concept-mini-name">' + m.nameit.concept + '</span>';
      html += '</div>';
    });
    html += '</div>';

    html += '<button class="iq-cta" id="btn-explore-mode">Start exploring \u2192</button>';
    html += '<button class="iq-cta iq-cta-secondary" id="btn-restart">Start over \u2192</button>';
    html += '</div>';
    panel.innerHTML = html;

    // Post-render: count-up then stagger concept cards
    (async function () {
      var countEl = document.getElementById('complete-count');
      if (countEl) {
        await animateNumber(countEl, 5, 800);
        countEl.textContent = '05';
      }
      var cards = panel.querySelectorAll('.iq-concept-mini');
      for (var i = 0; i < cards.length; i++) {
        await delay(100);
        cards[i].classList.add('visible');
      }
    })();

    var conceptCards = panel.querySelectorAll('.iq-concept-mini');
    conceptCards.forEach(function (card) {
      card.style.cursor = 'pointer';
      card.addEventListener('click', function () {
        currentModule = parseInt(this.getAttribute('data-idx'), 10);
        goToPhase('question');
      });
    });

    document.getElementById('btn-explore-mode').addEventListener('click', function () {
      enterExploreMode();
    });

    document.getElementById('btn-restart').addEventListener('click', function () {
      currentModule = 0;
      goToPhase('question');
    });
  }

  var peekTimeout = null;

  async function showPeekCard(iso3) {
    var existing = document.getElementById('literacy-peek-card');
    if (existing) existing.remove();
    if (peekTimeout) clearTimeout(peekTimeout);
    try {
      var card = await VC.getReportCard(iso3);
      if (!card) return;
      var flag = VC.iso3ToFlag(iso3);
      var score = card.total_score != null ? VC.fmt(card.total_score, 1) : '—';
      var grade = card.grade || '—';
      var div = document.createElement('div');
      div.id = 'literacy-peek-card';
      div.className = 'iq-peek-card';
      div.innerHTML =
        '<span class="iq-peek-flag">' + flag + '</span>' +
        '<span class="iq-peek-name">' + card.name + '</span>' +
        '<span class="iq-peek-score">' + score + '/100</span>' +
        '<span class="iq-peek-grade">' + grade + '</span>';
      document.body.appendChild(div);
      peekTimeout = setTimeout(function () {
        div.classList.add('iq-peek-exit');
        setTimeout(function () { div.remove(); }, 300);
      }, 3000);
    } catch (e) {}
  }

  function onLearnMarkChange() {
    // peek card disabled
  }

  // ———— Progress ————
  function updateProgress() {
    var phases = { question: 1, reveal: 2, explore: 3, nameit: 4 };
    var step = currentModule * 4 + (phases[currentPhase] || 0);
    var pct = (step / 20) * 100;
    var fill = document.getElementById('literacy-progress-fill');
    if (fill) fill.style.width = pct + '%';
  }

  // ———— Phase navigation ————
  async function goToPhase(phase) {
    currentPhase = phase;
    m5CardActive = false;
    if (phase === 'question') {
      await clearActiveFilters();
      var mod = MODULES[currentModule];
      await setParameter('p_Module', mod.id);
      if (mod.sheet === 'M1 Scatter') {
        if (mod.id === 5) {
          await setParameter('p_Measure', 'CARBON_INTENSITY');
        } else {
          await setParameter('p_Measure', 'GHG_PER_CAPITA');
        }
      } else if (mod.sheet === 'M2 Line') {
        await setParameter('p_TimeMeasure', 'OWID.CO2');
      } else if (mod.sheet === 'M3 Waffle') {
        await setParameter('p_Measure', 'RENEWABLE_PCT');
        await setParameter('p_M3View', 'map');
      } else if (mod.sheet === 'M4 Dumbbell') {
        await setParameter('p_TimeMeasure', 'OWID.TOTAL_GHG_EXCLUDING_LUCF');
      }
      await delay(600);
    }
    await setParameter('p_Phase', phase);
    if (phase === 'reveal') {
      await delay(300);
    }
    var mod = MODULES[currentModule];
    switch (phase) {
      case 'question': await transitionTo(function () { renderQuestion(mod); }); break;
      case 'reveal': await transitionTo(function () { return renderReveal(mod); }); break;
      case 'explore': await transitionTo(function () { return renderExplore(mod); }); break;
      case 'nameit': await transitionTo(function () { return renderNameIt(mod); }); break;
    }
    updateProgress();
  }

  // ———— Explore Mode (Free Mode) ————
  function enterExploreMode() {
    exploreMode = true;
    renderExploreWaiting();
    VC.onMarkSelection(onExploreMarkChange);
    VC.onFilterChange(onExploreMarkChange);
  }

  async function onExploreMarkChange() {
    if (!exploreMode) return;
    var iso3 = await VC.detectISO3FromDashboard();
    if (iso3) await renderExploreProfile(iso3);
  }

  function renderExploreWaiting() {
    transitionTo(function () {
      var panel = document.getElementById('literacy-panel');
      var html = '<div class="iq-frame">';
      html += '<div class="iq-eyebrow">';
      html += '<span class="iq-eyebrow-title">Explore</span>';
      html += '<span class="iq-eyebrow-rule"></span>';
      html += '<span class="iq-eyebrow-count">Free Mode</span>';
      html += '</div>';
      html += '<h2 class="iq-question">Click any country on the chart.</h2>';
      html += '<p class="iq-hook">You\u2019ve learned 5 frames. Now apply them to any of 250 countries.</p>';
      html += '<div class="iq-continue revealed" id="btn-back-learn">\u2190 Back to Learn</div>';
      html += '</div>';
      panel.innerHTML = html;

      document.getElementById('btn-back-learn').addEventListener('click', function () {
        exitExploreMode();
      });
    });
  }

  async function renderExploreProfile(iso3) {
    var results = await Promise.all([VC.getReportCard(iso3), VC.getPeerContext(iso3)]);
    var card = results[0];
    var peer = results[1];
    if (!card) return;

    var grade = card.grade || '\u2014';
    var gradeBg = VC.GRADE_BG[grade] || '#F8F9FA';
    var gradeColor = VC.GRADE_COLOR[grade] || '#1A1A2E';
    var className = VC.CLASS_LABEL[card.climate_class] || null;
    var classColor = className ? (VC.CLASS_COLOR[className] || '#9A9A9A') : '#9A9A9A';
    var GLOBAL_AVG = { emissions: 55, energy: 50, economy: 45, responsibility: 60, resilience: 40 };

    transitionTo(function () {
      var panel = document.getElementById('literacy-panel');
      var html = '<div class="iq-frame">';

      // Eyebrow
      html += '<div class="iq-eyebrow">';
      html += '<span class="iq-eyebrow-title">Explore</span>';
      html += '<span class="iq-eyebrow-rule"></span>';
      html += '<span class="iq-eyebrow-count">' + card.name + '</span>';
      html += '</div>';

      // Full Climate Card
      html += '<div class="climate-card" style="display:block;padding:0;">';

      // Header
      html += '<div class="card-header">';
      html += '<span class="card-flag">' + VC.iso3ToFlag(iso3) + '</span>';
      html += '<div>';
      html += '<div class="card-country-name">' + card.name + '</div>';
      html += '<div class="card-meta">' + iso3 + ' \u00B7 ' + (card.region || '\u2014') + ' \u00B7 ' + (card.income_group || '\u2014') + '</div>';
      html += '</div>';
      html += '</div>';

      // Score Hero
      html += '<div class="score-hero">';
      html += '<div><span class="score-big" id="explore-score-num">0</span><span class="score-unit">/100</span></div>';
      html += '<span class="grade-badge" style="background:' + gradeBg + ';color:' + gradeColor + '">' + grade + '</span>';
      html += '<div>';
      if (className) {
        html += '<span class="class-pill" style="background:' + classColor + ';display:inline-block">' + className + '</span>';
      }
      if (peer && peer.globalRank) {
        html += '<div class="rank-text" style="margin-top:4px">#' + peer.globalRank + ' / ' + peer.totalCountries + '</div>';
      }
      html += '</div>';
      html += '</div>';

      // Domain Bars
      html += '<div class="domain-section"><h3>Domain Breakdown</h3>';
      VC.DOMAINS.forEach(function (d) {
        var score = card[d.scoreField];
        var pct = score != null ? Math.min(100, Math.max(0, score)) : 0;
        var avg = GLOBAL_AVG[d.key] || 50;
        html += '<div class="domain-bar-row">';
        html += '<div class="domain-tooltip">' + d.label + ': ' + (score != null ? VC.fmt(score) + '/100' : 'No data') + ' \u00B7 Weight: ' + d.weight + ' \u00B7 Global avg: ' + avg + '</div>';
        html += '<span class="domain-label">' + d.label + ' <span style="font-size:9px;color:var(--vc-text-muted)">(' + d.weight + ')</span></span>';
        html += '<div class="domain-bar-track">';
        html += '<div class="domain-bar-fill" style="width:0%;background:' + d.color + '" data-target-width="' + pct + '%"></div>';
        html += '<div class="domain-bar-avg" style="left:' + avg + '%" title="Global Avg: ' + avg + '"></div>';
        html += '</div>';
        html += '<span class="domain-bar-value" style="color:' + (score != null ? d.color : 'var(--vc-missing)') + '">' + (score != null ? VC.fmt(score) : '\u2014') + '</span>';
        html += '</div>';
      });
      html += '</div>';

      // Key Insights
      var lines = [];
      var domainScores = VC.DOMAINS
        .map(function (d) { return { label: d.label, score: card[d.scoreField] }; })
        .filter(function (d) { return d.score != null; })
        .sort(function (a, b) { return b.score - a.score; });
      if (domainScores.length > 0) {
        var best = domainScores[0];
        var worst = domainScores[domainScores.length - 1];
        lines.push('<strong>Strongest:</strong> ' + best.label + ' (' + VC.fmt(best.score) + ', ' + VC.perfLabel(best.score) + ')');
        if (domainScores.length > 1) {
          lines.push('<strong>Weakest:</strong> ' + worst.label + ' (' + VC.fmt(worst.score) + ', ' + VC.perfLabel(worst.score) + ')');
        }
      }
      if (className && VC.CLASS_EXPLAIN[className]) {
        lines.push('<strong>Classification:</strong> ' + className + ' \u2014 ' + VC.CLASS_EXPLAIN[className]);
      }
      if (peer && peer.globalRank) {
        lines.push('<strong>Global Rank:</strong> #' + peer.globalRank + ' of ' + peer.totalCountries + ' countries');
      }
      if (peer && peer.incomeRank) {
        lines.push('<strong>Income Group Rank:</strong> #' + peer.incomeRank + ' of ' + peer.incomeTotal);
      }
      if (lines.length > 0) {
        html += '<div class="insights">' + lines.join('<br>') + '</div>';
      }

      html += '</div>'; // .climate-card

      // Back button
      html += '<div class="iq-continue revealed" id="btn-back-learn">\u2190 Back to Learn</div>';
      html += '</div>'; // .iq-frame
      panel.innerHTML = html;

      // Post-render: animate score + domain bars
      (async function () {
        await delay(200);
        var scoreEl = document.getElementById('explore-score-num');
        if (scoreEl) animateNumber(scoreEl, card.total_score, 800);
        panel.querySelectorAll('.domain-bar-fill').forEach(function (el) {
          el.style.width = el.getAttribute('data-target-width');
        });
      })();

      document.getElementById('btn-back-learn').addEventListener('click', function () {
        exitExploreMode();
      });
    });
  }

  function getInsight(card) {
    var score = card.total_score;
    if (score >= 80) return 'Climate leader \u2014 top global performance across most domains.';
    if (score >= 60) return 'Solid performer \u2014 above average, room to improve.';
    if (score >= 40) return 'Moderate action \u2014 meaningful gaps in several domains.';
    if (score >= 20) return 'Below average \u2014 urgent improvement needed across most areas.';
    return 'Critical \u2014 among the lowest performers globally.';
  }

  function exitExploreMode() {
    exploreMode = false;
    currentModule = 0;
    goToPhase('question');
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
    exploreMode = false;

    // Cache p_HighlightISO3 parameter reference for fast hover
    _highlightParam = await findParameter('p_HighlightISO3');
    debugMsg('p_HighlightISO3: ' + (_highlightParam ? 'FOUND' : 'NOT FOUND'));

    await setParameter('p_Module', 1);
    await setParameter('p_Phase', 'question');
    await setParameter('p_Measure', 'GHG_PER_CAPITA');
    renderQuestion(MODULES[0]);
    VC.onMarkSelection(onLearnMarkChange);
  }
})();
