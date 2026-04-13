(function () {
  'use strict';

  let currentModule = 0;
  let currentPhase = 'question';

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
    }
  ];

  // ———— Phase rendering ————
  function renderQuestion(mod) {
    const panel = document.getElementById('literacy-panel');
    let html = '<div class="lit-module-header">';
    html += '<span class="lit-module-tag">Module ' + mod.id + '</span>';
    html += '<span class="lit-module-title">' + mod.title + '</span>';
    html += '</div>';
    html += '<p class="lit-question-text">' + mod.question.text + '</p>';
    html += '<div class="lit-choices">';
    mod.question.choices.forEach(function (c) {
      html += '<button class="lit-choice-btn" data-iso3="' + c.iso3 + '">' + c.label + '</button>';
    });
    html += '</div>';
    panel.innerHTML = html;

    panel.querySelectorAll('.lit-choice-btn').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        // disable all buttons
        panel.querySelectorAll('.lit-choice-btn').forEach(function (b) {
          b.disabled = true;
        });

        var iso3 = btn.dataset.iso3;
        var correct = iso3 === mod.question.answer;
        btn.classList.add(correct ? 'lit-correct' : 'lit-wrong');

        // highlight correct answer if user was wrong
        if (!correct) {
          panel.querySelectorAll('.lit-choice-btn').forEach(function (b) {
            if (b.dataset.iso3 === mod.question.answer) {
              b.classList.add('lit-correct');
            }
          });
        }

        await selectCountry(mod.sheet, iso3);
        setTimeout(function () { goToPhase('reveal'); }, 1200);
      });
    });
  }

  async function renderReveal(mod) {
    for (var key in mod.reveal.params) {
      await setParameter(key, mod.reveal.params[key]);
    }
    await selectCountry(mod.sheet, mod.reveal.highlight);

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
