/**
 * narrator-app.js — Visual Climate Climate Narrator Extension
 *
 * State machine (guided mode):
 *   EMPTY → WELCOME → (2s) → PROFILE → (3s) → EXPLORE
 *   If previousISO3 exists: → VERSUS
 *   If fromQuiz: → WELCOME (quiz rules fire via condition)
 *
 * Rule engine:
 *   25 rules, first match wins.
 *   Each rule property can be a static value or a function(p, peer, extra, ctx).
 */

(function () {
  'use strict';

  var currentISO3 = null;
  var previousISO3 = null;
  var currentProfile = null;
  var currentPeer = null;
  var currentState = 'EMPTY';
  var currentMode = 'guided';
  var currentModule = 1;
  var previousProfile = null;

  var transitionTimer1 = null;
  var transitionTimer2 = null;

  // Cached for click-cycling without refetch
  var currentExtra = {};
  var currentContext = {};

  // ———— Domain helpers ————

  function getWeakestDomain(profile) {
    var domains = VC.DOMAINS
      .map(function (d) { return { key: d.key, label: d.label, score: profile[d.scoreField] }; })
      .filter(function (d) { return d.score != null; })
      .sort(function (a, b) { return a.score - b.score; });
    return domains.length > 0 ? domains[0] : null;
  }

  function getStrongestDomain(profile) {
    var domains = VC.DOMAINS
      .map(function (d) { return { key: d.key, label: d.label, score: profile[d.scoreField] }; })
      .filter(function (d) { return d.score != null; })
      .sort(function (a, b) { return b.score - a.score; });
    return domains.length > 0 ? domains[0] : null;
  }

  function getSortedDomains(p) {
    return VC.DOMAINS
      .map(function (d) {
        return { label: d.label, score: p[d.scoreField], color: d.color, weight: d.weight, key: d.key };
      })
      .filter(function (d) { return d.score != null; })
      .sort(function (a, b) { return b.score - a.score; });
  }

  function getDomainSpread(p) {
    var domains = getSortedDomains(p);
    if (domains.length < 2) return 0;
    return domains[0].score - domains[domains.length - 1].score;
  }

  function findBiggestDomainDiff(a, b) {
    var diffs = VC.DOMAINS
      .map(function (d) {
        var sa = a[d.scoreField];
        var sb = b[d.scoreField];
        if (sa != null && sb != null) return { label: d.label, diff: sa - sb };
        return null;
      })
      .filter(function (d) { return d !== null; })
      .sort(function (x, y) { return Math.abs(y.diff) - Math.abs(x.diff); });
    return diffs.length > 0 ? diffs[0] : null;
  }

  // ———— Rule resolver ————

  function resolve(val, p, peer, extra, ctx) {
    return typeof val === 'function' ? val(p, peer, extra, ctx) : (val || '');
  }

  function resolveMetric(val, p, peer, extra, ctx) {
    if (!val) return null;
    return typeof val === 'function' ? val(p, peer, extra, ctx) : val;
  }

  // ================================================================
  //  NARRATOR RULES — 25 rules, first match wins
  // ================================================================

  var NARRATOR_RULES = [

    // ── R01–R04: VERSUS ────────────────────────────────────────

    { id: 'VERSUS_LEAD_BIG',
      condition: function (st, p, peer, ex, ctx) {
        return st === 'VERSUS' && ctx.prevProfile &&
               ((p.total_score || 0) - (ctx.prevProfile.total_score || 0)) > 20;
      },
      insight: function (p, peer, ex, ctx) {
        var prev = ctx.prevProfile;
        var diff = (p.total_score || 0) - (prev.total_score || 0);
        return p.name + ' dramatically outperforms ' + prev.name + ' by +' +
          VC.fmt(diff) + ' points (' + VC.fmt(p.total_score) + ' vs ' + VC.fmt(prev.total_score) + ').';
      },
      so_what: function (p, peer, ex, ctx) {
        var big = findBiggestDomainDiff(p, ctx.prevProfile);
        return big
          ? 'The biggest gap is ' + big.label + ': leads by ' + VC.fmt(Math.abs(big.diff)) + ' pts.'
          : 'A commanding lead across most domains.';
      },
      metric: function (p, peer, ex, ctx) {
        var diff = (p.total_score || 0) - (ctx.prevProfile.total_score || 0);
        return { value: '+' + VC.fmt(diff), label: 'vs ' + ctx.prevProfile.name };
      },
      action: 'What drives this gap? Compare income groups for context.',
      module: 4,
    },

    { id: 'VERSUS_TRAIL_BIG',
      condition: function (st, p, peer, ex, ctx) {
        return st === 'VERSUS' && ctx.prevProfile &&
               ((p.total_score || 0) - (ctx.prevProfile.total_score || 0)) < -20;
      },
      insight: function (p, peer, ex, ctx) {
        var prev = ctx.prevProfile;
        var diff = (p.total_score || 0) - (prev.total_score || 0);
        return p.name + ' significantly trails ' + prev.name + ' by ' + VC.fmt(diff) + ' points.';
      },
      so_what: function (p, peer, ex, ctx) {
        var big = findBiggestDomainDiff(p, ctx.prevProfile);
        return big
          ? 'Widest gap in ' + big.label + ': ' + VC.fmt(Math.abs(big.diff)) + ' pts behind.'
          : 'Lagging across multiple domains.';
      },
      metric: function (p, peer, ex, ctx) {
        var diff = (p.total_score || 0) - (ctx.prevProfile.total_score || 0);
        return { value: VC.fmt(diff), label: 'vs ' + ctx.prevProfile.name };
      },
      action: 'Check if income level or geography explains part of this gap.',
      module: 4,
    },

    { id: 'VERSUS_CLOSE',
      condition: function (st, p, peer, ex, ctx) {
        return st === 'VERSUS' && ctx.prevProfile &&
               Math.abs((p.total_score || 0) - (ctx.prevProfile.total_score || 0)) <= 5;
      },
      insight: function (p, peer, ex, ctx) {
        var prev = ctx.prevProfile;
        return p.name + ' and ' + prev.name + ' are nearly identical (' +
          VC.fmt(p.total_score) + ' vs ' + VC.fmt(prev.total_score) + ').';
      },
      so_what: function (p, peer, ex, ctx) {
        var big = findBiggestDomainDiff(p, ctx.prevProfile);
        return big
          ? 'Despite similar totals, they differ most in ' + big.label + ' (' + VC.fmt(Math.abs(big.diff)) + ' pts).'
          : 'Remarkably similar profiles across all domains.';
      },
      metric: function (p, peer, ex, ctx) {
        var diff = (p.total_score || 0) - (ctx.prevProfile.total_score || 0);
        var sign = diff >= 0 ? '+' : '';
        return { value: sign + VC.fmt(diff), label: 'vs ' + ctx.prevProfile.name };
      },
      action: 'Look at the domain breakdown \u2014 the devil is in the details.',
      module: 4,
    },

    { id: 'VERSUS_DEFAULT',
      condition: function (st) { return st === 'VERSUS'; },
      insight: function (p, peer, ex, ctx) {
        var prev = ctx.prevProfile;
        var diff = (p.total_score || 0) - (prev.total_score || 0);
        var sign = diff >= 0 ? '+' : '';
        return p.name + ' (' + VC.fmt(p.total_score) + ') vs ' + prev.name +
          ' (' + VC.fmt(prev.total_score) + '): ' + sign + VC.fmt(diff) + ' points.';
      },
      so_what: function (p, peer, ex, ctx) {
        var big = findBiggestDomainDiff(p, ctx.prevProfile);
        return big
          ? 'Biggest gap in ' + big.label + ': ' + (big.diff >= 0 ? 'leads' : 'trails') +
            ' by ' + VC.fmt(Math.abs(big.diff)) + ' pts.'
          : '';
      },
      metric: function (p, peer, ex, ctx) {
        var diff = (p.total_score || 0) - (ctx.prevProfile.total_score || 0);
        var sign = diff >= 0 ? '+' : '';
        return { value: sign + VC.fmt(diff), label: 'vs ' + ctx.prevProfile.name };
      },
      action: 'Try comparing within the same income group for fairer context.',
      module: 4,
    },

    // ── R05–R07: WELCOME + quiz bridge ─────────────────────────

    { id: 'QUIZ_ACCURATE',
      condition: function (st, p, peer, ex, ctx) {
        return st === 'WELCOME' && ctx.fromQuiz &&
               Math.abs((p.total_score || 0) - (Number(ctx.quizScore) || 0)) <= 10;
      },
      insight: function (p, peer, ex, ctx) {
        var qs = Number(ctx.quizScore) || 0;
        var diff = (p.total_score || 0) - qs;
        var sign = diff >= 0 ? '+' : '';
        return 'You estimated ' + qs + ' on the quiz. ' + p.name + ' actually scores ' +
          VC.fmt(p.total_score) + '/100 (' + sign + VC.fmt(diff) + '). Great intuition!';
      },
      so_what: 'Your estimate was within 10 points of the real score.',
      metric: function (p) {
        return { value: VC.fmt(p.total_score), label: 'Actual Score' };
      },
      action: 'Explore the 5 domains to see what drives this score \u2192',
      module: 1,
    },

    { id: 'QUIZ_OVERESTIMATE',
      condition: function (st, p, peer, ex, ctx) {
        return st === 'WELCOME' && ctx.fromQuiz &&
               (Number(ctx.quizScore) || 0) > (p.total_score || 0);
      },
      insight: function (p, peer, ex, ctx) {
        var qs = Number(ctx.quizScore) || 0;
        var diff = (p.total_score || 0) - qs;
        return 'You estimated ' + qs + ', but ' + p.name + ' actually scores ' +
          VC.fmt(p.total_score) + '/100 (' + VC.fmt(diff) + ' from your guess).';
      },
      so_what: function (p) {
        return p.name + ' underperforms relative to your expectation. The domain breakdown reveals where.';
      },
      metric: function (p) {
        return { value: VC.fmt(p.total_score), label: 'Actual Score' };
      },
      action: 'Which domain drags the score down? Explore to find out \u2192',
      module: 1,
    },

    { id: 'QUIZ_UNDERESTIMATE',
      condition: function (st, p, peer, ex, ctx) {
        return st === 'WELCOME' && ctx.fromQuiz;
      },
      insight: function (p, peer, ex, ctx) {
        var qs = Number(ctx.quizScore) || 0;
        var diff = (p.total_score || 0) - qs;
        return 'You estimated ' + qs + ', but ' + p.name + ' actually scores ' +
          VC.fmt(p.total_score) + '/100 (+' + VC.fmt(diff) + ' better than expected).';
      },
      so_what: function (p) {
        return p.name + ' performs better than expected. Explore the domains to see why.';
      },
      metric: function (p) {
        return { value: VC.fmt(p.total_score), label: 'Actual Score' };
      },
      action: 'Which domain is the surprise strength? Explore to find out \u2192',
      module: 1,
    },

    // ── R08–R12: WELCOME by score tier ─────────────────────────

    { id: 'WELCOME_EXCELLENT',
      condition: function (st, p) { return st === 'WELCOME' && (p.total_score || 0) >= 80; },
      insight: function (p) {
        var cls = VC.CLASS_LABEL[p.climate_class];
        return p.name + ' scores an outstanding ' + VC.fmt(p.total_score) + '/100 \u2014 grade ' +
          (p.grade || '\u2014') + '. A global climate leader.' +
          (cls ? ' Classified as a ' + cls + '.' : '');
      },
      so_what: 'Among the very top tier of all 250 countries assessed.',
      metric: function (p) { return { value: VC.fmt(p.total_score), label: 'Climate Score' }; },
      action: function (p, peer) {
        return peer.globalRank
          ? 'Ranked #' + peer.globalRank + ' of ' + peer.totalCountries + ' globally.'
          : 'Exploring profile\u2026';
      },
      module: 1,
    },

    { id: 'WELCOME_GOOD',
      condition: function (st, p) { return st === 'WELCOME' && (p.total_score || 0) >= 60; },
      insight: function (p) {
        var cls = VC.CLASS_LABEL[p.climate_class];
        return p.name + ' scores ' + VC.fmt(p.total_score) + '/100 \u2014 grade ' +
          (p.grade || '\u2014') + (cls ? ', classified as a ' + cls : '') + '.';
      },
      so_what: 'A solid performance, though still room to reach the top tier.',
      metric: function (p) { return { value: VC.fmt(p.total_score), label: 'Climate Score' }; },
      action: function (p, peer) {
        return peer.globalRank
          ? 'Ranked #' + peer.globalRank + ' of ' + peer.totalCountries + ' countries.'
          : 'Exploring profile\u2026';
      },
      module: 1,
    },

    { id: 'WELCOME_FAIR',
      condition: function (st, p) { return st === 'WELCOME' && (p.total_score || 0) >= 40; },
      insight: function (p) {
        var cls = VC.CLASS_LABEL[p.climate_class];
        return p.name + ' scores ' + VC.fmt(p.total_score) + '/100 \u2014 grade ' +
          (p.grade || '\u2014') + (cls ? ', classified as a ' + cls : '') + '.';
      },
      so_what: 'Middling \u2014 some progress, but significant gaps remain across domains.',
      metric: function (p) { return { value: VC.fmt(p.total_score), label: 'Climate Score' }; },
      action: function (p, peer) {
        return peer.globalRank
          ? 'Ranked #' + peer.globalRank + ' of ' + peer.totalCountries + ' countries.'
          : 'Exploring profile\u2026';
      },
      module: 1,
    },

    { id: 'WELCOME_POOR',
      condition: function (st, p) { return st === 'WELCOME' && (p.total_score || 0) >= 20; },
      insight: function (p) {
        return p.name + ' scores ' + VC.fmt(p.total_score) + '/100 \u2014 grade ' + (p.grade || '\u2014') + '.';
      },
      so_what: 'Below average. Major acceleration is needed across most domains.',
      metric: function (p) { return { value: VC.fmt(p.total_score), label: 'Climate Score' }; },
      action: function (p, peer) {
        return peer.globalRank
          ? 'Ranked #' + peer.globalRank + ' of ' + peer.totalCountries + '. Click another country to compare.'
          : 'Exploring profile\u2026';
      },
      module: 1,
    },

    { id: 'WELCOME_CRITICAL',
      condition: function (st) { return st === 'WELCOME'; },
      insight: function (p) {
        return p.name + ' scores ' + VC.fmt(p.total_score) + '/100 \u2014 grade ' + (p.grade || '\u2014') + '.';
      },
      so_what: function (p) {
        return 'Critical. ' + p.name + ' ranks among the lowest performers globally.';
      },
      metric: function (p) { return { value: VC.fmt(p.total_score), label: 'Climate Score' }; },
      action: function (p, peer) {
        return peer.globalRank
          ? 'Ranked #' + peer.globalRank + ' of ' + peer.totalCountries + '.'
          : 'Exploring profile\u2026';
      },
      module: 1,
    },

    // ── R13–R19: PROFILE ───────────────────────────────────────

    { id: 'PROFILE_CHANGER',
      condition: function (st, p) {
        return st === 'PROFILE' && VC.CLASS_LABEL[p.climate_class] === 'Changer';
      },
      insight: function (p) {
        var best = getStrongestDomain(p);
        var worst = getWeakestDomain(p);
        return 'Changer: CO\u2082 declining AND renewables rising. Strongest: ' +
          (best ? best.label + ' (' + VC.fmt(best.score) + ')' : '\u2014') + '. Weakest: ' +
          (worst ? worst.label + ' (' + VC.fmt(worst.score) + ')' : '\u2014') + '.';
      },
      so_what: 'The trajectory is positive. Sustaining momentum in the weaker domains will be key.',
      metric: function (p) {
        var best = getStrongestDomain(p);
        return best ? { value: VC.fmt(best.score), label: best.label + ' (best)' } : null;
      },
      action: function (p, peer) {
        if (peer.incomeRank && peer.incomeTotal)
          return '#' + peer.incomeRank + ' of ' + peer.incomeTotal + ' in ' + (p.income_group || 'income group') + '.';
        if (peer.globalRank)
          return 'Global rank: #' + peer.globalRank + ' of ' + peer.totalCountries + '.';
        return '';
      },
      module: 2,
    },

    { id: 'PROFILE_STARTER',
      condition: function (st, p) {
        return st === 'PROFILE' && VC.CLASS_LABEL[p.climate_class] === 'Starter';
      },
      insight: function (p) {
        var best = getStrongestDomain(p);
        var worst = getWeakestDomain(p);
        return 'Starter: Either CO\u2082 declining OR renewables rising (not both). Strongest: ' +
          (best ? best.label + ' (' + VC.fmt(best.score) + ')' : '\u2014') + '. Weakest: ' +
          (worst ? worst.label + ' (' + VC.fmt(worst.score) + ')' : '\u2014') + '.';
      },
      so_what: function (p) {
        var spread = getDomainSpread(p);
        var worst = getWeakestDomain(p);
        return spread > 30
          ? 'A ' + VC.fmt(spread, 0) + '-point domain spread. ' + (worst ? worst.label : 'The weakest domain') + ' is holding back advancement.'
          : 'Partial progress \u2014 aligning both emissions and energy trends would upgrade to Changer.';
      },
      metric: function (p) {
        var best = getStrongestDomain(p);
        return best ? { value: VC.fmt(best.score), label: best.label + ' (best)' } : null;
      },
      action: function (p, peer) {
        if (peer.incomeRank && peer.incomeTotal)
          return '#' + peer.incomeRank + ' of ' + peer.incomeTotal + ' in ' + (p.income_group || 'income group') + '.';
        if (peer.globalRank)
          return 'Global rank: #' + peer.globalRank + ' of ' + peer.totalCountries + '.';
        return '';
      },
      module: 2,
    },

    { id: 'PROFILE_TALKER',
      condition: function (st, p) {
        return st === 'PROFILE' && VC.CLASS_LABEL[p.climate_class] === 'Talker';
      },
      insight: function (p) {
        var best = getStrongestDomain(p);
        var worst = getWeakestDomain(p);
        return 'Talker: Neither CO\u2082 declining nor renewables rising. Best: ' +
          (best ? best.label + ' (' + VC.fmt(best.score) + ')' : '\u2014') + '. Worst: ' +
          (worst ? worst.label + ' (' + VC.fmt(worst.score) + ')' : '\u2014') + '.';
      },
      so_what: 'Neither key trend is positive. Structural reform is needed to shift the trajectory.',
      metric: function (p) {
        var worst = getWeakestDomain(p);
        return worst ? { value: VC.fmt(worst.score), label: worst.label + ' (worst)' } : null;
      },
      action: function (p, peer) {
        if (peer.incomeRank && peer.incomeTotal)
          return '#' + peer.incomeRank + ' of ' + peer.incomeTotal + ' in ' + (p.income_group || 'income group') + '.';
        if (peer.globalRank)
          return 'Global rank: #' + peer.globalRank + ' of ' + peer.totalCountries + '.';
        return '';
      },
      module: 2,
    },

    { id: 'PROFILE_HIGH_INCOME_LOW_SCORE',
      condition: function (st, p) {
        return st === 'PROFILE' &&
               p.income_group === 'High income' &&
               (p.total_score || 0) < 50;
      },
      insight: function (p, peer) {
        return p.name + ' ranks ' + (peer.incomeRank || '?') + '/' + (peer.incomeTotal || '?') +
          ' among high-income countries \u2014 in the bottom half of its peer group.';
      },
      so_what: 'Economic wealth hasn\'t translated into climate leadership.',
      metric: function (p) {
        return { value: VC.fmt(p.total_score), label: 'Score (High-income avg: ~55)' };
      },
      action: 'Check the Climate Card: which of the 5 domains is weakest?',
      module: 2,
    },

    { id: 'PROFILE_BIG_SPREAD',
      condition: function (st, p) {
        return st === 'PROFILE' && getDomainSpread(p) > 40;
      },
      insight: function (p) {
        var domains = getSortedDomains(p);
        var best = domains[0];
        var worst = domains[domains.length - 1];
        return 'Strongest: ' + best.label + ' (' + VC.fmt(best.score) + '). Weakest: ' +
          worst.label + ' (' + VC.fmt(worst.score) + '). A ' +
          VC.fmt(best.score - worst.score, 0) + '-point spread.';
      },
      so_what: function (p) {
        var worst = getWeakestDomain(p);
        return 'A lopsided profile that signals structural imbalance. Closing ' +
          (worst ? worst.label.toLowerCase() : 'the weakest domain') + ' could transform the grade.';
      },
      metric: function (p) {
        return { value: VC.fmt(getDomainSpread(p), 0), label: 'Domain Spread' };
      },
      action: function (p, peer) {
        if (peer.incomeRank && peer.incomeTotal)
          return '#' + peer.incomeRank + ' of ' + peer.incomeTotal + ' in ' + (p.income_group || 'income group') + '.';
        return '';
      },
      module: 2,
    },

    { id: 'PROFILE_CRITICAL_WEAKNESS',
      condition: function (st, p) {
        var w = getWeakestDomain(p);
        return st === 'PROFILE' && w && w.score < 20;
      },
      insight: function (p) {
        var worst = getWeakestDomain(p);
        var best = getStrongestDomain(p);
        return worst.label + ' at ' + VC.fmt(worst.score) + '/100 is critically low.' +
          (best ? ' Best domain: ' + best.label + ' (' + VC.fmt(best.score) + ').' : '');
      },
      so_what: function (p) {
        var worst = getWeakestDomain(p);
        return 'Critical weakness. Improving ' + worst.label + ' would have the largest impact on the overall grade.';
      },
      metric: function (p) {
        var worst = getWeakestDomain(p);
        return { value: VC.fmt(worst.score), label: worst.label + ' (critical)' };
      },
      action: function (p, peer) {
        if (peer.globalRank)
          return 'Global rank: #' + peer.globalRank + ' of ' + peer.totalCountries + '.';
        return '';
      },
      module: 2,
    },

    { id: 'PROFILE_DEFAULT',
      condition: function (st) { return st === 'PROFILE'; },
      insight: function (p) {
        var domains = getSortedDomains(p);
        if (domains.length === 0) return 'Domain score data is not available for ' + p.name + '.';
        var best = domains[0];
        var worst = domains[domains.length - 1];
        return 'Strongest: ' + best.label + ' (' + VC.fmt(best.score) + ', ' + VC.perfLabel(best.score) +
          '). Weakest: ' + worst.label + ' (' + VC.fmt(worst.score) + ', ' + VC.perfLabel(worst.score) + ').';
      },
      so_what: function (p) {
        var spread = getDomainSpread(p);
        var worst = getWeakestDomain(p);
        return spread > 20
          ? 'Moderate variation. Targeted investment in ' + (worst ? worst.label.toLowerCase() : 'weak areas') + ' could lift the grade.'
          : 'Relatively even performance. Gains will come from across-the-board improvement.';
      },
      metric: function (p) {
        var best = getStrongestDomain(p);
        return best ? { value: VC.fmt(best.score), label: best.label + ' (best)' } : null;
      },
      action: function (p, peer) {
        var prefix = '';
        if (peer.incomeRank && peer.incomeTotal)
          prefix = '#' + peer.incomeRank + ' of ' + peer.incomeTotal + ' in ' + (p.income_group || 'income group') + '. ';
        else if (peer.globalRank)
          prefix = 'Global #' + peer.globalRank + ' of ' + peer.totalCountries + '. ';
        return prefix + 'Diving deeper\u2026';
      },
      module: 2,
    },

    // ── R20–R24: EXPLORE ───────────────────────────────────────

    { id: 'EXPLORE_HIGH_RE',
      condition: function (st, p, peer, ex) {
        return st === 'EXPLORE' && ex['EMBER.RENEWABLE.PCT'] && ex['EMBER.RENEWABLE.PCT'].value >= 50;
      },
      insight: function (p, peer, ex) {
        var re = ex['EMBER.RENEWABLE.PCT'];
        var ghg = ex['OWID.GHG_PER_CAPITA'];
        var txt = 'Renewable electricity at ' + VC.fmt(re.value) + '% (' +
          VC.reShareCategory(re.value) + ', ' + re.year + ') \u2014 a clean grid.';
        if (ghg) txt += ' GHG per capita: ' + VC.fmt(ghg.value) + ' tCO\u2082eq.';
        return txt;
      },
      so_what: 'A majority-renewable grid is a strong foundation. The remaining challenge is decarbonizing transport, industry, and heating.',
      metric: function (p, peer, ex) {
        var re = ex['EMBER.RENEWABLE.PCT'];
        return { value: VC.fmt(re.value) + '%', label: 'Renewable Electricity' };
      },
      action: 'Try the NDC Tracker or Timeseries Explorer for deeper analysis \u2192',
      module: 3,
    },

    { id: 'EXPLORE_LOW_RE',
      condition: function (st, p, peer, ex) {
        return st === 'EXPLORE' && ex['EMBER.RENEWABLE.PCT'] && ex['EMBER.RENEWABLE.PCT'].value < 10;
      },
      insight: function (p, peer, ex) {
        var re = ex['EMBER.RENEWABLE.PCT'];
        var ghg = ex['OWID.GHG_PER_CAPITA'];
        var txt = 'Renewable electricity at just ' + VC.fmt(re.value) + '% (' +
          re.year + ') \u2014 almost entirely fossil-powered.';
        if (ghg) txt += ' GHG per capita: ' + VC.fmt(ghg.value) + ' tCO\u2082eq.';
        return txt;
      },
      so_what: 'Energy transition has barely started. This is the single biggest lever for emissions reduction.',
      metric: function (p, peer, ex) {
        var re = ex['EMBER.RENEWABLE.PCT'];
        return { value: VC.fmt(re.value) + '%', label: 'Renewable Electricity' };
      },
      action: 'Open the Timeseries Explorer to see the energy trend over time \u2192',
      module: 3,
    },

    { id: 'EXPLORE_HIGH_EMISSIONS',
      condition: function (st, p, peer, ex) {
        return st === 'EXPLORE' && ex['OWID.GHG_PER_CAPITA'] && ex['OWID.GHG_PER_CAPITA'].value >= 10;
      },
      insight: function (p, peer, ex) {
        var ghg = ex['OWID.GHG_PER_CAPITA'];
        var re = ex['EMBER.RENEWABLE.PCT'];
        var txt = 'GHG per capita: ' + VC.fmt(ghg.value) + ' tCO\u2082eq (' + ghg.year + ') \u2014 well above the global average of ~6.';
        if (re) txt += ' Renewables: ' + VC.fmt(re.value) + '%.';
        return txt;
      },
      so_what: 'High per-capita emissions signal carbon-intensive lifestyles or industry. Both demand-side and supply-side action is critical.',
      metric: function (p, peer, ex) {
        var ghg = ex['OWID.GHG_PER_CAPITA'];
        return { value: VC.fmt(ghg.value), label: 'tCO\u2082eq per capita' };
      },
      action: 'Check the NDC Tracker to see if targets match this reality \u2192',
      module: 3,
    },

    { id: 'EXPLORE_VULNERABLE',
      condition: function (st, p, peer, ex) {
        return st === 'EXPLORE' && ex['NDGAIN.VULNERABILITY'] && ex['NDGAIN.VULNERABILITY'].value >= 0.5;
      },
      insight: function (p, peer, ex) {
        var vuln = ex['NDGAIN.VULNERABILITY'];
        var re = ex['EMBER.RENEWABLE.PCT'];
        var txt = 'ND-GAIN vulnerability: ' + VC.fmt(vuln.value, 2) + ' (high vulnerability, ' + vuln.year + ').';
        if (re) txt += ' Renewables: ' + VC.fmt(re.value) + '%.';
        return txt;
      },
      so_what: 'High climate vulnerability coupled with limited adaptive capacity. Resilience investment is as urgent as mitigation.',
      metric: function (p, peer, ex) {
        var vuln = ex['NDGAIN.VULNERABILITY'];
        return { value: VC.fmt(vuln.value, 2), label: 'Vulnerability Index' };
      },
      action: 'Explore the Resilience domain in the Climate Card \u2192',
      module: 3,
    },

    { id: 'EXPLORE_NDC_COUNTRY',
      condition: function (st, p) {
        return st === 'EXPLORE' && !!VC.NDC_TARGETS[p.iso3];
      },
      insight: function (p, peer, ex) {
        var ndc = VC.NDC_TARGETS[p.iso3];
        var re = ex['EMBER.RENEWABLE.PCT'];
        var ghg = ex['OWID.GHG_PER_CAPITA'];
        var parts = [];
        if (re) parts.push('Renewables: ' + VC.fmt(re.value) + '% (' + re.year + ').');
        if (ghg) parts.push('GHG/cap: ' + VC.fmt(ghg.value) + ' tCO\u2082eq.');
        parts.push('NDC 2030 target: \u2212' + ndc.ndc2030_pct + '%.');
        if (ndc.nz_year) parts.push('Net-zero: ' + ndc.nz_year + '.');
        return parts.join(' ');
      },
      so_what: function (p) {
        var ndc = VC.NDC_TARGETS[p.iso3];
        if (!ndc.cat) return 'Policy ambition data available in the NDC Tracker.';
        return 'CAT rates this ' + ndc.cat.replace(/_/g, ' ') + '. ' +
          (ndc.ndc3 ? 'NDC 3.0 has been submitted.' : 'NDC 3.0 not yet submitted.');
      },
      metric: function (p) {
        var ndc = VC.NDC_TARGETS[p.iso3];
        return { value: '\u2212' + ndc.ndc2030_pct + '%', label: 'NDC 2030 Target' };
      },
      action: 'Open the NDC Gap Tracker for detailed trajectory analysis \u2192',
      module: 3,
    },

    // ── R25: FALLBACK ──────────────────────────────────────────

    { id: 'FALLBACK',
      condition: function () { return true; },
      insight: function (p, peer, ex) {
        var parts = [];
        var re = ex['EMBER.RENEWABLE.PCT'];
        var ghg = ex['OWID.GHG_PER_CAPITA'];
        if (re) parts.push('Renewables: ' + VC.fmt(re.value) + '%.');
        if (ghg) parts.push('GHG/cap: ' + VC.fmt(ghg.value) + ' tCO\u2082eq.');
        if (parts.length > 0) return parts.join(' ');
        return p.name + ' \u2014 ' + VC.fmt(p.total_score) + '/100, grade ' + (p.grade || '\u2014') + '.';
      },
      so_what: function (p) {
        var worst = getWeakestDomain(p);
        return worst
          ? worst.label + ' at ' + VC.fmt(worst.score) + ' is the priority area for improvement.'
          : '';
      },
      metric: function (p) {
        return { value: VC.fmt(p.total_score), label: 'Climate Score' };
      },
      action: 'Try the Climate Card or Timeseries Explorer for more detail \u2192',
      module: 1,
    },
  ];

  // Module titles
  var MODULE_TITLES = { 1: 'Overview', 2: 'Profile', 3: 'Explore', 4: 'Comparison' };

  // ———— Rule matcher ————

  function matchRule(state, profile, peer, extra, context) {
    for (var i = 0; i < NARRATOR_RULES.length; i++) {
      if (NARRATOR_RULES[i].condition(state, profile, peer, extra, context)) {
        return NARRATOR_RULES[i];
      }
    }
    return NARRATOR_RULES[NARRATOR_RULES.length - 1];
  }

  // ———— UI helpers ————

  function showLoading() {
    document.getElementById('narrator-loading').style.display = 'flex';
    document.getElementById('narrator-empty').style.display = 'none';
    document.getElementById('narrator-main').style.display = 'none';
    document.getElementById('narrator-web-footer').style.display = 'none';
  }

  function showEmptyState() {
    currentState = 'EMPTY';
    clearTransitionTimers();
    document.getElementById('narrator-loading').style.display = 'none';
    document.getElementById('narrator-empty').style.display = 'flex';
    document.getElementById('narrator-main').style.display = 'none';
    document.getElementById('narrator-web-footer').style.display = 'none';
  }

  function showNarratorMain() {
    document.getElementById('narrator-loading').style.display = 'none';
    document.getElementById('narrator-empty').style.display = 'none';
    document.getElementById('narrator-main').style.display = 'block';
    document.getElementById('narrator-web-footer').style.display = 'block';

    // Guided mode: insight visible, free summary hidden
    if (currentMode === 'guided') {
      document.getElementById('narrator-insight-section').style.display = 'block';
      document.getElementById('narrator-action-section').style.display = 'block';
      document.getElementById('narrator-free-summary').style.display = 'none';
    }
  }

  function showMetric(value, label, color) {
    var section = document.getElementById('narrator-metric-section');
    section.style.display = 'block';
    document.getElementById('narrator-metric-value').textContent = value;
    document.getElementById('narrator-metric-value').style.color = color || 'var(--vc-primary)';
    document.getElementById('narrator-metric-label').textContent = label;
  }

  function hideMetric() {
    document.getElementById('narrator-metric-section').style.display = 'none';
  }

  // ———— Render: country header ————

  function renderCountryHeader(profile) {
    document.getElementById('narrator-flag').textContent = VC.iso3ToFlag(currentISO3);
    document.getElementById('narrator-name').textContent = profile.name;
    document.getElementById('narrator-meta').textContent =
      currentISO3 + ' \u00b7 ' + (profile.region || '\u2014') + ' \u00b7 ' + (profile.income_group || '\u2014');

    var gradeEl = document.getElementById('narrator-grade-badge');
    var grade = profile.grade || '\u2014';
    gradeEl.textContent = grade;
    gradeEl.style.background = VC.GRADE_BG[grade] || '#F8F9FA';
    gradeEl.style.color = VC.GRADE_COLOR[grade] || '#1A1A2E';
  }

  // ———— Render functions (each follows the same pattern) ————

  function renderWelcome(profile, peer) {
    showNarratorMain();
    renderCountryHeader(profile);
    currentModule = 1;

    var rule = matchRule('WELCOME', profile, peer, currentExtra, currentContext);
    console.log('[Narrator] WELCOME rule=' + rule.id);

    document.getElementById('narrator-insight').textContent =
      resolve(rule.insight, profile, peer, currentExtra, currentContext);

    var soWhatEl = document.getElementById('narrator-so-what');
    if (rule.so_what) {
      soWhatEl.textContent = resolve(rule.so_what, profile, peer, currentExtra, currentContext);
      soWhatEl.style.display = 'block';
    } else {
      soWhatEl.style.display = 'none';
    }

    var m = resolveMetric(rule.metric, profile, peer, currentExtra, currentContext);
    if (m) { showMetric(m.value, m.label, m.color); } else { hideMetric(); }

    document.getElementById('narrator-action').textContent =
      resolve(rule.action, profile, peer, currentExtra, currentContext);

    document.getElementById('narrator-module').textContent =
      'Module ' + currentModule + '/4 \u00b7 ' + (MODULE_TITLES[currentModule] || '');
  }

  function renderProfile(profile, peer) {
    showNarratorMain();
    renderCountryHeader(profile);
    currentModule = 2;

    var rule = matchRule('PROFILE', profile, peer, currentExtra, currentContext);
    console.log('[Narrator] PROFILE rule=' + rule.id);

    document.getElementById('narrator-insight').textContent =
      resolve(rule.insight, profile, peer, currentExtra, currentContext);

    var soWhatEl = document.getElementById('narrator-so-what');
    if (rule.so_what) {
      soWhatEl.textContent = resolve(rule.so_what, profile, peer, currentExtra, currentContext);
      soWhatEl.style.display = 'block';
    } else {
      soWhatEl.style.display = 'none';
    }

    var m = resolveMetric(rule.metric, profile, peer, currentExtra, currentContext);
    if (m) { showMetric(m.value, m.label, m.color); } else { hideMetric(); }

    document.getElementById('narrator-action').textContent =
      resolve(rule.action, profile, peer, currentExtra, currentContext);

    document.getElementById('narrator-module').textContent =
      'Module ' + currentModule + '/4 \u00b7 ' + (MODULE_TITLES[currentModule] || '');
  }

  function renderExplore(profile, peer) {
    showNarratorMain();
    renderCountryHeader(profile);
    currentModule = 3;

    var rule = matchRule('EXPLORE', profile, peer, currentExtra, currentContext);
    console.log('[Narrator] EXPLORE rule=' + rule.id);

    document.getElementById('narrator-insight').textContent =
      resolve(rule.insight, profile, peer, currentExtra, currentContext);

    var soWhatEl = document.getElementById('narrator-so-what');
    if (rule.so_what) {
      soWhatEl.textContent = resolve(rule.so_what, profile, peer, currentExtra, currentContext);
      soWhatEl.style.display = 'block';
    } else {
      soWhatEl.style.display = 'none';
    }

    var m = resolveMetric(rule.metric, profile, peer, currentExtra, currentContext);
    if (m) { showMetric(m.value, m.label, m.color); } else { hideMetric(); }

    document.getElementById('narrator-action').textContent =
      resolve(rule.action, profile, peer, currentExtra, currentContext);

    document.getElementById('narrator-module').textContent =
      'Module ' + currentModule + '/4 \u00b7 ' + (MODULE_TITLES[currentModule] || '');
  }

  function renderVersus(profile, peer) {
    showNarratorMain();
    renderCountryHeader(profile);
    currentModule = 4;

    var rule = matchRule('VERSUS', profile, peer, currentExtra, currentContext);
    console.log('[Narrator] VERSUS rule=' + rule.id);

    document.getElementById('narrator-insight').textContent =
      resolve(rule.insight, profile, peer, currentExtra, currentContext);

    var soWhatEl = document.getElementById('narrator-so-what');
    if (rule.so_what) {
      soWhatEl.textContent = resolve(rule.so_what, profile, peer, currentExtra, currentContext);
      soWhatEl.style.display = 'block';
    } else {
      soWhatEl.style.display = 'none';
    }

    var m = resolveMetric(rule.metric, profile, peer, currentExtra, currentContext);
    if (m) { showMetric(m.value, m.label, m.color); } else { hideMetric(); }

    document.getElementById('narrator-action').textContent =
      resolve(rule.action, profile, peer, currentExtra, currentContext);

    document.getElementById('narrator-module').textContent =
      'Module ' + currentModule + '/4 \u00b7 ' + (MODULE_TITLES[currentModule] || '');
  }

  // ———— Render: Free mode summary ————

  function renderFreeSummary(profile, peer) {
    showNarratorMain();
    renderCountryHeader(profile);

    // Insight/Action hidden, Free Summary visible
    document.getElementById('narrator-insight-section').style.display = 'none';
    document.getElementById('narrator-action-section').style.display = 'none';
    document.getElementById('narrator-free-summary').style.display = 'block';

    // Domain mini bars
    var container = document.getElementById('narrator-free-domains');
    var html = '';

    for (var i = 0; i < VC.DOMAINS.length; i++) {
      var d = VC.DOMAINS[i];
      var score = profile[d.scoreField];
      var pct = score != null ? Math.min(100, Math.max(0, score)) : 0;
      var valText = score != null ? VC.fmt(score) : '\u2014';
      var valColor = score != null ? d.color : 'var(--vc-missing)';

      html += '<div class="narrator-free-domain-row">' +
        '<span class="narrator-free-domain-label">' + d.label + '</span>' +
        '<div class="narrator-free-domain-track">' +
          '<div class="narrator-free-domain-fill" style="width:' + pct + '%;background:' + d.color + ';"></div>' +
        '</div>' +
        '<span class="narrator-free-domain-value" style="color:' + valColor + '">' + valText + '</span>' +
      '</div>';
    }

    container.innerHTML = html;

    // Module + toggle always visible
    document.getElementById('narrator-module').textContent = '';
  }

  // ================================================================
  //  APP LIFECYCLE
  // ================================================================

  document.addEventListener('DOMContentLoaded', function () {
    if (typeof tableau === 'undefined' || !tableau.extensions) {
      console.warn('Standalone mode.');
      startApp();
      return;
    }
    tableau.extensions.initializeAsync().then(function () {
      startApp();
    }).catch(function (err) {
      console.error('Init error:', err);
    });
  });

  async function startApp() {
    showLoading();
    setupModeToggle();

    var fromQuiz = VC.getUrlParam('from') === 'quiz';
    var quizScore = VC.getUrlParam('score');

    try {
      var iso3 = await VC.detectISO3FromDashboard();
      console.log('[Narrator] Initial detected ISO3:', iso3);
      if (!iso3) {
        showEmptyState();
      } else {
        await onCountryChanged(iso3, fromQuiz, quizScore);
      }
    } catch (e) {
      console.error('[Narrator] Start error:', e);
      showEmptyState();
    }

    VC.onFilterChange(onDashboardChange);
    VC.onMarkSelection(onDashboardChange);
  }

  async function onDashboardChange() {
    try {
      var iso3 = await VC.detectISO3FromDashboard();
      if (iso3 && iso3 !== currentISO3) {
        await onCountryChanged(iso3, false, null);
      } else if (!iso3 && currentISO3) {
        currentISO3 = null;
        showEmptyState();
      }
    } catch (e) {
      console.error('Dashboard change error:', e);
    }
  }

  async function onCountryChanged(iso3, fromQuiz, quizScore) {
    showLoading();
    clearTransitionTimers();

    if (currentISO3 && currentISO3 !== iso3) {
      previousISO3 = currentISO3;
      previousProfile = currentProfile;
    }

    currentISO3 = iso3;

    var results = await Promise.all([
      VC.getReportCard(iso3),
      VC.getPeerContext(iso3),
    ]);

    var profile = results[0];
    var peer = results[1];

    if (!profile) {
      showEmptyState();
      return;
    }

    currentProfile = profile;
    currentPeer = peer;

    var weakest = getWeakestDomain(profile);
    var extraIndicators = {};

    try {
      extraIndicators = await VC.getLatestIndicators(iso3, [
        'EMBER.RENEWABLE.PCT',
        'OWID.GHG_PER_CAPITA',
        'NDGAIN.VULNERABILITY',
        'DERIVED.CO2_PER_GDP',
        'DERIVED.ENERGY_TRANSITION',
      ]);
    } catch (e) {
      console.warn('Extra indicators failed:', e);
    }

    currentExtra = extraIndicators;
    currentContext = {
      fromQuiz: fromQuiz,
      quizScore: quizScore,
      prevProfile: previousProfile,
      prevISO3: previousISO3,
      weakest: weakest,
      strongest: getStrongestDomain(profile),
    };

    // State routing
    if (fromQuiz) {
      currentState = 'WELCOME';
      renderWelcome(profile, peer);
    } else if (previousISO3 && previousProfile) {
      currentState = 'VERSUS';
      renderVersus(profile, peer);
    } else {
      currentState = 'WELCOME';
      renderWelcome(profile, peer);

      transitionTimer1 = setTimeout(function () {
        if (currentISO3 === iso3 && currentMode === 'guided') {
          currentState = 'PROFILE';
          renderProfile(profile, peer);

          transitionTimer2 = setTimeout(function () {
            if (currentISO3 === iso3 && currentMode === 'guided') {
              currentState = 'EXPLORE';
              renderExplore(profile, peer);
            }
          }, 3000);
        }
      }, 2000);
    }

    if (currentMode === 'free') {
      renderFreeSummary(profile, peer);
    }

    updateWebLink(iso3);
  }

  // ———— Click to cycle states (guided mode) ————

  document.addEventListener('click', function (e) {
    if (currentMode !== 'guided' || currentState === 'EMPTY') return;
    if (!currentProfile || !currentPeer) return;

    var insightSection = document.getElementById('narrator-insight-section');
    var metricSection = document.getElementById('narrator-metric-section');
    var actionSection = document.getElementById('narrator-action-section');

    if (insightSection.contains(e.target) ||
        metricSection.contains(e.target) ||
        actionSection.contains(e.target)) {
      clearTransitionTimers();

      if (currentState === 'WELCOME') {
        currentState = 'PROFILE';
        renderProfile(currentProfile, currentPeer);
      } else if (currentState === 'PROFILE') {
        currentState = 'EXPLORE';
        renderExplore(currentProfile, currentPeer);
      } else if (currentState === 'EXPLORE') {
        if (previousProfile) {
          currentState = 'VERSUS';
          renderVersus(currentProfile, currentPeer);
        } else {
          currentState = 'WELCOME';
          renderWelcome(currentProfile, currentPeer);
        }
      } else if (currentState === 'VERSUS') {
        currentState = 'WELCOME';
        renderWelcome(currentProfile, currentPeer);
      }
    }
  });

  // ———— Mode toggle ————

  function setupModeToggle() {
    var guidedEmpty = document.getElementById('btn-mode-guided-empty');
    var freeEmpty = document.getElementById('btn-mode-free-empty');
    var guidedMain = document.getElementById('btn-mode-guided');
    var freeMain = document.getElementById('btn-mode-free');

    if (guidedEmpty) guidedEmpty.addEventListener('click', function () { setMode('guided'); });
    if (freeEmpty) freeEmpty.addEventListener('click', function () { setMode('free'); });
    if (guidedMain) guidedMain.addEventListener('click', function () { setMode('guided'); });
    if (freeMain) freeMain.addEventListener('click', function () { setMode('free'); });
  }

  function setMode(mode) {
    currentMode = mode;
    clearTransitionTimers();

    var allGuided = [
      document.getElementById('btn-mode-guided-empty'),
      document.getElementById('btn-mode-guided'),
    ];
    var allFree = [
      document.getElementById('btn-mode-free-empty'),
      document.getElementById('btn-mode-free'),
    ];

    for (var i = 0; i < allGuided.length; i++) {
      if (allGuided[i]) {
        if (mode === 'guided') allGuided[i].classList.add('active');
        else allGuided[i].classList.remove('active');
      }
    }
    for (var j = 0; j < allFree.length; j++) {
      if (allFree[j]) {
        if (mode === 'free') allFree[j].classList.add('active');
        else allFree[j].classList.remove('active');
      }
    }

    if (currentProfile && currentPeer) {
      if (mode === 'guided') {
        currentState = 'WELCOME';
        renderWelcome(currentProfile, currentPeer);
      } else {
        renderFreeSummary(currentProfile, currentPeer);
      }
    }
  }

  // ———— Misc helpers ————

  function updateWebLink(iso3) {
    var link = document.getElementById('narrator-web-link');
    link.href = 'https://visualclimate.org/country/' + iso3.toLowerCase();
    link.textContent = 'View full profile on visualclimate.org \u2192';
  }

  function clearTransitionTimers() {
    if (transitionTimer1) { clearTimeout(transitionTimer1); transitionTimer1 = null; }
    if (transitionTimer2) { clearTimeout(transitionTimer2); transitionTimer2 = null; }
  }
})();
