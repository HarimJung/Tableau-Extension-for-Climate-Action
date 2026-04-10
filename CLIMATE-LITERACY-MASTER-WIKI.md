# MASTER PROMPT — Visual Climate: Narrator Upgrade + Climate Literacy Dashboards

> **이 프롬프트를 받은 Claude는 Lead Developer로서 아래 전체 명세를 읽고 Phase별로 실행합니다.**

---

## 0. PROJECT IDENTITY

- **GitHub**: https://github.com/HarimJung/Tableau-Extension-for-Climate-Action
- **Website**: https://visualclimate.org
- **Data**: Supabase (172,121 rows, 250 countries, 61 indicators) + GitHub JSON/CSV

---

## 1. EXISTING CODEBASE — 절대 삭제하지 말 것

### 1.1 Extension 파일 목록 (extension/ 폴더)

| 파일 | 역할 | .trex ID |
|---|---|---|
| `shared.js` (20.9KB) | 공유 모듈: Supabase REST, ISO3 감지, 등급/색상 맵, NDC_TARGETS(20국), TIMESERIES_GROUPS(7그룹), 이벤트 리스너 | — |
| `app.js` (10.7KB) + `index.html` | **Climate Card** — 국가별 기후 성적표 (5-domain breakdown, radar, insights) | `com.visualclimate.climate-card` |
| `narrator-app.js` (45.6KB) + `narrator.html` | **Climate Narrator** — 25-rule state machine (EMPTY→WELCOME→PROFILE→EXPLORE→VERSUS), guided/free mode | `com.visualclimate.climate-narrator` |
| `timeseries-app.js` (17.1KB) + `timeseries.html` | **Timeseries Explorer** — 7 indicator groups, SVG line charts, crosshair tooltips | `com.visualclimate.timeseries-explorer` |
| `ndc-tracker-app.js` (18.8KB) + `ndc-tracker.html` | **NDC Gap Tracker** — 20국 NDC 목표 vs 실배출, gap severity, projection fan | `com.visualclimate.ndc-tracker` |
| `radar-chart.js` (7KB) | Climate Card용 SVG radar chart | — |
| `styles.css` (26.9KB) | 전체 공유 CSS (VC 브랜드 변수 포함) | — |
| `tableau.extensions.1.latest.js` | Tableau Extensions API 라이브러리 | — |

### 1.2 shared.js 핵심 API (모든 Extension이 의존)

```javascript
VC.configureSupabase(url, key)
VC.supabaseGet(table, query)
VC.getCountry(iso3) → {iso3, name, region, sub_region, income_group, population}
VC.getAllCountries()
VC.getLatestIndicators(iso3, codes[]) → {code: {value, year, source}}
VC.getTimeseries(iso3, code) → [{year, value, source}]
VC.getMultiTimeseries(iso3, codes[])
VC.getReportCard(iso3) → {iso3, name, total_score, grade, climate_class, *_score}
VC.getPeerContext(iso3) → {globalRank, totalCountries, incomeRank, incomeTotal}
VC.detectISO3FromDashboard() → ISO3 string (marks → filters fallback)
VC.onFilterChange(callback), VC.onMarkSelection(callback)
VC.NDC_TARGETS → {KOR:{ndc2030_pct:40, ref_year:2018, ...}, ...} (20국)
VC.TIMESERIES_GROUPS → {emissions:{codes:[...]}, fuel, sector, energy, economy, resilience, other_ghg}
VC.GRADE_LABEL, VC.GRADE_COLOR, VC.GRADE_BG
VC.CLASS_LABEL, VC.CLASS_COLOR, VC.CLASS_EXPLAIN
VC.DOMAINS → [{key, label, weight, color, scoreField}] (emissions 30%, energy 25%, economy/responsibility/resilience 15%)
VC.BRAND → {primary:'#0066FF', changer:'#00A67E', starter:'#F59E0B', talker:'#E5484D', ...}
VC.CAT_COLOR, VC.GAP_COLOR
VC.reShareCategory(pct), VC.perfLabel(score), VC.scoreColor(score)
VC.iso3ToFlag(iso3), VC.fmt(val, decimals), VC.fmtLarge(val)
```

### 1.3 Narrator 현재 상태 (narrator-app.js)

**States**: EMPTY → WELCOME → PROFILE → EXPLORE (+ VERSUS if previousISO3 exists)
**Rules**: 25개 (R01-R04 VERSUS, R05-R07 Quiz bridge, R08-R12 WELCOME by score tier, R13-R19 PROFILE by class/spread, R20-R24 EXPLORE by indicator, R25 FALLBACK)
**Data flow**: VC.getReportCard() + VC.getPeerContext() + VC.getLatestIndicators(iso3, EXPLORE_CODES)
**UI**: narrator-panel with country header, insight text, so-what text, metric section, action text, module indicator, guided/free toggle
**Free mode**: domain mini bars, score/grade summary
**Problem**: 텍스트만 보여주고 끝. Tableau 워크시트를 제어하지 않음. 인터랙티브 넛지 없음. 감동 없음.

### 1.4 visualclimate-trojan/ 폴더 (백엔드 엔진)

- `CLAUDE.md` — 프로젝트 마스터 규칙 (환각 금지, 단위 표준, GWP AR5, LULUCF 제외 기본)
- `data/schema.json` — 23개 핵심 지표 정의 (Supabase 코드 매핑 포함)
- `data/source-registry.json` — 소스 6개 등록
- `data/ndc-targets-v2.json` — NDC 3.0 포함 20국 상세
- `data/tableau/countries_latest.csv` — 250국 최신 지표 CSV
- `data/tableau/timeseries.csv` — 6국 시계열 CSV
- `data/tableau/calculated-fields.md` — Tableau 계산필드 10개 (CF01-CF10)
- `.claude/skills/` — 스킬 10개 (country-brief, ndc-gap-brief, tableau-spec-writer 등)
- `.claude/agents/engine-director.md`
- `scripts/pull-from-supabase.ts`, `push-to-supabase.ts`

---

## 2. WHAT TO BUILD — Hans Rosling Factfulness 기반 Narrator 업그레이드

### 2.1 설계 원칙

Hans Rosling의 3단계: (1) REALIZE — 세계를 있는 그대로 보지 못함 (2) IDENTIFY — 10 dramatic instincts (3) CONTROL — Rules of Thumb

우리가 깨뜨릴 5가지 본능 (= 5 Dashboards):

| # | Dashboard | Rosling Instinct | Misconception | Key Data |
|---|---|---|---|---|
| DB1 | WHO EMITS? | Gap Instinct | "중국이 최대 오염국" | KOR 11.4t vs CHN ~8.0t (CO2/capita) |
| DB2 | WHAT'S CHANGING? | Negativity + Straight Line | "아무것도 안 변해" | DEU renewable 35→54%, post-Paris CAGR |
| DB3 | ENERGY REALITY | Size Instinct | "화석연료 줄었다" | 절대량 +20% vs 비율 변화 |
| DB4 | PROMISES vs REALITY | Urgency + Destiny | "약속대로 진행 중" | KOR NDC -40% vs actual -8% |
| DB5 | CLIMATE JUSTICE | Blame + Generalization | "가난한 나라가 원인" | NGA 0.55t but vuln 0.48 vs KOR 11.4t vuln 0.36 |

### 2.2 교수법: 6-Step Scaffolded Inquiry (각 Dashboard 동일 구조)

**ANCHOR** → 놀라운 질문으로 기존 인식 고정
**DISRUPT** → 정답 공개로 인식 파괴
**EXPLORE** → 사용자가 직접 데이터 탐색 (드래그/클릭/필터)
**COMPARE** → 다른 국가/지표와 비교 넛지
**EVALUATE** → 목표 vs 현실 격차 확인
**REFLECT** → Rosling 인용 + 기후 정의 성찰

### 2.3 Narrator 업그레이드 요구사항

**현재**: 텍스트 표시만 (passive)
**목표**: Tableau 워크시트를 능동적으로 제어하는 코치 (active nudge)

추가할 Tableau API 호출:
```javascript
// narrator-actions.js (신규 파일)
selectMarks(worksheetName, fieldName, values)  // selectMarksByValueAsync
setParameter(paramName, value)                  // changeValueAsync
applyFilter(worksheetName, fieldName, values)   // applyFilterAsync
annotate(worksheetName, markField, markValue, text) // annotateMarkAsync
```

추가할 이벤트 감지:
```javascript
// SummaryDataChanged — 드래그 앤 드롭 감지 (Tableau Desktop)
worksheet.addEventListener(TableauEventType.SummaryDataChanged, handler)
```

### 2.4 narrator-rules.json 신규 구조

기존 25 rules은 유지. 새로운 "dashboard-specific" 룰 30개 추가 (5 dashboards × 6 steps).
기존 rules는 "generic" 카테고리로, 새 rules는 "guided-tour" 카테고리로.
Rule 매칭: guided-tour 모드에서는 dashboard+step 기반 매칭 우선, generic은 free 모드에서 사용.

---

## 3. PHASE별 작업 지시

### Phase 1: 데이터 파일 생성 (즉시 실행 가능)

**1a. `data/quiz-global-stats.json`**
```json
{
  "generated": "2026-04-10",
  "global_co2_per_capita_t": 4.7,
  "global_renewable_pct": 30,
  "paris_signatories": 194,
  "paris_total_countries": 195,
  "new_renewable_2024_pct": 90,
  "fossil_use_vs_2000_pct": 120,
  "high_income_top10_co2_t": 25,
  "high_income_bottom50_co2_t": 5,
  "sources": {
    "co2_per_capita": "OWID/GCP 2023",
    "renewable_pct": "IRENA/Ember 2023",
    "paris": "UNFCCC 2024",
    "new_renewable": "IRENA 2024",
    "fossil_use": "OWID Energy 2023",
    "inequality": "World Inequality Database 2021"
  }
}
```

**1b. `data/narrator-country-cache.json`** — 6국 핵심 수치 (narrator가 Supabase 호출 없이 즉시 표시)
기존 risk-profile JSON에서 추출. KOR, USA, DEU, BRA, NGA, BGD 각각:
co2_per_capita, renewable_pct, fossil_pct, carbon_intensity, ndgain_vulnerability, ndgain_readiness, decoupling, pm25, ndc_target_pct, population, gdp_per_capita, total_score, grade, climate_class

**1c. `data/energy-absolute-twh.csv`** — OWID energy CSV에서 6국 추출
열: iso3, year, coal_twh, oil_twh, gas_twh, nuclear_twh, hydro_twh, wind_twh, solar_twh, other_renewable_twh, total_twh

### Phase 2: Quiz Web App (독립적, 병렬 진행)

5문항 Gapminder 스타일. 스펙:
- Q1: "한국과 중국, 1인당 CO₂ 더 높은 나라?" A.한국 B.중국 C.비슷 → A (82% 오답) → DB1
- Q2: "2023년 화석연료 사용 vs 2000년?" A.5%↓ B.비슷 C.20%↑ → C (80%) → DB3
- Q3: "파리협정 서명국 수?" A.~50 B.~100 C.194 → C (85%) → DB4
- Q4: "2024 신규 발전소 중 재생에너지?" A.~10% B.~50% C.~90% → C (89%) → DB3
- Q5: "고소득국 상위 10% 1인당 CO₂?" A.~10t B.~15t C.~25t → C (60%) → DB5

출력: `?score=N&missed=DB1,DB3&lang=ko` URL 파라미터로 Tableau에 전달.

### Phase 3: Narrator Extension 업그레이드 (핵심)

**절대 규칙**: 기존 narrator-app.js의 25 rules, state machine, UI 구조를 유지한 채 확장.

**3a. 신규 파일: `extension/narrator-actions.js`**
Tableau API 래퍼 (selectMarks, setParameter, applyFilter, annotate)

**3b. 신규 파일: `extension/narrator-rules-guided.json`**
5 dashboards × 6 steps = 30 guided-tour rules. 각 rule:
```json
{
  "id": "DB1_STEP1_ANCHOR",
  "dashboard": "DB1",
  "step": 1,
  "state": "ANCHOR",
  "narrator_text_ko": "한국과 중국, 1인당 CO₂ 배출이 더 많은 나라는?",
  "quiz_options": ["한국", "중국"],
  "correct_answer": "한국",
  "wrong_pct": 82,
  "on_correct": { "text": "정답! 하지만 82%의 사람은 틀립니다." },
  "on_wrong": { "text": "82%의 사람이 같은 답을 골랐습니다. 하지만…" },
  "tableau_actions": [],
  "metric": { "value": "11.4t", "label": "Korea CO₂/capita" },
  "data_source": "risk-profile-KOR.json → EN.GHG.CO2.PC.CE.AR5"
}
```

**3c. narrator-app.js 수정사항** (기존 코드 유지하면서 추가):
- `currentDashboard` 상태 변수 추가 (DB1-DB5)
- `currentStep` 상태 변수 추가 (1-6)
- `guidedTourActive` boolean
- URL 파라미터로 dashboard/step 수신: `?dashboard=DB1&step=1`
- 기존 state machine(EMPTY→WELCOME→PROFILE→EXPLORE→VERSUS)은 free mode에서 그대로 동작
- guided mode에서는 ANCHOR→DISRUPT→EXPLORE→COMPARE→EVALUATE→REFLECT 진행
- narrator-actions.js import하여 각 step에서 Tableau 워크시트 제어
- quiz 버튼 UI 추가 (ANCHOR step에서 2-3개 선택지 표시)

**3d. narrator.html 수정** (기존 구조 유지하면서 추가):
- `<div id="narrator-quiz-section">` 추가 (퀴즈 버튼 영역)
- `<div id="narrator-sparkline">` 추가 (미니 차트 영역)
- `<div id="narrator-step-indicator">` 추가 (●●○○○○ 진행 표시)

**3e. styles.css에 추가할 클래스**:
- `.narrator-quiz-btn` — 퀴즈 선택 버튼
- `.narrator-sparkline` — 미니 SVG 차트 영역
- `.narrator-step-dot` — 단계 인디케이터
- `.narrator-nudge-pulse` — 넛지 펄스 애니메이션

### Phase 4: 통합 (Quiz → Tableau → Narrator 연결)

- Quiz 완료 → URL params → Tableau Dashboard URL Action 수신
- Narrator가 `?dashboard=DB1&step=1&score=2&missed=DB1,DB3` 파싱
- missed topics에 해당하는 dashboard를 "Recall" beat로 시작

---

## 4. DEVELOPMENT RULES

1. **기존 코드 삭제 금지**. narrator-app.js의 25 rules, shared.js의 모든 함수, 4개 .trex 파일 그대로 유지.
2. **신규 파일 추가만 허용**: narrator-actions.js, narrator-rules-guided.json, quiz 파일들.
3. **기존 파일 수정 시**: 추가만. 기존 함수/변수 이름 변경 금지. 새 코드 블록에 `// === GUIDED TOUR ADDITION ===` 주석.
4. **shared.js의 VC 네임스페이스 확장 시**: 기존 return 객체에 새 프로퍼티 추가만.
5. **모든 숫자의 출처 추적 가능**: narrator text에 사용되는 모든 수치는 data source file + field name 명시.
6. **narrator 텍스트는 한국어 (Korean)**.
7. **환각 금지**: data/ 또는 Supabase에 없는 수치 생성 금지. 모르면 [DATA MISSING].
8. **CLAUDE.md의 모든 규칙 적용**: 단위 표준, GWP AR5, LULUCF 제외 기본, 출처 표기.

---

## 5. START COMMAND

Phase 1부터 시작해줘:
1. `data/quiz-global-stats.json` 생성
2. `data/narrator-country-cache.json` 생성 (6국 핵심 수치)
3. `data/energy-absolute-twh.csv` 추출 스펙

Phase 1 완료 후 Phase 3a(`narrator-actions.js`)로 진행.
