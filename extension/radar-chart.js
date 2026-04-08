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
const RadarChart = (() => {
  'use strict';

  const DOMAINS = [
    { key: 'emissions', label: 'Emissions', angle: -90, color: '#E5484D' },
    { key: 'energy', label: 'Energy', angle: -18, color: '#0066FF' },
    { key: 'economy', label: 'Economy', angle: 54, color: '#8B5CF6' },
    { key: 'responsibility', label: 'Responsibility', angle: 126, color: '#F59E0B' },
    { key: 'resilience', label: 'Resilience', angle: 198, color: '#00A67E' },
  ];

  function polarToXY(cx, cy, radius, angleDeg) {
    const rad = (angleDeg * Math.PI) / 180;
    return {
      x: cx + radius * Math.cos(rad),
      y: cy + radius * Math.sin(rad),
    };
  }

  function render(containerId, scores, globalAvg) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const size = 300;
    const cx = size / 2;
    const cy = size / 2;
    const maxR = 120;
    const levels = 5; // 0, 20, 40, 60, 80, 100

    let svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">`;

    // 배경 원형 그리드
    for (let i = 1; i <= levels; i++) {
      const r = (maxR / levels) * i;
      const points = DOMAINS.map(d => {
        const p = polarToXY(cx, cy, r, d.angle);
        return `${p.x},${p.y}`;
      }).join(' ');
      svg += `<polygon points="${points}" fill="none" stroke="#E5E7EB" stroke-width="0.5"/>`;
    }

    // 축선
    for (const d of DOMAINS) {
      const p = polarToXY(cx, cy, maxR, d.angle);
      svg += `<line x1="${cx}" y1="${cy}" x2="${p.x}" y2="${p.y}" stroke="#E5E7EB" stroke-width="0.5"/>`;
    }

    // 글로벌 평균 다각형 (있을 경우)
    if (globalAvg) {
      const avgPoints = DOMAINS.map(d => {
        const val = globalAvg[d.key] ?? 0;
        const r = (val / 100) * maxR;
        const p = polarToXY(cx, cy, r, d.angle);
        return `${p.x},${p.y}`;
      }).join(' ');
      svg += `<polygon points="${avgPoints}" fill="rgba(136,136,160,0.15)" stroke="#8888A0" stroke-width="1" stroke-dasharray="4,3"/>`;
    }

    // 국가 점수 다각형
    const validScores = DOMAINS.map(d => ({
      ...d,
      value: scores[d.key] ?? null,
    }));

    const scorePoints = validScores.map(d => {
      const val = d.value ?? 0;
      const r = (val / 100) * maxR;
      return polarToXY(cx, cy, r, d.angle);
    });

    const polyStr = scorePoints.map(p => `${p.x},${p.y}`).join(' ');
    svg += `<polygon points="${polyStr}" fill="rgba(0,102,255,0.15)" stroke="#0066FF" stroke-width="2" opacity="0">`;
    svg += `<animate attributeName="opacity" from="0" to="1" dur="0.6s" fill="freeze"/>`;
    svg += `</polygon>`;

    // 각 꼭짓점 도트 + 점수 라벨
    for (let i = 0; i < DOMAINS.length; i++) {
      const d = DOMAINS[i];
      const val = scores[d.key];
      const r = val != null ? (val / 100) * maxR : 0;
      const p = polarToXY(cx, cy, r, d.angle);

      // 도트 (with sequential fade-in)
      if (val != null) {
        svg += `<circle cx="${p.x}" cy="${p.y}" r="4" fill="${d.color}" stroke="white" stroke-width="1.5" opacity="0">`;
        svg += `<animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="${i * 0.1}s" fill="freeze"/>`;
        svg += `</circle>`;
      }

      // 도메인 라벨 (외곽)
      const lp = polarToXY(cx, cy, maxR + 22, d.angle);
      const anchor = d.angle > 90 && d.angle < 270 ? 'end' : (d.angle === 90 || d.angle === 270 ? 'middle' : 'start');
      // 상단(-90도)일 때 가운데 정렬
      const textAnchor = Math.abs(d.angle + 90) < 1 ? 'middle' :
                    (d.angle > -90 && d.angle < 90) ? 'start' :
                    (Math.abs(d.angle - 90) < 1 || Math.abs(d.angle - 270) < 1) ? 'middle' : 'end';

      svg += `<text x="${lp.x}" y="${lp.y}" text-anchor="middle" font-size="10" font-family="Inter,sans-serif" fill="#4A4A6A">${d.label}</text>`;

      // 점수값 (도트 아래)
      if (val != null) {
        svg += `<text x="${lp.x}" y="${lp.y + 13}" text-anchor="middle" font-size="9" font-family="JetBrains Mono,monospace" fill="${d.color}" font-weight="600">${val.toFixed(1)}</text>`;
      } else {
        svg += `<text x="${lp.x}" y="${lp.y + 13}" text-anchor="middle" font-size="9" font-family="Inter,sans-serif" fill="#CCCCCC">\u2014</text>`;
      }
    }

    svg += '</svg>';
    container.innerHTML = svg;
  }

  return { render };
})();
