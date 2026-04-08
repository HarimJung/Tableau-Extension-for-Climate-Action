/**
 * shared.js — Visual Climate Tableau Extension 공유 모듈
 *
 * 실제 Supabase 테이블 구조:
 *  - countries: iso3, name, region, sub_region, income_group, population
 *  - indicators: code, source, name, unit, category, domain
 *  - country_data: country_iso3, indicator_code, year, value, source
 *
 * indicator_code 패턴 (pull-from-supabase.ts 기반, 실제 DB에서 검증됨):
 *  WB 계열: SP.POP.TOTL, NY.GDP.PCAP.CD, EN.ATM.GHGT.KT.CE, EN.ATM.CO2E.KT,
 *       EN.ATM.CO2E.PC, EG.FEC.RNEW.ZS, NY.GDP.MKTP.PP.CD
 *  OWID.*: TOTAL_GHG_EXCLUDING_LUCF, TOTAL_GHG, CO2, GHG_PER_CAPITA,
 *       CONSUMPTION_CO2_PER_CAPITA, COAL_CO2, OIL_CO2, GAS_CO2,
 *       METHANE, NITROUS_OXIDE, CO2_PER_GDP
 *  EMBER.*: RENEWABLE.PCT, CARBON.INTENSITY
 *  NDGAIN.*: VULNERABILITY, READINESS, RANK
 *  CTRACE.*: TOTAL, POWER, TRANSPORTATION, MANUFACTURING, AGRICULTURE, WASTE,
 *       BUILDINGS, MINERAL_EXTRACTION, FLUORINATED_GASES
 *  DERIVED.*: CO2_PER_GDP, ENERGY_TRANSITION, CLIMATE_CLASS, DECOUPLING
 *  REPORT.*: TOTAL_SCORE, GRADE, EMISSIONS_SCORE, ENERGY_SCORE,
 *       ECONOMY_SCORE, RESPONSIBILITY_SCORE, RESILIENCE_SCORE
 */

const VC = (() => {
  'use strict';

  // ———— Supabase 설정 (하드코딩) ————
  let _supabaseUrl = 'https://loiawfnakocsodxdytcu.supabase.co';
  let _supabaseKey = 'sb_publishable_2eNSAA0H6fSYse98z_XrnA_SPrCy2CT';

  function configureSupabase(url, key) {
    _supabaseUrl = url.replace(/\/$/, '');
    _supabaseKey = key;
  }

  function getSupabaseUrl() { return _supabaseUrl; }

  function loadConfigFromSettings() { /* no-op: credentials hardcoded */ }
  function saveConfigToSettings() { return Promise.resolve(); }

  // ———— Supabase REST 호출 ————
  // PostgREST 기반: GET /rest/v1/{table}?{query}
  async function supabaseGet(table, query) {
    if (!_supabaseUrl || !_supabaseKey) {
      throw new Error('Supabase not configured. Call VC.configureSupabase(url, key) first.');
    }
    const url = `${_supabaseUrl}/rest/v1/${table}?${query}`;
    const resp = await fetch(url, {
      headers: {
        'apikey': _supabaseKey,
        'Authorization': `Bearer ${_supabaseKey}`,
        'Content-Type': 'application/json',
      },
    });
    if (!resp.ok) throw new Error(`Supabase ${resp.status}: ${await resp.text()}`);
    return resp.json();
  }

  // ———— 데이터 쿼리 함수들 (실제 DB 구조 기반) ————

  /** 국가 메타데이터 조회 */
  async function getCountry(iso3) {
    const rows = await supabaseGet('countries',
      `iso3=eq.${iso3}&select=iso3,name,region,sub_region,income_group,population`);
    return rows[0] || null;
  }

  /** 모든 국가 목록 */
  async function getAllCountries() {
    return supabaseGet('countries',
      'select=iso3,name,region,income_group&order=name');
  }

  /** 특정 국가의 최신 지표값 (indicator_code 배열) */
  async function getLatestIndicators(iso3, codes) {
    // country_data에서 해당 코드들을 연도 내림차순으로 가져옴
    const codesStr = codes.map(c => `"${c}"`).join(',');
    const rows = await supabaseGet('country_data',
      `country_iso3=eq.${iso3}&indicator_code=in.(${codes.join(',')})&order=year.desc&limit=500`);
    // 코드별 최신값만 추출 (pull-from-supabase.ts 패턴 동일)
    const latest = {};
    for (const row of rows) {
      if (!latest[row.indicator_code]) {
        latest[row.indicator_code] = {
          value: row.value,
          year: row.year,
          source: row.source,
        };
      }
    }
    return latest;
  }

  /** 특정 국가 + 특정 지표의 시계열 */
  async function getTimeseries(iso3, code) {
    return supabaseGet('country_data',
      `country_iso3=eq.${iso3}&indicator_code=eq.${code}&order=year.asc&select=year,value,source`);
  }

  /** 특정 국가 + 여러 지표의 시계열 */
  async function getMultiTimeseries(iso3, codes) {
    return supabaseGet('country_data',
      `country_iso3=eq.${iso3}&indicator_code=in.(${codes.join(',')})&order=year.asc&select=indicator_code,year,value,source`);
  }

  /** 스코어카드 데이터 (REPORT.* 코드 사용) */
  const REPORT_CODES = [
    'REPORT.TOTAL_SCORE',
    'REPORT.GRADE',
    'REPORT.EMISSIONS_SCORE',
    'REPORT.ENERGY_SCORE',
    'REPORT.ECONOMY_SCORE',
    'REPORT.RESPONSIBILITY_SCORE',
    'REPORT.RESILIENCE_SCORE',
  ];

  async function getReportCard(iso3) {
    const country = await getCountry(iso3);
    if (!country) return null;

    const latest = await getLatestIndicators(iso3, REPORT_CODES);

    // DERIVED.CLIMATE_CLASS 조회 (2023년 데이터, RAG 레포에서 확인됨)
    const classRows = await supabaseGet('country_data',
      `country_iso3=eq.${iso3}&indicator_code=eq.DERIVED.CLIMATE_CLASS&order=year.desc&limit=1`);

    const score = latest['REPORT.TOTAL_SCORE']?.value ?? null;
    const gradeNum = latest['REPORT.GRADE']?.value ?? null;

    return {
      iso3: country.iso3,
      name: country.name,
      region: country.region,
      income_group: country.income_group,
      total_score: score,
      grade: gradeNum !== null ? GRADE_LABEL[gradeNum] : null,
      grade_numeric: gradeNum,
      climate_class: classRows[0]?.value ?? null,
      emissions_score: latest['REPORT.EMISSIONS_SCORE']?.value ?? null,
      energy_score: latest['REPORT.ENERGY_SCORE']?.value ?? null,
      economy_score: latest['REPORT.ECONOMY_SCORE']?.value ?? null,
      responsibility_score: latest['REPORT.RESPONSIBILITY_SCORE']?.value ?? null,
      resilience_score: latest['REPORT.RESILIENCE_SCORE']?.value ?? null,
    };
  }

  /** 피어 컨텍스트: 글로벌 순위, 소득그룹 순위 */
  async function getPeerContext(iso3) {
    // 모든 국가의 REPORT.TOTAL_SCORE 가져오기
    const allScores = await supabaseGet('country_data',
      'indicator_code=eq.REPORT.TOTAL_SCORE&order=value.desc&select=country_iso3,value,year');

    // 국가별 최신값만 추출
    const countryScores = {};
    for (const row of allScores) {
      if (!countryScores[row.country_iso3]) {
        countryScores[row.country_iso3] = row.value;
      }
    }

    // 순위 계산
    const sorted = Object.entries(countryScores)
      .sort((a, b) => b[1] - a[1]);
    const globalRank = sorted.findIndex(([c]) => c === iso3) + 1;
    const totalCountries = sorted.length;

    // 소득그룹 내 순위
    const country = await getCountry(iso3);
    let incomeRank = null;
    let incomeTotal = null;
    if (country?.income_group) {
      const peerCountries = await supabaseGet('countries',
        `income_group=eq.${encodeURIComponent(country.income_group)}&select=iso3`);
      const peerIsos = new Set(peerCountries.map(c => c.iso3));
      const peerSorted = sorted.filter(([c]) => peerIsos.has(c));
      incomeRank = peerSorted.findIndex(([c]) => c === iso3) + 1;
      incomeTotal = peerSorted.length;
    }

    return { globalRank, totalCountries, incomeRank, incomeTotal };
  }

  // ———— 등급/색상 매핑 (ReportCardClient.tsx에서 추출) ————

  // REPORT.GRADE 숫자 → 텍스트 (RAG 레포 page.tsx 기반)
  const GRADE_LABEL = {
    0: 'A+', 1: 'A', 2: 'B+', 3: 'B', 4: 'C+', 5: 'C', 6: 'D', 7: 'F',
  };

  // 등급별 색상 (ReportIndexClient.tsx에서 추출)
  const GRADE_COLOR = {
    'A+': '#00A67E', 'A': '#00A67E',
    'B+': '#0066FF', 'B': '#0066FF',
    'C+': '#F59E0B', 'C': '#F59E0B',
    'D': '#E5484D',
    'F': '#7F1D1D',
  };

  const GRADE_BG = {
    'A+': '#ECFDF5', 'A': '#ECFDF5',
    'B+': '#EFF6FF', 'B': '#EFF6FF',
    'C+': '#FFFBEB', 'C': '#FFFBEB',
    'D': '#FEF2F2',
    'F': '#FEF2F2',
  };

  // Climate Class (DERIVED.CLIMATE_CLASS: 1=Changer, 2=Starter, 3=Talker)
  const CLASS_LABEL = { 1: 'Changer', 2: 'Starter', 3: 'Talker' };
  const CLASS_COLOR = {
    'Changer': '#00A67E', 'Starter': '#F59E0B', 'Talker': '#E5484D',
  };
  const CLASS_EXPLAIN = {
    'Changer': 'CO\u2082 declining AND renewables rising',
    'Starter': 'Either CO\u2082 declining OR renewables rising (not both)',
    'Talker': 'Neither CO\u2082 declining nor renewables rising',
  };

  // 도메인 정의 (ReportCardClient.tsx에서 추출)
  const DOMAINS = [
    { key: 'emissions', label: 'Emissions', weight: '30%', color: '#E5484D',
      scoreField: 'emissions_score' },
    { key: 'energy', label: 'Energy', weight: '25%', color: '#0066FF',
      scoreField: 'energy_score' },
    { key: 'economy', label: 'Economy', weight: '15%', color: '#8B5CF6',
      scoreField: 'economy_score' },
    { key: 'responsibility', label: 'Responsibility', weight: '15%', color: '#F59E0B',
      scoreField: 'responsibility_score' },
    { key: 'resilience', label: 'Resilience', weight: '15%', color: '#00A67E',
      scoreField: 'resilience_score' },
  ];

  // brand-config.md 색상
  const BRAND = {
    primary: '#0066FF',
    changer: '#00A67E',
    starter: '#F59E0B',
    talker: '#E5484D',
    critical: '#7F1D1D',
    bg: '#FFFFFF',
    sectionBg: '#F8F9FA',
    textPrimary: '#1A1A2E',
    textSecondary: '#4A4A6A',
    textMuted: '#8888A0',
    border: '#E5E7EB',
    dataMissing: '#CCCCCC',
  };

  // CAT rating 색상 (calculated-fields.md CF10 기반)
  const CAT_COLOR = {
    '1.5C_compatible': '#00A67E',
    'Almost_sufficient': '#8BC34A',
    'Insufficient': '#F59E0B',
    'Highly_insufficient': '#E5484D',
    'Critically_insufficient': '#7F1D1D',
  };

  // NDC Gap Severity 색상 (calculated-fields.md CF05 기반)
  const GAP_COLOR = {
    'On Track': '#00A67E',
    'Narrow Gap': '#F59E0B',
    'Significant Gap': '#E5484D',
    'Critical Gap': '#7F1D1D',
  };

  // RE Share Category (CF09)
  function reShareCategory(pct) {
    if (pct == null) return 'No Data';
    if (pct >= 80) return 'RE Leader (80%+)';
    if (pct >= 50) return 'Majority RE (50-79%)';
    if (pct >= 25) return 'Growing RE (25-49%)';
    return 'Fossil Dominant (<25%)';
  }

  // Score → 성능 라벨 (ReportCardClient.tsx의 perfLabel 기반)
  function perfLabel(score) {
    if (score == null) return 'No Data';
    if (score >= 90) return 'Excellent';
    if (score >= 70) return 'Good';
    if (score >= 50) return 'Fair';
    if (score >= 25) return 'Poor';
    return 'Critical';
  }

  // Score → 색상
  function scoreColor(score) {
    if (score == null) return BRAND.dataMissing;
    if (score >= 80) return '#00A67E';
    if (score >= 60) return '#0066FF';
    if (score >= 40) return '#F59E0B';
    if (score >= 20) return '#E5484D';
    return '#7F1D1D';
  }

  // ISO3 → 국기 이모지 (ReportCardClient.tsx의 iso3ToFlag 로직)
  function iso3ToFlag(iso3) {
    const iso2Map = {
      'KOR': 'KR', 'USA': 'US', 'DEU': 'DE', 'CHN': 'CN', 'JPN': 'JP',
      'GBR': 'GB', 'FRA': 'FR', 'BRA': 'BR', 'IND': 'IN', 'AUS': 'AU',
      'CAN': 'CA', 'RUS': 'RU', 'IDN': 'ID', 'MEX': 'MX', 'ZAF': 'ZA',
      'NGA': 'NG', 'BGD': 'BD', 'SAU': 'SA', 'TUR': 'TR', 'EGY': 'EG',
      'KHM': 'KH', 'VNM': 'VN', 'THA': 'TH', 'PHL': 'PH', 'MMR': 'MM',
      'LAO': 'LA', 'SGP': 'SG', 'MYS': 'MY', 'TWN': 'TW', 'HKG': 'HK',
    };
    const iso2 = iso2Map[iso3] || iso3.substring(0, 2);
    return String.fromCodePoint(
      ...[...iso2.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65)
    );
  }

  // 숫자 포맷
  function fmt(val, decimals = 1) {
    if (val == null || isNaN(val)) return '\u2014';
    return Number(val).toFixed(decimals);
  }

  function fmtLarge(val) {
    if (val == null || isNaN(val)) return '\u2014';
    const n = Number(val);
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toFixed(0);
  }

  // ———— URL 파라미터에서 값 읽기 (standalone 모드) ————
  function getUrlParam(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name);
  }

  function isStandaloneMode() {
    return typeof tableau === 'undefined' || !tableau.extensions;
  }

  // ———— Tableau 워크시트에서 ISO3 탐지 ————
  async function detectISO3FromDashboard() {
    // standalone 모드: URL 파라미터에서 ISO3 읽기
    const paramISO3 = getUrlParam('iso3');
    if (paramISO3) return paramISO3.toUpperCase();

    if (isStandaloneMode()) return null;

    const dashboard = tableau.extensions.dashboardContent.dashboard;
    const worksheets = dashboard.worksheets || [];

    console.log("[EXT] worksheets:", worksheets.map(w => w.name));

    for (const ws of worksheets) {
      try {
        const marks = await ws.getSelectedMarksAsync();
        console.log(`[EXT] worksheet=${ws.name} selectedMarks=`, marks);

        if (marks && marks.data && marks.data.length > 0) {
          for (const table of marks.data) {
            const columns = table.columns || [];
            const rows = table.data || [];

            console.log(`[EXT] worksheet=${ws.name} columns=`, columns.map(c => ({
              fieldName: c.fieldName,
              caption: c.caption
            })));

            const isoIndex = columns.findIndex(col => {
              const a = (col.fieldName || "").toLowerCase();
              const b = (col.caption || "").toLowerCase();
              return [
                "iso3",
                "iso 3",
                "country code",
                "countrycode",
                "iso code"
              ].some(key => a.includes(key) || b.includes(key));
            });

            if (isoIndex >= 0 && rows.length > 0) {
              const raw = rows[0][isoIndex] && rows[0][isoIndex].value;
              const iso3 = String(raw || "").trim().toUpperCase();
              console.log(`[EXT] detected iso3 from selected marks:`, iso3);
              if (iso3) return iso3;
            }
          }
        }
      } catch (err) {
        console.error(`[EXT] getSelectedMarksAsync failed for ${ws.name}`, err);
      }
    }

    for (const ws of worksheets) {
      try {
        const filters = await ws.getFiltersAsync();
        console.log(`[EXT] worksheet=${ws.name} filters=`, filters);

        for (const f of filters) {
          const field = String(f.fieldName || "").toLowerCase();
          if (
            field.includes("iso3") ||
            field.includes("country code") ||
            field.includes("countrycode")
          ) {
            if (f.appliedValues && f.appliedValues.length > 0) {
              const iso3 = String(f.appliedValues[0].value || "").trim().toUpperCase();
              console.log(`[EXT] detected iso3 from filter:`, iso3);
              if (iso3) return iso3;
            }
          }
        }
      } catch (err) {
        console.error(`[EXT] getFiltersAsync failed for ${ws.name}`, err);
      }
    }

    console.log("[EXT] no iso3 detected");
    return null;
  }

  // ———— Tableau 이벤트 리스너 등록 ————
  function onFilterChange(callback) {
    if (isStandaloneMode()) return;
    const dashboard = tableau.extensions.dashboardContent.dashboard;
    for (const ws of dashboard.worksheets) {
      ws.addEventListener(
        tableau.TableauEventType.FilterChanged,
        () => callback()
      );
    }
  }

  function onMarkSelection(callback) {
    if (isStandaloneMode()) return;
    const dashboard = tableau.extensions.dashboardContent.dashboard;
    for (const ws of dashboard.worksheets) {
      ws.addEventListener(
        tableau.TableauEventType.MarkSelectionChanged,
        () => callback()
      );
    }
  }

  // ———— 시계열 indicator 그룹 (CountryClient.tsx에서 추출된 실제 코드) ————
  const TIMESERIES_GROUPS = {
    emissions: {
      label: 'Emissions',
      codes: [
        'EN.GHG.CO2.PC.CE.AR5',  // WB CO2 per capita
        'OWID.GHG_PER_CAPITA',
        'OWID.CO2',
        'OWID.TOTAL_GHG_EXCLUDING_LUCF',
        'OWID.CONSUMPTION_CO2_PER_CAPITA',
        'OWID.CO2_PER_GDP',
      ],
    },
    fuel: {
      label: 'Fuel Breakdown',
      codes: [
        'OWID.COAL_CO2',
        'OWID.OIL_CO2',
        'OWID.GAS_CO2',
        'OWID.CEMENT_CO2',
        'OWID.FLARING_CO2',
      ],
    },
    sector: {
      label: 'Sector (Climate TRACE)',
      codes: [
        'CTRACE.POWER',
        'CTRACE.TRANSPORTATION',
        'CTRACE.MANUFACTURING',
        'CTRACE.AGRICULTURE',
        'CTRACE.BUILDINGS',
        'CTRACE.WASTE',
        'CTRACE.MINERAL_EXTRACTION',
        'CTRACE.FLUORINATED_GASES',
      ],
    },
    energy: {
      label: 'Energy',
      codes: [
        'EMBER.RENEWABLE.PCT',
        'EMBER.CARBON.INTENSITY',
        'EG.FEC.RNEW.ZS',
      ],
    },
    economy: {
      label: 'Economy',
      codes: [
        'NY.GDP.PCAP.CD',
        'SP.POP.TOTL',
        'DERIVED.CO2_PER_GDP',
      ],
    },
    resilience: {
      label: 'Resilience',
      codes: [
        'NDGAIN.VULNERABILITY',
        'NDGAIN.READINESS',
      ],
    },
    other_ghg: {
      label: 'Other GHG',
      codes: [
        'OWID.METHANE',
        'OWID.NITROUS_OXIDE',
      ],
    },
  };

  // ———— NDC Targets (ndc-targets-v2.json 기반, 20국) ————
  const NDC_TARGETS = {
    KOR: { name:'South Korea', ndc2030_pct:40, ref_year:2018, ref_type:'absolute', ref_mt:727.6, target_mt:436.6, ndc3:false, nz_year:2050, nz_legal:'in_law', cat:'Highly_insufficient' },
    USA: { name:'United States', ndc2030_pct:50, ref_year:2005, ref_type:'absolute', ref_mt:7417, target_mt:3709, ndc3:false, nz_year:2050, nz_legal:'pledge', cat:'Insufficient' },
    DEU: { name:'Germany', ndc2030_pct:65, ref_year:1990, ref_type:'absolute', ref_mt:1251, target_mt:438, ndc3:true, ndc3_pct:78, ndc3_date:'2025-02-14', nz_year:2045, nz_legal:'in_law', cat:'Insufficient' },
    CHN: { name:'China', ndc2030_pct:65, ref_year:2005, ref_type:'intensity', ndc3:false, nz_year:2060, nz_legal:'pledge', cat:'Highly_insufficient' },
    IND: { name:'India', ndc2030_pct:45, ref_year:2005, ref_type:'intensity', ndc3:false, nz_year:2070, nz_legal:'pledge', cat:'Highly_insufficient' },
    JPN: { name:'Japan', ndc2030_pct:46, ref_year:2013, ref_type:'absolute', ndc3:true, ndc3_pct:60, ndc3_date:'2025-02-04', nz_year:2050, nz_legal:'in_law', cat:'Insufficient' },
    GBR: { name:'United Kingdom', ndc2030_pct:68, ref_year:1990, ref_type:'absolute', ndc3:true, ndc3_pct:81, ndc3_date:'2025-02-04', nz_year:2050, nz_legal:'in_law', cat:'Insufficient' },
    BRA: { name:'Brazil', ndc2030_pct:50, ref_year:2005, ref_type:'absolute', ndc3:true, ndc3_pct:67, ndc3_date:'2025-02-10', nz_year:2050, nz_legal:'in_policy', cat:'Insufficient' },
    CAN: { name:'Canada', ndc2030_pct:40, ref_year:2005, ref_type:'absolute', ndc3:false, nz_year:2050, nz_legal:'in_law', cat:'Insufficient' },
    AUS: { name:'Australia', ndc2030_pct:43, ref_year:2005, ref_type:'absolute', ndc3:false, nz_year:2050, nz_legal:'in_law', cat:'Insufficient' },
    FRA: { name:'France', ndc2030_pct:55, ref_year:1990, ref_type:'absolute', ndc3:true, ndc3_date:'2025-02-14', nz_year:2050, nz_legal:'in_law', cat:'Insufficient' },
    IDN: { name:'Indonesia', ndc2030_pct:32, ref_type:'bau', ndc3:false, nz_year:2060, nz_legal:'in_policy', cat:'Highly_insufficient' },
    NGA: { name:'Nigeria', ndc2030_pct:47, ref_type:'bau', ndc3:false, nz_year:2060, nz_legal:'pledge', cat:'Highly_insufficient' },
    BGD: { name:'Bangladesh', ndc2030_pct:22, ref_type:'bau', ndc3:false, nz_year:null, nz_legal:'none', cat:null },
    ZAF: { name:'South Africa', ndc2030_pct:32, ref_type:'absolute', ndc3:false, nz_year:2050, nz_legal:'in_policy', cat:'Highly_insufficient' },
    MEX: { name:'Mexico', ndc2030_pct:35, ref_type:'bau', ndc3:false, nz_year:2050, nz_legal:'pledge', cat:'Critically_insufficient' },
    RUS: { name:'Russia', ndc2030_pct:30, ref_year:1990, ref_type:'absolute', ndc3:false, nz_year:2060, nz_legal:'in_policy', cat:'Critically_insufficient' },
    SAU: { name:'Saudi Arabia', ndc2030_pct:19, ref_type:'bau', ndc3:false, nz_year:2060, nz_legal:'pledge', cat:'Critically_insufficient' },
    TUR: { name:'Turkey', ndc2030_pct:41, ref_type:'bau', ndc3:false, nz_year:2053, nz_legal:'pledge', cat:'Critically_insufficient' },
    EGY: { name:'Egypt', ndc2030_pct:33, ref_type:'bau', ndc3:false, nz_year:null, nz_legal:'none', cat:'Highly_insufficient' },
  };

  return {
    configureSupabase, getSupabaseUrl, loadConfigFromSettings, saveConfigToSettings,
    supabaseGet, getCountry, getAllCountries, getLatestIndicators,
    getTimeseries, getMultiTimeseries, getReportCard, getPeerContext,
    detectISO3FromDashboard, onFilterChange, onMarkSelection, getUrlParam, isStandaloneMode,
    GRADE_LABEL, GRADE_COLOR, GRADE_BG,
    CLASS_LABEL, CLASS_COLOR, CLASS_EXPLAIN,
    DOMAINS, BRAND, CAT_COLOR, GAP_COLOR,
    NDC_TARGETS, REPORT_CODES, TIMESERIES_GROUPS,
    reShareCategory, perfLabel, scoreColor, iso3ToFlag, fmt, fmtLarge,
  };
})();
