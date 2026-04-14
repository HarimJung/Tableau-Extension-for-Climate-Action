/**
 * narrator-actions.js — Tableau API action wrappers for Climate Narrator
 *
 * Provides imperative control over Tableau worksheets from the narrator:
 *   selectMarks, setParameter, applyFilter, clearFilter, annotate
 *
 * All functions are no-ops in standalone mode (no Tableau API).
 * Depends on: tableau.extensions (loaded via tableau.extensions.1.latest.js)
 */

(function () {
  'use strict';

  // ———— Internal helpers ————

  function isStandalone() {
    return typeof tableau === 'undefined' || !tableau.extensions;
  }

  function getDashboard() {
    if (isStandalone()) return null;
    return tableau.extensions.dashboardContent.dashboard;
  }

  function findWorksheet(name) {
    var dashboard = getDashboard();
    if (!dashboard) return null;
    var worksheets = dashboard.worksheets || [];
    for (var i = 0; i < worksheets.length; i++) {
      if (worksheets[i].name === name) return worksheets[i];
    }
    console.warn('[NarratorActions] Worksheet not found:', name);
    return null;
  }

  function findWorksheetFuzzy(name) {
    var dashboard = getDashboard();
    if (!dashboard) return null;
    var worksheets = dashboard.worksheets || [];
    var lower = name.toLowerCase();
    // Exact match first
    for (var i = 0; i < worksheets.length; i++) {
      if (worksheets[i].name === name) return worksheets[i];
    }
    // Partial match
    for (var j = 0; j < worksheets.length; j++) {
      if (worksheets[j].name.toLowerCase().indexOf(lower) >= 0) return worksheets[j];
    }
    console.warn('[NarratorActions] Worksheet not found (fuzzy):', name);
    return null;
  }

  // ———— Public API ————

  /**
   * Select marks on a worksheet by field value(s).
   * @param {string} worksheetName - Tableau worksheet name
   * @param {string} fieldName - Field to select by (e.g. "ISO3", "Country")
   * @param {Array} values - Values to select (e.g. ["KOR", "USA"])
   * @returns {Promise<boolean>} true if successful
   */
  async function selectMarks(worksheetName, fieldName, values) {
    if (isStandalone()) {
      console.log('[NarratorActions] selectMarks (standalone):', worksheetName, fieldName, values);
      return false;
    }

    var ws = findWorksheetFuzzy(worksheetName);
    if (!ws) return false;

    try {
      await ws.selectMarksByValueAsync(
        [{ fieldName: fieldName, value: values }],
        tableau.SelectionUpdateType.Replace
      );
      console.log('[NarratorActions] selectMarks OK:', worksheetName, fieldName, values);
      return true;
    } catch (err) {
      console.error('[NarratorActions] selectMarks failed:', err);
      return false;
    }
  }

  /**
   * Set a Tableau parameter value.
   * @param {string} paramName - Parameter name
   * @param {*} value - New value
   * @returns {Promise<boolean>}
   */
  async function setParameter(paramName, value) {
    if (isStandalone()) {
      console.log('[NarratorActions] setParameter (standalone):', paramName, value);
      return false;
    }

    var dashboard = getDashboard();
    if (!dashboard) return false;

    try {
      var params = await dashboard.getParametersAsync();
      var param = null;
      for (var i = 0; i < params.length; i++) {
        if (params[i].name === paramName) { param = params[i]; break; }
      }
      if (!param) {
        console.warn('[NarratorActions] Parameter not found:', paramName);
        return false;
      }
      // Integer/float 파라미터는 숫자로 변환
      var finalValue = value;
      if (param.dataType === 'int' || param.dataType === 'float') {
        finalValue = Number(value);
      }
      await param.changeValueAsync(finalValue);
      console.log('[NarratorActions] setParameter OK:', paramName, finalValue);
      return true;
    } catch (err) {
      console.error('[NarratorActions] setParameter failed:', err);
      return false;
    }
  }

  /**
   * Apply a categorical filter on a worksheet.
   * @param {string} worksheetName
   * @param {string} fieldName
   * @param {Array} values - Values to include
   * @param {string} [updateType='replace'] - 'replace', 'add', or 'remove'
   * @returns {Promise<boolean>}
   */
  async function applyFilter(worksheetName, fieldName, values, updateType) {
    if (isStandalone()) {
      console.log('[NarratorActions] applyFilter (standalone):', worksheetName, fieldName, values);
      return false;
    }

    var ws = findWorksheetFuzzy(worksheetName);
    if (!ws) return false;

    var filterType = tableau.FilterUpdateType.Replace;
    if (updateType === 'add') filterType = tableau.FilterUpdateType.Add;
    if (updateType === 'remove') filterType = tableau.FilterUpdateType.Remove;

    try {
      await ws.applyFilterAsync(fieldName, values, filterType);
      console.log('[NarratorActions] applyFilter OK:', worksheetName, fieldName, values);
      return true;
    } catch (err) {
      console.error('[NarratorActions] applyFilter failed:', err);
      return false;
    }
  }

  /**
   * Clear a filter on a worksheet.
   * @param {string} worksheetName
   * @param {string} fieldName
   * @returns {Promise<boolean>}
   */
  async function clearFilter(worksheetName, fieldName) {
    if (isStandalone()) {
      console.log('[NarratorActions] clearFilter (standalone):', worksheetName, fieldName);
      return false;
    }

    var ws = findWorksheetFuzzy(worksheetName);
    if (!ws) return false;

    try {
      await ws.clearFilterAsync(fieldName);
      console.log('[NarratorActions] clearFilter OK:', worksheetName, fieldName);
      return true;
    } catch (err) {
      console.error('[NarratorActions] clearFilter failed:', err);
      return false;
    }
  }

  /**
   * List all worksheet names in the current dashboard.
   * Useful for debugging which worksheet names are available.
   * @returns {Array<string>}
   */
  function listWorksheets() {
    var dashboard = getDashboard();
    if (!dashboard) return [];
    var worksheets = dashboard.worksheets || [];
    var names = [];
    for (var i = 0; i < worksheets.length; i++) {
      names.push(worksheets[i].name);
    }
    return names;
  }

  /**
   * List all parameter names in the current dashboard.
   * @returns {Promise<Array<string>>}
   */
  async function listParameters() {
    var dashboard = getDashboard();
    if (!dashboard) return [];

    try {
      var params = await dashboard.getParametersAsync();
      var names = [];
      for (var i = 0; i < params.length; i++) {
        names.push(params[i].name);
      }
      return names;
    } catch (err) {
      console.error('[NarratorActions] listParameters failed:', err);
      return [];
    }
  }

  /**
   * Execute an array of tableau_actions from a guided-tour rule.
   * Each action: { type: 'selectMarks'|'setParameter'|'applyFilter'|'clearFilter', ...params }
   * @param {Array} actions
   * @returns {Promise<void>}
   */
  async function executeActions(actions) {
    if (!actions || actions.length === 0) return;

    for (var i = 0; i < actions.length; i++) {
      var a = actions[i];
      switch (a.type) {
        case 'selectMarks':
          await selectMarks(a.worksheet, a.field, a.values);
          break;
        case 'setParameter':
          await setParameter(a.param, a.value);
          break;
        case 'applyFilter':
          await applyFilter(a.worksheet, a.field, a.values, a.updateType);
          break;
        case 'clearFilter':
          await clearFilter(a.worksheet, a.field);
          break;
        default:
          console.warn('[NarratorActions] Unknown action type:', a.type);
      }
    }
  }

  // ———— Export to global NarratorActions namespace ————

  window.NarratorActions = {
    selectMarks: selectMarks,
    setParameter: setParameter,
    applyFilter: applyFilter,
    clearFilter: clearFilter,
    listWorksheets: listWorksheets,
    listParameters: listParameters,
    executeActions: executeActions,
    isStandalone: isStandalone,
  };

})();
