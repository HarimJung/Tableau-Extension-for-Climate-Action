/**
 * radar-chart.js — Pure SVG radar chart for 5 climate domains.
 * No external dependencies. Matches ReportCardClient.tsx domain colors.
 *
 * Usage:
 *  RadarChart.render('container-id', {
 *    emissions: 98.6,
 *    energy: 52.3,
 *    economy: 0.8,
 *    responsibility: 99.9,
 *    resilience: null
 *  }, {
 *    emissions: 55, energy: 50, economy: 45, responsibility: 60, resilience: 40
 *  });
 */
var RadarChart = (function () {
  'use strict';

  var DOMAINS = [
    { key: 'emissions', label: 'Emissions', angle: -90, color: '#E5484D' },
    { key: 'energy', label: 'Energy', angle: -18, color: '#0066FF' },
    { key: 'economy', label: 'Economy', angle: 54, color: '#8B5CF6' },
    { key: 'responsibility', label: 'Responsibility', angle: 126, color: '#F59E0B' },
    { key: 'resilience', label: 'Resilience', angle: 198, color: '#00A67E' },
  ];

  function polarToXY(cx, cy, radius, angleDeg) {
    var rad = (angleDeg * Math.PI) / 180;
    return {
      x: cx + radius * Math.cos(rad),
      y: cy + radius * Math.sin(rad),
    };
  }

  function render(containerId, scores, globalAvg) {
    var container = document.getElementById(containerId);
    if (!container) return;

    var size = 300;
    var cx = size / 2;
    var cy = size / 2;
    var maxR = 120;
    var levels = 5; // 0, 20, 40, 60, 80, 100

    var svg = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" xmlns="http://www.w3.org/2000/svg" style="overflow:visible">';

    // 배경 원형 그리드
    for (var i = 1; i <= levels; i++) {
      var r = (maxR / levels) * i;
      var points = DOMAINS.map(function (d) {
        var p = polarToXY(cx, cy, r, d.angle);
        return p.x + ',' + p.y;
      }).join(' ');
      svg += '<polygon points="' + points + '" fill="none" stroke="var(--vc-border, #E2E8F0)" stroke-width="0.5"/>';
    }

    // 축선
    for (var a = 0; a < DOMAINS.length; a++) {
      var d = DOMAINS[a];
      var p = polarToXY(cx, cy, maxR, d.angle);
      svg += '<line x1="' + cx + '" y1="' + cy + '" x2="' + p.x + '" y2="' + p.y + '" stroke="var(--vc-border, #E2E8F0)" stroke-width="0.5"/>';
    }

    // 글로벌 평균 다각형 (있을 경우)
    if (globalAvg) {
      var avgPoints = DOMAINS.map(function (d) {
        var val = globalAvg[d.key] || 0;
        var ar = (val / 100) * maxR;
        var ap = polarToXY(cx, cy, ar, d.angle);
        return ap.x + ',' + ap.y;
      }).join(' ');
      svg += '<polygon points="' + avgPoints + '" fill="rgba(136,136,160,0.1)" stroke="var(--vc-text-muted, #8898AA)" stroke-width="1" stroke-dasharray="4,3"/>';
    }

    // 국가 점수 다각형
    var scorePoints = DOMAINS.map(function (d) {
      var val = scores[d.key] || 0;
      var sr = (val / 100) * maxR;
      return polarToXY(cx, cy, sr, d.angle);
    });

    var polyStr = scorePoints.map(function (p) { return p.x + ',' + p.y; }).join(' ');
    svg += '<polygon points="' + polyStr + '" fill="rgba(194,65,12,0.10)" stroke="var(--vc-primary, #C2410C)" stroke-width="2" opacity="0">';
    svg += '<animate attributeName="opacity" from="0" to="1" dur="0.6s" fill="freeze"/>';
    svg += '</polygon>';

    // 각 꼭짓점 도트 + 점수 라벨
    for (var j = 0; j < DOMAINS.length; j++) {
      var dm = DOMAINS[j];
      var val = scores[dm.key];
      var dr = val != null ? (val / 100) * maxR : 0;
      var dp = polarToXY(cx, cy, dr, dm.angle);

      // 도트 (with sequential fade-in) — larger hit area for hover
      if (val != null) {
        // Invisible larger hit target
        svg += '<circle cx="' + dp.x + '" cy="' + dp.y + '" r="14" fill="transparent" class="radar-hit" data-domain="' + dm.label + '" data-score="' + val.toFixed(1) + '" data-color="' + dm.color + '" style="cursor:pointer"/>';
        // Visible dot
        svg += '<circle cx="' + dp.x + '" cy="' + dp.y + '" r="4.5" fill="' + dm.color + '" stroke="white" stroke-width="2" class="radar-dot" opacity="0" style="pointer-events:none">';
        svg += '<animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="' + (j * 0.1) + 's" fill="freeze"/>';
        svg += '</circle>';
      }

      // 도메인 라벨 (외곽)
      var lp = polarToXY(cx, cy, maxR + 22, dm.angle);
      svg += '<text x="' + lp.x + '" y="' + lp.y + '" text-anchor="middle" font-size="10" font-family="Inter,sans-serif" font-weight="600" fill="var(--vc-text-secondary, #475569)">' + dm.label + '</text>';

      // 점수값 (도트 아래)
      if (val != null) {
        svg += '<text x="' + lp.x + '" y="' + (lp.y + 14) + '" text-anchor="middle" font-size="10" font-family="JetBrains Mono,monospace" fill="' + dm.color + '" font-weight="700">' + val.toFixed(1) + '</text>';
      } else {
        svg += '<text x="' + lp.x + '" y="' + (lp.y + 14) + '" text-anchor="middle" font-size="10" font-family="Inter,sans-serif" fill="var(--vc-missing, #CBD5E1)">\u2014</text>';
      }
    }

    svg += '</svg>';
    container.innerHTML = svg;

    // ———— Interactive tooltip on radar dots ————
    var svgEl = container.querySelector('svg');
    var tooltip = document.getElementById('chart-tooltip');
    if (!svgEl || !tooltip) return;

    var hitTargets = svgEl.querySelectorAll('.radar-hit');
    for (var h = 0; h < hitTargets.length; h++) {
      (function (hit) {
        hit.addEventListener('mouseenter', function (e) {
          var domain = hit.getAttribute('data-domain');
          var score = hit.getAttribute('data-score');
          var color = hit.getAttribute('data-color');

          tooltip.innerHTML =
            '<div class="tt-year">' + domain + '</div>' +
            '<div class="tt-value" style="color:' + color + '">' + score + '<span style="font-size:10px;color:rgba(241,245,249,0.5);font-weight:400">/100</span></div>';
          tooltip.style.display = 'block';

          var ttX = e.clientX + 14;
          var ttY = e.clientY - 44;
          if (ttX + 100 > window.innerWidth) ttX = e.clientX - 110;
          if (ttY < 4) ttY = e.clientY + 14;
          tooltip.style.left = ttX + 'px';
          tooltip.style.top = ttY + 'px';

          // Highlight the dot
          var dot = hit.nextElementSibling;
          if (dot && dot.classList.contains('radar-dot')) {
            dot.setAttribute('r', '6');
          }
        });

        hit.addEventListener('mousemove', function (e) {
          var ttX = e.clientX + 14;
          var ttY = e.clientY - 44;
          if (ttX + 100 > window.innerWidth) ttX = e.clientX - 110;
          tooltip.style.left = ttX + 'px';
          tooltip.style.top = ttY + 'px';
        });

        hit.addEventListener('mouseleave', function () {
          tooltip.style.display = 'none';
          var dot = hit.nextElementSibling;
          if (dot && dot.classList.contains('radar-dot')) {
            dot.setAttribute('r', '4.5');
          }
        });
      })(hitTargets[h]);
    }
  }

  return { render: render };
})();
