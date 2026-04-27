var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => LifeLedgerPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var VIEW_TYPE_LIFE_LEDGER = "life-ledger-dashboard";
var DATA_ROOT = "LifeLedger";
var BLEEDING_PROJECTS_PATH = `${DATA_ROOT}/BleedingProjects.md`;
var EXPORTS_PATH = `${DATA_ROOT}/Exports`;
var DEFAULT_NORMAL_CATEGORIES = ["\u996E\u98DF", "\u4EA4\u901A", "\u8D2D\u7269", "\u5B66\u4E60", "\u5A31\u4E50", "\u751F\u6D3B\u8D39", "\u521B\u4E1A", "\u5176\u4ED6"];
var DEFAULT_ASSET_CATEGORIES = [
  "\u94F6\u884C\u5361\u50A8\u84C4",
  "\u5FAE\u4FE1\u96F6\u94B1",
  "\u652F\u4ED8\u5B9D\u96F6\u94B1",
  "\u5FAE\u4FE1\u4F59\u989D\u5B9D",
  "\u57FA\u91D1",
  "\u865A\u62DF\u8D27\u5E01",
  "\u5176\u4ED6\u8D44\u4EA7"
];
var RECORD_PAGE_SIZE = 8;
var DEFAULT_SECTION_COLLAPSE_STATE = {
  quickEntry: false,
  dashboard: false,
  budgetWarnings: false,
  charts: false,
  bleeding: true,
  calendar: true,
  search: true,
  yearlyOverview: true,
  monthlyRecords: false,
  exportBackup: true,
  healthCheck: true
};
var DEFAULT_SETTINGS = {
  systemStartMonth: getCurrentMonthString(),
  activityWalletInitialAmount: 1500,
  reserveWalletInitialAmount: 0,
  assetWalletInitialAmount: 0,
  monthlyExpenseBudget: 0,
  activityLowBalanceWarning: 0,
  reserveLowBalanceWarning: 0,
  monthlyBleedingWarning: 0,
  normalCategories: DEFAULT_NORMAL_CATEGORIES,
  assetCategories: DEFAULT_ASSET_CATEGORIES,
  collapsedSections: DEFAULT_SECTION_COLLAPSE_STATE
};
var LifeLedgerPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    __publicField(this, "settings", DEFAULT_SETTINGS);
  }
  async onload() {
    await this.loadSettings();
    this.registerView(
      VIEW_TYPE_LIFE_LEDGER,
      (leaf) => new LifeLedgerDashboardView(leaf, this)
    );
    this.addSettingTab(new LifeLedgerSettingTab(this.app, this));
    this.addRibbonIcon("book-open-check", "LifeLedger Dashboard", () => {
      void this.activateView();
    });
  }
  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_LIFE_LEDGER);
  }
  async activateView() {
    const existingLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_LIFE_LEDGER)[0];
    if (existingLeaf) {
      this.app.workspace.revealLeaf(existingLeaf);
      return;
    }
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.setViewState({
      type: VIEW_TYPE_LIFE_LEDGER,
      active: true
    });
    this.app.workspace.revealLeaf(leaf);
  }
  async loadSettings() {
    const loaded = await this.loadData();
    const systemStartMonth = typeof (loaded == null ? void 0 : loaded.systemStartMonth) === "string" && isMonthString(loaded.systemStartMonth) ? loaded.systemStartMonth : getCurrentMonthString();
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loaded,
      systemStartMonth,
      normalCategories: normalizeCategoryList(
        loaded == null ? void 0 : loaded.normalCategories,
        DEFAULT_NORMAL_CATEGORIES
      ),
      assetCategories: normalizeCategoryList(
        loaded == null ? void 0 : loaded.assetCategories,
        DEFAULT_ASSET_CATEGORIES
      ),
      collapsedSections: {
        ...DEFAULT_SECTION_COLLAPSE_STATE,
        ...(loaded == null ? void 0 : loaded.collapsedSections) || {}
      }
    };
    if (!(loaded == null ? void 0 : loaded.systemStartMonth)) {
      await this.saveData(this.settings);
    }
  }
  async saveSettings() {
    await this.saveData(this.settings);
    await this.refreshDashboardViews();
  }
  async saveSectionCollapseState() {
    await this.saveData(this.settings);
  }
  async refreshDashboardViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_LIFE_LEDGER)) {
      const view = leaf.view;
      if (view instanceof LifeLedgerDashboardView) {
        await view.render();
      }
    }
  }
  async saveRecord(input) {
    await this.saveRecords([input]);
  }
  async saveRecords(inputs) {
    const today = getLocalDateString(/* @__PURE__ */ new Date());
    const yearPath = this.getYearPath(today);
    const monthPath = this.getMonthPath(today);
    const dayPath = this.getNewDailyPath(today);
    const recordsToAdd = inputs.map((input, index) => ({
      ...this.prepareRecordForSave(input),
      amount: roundMoney(input.amount),
      id: createRecordId(index),
      date: today
    }));
    await this.learnCategories(recordsToAdd);
    await this.ensureFolder(DATA_ROOT);
    await this.ensureFolder(yearPath);
    await this.ensureFolder(monthPath);
    const exists = await this.app.vault.adapter.exists(dayPath);
    if (!exists) {
      await this.app.vault.create(dayPath, this.formatDailyFile(today, recordsToAdd));
      return;
    }
    const { file, content } = await this.readDailyFile(dayPath);
    const records = parseLedgerRecords(content);
    records.push(...recordsToAdd);
    await this.app.vault.modify(file, this.replaceLedgerBlock(content, today, records));
  }
  async updateRecord(record) {
    const { file, content } = await this.findDailyFileForRecord(record);
    const records = parseLedgerRecords(content);
    const index = records.findIndex((item) => item.id === record.id);
    if (index === -1) {
      throw new Error(`\u672A\u627E\u5230\u8BB0\u5F55\uFF1A${record.id}`);
    }
    const updatedRecord = this.prepareRecordForSave({
      ...record,
      amount: roundMoney(record.amount)
    });
    records[index] = updatedRecord;
    await this.learnCategories([updatedRecord]);
    await this.app.vault.modify(file, this.replaceLedgerBlock(content, record.date, records));
  }
  async deleteRecord(record) {
    const { file, content } = await this.findDailyFileForRecord(record);
    const records = parseLedgerRecords(content);
    const nextRecords = records.filter((item) => item.id !== record.id);
    if (nextRecords.length === records.length) {
      throw new Error(`\u672A\u627E\u5230\u8BB0\u5F55\uFF1A${record.id}`);
    }
    await this.app.vault.modify(file, this.replaceLedgerBlock(content, record.date, nextRecords));
  }
  async saveBleedingProject(input) {
    await this.ensureFolder(DATA_ROOT);
    const project = {
      ...input,
      amount: roundMoney(input.amount),
      durationDays: Math.round(input.durationDays),
      id: createRecordId(),
      active: true
    };
    const exists = await this.app.vault.adapter.exists(BLEEDING_PROJECTS_PATH);
    if (!exists) {
      await this.app.vault.create(BLEEDING_PROJECTS_PATH, this.formatBleedingFile([project]));
      return;
    }
    const file = this.app.vault.getFileByPath(BLEEDING_PROJECTS_PATH);
    if (!file) {
      throw new Error(`\u65E0\u6CD5\u8BFB\u53D6\u6587\u4EF6\uFF1A${BLEEDING_PROJECTS_PATH}`);
    }
    const content = await this.app.vault.read(file);
    const projects = parseBleedingProjects(content);
    projects.push(project);
    await this.app.vault.modify(file, this.replaceBleedingBlock(content, projects));
  }
  async updateBleedingProject(project) {
    const { file, content } = await this.readBleedingFile();
    const projects = parseBleedingProjects(content);
    const index = projects.findIndex((item) => item.id === project.id);
    if (index === -1) {
      throw new Error(`\u672A\u627E\u5230\u6D41\u8840\u9879\u76EE\uFF1A${project.id}`);
    }
    projects[index] = {
      ...project,
      amount: roundMoney(project.amount),
      durationDays: Math.round(project.durationDays)
    };
    await this.app.vault.modify(file, this.replaceBleedingBlock(content, projects));
  }
  async deleteBleedingProject(projectId) {
    const { file, content } = await this.readBleedingFile();
    const projects = parseBleedingProjects(content);
    const nextProjects = projects.filter((project) => project.id !== projectId);
    if (nextProjects.length === projects.length) {
      throw new Error(`\u672A\u627E\u5230\u6D41\u8840\u9879\u76EE\uFF1A${projectId}`);
    }
    await this.app.vault.modify(file, this.replaceBleedingBlock(content, nextProjects));
  }
  async toggleBleedingProject(projectId) {
    const { file, content } = await this.readBleedingFile();
    const projects = parseBleedingProjects(content);
    const project = projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error(`\u672A\u627E\u5230\u6D41\u8840\u9879\u76EE\uFF1A${projectId}`);
    }
    project.active = !project.active;
    await this.app.vault.modify(file, this.replaceBleedingBlock(content, projects));
  }
  async getBleedingProjects() {
    const { file, content } = await this.readBleedingFile();
    if (!/```life-ledger-bleeding\s*([\s\S]*?)```/.test(content)) {
      await this.app.vault.modify(file, this.replaceBleedingBlock(content, []));
      return [];
    }
    return parseBleedingProjects(content);
  }
  async getMonthSummary(month) {
    const monthlyRecords = await this.loadMonthRecords(month);
    const canUseCumulativeBalances = month >= this.settings.systemStartMonth;
    const cumulativeRecords = canUseCumulativeBalances ? await this.loadRecordsBetweenMonths(this.settings.systemStartMonth, month) : [];
    const income = sumRecords(monthlyRecords, "income");
    const expense = sumRecords(monthlyRecords, "expense");
    const surplus = income - expense;
    const activityIncome = sumRecords(cumulativeRecords, "income", "activity");
    const activityExpense = sumRecords(cumulativeRecords, "expense", "activity");
    const activityInitial = sumRecords(cumulativeRecords, "initial", "activity");
    const reserveIncome = sumRecords(cumulativeRecords, "income", "reserve");
    const reserveExpense = sumRecords(cumulativeRecords, "expense", "reserve");
    const reserveInitial = sumRecords(cumulativeRecords, "initial", "reserve");
    const assetIncome = sumRecords(cumulativeRecords, "income", "asset");
    const assetExpense = sumRecords(cumulativeRecords, "expense", "asset");
    const assetInitial = sumRecords(cumulativeRecords, "initial", "asset");
    const bleedingProjects = await this.getBleedingProjects();
    const today = getLocalDateString(/* @__PURE__ */ new Date());
    return {
      income,
      expense,
      surplus,
      activityBalance: canUseCumulativeBalances ? this.settings.activityWalletInitialAmount + activityIncome + activityInitial - activityExpense : 0,
      reserveBalance: canUseCumulativeBalances ? this.settings.reserveWalletInitialAmount + reserveIncome + reserveInitial - reserveExpense : 0,
      assetBalance: canUseCumulativeBalances ? this.settings.assetWalletInitialAmount + assetIncome + assetInitial - assetExpense : 0,
      assetBreakdown: canUseCumulativeBalances ? getAssetBreakdown(cumulativeRecords) : [],
      expenseBreakdown: getExpenseBreakdown(monthlyRecords),
      bleedingProjects,
      activeBleedingProjects: getActiveBleedingProjects(bleedingProjects, today),
      dailyBleedingTotal: getBleedingTotalForDate(bleedingProjects, today),
      monthBleedingTotal: getBleedingTotalForMonth(bleedingProjects, month),
      realMonthlyExpenseReference: roundMoney(expense + getBleedingTotalForMonth(bleedingProjects, month)),
      records: monthlyRecords.sort((a, b) => b.id.localeCompare(a.id))
    };
  }
  async generateMonthlyReview(month) {
    const summary = await this.getMonthSummary(month);
    const yearPath = this.getYearPath(`${month}-01`);
    const monthPath = this.getMonthPath(`${month}-01`);
    const reviewPath = this.getMonthlyReviewPath(month);
    const content = formatMonthlyReview(month, summary, this.settings);
    await this.ensureFolder(DATA_ROOT);
    await this.ensureFolder(yearPath);
    await this.ensureFolder(monthPath);
    const exists = await this.app.vault.adapter.exists(reviewPath);
    if (!exists) {
      await this.app.vault.create(reviewPath, content);
      return;
    }
    new import_obsidian.Notice("\u6708\u5EA6\u590D\u76D8\u6587\u4EF6\u5DF2\u5B58\u5728\uFF0C\u5C06\u8986\u76D6\u539F\u6587\u4EF6\u3002");
    const file = this.app.vault.getFileByPath(reviewPath);
    if (!file) {
      throw new Error(`\u65E0\u6CD5\u8BFB\u53D6\u6587\u4EF6\uFF1A${reviewPath}`);
    }
    await this.app.vault.modify(file, content);
  }
  async generateYearlyReview(year, viewMonth) {
    const yearlySummary = await this.getYearSummary(year);
    const monthSummary = await this.getMonthSummary(viewMonth);
    const yearPath = this.getYearPath(`${year}-01-01`);
    const reviewPath = this.getYearlyReviewPath(year);
    const content = formatYearlyReview(year, yearlySummary, monthSummary, this.settings);
    await this.ensureFolder(DATA_ROOT);
    await this.ensureFolder(yearPath);
    const exists = await this.app.vault.adapter.exists(reviewPath);
    if (!exists) {
      await this.app.vault.create(reviewPath, content);
      return;
    }
    new import_obsidian.Notice("\u5E74\u5EA6\u590D\u76D8\u6587\u4EF6\u5DF2\u5B58\u5728\uFF0C\u5C06\u8986\u76D6\u539F\u6587\u4EF6\u3002");
    const file = this.app.vault.getFileByPath(reviewPath);
    if (!file) {
      throw new Error(`\u65E0\u6CD5\u8BFB\u53D6\u6587\u4EF6\uFF1A${reviewPath}`);
    }
    await this.app.vault.modify(file, content);
  }
  async getYearSummary(year) {
    const monthlySummaries = [];
    const yearlyRecords = [];
    for (let monthIndex = 1; monthIndex <= 12; monthIndex += 1) {
      const month = `${year}-${String(monthIndex).padStart(2, "0")}`;
      const records = await this.loadMonthRecords(month);
      const income2 = sumRecords(records, "income");
      const expense2 = sumRecords(records, "expense");
      yearlyRecords.push(...records);
      monthlySummaries.push({
        month,
        income: income2,
        expense: expense2,
        surplus: roundMoney(income2 - expense2),
        recordCount: records.length
      });
    }
    const income = sumRecords(yearlyRecords, "income");
    const expense = sumRecords(yearlyRecords, "expense");
    const monthsWithRecords = monthlySummaries.filter((item) => item.recordCount > 0).length;
    return {
      year,
      income,
      expense,
      surplus: roundMoney(income - expense),
      averageMonthlyExpense: monthsWithRecords > 0 ? roundMoney(expense / monthsWithRecords) : 0,
      averageMonthlyIncome: monthsWithRecords > 0 ? roundMoney(income / monthsWithRecords) : 0,
      monthlySummaries,
      expenseBreakdown: getExpenseBreakdown(yearlyRecords).slice(0, 8),
      topRecords: [...yearlyRecords].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, 10),
      records: yearlyRecords
    };
  }
  async exportMonthCsv(month) {
    const summary = await this.getMonthSummary(month);
    const path = `${EXPORTS_PATH}/${month}_LifeLedger_Records.csv`;
    await this.writeExportFile(path, formatRecordsCsv(summary.records));
    return path;
  }
  async exportYearCsv(year) {
    const yearlySummary = await this.getYearSummary(year);
    const path = `${EXPORTS_PATH}/${year}_LifeLedger_Records.csv`;
    await this.writeExportFile(path, formatRecordsCsv(yearlySummary.records));
    return path;
  }
  async exportAllRecordsJson() {
    const records = await this.loadAllLedgerRecords();
    const path = `${EXPORTS_PATH}/LifeLedger_All_Records.json`;
    await this.writeExportFile(path, `${JSON.stringify(records, null, 2)}
`);
    return path;
  }
  async exportBleedingProjectsJson() {
    const projects = await this.getBleedingProjects();
    const path = `${EXPORTS_PATH}/LifeLedger_BleedingProjects.json`;
    await this.writeExportFile(path, `${JSON.stringify(projects, null, 2)}
`);
    return path;
  }
  async runDataHealthCheck() {
    const result = {
      errors: [],
      warnings: [],
      info: [],
      scannedFiles: 0,
      ledgerRecords: 0,
      bleedingProjects: 0,
      reportPath: `${EXPORTS_PATH}/LifeLedger_DataHealthReport.md`
    };
    const ledgerIds = /* @__PURE__ */ new Map();
    const bleedingIds = /* @__PURE__ */ new Map();
    await this.scanLedgerFiles(result, ledgerIds);
    await this.scanBleedingProjects(result, bleedingIds);
    result.info.push({ message: `\u68C0\u67E5\u4E86 ${result.scannedFiles} \u4E2A\u6587\u4EF6\u3002` });
    result.info.push({ message: `\u68C0\u67E5\u4E86 ${result.ledgerRecords} \u6761\u666E\u901A\u8BB0\u5F55\u3002` });
    result.info.push({ message: `\u68C0\u67E5\u4E86 ${result.bleedingProjects} \u4E2A\u6D41\u8840\u9879\u76EE\u3002` });
    result.info.push({
      message: result.errors.length === 0 && result.warnings.length === 0 ? "\u6570\u636E\u68C0\u67E5\u901A\u8FC7\uFF0C\u672A\u53D1\u73B0\u660E\u663E\u95EE\u9898\u3002" : "\u6570\u636E\u68C0\u67E5\u5B8C\u6210\uFF0C\u53D1\u73B0\u9700\u8981\u5173\u6CE8\u7684\u95EE\u9898\u3002"
    });
    await this.writeExportFile(result.reportPath, formatHealthCheckReport(result));
    return result;
  }
  async ensureFolder(path) {
    const exists = await this.app.vault.adapter.exists(path);
    if (!exists) {
      await this.app.vault.createFolder(path);
    }
  }
  async writeExportFile(path, content) {
    await this.ensureFolder(DATA_ROOT);
    await this.ensureFolder(EXPORTS_PATH);
    const exists = await this.app.vault.adapter.exists(path);
    if (!exists) {
      await this.app.vault.create(path, content);
      return;
    }
    new import_obsidian.Notice("\u5BFC\u51FA\u6587\u4EF6\u5DF2\u5B58\u5728\uFF0C\u5C06\u8986\u76D6\u539F\u6587\u4EF6\u3002");
    const file = this.app.vault.getFileByPath(path);
    if (!file) {
      throw new Error(`\u65E0\u6CD5\u8BFB\u53D6\u6587\u4EF6\uFF1A${path}`);
    }
    await this.app.vault.modify(file, content);
  }
  async loadAllLedgerRecords() {
    const records = [];
    const files = this.app.vault.getMarkdownFiles().filter((file) => file.path.startsWith(`${DATA_ROOT}/`));
    for (const file of files) {
      const content = await this.app.vault.read(file);
      for (const record of parseLedgerRecords(content)) {
        records.push({ record, index: records.length });
      }
    }
    return records.sort((a, b) => {
      const dateCompare = a.record.date.localeCompare(b.record.date);
      return dateCompare !== 0 ? dateCompare : a.index - b.index;
    }).map((item) => item.record);
  }
  async scanLedgerFiles(result, seenIds) {
    const files = this.app.vault.getMarkdownFiles().filter((file) => isLedgerCandidateFile(file.path));
    for (const file of files) {
      result.scannedFiles += 1;
      const fileDate = getLedgerDateFromFilePath(file.path);
      if (!isStandardLedgerFileName(file.path)) {
        result.warnings.push({
          filePath: file.path,
          message: "\u6587\u4EF6\u547D\u540D\u4E0D\u89C4\u8303\u3002"
        });
      }
      const content = await this.app.vault.read(file);
      const block = extractJsonCodeBlock(content, "life-ledger");
      if (block === null) {
        result.warnings.push({
          filePath: file.path,
          message: "\u7F3A\u5C11 life-ledger \u4EE3\u7801\u5757\u3002"
        });
        continue;
      }
      let parsed;
      try {
        parsed = JSON.parse(block.trim());
      } catch (e) {
        result.errors.push({
          filePath: file.path,
          message: "life-ledger JSON \u89E3\u6790\u5931\u8D25\u3002"
        });
        continue;
      }
      if (!Array.isArray(parsed)) {
        result.errors.push({
          filePath: file.path,
          message: "life-ledger \u4EE3\u7801\u5757\u5185\u5BB9\u4E0D\u662F JSON \u6570\u7EC4\u3002"
        });
        continue;
      }
      parsed.forEach((value, index) => {
        result.ledgerRecords += 1;
        this.validateLedgerRecord(value, file.path, index, fileDate, result, seenIds);
      });
    }
  }
  validateLedgerRecord(value, filePath, index, fileDate, result, seenIds) {
    const record = value && typeof value === "object" ? value : null;
    const fallbackId = `\u7B2C ${index + 1} \u6761\u8BB0\u5F55`;
    const recordId = typeof (record == null ? void 0 : record.id) === "string" ? record.id : fallbackId;
    if (!record) {
      result.errors.push({ filePath, recordId, message: "\u8BB0\u5F55\u4E0D\u662F\u6709\u6548\u5BF9\u8C61\u3002" });
      return;
    }
    if (typeof record.id !== "string" || record.id.length === 0) {
      result.errors.push({ filePath, recordId, message: "\u8BB0\u5F55 id \u7F3A\u5931\u6216\u4E0D\u662F\u5B57\u7B26\u4E32\u3002" });
    } else {
      const previous = seenIds.get(record.id);
      if (previous) {
        result.errors.push({ filePath, recordId: record.id, message: "\u8BB0\u5F55 id \u91CD\u590D\u3002" });
      } else {
        seenIds.set(record.id, { filePath, recordId: record.id, message: "\u8BB0\u5F55 id \u5DF2\u767B\u8BB0\u3002" });
      }
    }
    if (typeof record.date !== "string" || !isDateString(record.date)) {
      result.errors.push({ filePath, recordId, message: "\u8BB0\u5F55 date \u7F3A\u5931\u6216\u683C\u5F0F\u975E\u6CD5\u3002" });
    } else if (fileDate && record.date !== fileDate) {
      result.warnings.push({ filePath, recordId, message: "\u6587\u4EF6\u65E5\u671F\u548C\u8BB0\u5F55 date \u4E0D\u4E00\u81F4\u3002" });
    }
    if (!isLedgerType(record.type)) {
      result.errors.push({ filePath, recordId, message: "\u8BB0\u5F55 type \u975E\u6CD5\u3002" });
    }
    const hasWallet = Object.prototype.hasOwnProperty.call(record, "wallet");
    if (!hasWallet) {
      result.warnings.push({
        filePath,
        recordId,
        message: "\u65E7\u8BB0\u5F55\u7F3A\u5C11 wallet\uFF0C\u5C06\u6309 activity \u517C\u5BB9\u5904\u7406\u3002"
      });
    } else if (!isWalletType(record.wallet)) {
      result.errors.push({ filePath, recordId, message: "\u8BB0\u5F55 wallet \u975E\u6CD5\u3002" });
    }
    if (typeof record.category !== "string" || record.category.trim().length === 0) {
      result.errors.push({ filePath, recordId, message: "\u8BB0\u5F55 category \u7F3A\u5931\u6216\u4E3A\u7A7A\u3002" });
    }
    if (typeof record.amount !== "number" || !Number.isFinite(record.amount) || record.amount <= 0) {
      result.errors.push({ filePath, recordId, message: "\u8BB0\u5F55 amount \u975E\u6CD5\u3002" });
    }
    const wallet = isWalletType(record.wallet) ? record.wallet : hasWallet ? null : "activity";
    const assetCategory = typeof record.assetCategory === "string" ? record.assetCategory.trim() : "";
    if (wallet === "asset" && !assetCategory) {
      result.warnings.push({
        filePath,
        recordId,
        message: "\u8D44\u4EA7\u8D26\u6237\u8BB0\u5F55\u7F3A\u5C11 assetCategory\uFF0C\u5C06\u5728\u7EDF\u8BA1\u4E2D\u5F52\u4E3A\u5176\u4ED6\u8D44\u4EA7\u3002"
      });
    }
    if (wallet !== "asset" && assetCategory) {
      result.warnings.push({
        filePath,
        recordId,
        message: "\u975E\u8D44\u4EA7\u8D26\u6237\u8BB0\u5F55\u5B58\u5728 assetCategory\uFF0C\u5EFA\u8BAE\u6E05\u7406\u3002"
      });
    }
  }
  async scanBleedingProjects(result, seenIds) {
    const file = this.app.vault.getFileByPath(BLEEDING_PROJECTS_PATH);
    if (!file) {
      result.info.push({ filePath: BLEEDING_PROJECTS_PATH, message: "\u6682\u65E0\u6D41\u8840\u9879\u76EE\u6587\u4EF6\u3002" });
      return;
    }
    result.scannedFiles += 1;
    const content = await this.app.vault.read(file);
    const block = extractJsonCodeBlock(content, "life-ledger-bleeding");
    if (block === null) {
      result.warnings.push({
        filePath: BLEEDING_PROJECTS_PATH,
        message: "\u7F3A\u5C11 life-ledger-bleeding \u4EE3\u7801\u5757\u3002"
      });
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(block.trim());
    } catch (e) {
      result.errors.push({
        filePath: BLEEDING_PROJECTS_PATH,
        message: "life-ledger-bleeding JSON \u89E3\u6790\u5931\u8D25\u3002"
      });
      return;
    }
    if (!Array.isArray(parsed)) {
      result.errors.push({
        filePath: BLEEDING_PROJECTS_PATH,
        message: "life-ledger-bleeding \u4EE3\u7801\u5757\u5185\u5BB9\u4E0D\u662F JSON \u6570\u7EC4\u3002"
      });
      return;
    }
    parsed.forEach((value, index) => {
      result.bleedingProjects += 1;
      this.validateBleedingProject(value, index, result, seenIds);
    });
  }
  validateBleedingProject(value, index, result, seenIds) {
    const project = value && typeof value === "object" ? value : null;
    const fallbackId = `\u7B2C ${index + 1} \u4E2A\u6D41\u8840\u9879\u76EE`;
    const recordId = typeof (project == null ? void 0 : project.id) === "string" ? project.id : fallbackId;
    if (!project) {
      result.errors.push({ filePath: BLEEDING_PROJECTS_PATH, recordId, message: "\u6D41\u8840\u9879\u76EE\u4E0D\u662F\u6709\u6548\u5BF9\u8C61\u3002" });
      return;
    }
    if (typeof project.id !== "string" || project.id.length === 0) {
      result.errors.push({ filePath: BLEEDING_PROJECTS_PATH, recordId, message: "\u6D41\u8840\u9879\u76EE id \u7F3A\u5931\u6216\u4E0D\u662F\u5B57\u7B26\u4E32\u3002" });
    } else if (seenIds.has(project.id)) {
      result.errors.push({ filePath: BLEEDING_PROJECTS_PATH, recordId: project.id, message: "\u6D41\u8840\u9879\u76EE id \u91CD\u590D\u3002" });
    } else {
      seenIds.set(project.id, { filePath: BLEEDING_PROJECTS_PATH, recordId: project.id, message: "\u6D41\u8840\u9879\u76EE id \u5DF2\u767B\u8BB0\u3002" });
    }
    if (typeof project.name !== "string" || project.name.trim().length === 0) {
      result.errors.push({ filePath: BLEEDING_PROJECTS_PATH, recordId, message: "\u6D41\u8840\u9879\u76EE name \u7F3A\u5931\u6216\u4E3A\u7A7A\u3002" });
    }
    if (typeof project.amount !== "number" || !Number.isFinite(project.amount) || project.amount <= 0) {
      result.errors.push({ filePath: BLEEDING_PROJECTS_PATH, recordId, message: "\u6D41\u8840\u9879\u76EE amount \u975E\u6CD5\u3002" });
    }
    if (typeof project.startDate !== "string" || !isDateString(project.startDate)) {
      result.errors.push({ filePath: BLEEDING_PROJECTS_PATH, recordId, message: "\u6D41\u8840\u9879\u76EE startDate \u7F3A\u5931\u6216\u683C\u5F0F\u975E\u6CD5\u3002" });
    }
    if (typeof project.durationDays !== "number" || !Number.isFinite(project.durationDays) || project.durationDays <= 0) {
      result.errors.push({ filePath: BLEEDING_PROJECTS_PATH, recordId, message: "\u6D41\u8840\u9879\u76EE durationDays \u975E\u6CD5\u3002" });
    }
    if (typeof project.active !== "boolean") {
      result.errors.push({ filePath: BLEEDING_PROJECTS_PATH, recordId, message: "\u6D41\u8840\u9879\u76EE active \u4E0D\u662F boolean\u3002" });
    }
  }
  async loadMonthRecords(month) {
    const markdownFiles = await this.listMonthLedgerFiles(month);
    const records = [];
    for (const path of markdownFiles) {
      const file = this.app.vault.getFileByPath(path);
      if (!file) continue;
      const content = await this.app.vault.read(file);
      records.push(...parseLedgerRecords(content));
    }
    return records;
  }
  async loadRecordsBetweenMonths(startMonth, endMonth) {
    if (endMonth < startMonth) {
      return [];
    }
    const records = [];
    let cursor = startMonth;
    while (cursor <= endMonth) {
      records.push(...await this.loadMonthRecords(cursor));
      cursor = shiftMonth(cursor, 1);
    }
    return records;
  }
  getOldDailyPath(date) {
    return `${DATA_ROOT}/${date.slice(0, 7)}/${date}.md`;
  }
  getYearPath(date) {
    return `${DATA_ROOT}/${date.slice(0, 4)}_LifeLedger`;
  }
  getMonthPath(date) {
    return `${this.getYearPath(date)}/${date.slice(0, 7)}`;
  }
  getNewDailyPath(date) {
    return `${this.getMonthPath(date)}/${date}_LL.md`;
  }
  getMonthlyReviewPath(month) {
    return `${this.getMonthPath(`${month}-01`)}/${month}_MonthlyReview_LL.md`;
  }
  getYearlyReviewPath(year) {
    return `${this.getYearPath(`${year}-01-01`)}/${year}_YearlyReview_LL.md`;
  }
  async listMonthLedgerFiles(date) {
    const newMonthPath = this.getMonthPath(date);
    const oldMonthPath = `${DATA_ROOT}/${date.slice(0, 7)}`;
    const paths = /* @__PURE__ */ new Set();
    if (await this.app.vault.adapter.exists(newMonthPath)) {
      const listed = await this.app.vault.adapter.list(newMonthPath);
      for (const path of listed.files) {
        if (path.endsWith("_LL.md")) {
          paths.add(path);
        }
      }
    }
    if (await this.app.vault.adapter.exists(oldMonthPath)) {
      const listed = await this.app.vault.adapter.list(oldMonthPath);
      for (const path of listed.files) {
        if (path.endsWith(".md")) {
          paths.add(path);
        }
      }
    }
    return Array.from(paths);
  }
  async findDailyFileForRecord(record) {
    for (const path of [this.getNewDailyPath(record.date), this.getOldDailyPath(record.date)]) {
      const file = this.app.vault.getFileByPath(path);
      if (!file) continue;
      const content = await this.app.vault.read(file);
      if (parseLedgerRecords(content).some((item) => item.id === record.id)) {
        return { file, content };
      }
    }
    throw new Error(`\u65E0\u6CD5\u5B9A\u4F4D\u8BB0\u5F55\u6587\u4EF6\uFF1A${record.id}`);
  }
  async readDailyFile(path) {
    const file = this.app.vault.getFileByPath(path);
    if (!file) {
      throw new Error(`\u65E0\u6CD5\u8BFB\u53D6\u6587\u4EF6\uFF1A${path}`);
    }
    return {
      file,
      content: await this.app.vault.read(file)
    };
  }
  async readBleedingFile() {
    await this.ensureFolder(DATA_ROOT);
    const exists = await this.app.vault.adapter.exists(BLEEDING_PROJECTS_PATH);
    if (!exists) {
      await this.app.vault.create(BLEEDING_PROJECTS_PATH, this.formatBleedingFile([]));
    }
    const file = this.app.vault.getFileByPath(BLEEDING_PROJECTS_PATH);
    if (!file) {
      throw new Error(`\u65E0\u6CD5\u8BFB\u53D6\u6587\u4EF6\uFF1A${BLEEDING_PROJECTS_PATH}`);
    }
    return {
      file,
      content: await this.app.vault.read(file)
    };
  }
  prepareRecordForSave(record) {
    const next = {
      ...record,
      category: record.category.trim(),
      amount: roundMoney(record.amount)
    };
    if (next.wallet === "asset") {
      const assetCategory2 = normalizeCategory(next.assetCategory || "");
      return assetCategory2 ? { ...next, assetCategory: assetCategory2 } : next;
    }
    const { assetCategory, ...withoutAssetCategory } = next;
    return withoutAssetCategory;
  }
  async learnCategories(records) {
    let changed = false;
    for (const record of records) {
      if (record.wallet !== "asset") {
        changed = addCategoryToList(this.settings.normalCategories, record.category) || changed;
      }
      if (record.wallet === "asset") {
        changed = addCategoryToList(this.settings.assetCategories, record.assetCategory || "") || changed;
      }
    }
    if (changed) {
      await this.saveData(this.settings);
    }
  }
  formatDailyFile(date, records) {
    return `# ${date}

\`\`\`life-ledger
${JSON.stringify(records, null, 2)}
\`\`\`
`;
  }
  replaceLedgerBlock(content, date, records) {
    const block = `\`\`\`life-ledger
${JSON.stringify(records, null, 2)}
\`\`\``;
    const blockRegex = /```life-ledger\s*([\s\S]*?)```/;
    if (blockRegex.test(content)) {
      return content.replace(blockRegex, block);
    }
    const base = content.trim().length > 0 ? content.replace(/\s+$/, "") : `# ${date}`;
    return `${base}

${block}
`;
  }
  formatBleedingFile(projects) {
    return `# Bleeding Projects

\`\`\`life-ledger-bleeding
${JSON.stringify(projects, null, 2)}
\`\`\`
`;
  }
  replaceBleedingBlock(content, projects) {
    const block = `\`\`\`life-ledger-bleeding
${JSON.stringify(projects, null, 2)}
\`\`\``;
    const blockRegex = /```life-ledger-bleeding\s*([\s\S]*?)```/;
    if (blockRegex.test(content)) {
      return content.replace(blockRegex, block);
    }
    const base = content.trim().length > 0 ? content.replace(/\s+$/, "") : "# Bleeding Projects";
    return `${base}

${block}
`;
  }
};
var LifeLedgerSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    __publicField(this, "plugin");
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "LifeLedger \u8BBE\u7F6E" });
    new import_obsidian.Setting(containerEl).setName("\u7CFB\u7EDF\u8D77\u59CB\u6708\u4EFD").setDesc("\u7528\u4E8E\u8DE8\u6708\u7D2F\u8BA1\u4F59\u989D\uFF0C\u683C\u5F0F\u4E3A YYYY-MM\u3002\u8D77\u59CB\u6708\u4EFD\u4E4B\u524D\u7684\u94B1\u5305\u4F59\u989D\u663E\u793A\u4E3A 0\u3002").addText((text) => {
      text.setPlaceholder(getCurrentMonthString()).setValue(this.plugin.settings.systemStartMonth).onChange(async (value) => {
        const month = value.trim();
        this.plugin.settings.systemStartMonth = isMonthString(month) ? month : getCurrentMonthString();
        await this.plugin.saveSettings();
      });
      text.inputEl.type = "month";
    });
    new import_obsidian.Setting(containerEl).setName("\u6D3B\u52A8\u94B1\u5305\u521D\u59CB\u91D1\u989D").setDesc("\u7528\u4E8E\u8BA1\u7B97\u672C\u6708\u6D3B\u52A8\u94B1\u5305\u4F59\u989D\uFF0C\u9ED8\u8BA4 1500\u3002").addText((text) => {
      text.setPlaceholder("1500").setValue(String(this.plugin.settings.activityWalletInitialAmount)).onChange(async (value) => {
        const amount = Number(value);
        this.plugin.settings.activityWalletInitialAmount = Number.isFinite(amount) ? amount : DEFAULT_SETTINGS.activityWalletInitialAmount;
        await this.plugin.saveSettings();
      });
      text.inputEl.type = "number";
      text.inputEl.step = "0.01";
    });
    new import_obsidian.Setting(containerEl).setName("\u5907\u7528\u94B1\u5305\u521D\u59CB\u91D1\u989D").setDesc("\u7528\u4E8E\u8BA1\u7B97\u672C\u6708\u5907\u7528\u94B1\u5305\u4F59\u989D\uFF0C\u9ED8\u8BA4 0\u3002").addText((text) => {
      text.setPlaceholder("0").setValue(String(this.plugin.settings.reserveWalletInitialAmount)).onChange(async (value) => {
        const amount = Number(value);
        this.plugin.settings.reserveWalletInitialAmount = Number.isFinite(amount) ? amount : DEFAULT_SETTINGS.reserveWalletInitialAmount;
        await this.plugin.saveSettings();
      });
      text.inputEl.type = "number";
      text.inputEl.step = "0.01";
    });
    new import_obsidian.Setting(containerEl).setName("\u8D44\u4EA7\u8D26\u6237\u521D\u59CB\u91D1\u989D").setDesc("\u7528\u4E8E\u8BA1\u7B97\u672C\u6708\u8D44\u4EA7\u8D26\u6237\u4F59\u989D\uFF0C\u9ED8\u8BA4 0\u3002").addText((text) => {
      text.setPlaceholder("0").setValue(String(this.plugin.settings.assetWalletInitialAmount)).onChange(async (value) => {
        const amount = Number(value);
        this.plugin.settings.assetWalletInitialAmount = Number.isFinite(amount) ? amount : DEFAULT_SETTINGS.assetWalletInitialAmount;
        await this.plugin.saveSettings();
      });
      text.inputEl.type = "number";
      text.inputEl.step = "0.01";
    });
    new import_obsidian.Setting(containerEl).setName("\u6708\u5EA6\u652F\u51FA\u9884\u7B97").setDesc("\u4E3A 0 \u65F6\u4E0D\u542F\u7528\u6708\u5EA6\u652F\u51FA\u9884\u7B97\u63D0\u9192\u3002").addText((text) => {
      text.setPlaceholder("0").setValue(String(this.plugin.settings.monthlyExpenseBudget)).onChange(async (value) => {
        const amount = Number(value);
        this.plugin.settings.monthlyExpenseBudget = Number.isFinite(amount) && amount >= 0 ? amount : DEFAULT_SETTINGS.monthlyExpenseBudget;
        await this.plugin.saveSettings();
      });
      text.inputEl.type = "number";
      text.inputEl.step = "0.01";
      text.inputEl.min = "0";
    });
    new import_obsidian.Setting(containerEl).setName("\u6D3B\u52A8\u94B1\u5305\u4F4E\u4F59\u989D\u9884\u8B66\u7EBF").setDesc("\u4E3A 0 \u65F6\u4E0D\u542F\u7528\u6D3B\u52A8\u94B1\u5305\u4F4E\u4F59\u989D\u63D0\u9192\u3002").addText((text) => {
      text.setPlaceholder("0").setValue(String(this.plugin.settings.activityLowBalanceWarning)).onChange(async (value) => {
        const amount = Number(value);
        this.plugin.settings.activityLowBalanceWarning = Number.isFinite(amount) && amount >= 0 ? amount : DEFAULT_SETTINGS.activityLowBalanceWarning;
        await this.plugin.saveSettings();
      });
      text.inputEl.type = "number";
      text.inputEl.step = "0.01";
      text.inputEl.min = "0";
    });
    new import_obsidian.Setting(containerEl).setName("\u5907\u7528\u94B1\u5305\u4F4E\u4F59\u989D\u9884\u8B66\u7EBF").setDesc("\u4E3A 0 \u65F6\u4E0D\u542F\u7528\u5907\u7528\u94B1\u5305\u4F4E\u4F59\u989D\u63D0\u9192\u3002").addText((text) => {
      text.setPlaceholder("0").setValue(String(this.plugin.settings.reserveLowBalanceWarning)).onChange(async (value) => {
        const amount = Number(value);
        this.plugin.settings.reserveLowBalanceWarning = Number.isFinite(amount) && amount >= 0 ? amount : DEFAULT_SETTINGS.reserveLowBalanceWarning;
        await this.plugin.saveSettings();
      });
      text.inputEl.type = "number";
      text.inputEl.step = "0.01";
      text.inputEl.min = "0";
    });
    new import_obsidian.Setting(containerEl).setName("\u6708\u5EA6\u88AB\u52A8\u6D41\u8840\u9884\u8B66\u7EBF").setDesc("\u4E3A 0 \u65F6\u4E0D\u542F\u7528\u6D41\u8840\u9884\u8B66\u3002").addText((text) => {
      text.setPlaceholder("0").setValue(String(this.plugin.settings.monthlyBleedingWarning)).onChange(async (value) => {
        const amount = Number(value);
        this.plugin.settings.monthlyBleedingWarning = Number.isFinite(amount) && amount >= 0 ? amount : DEFAULT_SETTINGS.monthlyBleedingWarning;
        await this.plugin.saveSettings();
      });
      text.inputEl.type = "number";
      text.inputEl.step = "0.01";
      text.inputEl.min = "0";
    });
    new import_obsidian.Setting(containerEl).setName("\u666E\u901A\u6536\u652F\u5206\u7C7B").setDesc("\u6BCF\u884C\u4E00\u4E2A\u5206\u7C7B\uFF0C\u7528\u4E8E\u6D3B\u52A8\u94B1\u5305\u548C\u5907\u7528\u94B1\u5305\u3002\u6E05\u7A7A\u540E\u4F1A\u6062\u590D\u9ED8\u8BA4\u5206\u7C7B\u3002").addTextArea((text) => {
      text.setPlaceholder(DEFAULT_NORMAL_CATEGORIES.join("\n")).setValue(this.plugin.settings.normalCategories.join("\n")).onChange(async (value) => {
        this.plugin.settings.normalCategories = normalizeCategoryList(
          value.split("\n"),
          DEFAULT_NORMAL_CATEGORIES
        );
        await this.plugin.saveSettings();
      });
      text.inputEl.rows = 8;
    });
    new import_obsidian.Setting(containerEl).setName("\u8D44\u4EA7\u5206\u7C7B").setDesc("\u6BCF\u884C\u4E00\u4E2A\u5206\u7C7B\uFF0C\u7528\u4E8E\u8D44\u4EA7\u8D26\u6237\u3002\u6E05\u7A7A\u540E\u4F1A\u6062\u590D\u9ED8\u8BA4\u8D44\u4EA7\u5206\u7C7B\u3002").addTextArea((text) => {
      text.setPlaceholder(DEFAULT_ASSET_CATEGORIES.join("\n")).setValue(this.plugin.settings.assetCategories.join("\n")).onChange(async (value) => {
        this.plugin.settings.assetCategories = normalizeCategoryList(
          value.split("\n"),
          DEFAULT_ASSET_CATEGORIES
        );
        await this.plugin.saveSettings();
      });
      text.inputEl.rows = 8;
    });
  }
};
var LifeLedgerDashboardView = class extends import_obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    __publicField(this, "editingRecord", null);
    __publicField(this, "editingBleedingProject", null);
    __publicField(this, "plugin");
    __publicField(this, "viewMonth", getCurrentMonthString());
    __publicField(this, "visibleRecordCount", RECORD_PAGE_SIZE);
    __publicField(this, "scrollTopBeforeRecordEdit", null);
    __publicField(this, "expandedDates", /* @__PURE__ */ new Set());
    __publicField(this, "filterKeyword", "");
    __publicField(this, "filterType", "all");
    __publicField(this, "filterWallet", "all");
    __publicField(this, "filterCategory", "");
    __publicField(this, "filterAssetCategory", "");
    __publicField(this, "filterMinAmount", "");
    __publicField(this, "filterMaxAmount", "");
    __publicField(this, "filterApplied", false);
    __publicField(this, "filteredRecords", []);
    __publicField(this, "healthCheckResult", null);
    this.plugin = plugin;
  }
  getViewType() {
    return VIEW_TYPE_LIFE_LEDGER;
  }
  getDisplayText() {
    return "LifeLedger Dashboard";
  }
  getIcon() {
    return "wallet-cards";
  }
  async onOpen() {
    await this.render();
  }
  async render() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("life-ledger-container");
    const root = containerEl.createDiv({ cls: "life-ledger-root" });
    const view = root.createDiv({ cls: "life-ledger-view" });
    view.createEl("h1", { text: "LifeLedger \u4EBA\u751F\u8D26\u672C" });
    this.renderQuickEntry(view);
    this.renderMonthSwitcher(view);
    await this.renderDashboard(view);
  }
  getRootScrollTop() {
    var _a;
    const root = this.containerEl.querySelector(".life-ledger-root");
    return (_a = root == null ? void 0 : root.scrollTop) != null ? _a : 0;
  }
  async rerenderPreserveScroll(scrollTop = this.getRootScrollTop()) {
    const previousScrollTop = scrollTop;
    await this.render();
    requestAnimationFrame(() => {
      const newRoot = this.containerEl.querySelector(".life-ledger-root");
      if (newRoot) {
        newRoot.scrollTop = previousScrollTop;
      }
    });
  }
  async startEditingRecord(record) {
    this.scrollTopBeforeRecordEdit = this.getRootScrollTop();
    this.editingRecord = { ...record };
    await this.render();
  }
  async deleteRecordFromView(record, deleteButton) {
    var _a;
    deleteButton.disabled = true;
    try {
      await this.plugin.deleteRecord(record);
      if (((_a = this.editingRecord) == null ? void 0 : _a.id) === record.id) {
        this.editingRecord = null;
        this.scrollTopBeforeRecordEdit = null;
      }
      new import_obsidian.Notice("\u8BB0\u5F55\u5DF2\u5220\u9664");
      await this.rerenderPreserveScroll();
    } catch (error) {
      console.error(error);
      new import_obsidian.Notice("\u5220\u9664\u5931\u8D25\uFF0C\u8BF7\u67E5\u770B\u63A7\u5236\u53F0");
      deleteButton.disabled = false;
    }
  }
  isSectionCollapsed(sectionKey) {
    var _a;
    return (_a = this.plugin.settings.collapsedSections[sectionKey]) != null ? _a : DEFAULT_SECTION_COLLAPSE_STATE[sectionKey];
  }
  async toggleSection(sectionKey) {
    this.plugin.settings.collapsedSections[sectionKey] = !this.isSectionCollapsed(sectionKey);
    await this.plugin.saveSectionCollapseState();
    await this.rerenderPreserveScroll();
  }
  createCollapsibleSection(parent, sectionKey, title, headingLevel = "h3", extraClass = "") {
    const collapsed = this.isSectionCollapsed(sectionKey);
    const section = parent.createDiv({
      cls: `life-ledger-section life-ledger-collapsible-section ${extraClass}`.trim()
    });
    const header = section.createDiv({ cls: "life-ledger-section-header" });
    header.createEl(headingLevel, { text: title });
    const button = header.createEl("button", {
      text: `${collapsed ? "\u25B8 \u5C55\u5F00" : "\u25BE \u6536\u8D77"}`,
      cls: "life-ledger-section-toggle"
    });
    button.addEventListener("click", async () => {
      await this.toggleSection(sectionKey);
    });
    if (collapsed) {
      section.addClass("is-collapsed");
      return { section, content: null, header, collapsed };
    }
    return {
      section,
      content: section.createDiv({ cls: "life-ledger-section-content" }),
      header,
      collapsed
    };
  }
  renderQuickEntry(root) {
    const { content } = this.createCollapsibleSection(root, "quickEntry", "\u5FEB\u901F\u8BB0\u8D26", "h2");
    if (!content) return;
    const form = content.createDiv({ cls: "life-ledger-form" });
    const typeField = createField(form, "\u7C7B\u578B");
    const typeSelect = typeField.createEl("select");
    const expenseOption = typeSelect.createEl("option", { text: "\u652F\u51FA" });
    expenseOption.value = "expense";
    const incomeOption = typeSelect.createEl("option", { text: "\u6536\u5165" });
    incomeOption.value = "income";
    const initialOption = typeSelect.createEl("option", { text: "\u671F\u521D\u4F59\u989D" });
    initialOption.value = "initial";
    const walletField = createField(form, "\u94B1\u5305");
    const walletSelect = walletField.createEl("select");
    const activityOption = walletSelect.createEl("option", { text: "\u6D3B\u52A8\u94B1\u5305" });
    activityOption.value = "activity";
    const reserveOption = walletSelect.createEl("option", { text: "\u5907\u7528\u94B1\u5305" });
    reserveOption.value = "reserve";
    const assetOption = walletSelect.createEl("option", { text: "\u8D44\u4EA7\u8D26\u6237" });
    assetOption.value = "asset";
    const categoryInput = createCategoryInput(form, this.plugin.settings.normalCategories);
    const assetCategoryInput = createAssetCategoryInput(form, this.plugin.settings.assetCategories);
    const amountInput = createNumberInput(form, "\u91D1\u989D");
    const noteInput = createTextInput(form, "\u5907\u6CE8", "\u53EF\u4E3A\u7A7A");
    const distributionSection = form.createDiv({ cls: "life-ledger-distribution" });
    const distributionModeField = createField(distributionSection, "\u6536\u5165\u5206\u914D\u6A21\u5F0F");
    const distributionModeSelect = distributionModeField.createEl("select");
    const singleWalletOption = distributionModeSelect.createEl("option", { text: "\u5355\u4E00\u94B1\u5305" });
    singleWalletOption.value = "single";
    const ratioOption = distributionModeSelect.createEl("option", { text: "\u6309\u6BD4\u4F8B\u5206\u914D" });
    ratioOption.value = "ratio";
    const distributionPairField = createField(distributionSection, "\u5206\u914D\u7EC4\u5408");
    const distributionPairSelect = distributionPairField.createEl("select");
    const activityReserveOption = distributionPairSelect.createEl("option", {
      text: "\u6D3B\u52A8\u94B1\u5305 / \u5907\u7528\u94B1\u5305"
    });
    activityReserveOption.value = "activity-reserve";
    const reserveAssetOption = distributionPairSelect.createEl("option", {
      text: "\u5907\u7528\u94B1\u5305 / \u8D44\u4EA7\u8D26\u6237"
    });
    reserveAssetOption.value = "reserve-asset";
    const ratioFields = distributionSection.createDiv({ cls: "life-ledger-ratio-fields" });
    const firstRatio = createNumberField(ratioFields, "\u6D3B\u52A8\u94B1\u5305\u6BD4\u4F8B");
    firstRatio.input.value = "60";
    const secondRatio = createNumberField(ratioFields, "\u5907\u7528\u94B1\u5305\u6BD4\u4F8B");
    secondRatio.input.value = "40";
    const syncDistributionVisibility = () => {
      const isIncome = typeSelect.value === "income";
      const isRatio = distributionModeSelect.value === "ratio";
      const usesAssetWallet = walletSelect.value === "asset" || isIncome && !this.editingRecord && isRatio && distributionPairSelect.value === "reserve-asset";
      distributionSection.toggle(isIncome && !this.editingRecord);
      distributionPairField.toggle(isIncome && !this.editingRecord && isRatio);
      ratioFields.toggle(isIncome && !this.editingRecord && isRatio);
      assetCategoryInput.field.toggle(usesAssetWallet);
      if (distributionPairSelect.value === "reserve-asset") {
        firstRatio.label.setText("\u5907\u7528\u94B1\u5305\u6BD4\u4F8B");
        secondRatio.label.setText("\u8D44\u4EA7\u8D26\u6237\u6BD4\u4F8B");
        if (firstRatio.input.value === "60" && secondRatio.input.value === "40") {
          firstRatio.input.value = "40";
          secondRatio.input.value = "60";
        }
      } else {
        firstRatio.label.setText("\u6D3B\u52A8\u94B1\u5305\u6BD4\u4F8B");
        secondRatio.label.setText("\u5907\u7528\u94B1\u5305\u6BD4\u4F8B");
        if (firstRatio.input.value === "40" && secondRatio.input.value === "60") {
          firstRatio.input.value = "60";
          secondRatio.input.value = "40";
        }
      }
    };
    if (this.editingRecord) {
      typeSelect.value = this.editingRecord.type;
      walletSelect.value = this.editingRecord.wallet;
      categoryInput.value = this.editingRecord.category;
      assetCategoryInput.input.value = this.editingRecord.assetCategory || "";
      amountInput.value = String(this.editingRecord.amount);
      noteInput.value = this.editingRecord.note;
      form.createDiv({
        text: `\u6B63\u5728\u7F16\u8F91\uFF1A${this.editingRecord.date} ${getTypeLabel(this.editingRecord.type)} ${getWalletLabel(this.editingRecord.wallet)} ${this.editingRecord.category}`,
        cls: "life-ledger-editing-hint"
      });
    }
    typeSelect.addEventListener("change", syncDistributionVisibility);
    walletSelect.addEventListener("change", syncDistributionVisibility);
    distributionModeSelect.addEventListener("change", syncDistributionVisibility);
    distributionPairSelect.addEventListener("change", syncDistributionVisibility);
    syncDistributionVisibility();
    const actions = form.createDiv({ cls: "life-ledger-actions" });
    const saveButton = actions.createEl("button", {
      text: this.editingRecord ? "\u4FDD\u5B58\u4FEE\u6539" : "\u4FDD\u5B58\u8BB0\u5F55",
      cls: "mod-cta"
    });
    if (this.editingRecord) {
      const cancelButton = actions.createEl("button", { text: "\u53D6\u6D88\u7F16\u8F91" });
      cancelButton.addEventListener("click", async () => {
        const recordEditScrollTop = this.scrollTopBeforeRecordEdit;
        this.editingRecord = null;
        this.scrollTopBeforeRecordEdit = null;
        await this.rerenderPreserveScroll(recordEditScrollTop != null ? recordEditScrollTop : void 0);
      });
    }
    saveButton.addEventListener("click", async () => {
      const recordEditScrollTop = this.editingRecord ? this.scrollTopBeforeRecordEdit : null;
      const amount = Number(amountInput.value);
      const category = categoryInput.value.trim();
      const assetCategory = assetCategoryInput.input.value.trim();
      const note = noteInput.value.trim();
      const type = typeSelect.value;
      const wallet = walletSelect.value;
      const isRatioIncome = type === "income" && distributionModeSelect.value === "ratio";
      const distributionPair = isRatioIncome ? getDistributionPair(distributionPairSelect.value) : null;
      const requiresAssetCategory = wallet === "asset" || distributionPair !== null && (distributionPair.firstWallet === "asset" || distributionPair.secondWallet === "asset");
      if (!Number.isFinite(amount) || amount <= 0) {
        new import_obsidian.Notice("\u91D1\u989D\u5FC5\u987B\u4E3A\u6B63\u6570");
        amountInput.focus();
        return;
      }
      if (!category) {
        new import_obsidian.Notice("\u8BF7\u586B\u5199\u5206\u7C7B");
        categoryInput.focus();
        return;
      }
      if (requiresAssetCategory && !assetCategory) {
        new import_obsidian.Notice("\u8BF7\u586B\u5199\u8D44\u4EA7\u5206\u7C7B");
        assetCategoryInput.input.focus();
        return;
      }
      saveButton.disabled = true;
      try {
        if (this.editingRecord) {
          if (typeSelect.value === "expense" && walletSelect.value === "asset") {
            new import_obsidian.Notice("\u8D44\u4EA7\u8D26\u6237\u539F\u5219\u4E0A\u53EA\u5B58\u4E0D\u53D6\uFF0C\u8BF7\u786E\u8BA4\u8FD9\u662F\u4E00\u6B21\u8D44\u4EA7\u652F\u51FA\u8BB0\u5F55\u3002");
          }
          await this.plugin.updateRecord({
            ...this.editingRecord,
            type,
            wallet,
            category,
            assetCategory: wallet === "asset" ? assetCategory : void 0,
            amount,
            note
          });
          this.editingRecord = null;
          new import_obsidian.Notice("\u4FEE\u6539\u5DF2\u4FDD\u5B58");
        } else {
          if (isRatioIncome) {
            const firstRatioValue = Number(firstRatio.input.value);
            const secondRatioValue = Number(secondRatio.input.value);
            if (!distributionPair) return;
            if (!Number.isFinite(firstRatioValue) || !Number.isFinite(secondRatioValue) || firstRatioValue + secondRatioValue !== 100) {
              new import_obsidian.Notice(`${distributionPair.firstLabel}\u6BD4\u4F8B\u548C${distributionPair.secondLabel}\u6BD4\u4F8B\u4E4B\u548C\u5FC5\u987B\u7B49\u4E8E 100`);
              saveButton.disabled = false;
              return;
            }
            const totalAmount = roundMoney(amount);
            const firstAmount = roundMoney(totalAmount * firstRatioValue / 100);
            const secondAmount = roundMoney(totalAmount - firstAmount);
            await this.plugin.saveRecords([
              {
                type: "income",
                wallet: distributionPair.firstWallet,
                category,
                assetCategory: distributionPair.firstWallet === "asset" ? assetCategory : void 0,
                amount: firstAmount,
                note: appendDistributionNote(note, distributionPair.firstLabel)
              },
              {
                type: "income",
                wallet: distributionPair.secondWallet,
                category,
                assetCategory: distributionPair.secondWallet === "asset" ? assetCategory : void 0,
                amount: secondAmount,
                note: appendDistributionNote(note, distributionPair.secondLabel)
              }
            ]);
          } else {
            if (type === "expense" && wallet === "asset") {
              new import_obsidian.Notice("\u8D44\u4EA7\u8D26\u6237\u539F\u5219\u4E0A\u53EA\u5B58\u4E0D\u53D6\uFF0C\u8BF7\u786E\u8BA4\u8FD9\u662F\u4E00\u6B21\u8D44\u4EA7\u652F\u51FA\u8BB0\u5F55\u3002");
            }
            await this.plugin.saveRecord({
              type,
              wallet,
              category,
              assetCategory: wallet === "asset" ? assetCategory : void 0,
              amount,
              note
            });
          }
          new import_obsidian.Notice("\u8BB0\u5F55\u5DF2\u4FDD\u5B58");
        }
        categoryInput.value = "";
        assetCategoryInput.input.value = "";
        amountInput.value = "";
        noteInput.value = "";
        await this.rerenderPreserveScroll(recordEditScrollTop != null ? recordEditScrollTop : void 0);
        this.scrollTopBeforeRecordEdit = null;
      } catch (error) {
        console.error(error);
        new import_obsidian.Notice("\u4FDD\u5B58\u5931\u8D25\uFF0C\u8BF7\u67E5\u770B\u63A7\u5236\u53F0");
        saveButton.disabled = false;
      }
    });
  }
  renderMonthSwitcher(root) {
    const section = root.createDiv({ cls: "life-ledger-month-switcher" });
    section.createEl("span", { text: `\u5F53\u524D\u67E5\u770B\u6708\u4EFD\uFF1A${this.viewMonth}` });
    const actions = section.createDiv({ cls: "life-ledger-month-actions" });
    const prevButton = actions.createEl("button", { text: "\u4E0A\u4E2A\u6708" });
    const nextButton = actions.createEl("button", { text: "\u4E0B\u4E2A\u6708" });
    const currentButton = actions.createEl("button", { text: "\u56DE\u5230\u672C\u6708" });
    const reviewButton = actions.createEl("button", { text: "\u751F\u6210\u6708\u5EA6\u590D\u76D8" });
    prevButton.addEventListener("click", async () => {
      this.viewMonth = shiftMonth(this.viewMonth, -1);
      this.visibleRecordCount = RECORD_PAGE_SIZE;
      this.expandedDates.clear();
      await this.render();
    });
    nextButton.addEventListener("click", async () => {
      this.viewMonth = shiftMonth(this.viewMonth, 1);
      this.visibleRecordCount = RECORD_PAGE_SIZE;
      this.expandedDates.clear();
      await this.render();
    });
    currentButton.addEventListener("click", async () => {
      this.viewMonth = getCurrentMonthString();
      this.visibleRecordCount = RECORD_PAGE_SIZE;
      this.expandedDates.clear();
      await this.render();
    });
    reviewButton.addEventListener("click", async () => {
      reviewButton.disabled = true;
      try {
        await this.plugin.generateMonthlyReview(this.viewMonth);
        new import_obsidian.Notice("\u6708\u5EA6\u590D\u76D8\u5DF2\u751F\u6210\u3002");
      } catch (error) {
        console.error(error);
        new import_obsidian.Notice("\u751F\u6210\u6708\u5EA6\u590D\u76D8\u5931\u8D25\uFF0C\u8BF7\u67E5\u770B\u63A7\u5236\u53F0");
      } finally {
        reviewButton.disabled = false;
      }
    });
  }
  async renderDashboard(root) {
    const isCurrentMonth = this.viewMonth === getCurrentMonthString();
    const dashboardTitle = isCurrentMonth ? "\u672C\u6708\u6570\u636E\u4EEA\u8868\u76D8" : `${this.viewMonth} \u6570\u636E\u4EEA\u8868\u76D8`;
    const recordTitle = isCurrentMonth ? "\u672C\u6708\u8BB0\u5F55" : `${this.viewMonth} \u8BB0\u5F55`;
    const summary = await this.plugin.getMonthSummary(this.viewMonth);
    const dashboardSection = this.createCollapsibleSection(root, "dashboard", dashboardTitle, "h2");
    if (dashboardSection.content) {
      const summaryGroups = dashboardSection.content.createDiv({ cls: "life-ledger-summary-groups" });
      const monthlyOverview = createSummaryGroup(summaryGroups, "\u672C\u6708\u6536\u652F\u6982\u89C8", true);
      createSummaryCard(monthlyOverview, "\u6708\u6536\u5165", summary.income, "income");
      createSummaryCard(monthlyOverview, "\u6708\u652F\u51FA", summary.expense, "expense");
      createSummaryCard(monthlyOverview, "\u6708\u7ED3\u4F59", summary.surplus, "balance");
      const walletStatus = createSummaryGroup(summaryGroups, "\u8D44\u91D1\u8D26\u6237\u72B6\u6001");
      createSummaryCard(walletStatus, "\u6D3B\u52A8\u94B1\u5305\u4F59\u989D", summary.activityBalance, "balance");
      createSummaryCard(walletStatus, "\u5907\u7528\u94B1\u5305\u4F59\u989D", summary.reserveBalance, "balance");
      createSummaryCard(walletStatus, "\u8D44\u4EA7\u8D26\u6237\u4F59\u989D", summary.assetBalance, "balance");
      const bleedingStatus = createSummaryGroup(
        summaryGroups,
        "\u6D41\u8840\u4E0E\u771F\u5B9E\u652F\u51FA\u53C2\u8003",
        false,
        "\u7528\u4E8E\u63D0\u793A\u88AB\u52A8\u635F\u8017\u4E0E\u771F\u5B9E\u652F\u51FA\u538B\u529B"
      );
      createSummaryCard(bleedingStatus, "\u4ECA\u65E5\u88AB\u52A8\u6D41\u8840", summary.dailyBleedingTotal, "expense");
      createSummaryCard(bleedingStatus, "\u6708\u88AB\u52A8\u6D41\u8840\u5408\u8BA1", summary.monthBleedingTotal, "expense");
      createSummaryCard(bleedingStatus, "\u6708\u771F\u5B9E\u652F\u51FA\u53C2\u8003", summary.realMonthlyExpenseReference, "expense");
    }
    this.renderBudgetWarnings(root, summary);
    this.renderChartsOverview(root, summary);
    this.renderAssetBreakdown(root, summary.assetBreakdown);
    this.renderBleedingSection(root, summary);
    this.renderMonthlyRecords(root, summary, recordTitle, isCurrentMonth);
    await this.renderYearlyOverview(root, summary);
    this.renderCalendarView(root, summary);
    this.renderRecordFilters(root, summary);
    this.renderExportSection(root);
    this.renderHealthCheckSection(root);
  }
  renderMonthlyRecords(parent, summary, recordTitle, isCurrentMonth) {
    this.visibleRecordCount = Math.max(
      RECORD_PAGE_SIZE,
      Math.min(this.visibleRecordCount, summary.records.length)
    );
    const monthlyRecords = this.createCollapsibleSection(parent, "monthlyRecords", recordTitle, "h3", "life-ledger-recent");
    if (!monthlyRecords.content) return;
    const recent = monthlyRecords.content;
    const recentHeader = recent.createDiv({ cls: "life-ledger-record-header" });
    recentHeader.createEl("h3", {
      text: `${recordTitle}\uFF08\u5171 ${summary.records.length} \u6761\uFF0C\u5F53\u524D\u663E\u793A ${Math.min(this.visibleRecordCount, summary.records.length)} \u6761\uFF09`
    });
    const pagination = recentHeader.createDiv({ cls: "life-ledger-record-pagination" });
    if (this.visibleRecordCount < summary.records.length) {
      const showMoreButton = pagination.createEl("button", { text: "\u663E\u793A\u66F4\u591A" });
      showMoreButton.addEventListener("click", async () => {
        this.visibleRecordCount = Math.min(
          this.visibleRecordCount + RECORD_PAGE_SIZE,
          summary.records.length
        );
        await this.rerenderPreserveScroll();
      });
    }
    if (this.visibleRecordCount > RECORD_PAGE_SIZE) {
      const collapseButton = pagination.createEl("button", { text: "\u6536\u8D77" });
      collapseButton.addEventListener("click", async () => {
        this.visibleRecordCount = RECORD_PAGE_SIZE;
        await this.rerenderPreserveScroll();
      });
    }
    if (summary.records.length === 0) {
      recent.createEl("p", {
        text: isCurrentMonth ? "\u672C\u6708\u6682\u65E0\u8BB0\u5F55" : `${this.viewMonth} \u6682\u65E0\u8BB0\u5F55`,
        cls: "life-ledger-empty"
      });
      return;
    }
    const visibleRecords = summary.records.slice(0, this.visibleRecordCount);
    const list = recent.createEl("ul", { cls: "life-ledger-record-list" });
    for (const record of visibleRecords) {
      const item = list.createEl("li", { cls: "life-ledger-record" });
      const details = item.createDiv({ cls: "life-ledger-record-details" });
      details.createDiv({ text: record.date, cls: "life-ledger-record-date" });
      details.createDiv({ text: getTypeLabel(record.type), cls: `life-ledger-record-type is-${record.type}` });
      details.createDiv({ text: getWalletDisplay(record), cls: "life-ledger-record-wallet" });
      details.createDiv({ text: record.category, cls: "life-ledger-record-category" });
      details.createDiv({
        text: `${record.type === "expense" ? "-" : "+"}${formatMoney(record.amount)}`,
        cls: `life-ledger-record-amount is-${record.type}`
      });
      details.createDiv({ text: record.note || "\u65E0\u5907\u6CE8", cls: "life-ledger-record-note" });
      const actions = item.createDiv({ cls: "life-ledger-record-actions" });
      const editButton = actions.createEl("button", { text: "\u7F16\u8F91" });
      const deleteButton = actions.createEl("button", { text: "\u5220\u9664", cls: "life-ledger-danger-button" });
      editButton.addEventListener("click", async () => {
        await this.startEditingRecord(record);
      });
      deleteButton.addEventListener("click", async () => {
        await this.deleteRecordFromView(record, deleteButton);
      });
    }
  }
  renderBudgetWarnings(parent, summary) {
    const { content } = this.createCollapsibleSection(parent, "budgetWarnings", "\u9884\u7B97\u4E0E\u63D0\u9192", "h3", "life-ledger-budget-warnings");
    if (!content) return;
    const reminders = getBudgetWarningMessages(this.plugin.settings, summary);
    if (reminders.length === 0) {
      content.createEl("p", {
        text: "\u6682\u65E0\u9884\u8B66\uFF0C\u5F53\u524D\u8D22\u52A1\u72B6\u6001\u6B63\u5E38\u3002",
        cls: "life-ledger-empty"
      });
      return;
    }
    const list = content.createEl("ul", { cls: "life-ledger-budget-warning-list" });
    for (const reminder of reminders) {
      list.createEl("li", { text: reminder, cls: "life-ledger-budget-warning-item" });
    }
  }
  renderCalendarView(parent, summary) {
    const { content } = this.createCollapsibleSection(parent, "calendar", "\u65E5\u5386\u89C6\u56FE", "h3", "life-ledger-calendar");
    if (!content) return;
    const dailySummaries = getDailySummaries(this.viewMonth, summary.records);
    const list = content.createEl("ul", { cls: "life-ledger-calendar-list" });
    for (const day of dailySummaries) {
      const item = list.createEl("li", { cls: "life-ledger-calendar-day" });
      const row = item.createDiv({ cls: "life-ledger-calendar-day-row" });
      const info = row.createDiv({ cls: "life-ledger-calendar-day-info" });
      info.createEl("strong", { text: day.date, cls: "life-ledger-calendar-date" });
      const metrics = info.createDiv({ cls: "life-ledger-calendar-metrics" });
      metrics.createSpan({ text: `\u6536\u5165\uFF1A${formatMoney(day.income)}` });
      metrics.createSpan({ text: `\u652F\u51FA\uFF1A${formatMoney(day.expense)}` });
      metrics.createSpan({ text: `\u7ED3\u4F59\uFF1A${formatMoney(day.surplus)}` });
      metrics.createSpan({ text: `\u8BB0\u5F55\uFF1A${day.records.length} \u6761` });
      if (day.records.length > 0) {
        const isExpanded = this.expandedDates.has(day.date);
        const detailButton = row.createEl("button", { text: isExpanded ? "\u6536\u8D77\u660E\u7EC6" : "\u67E5\u770B\u660E\u7EC6" });
        detailButton.addEventListener("click", async () => {
          if (isExpanded) {
            this.expandedDates.delete(day.date);
          } else {
            this.expandedDates.add(day.date);
          }
          await this.rerenderPreserveScroll();
        });
        if (isExpanded) {
          this.renderCalendarDetails(item, day.records);
        }
      }
    }
  }
  renderCalendarDetails(parent, records) {
    const detailList = parent.createEl("ul", { cls: "life-ledger-calendar-detail-list" });
    const sortedRecords = [...records].sort((a, b) => a.id.localeCompare(b.id));
    for (const record of sortedRecords) {
      const item = detailList.createEl("li", { cls: "life-ledger-calendar-detail-item" });
      const details = item.createDiv({ cls: "life-ledger-calendar-detail-fields" });
      details.createDiv({ text: getTypeLabel(record.type), cls: `life-ledger-record-type is-${record.type}` });
      details.createDiv({ text: getWalletLabel(record.wallet), cls: "life-ledger-record-wallet" });
      details.createDiv({ text: record.category, cls: "life-ledger-record-category" });
      details.createDiv({
        text: record.assetCategory || "\u65E0\u8D44\u4EA7\u5206\u7C7B",
        cls: "life-ledger-record-category"
      });
      details.createDiv({
        text: `${record.type === "expense" ? "-" : "+"}${formatMoney(record.amount)}`,
        cls: `life-ledger-record-amount is-${record.type}`
      });
      details.createDiv({ text: record.note || "\u65E0\u5907\u6CE8", cls: "life-ledger-record-note" });
      const actions = item.createDiv({ cls: "life-ledger-record-actions" });
      const editButton = actions.createEl("button", { text: "\u7F16\u8F91" });
      const deleteButton = actions.createEl("button", { text: "\u5220\u9664", cls: "life-ledger-danger-button" });
      editButton.addEventListener("click", async () => {
        await this.startEditingRecord(record);
      });
      deleteButton.addEventListener("click", async () => {
        await this.deleteRecordFromView(record, deleteButton);
      });
    }
  }
  async renderYearlyOverview(parent, monthSummary) {
    const year = this.viewMonth.slice(0, 4);
    const collapsed = this.isSectionCollapsed("yearlyOverview");
    const section = parent.createDiv({ cls: "life-ledger-section life-ledger-collapsible-section life-ledger-yearly" });
    const header = section.createDiv({ cls: "life-ledger-yearly-header" });
    header.createEl("h3", { text: `\u5E74\u5EA6\u6982\u89C8\uFF08${year}\uFF09` });
    const actions = header.createDiv({ cls: "life-ledger-yearly-actions" });
    const reviewButton = actions.createEl("button", { text: "\u751F\u6210\u5E74\u5EA6\u590D\u76D8" });
    const toggleButton = actions.createEl("button", {
      text: `${collapsed ? "\u25B8 \u5C55\u5F00" : "\u25BE \u6536\u8D77"}`
    });
    reviewButton.addEventListener("click", async () => {
      reviewButton.disabled = true;
      try {
        await this.plugin.generateYearlyReview(year, this.viewMonth);
        new import_obsidian.Notice("\u5E74\u5EA6\u590D\u76D8\u5DF2\u751F\u6210\u3002");
      } catch (error) {
        console.error(error);
        new import_obsidian.Notice("\u751F\u6210\u5E74\u5EA6\u590D\u76D8\u5931\u8D25\uFF0C\u8BF7\u67E5\u770B\u63A7\u5236\u53F0");
      } finally {
        reviewButton.disabled = false;
      }
    });
    toggleButton.addEventListener("click", async () => {
      await this.toggleSection("yearlyOverview");
    });
    if (collapsed) {
      section.addClass("is-collapsed");
      return;
    }
    const content = section.createDiv({ cls: "life-ledger-section-content" });
    const yearlySummary = await this.plugin.getYearSummary(year);
    const cards = content.createDiv({ cls: "life-ledger-yearly-summary" });
    createSummaryCard(cards, "\u5E74\u5EA6\u603B\u6536\u5165", yearlySummary.income, "income");
    createSummaryCard(cards, "\u5E74\u5EA6\u603B\u652F\u51FA", yearlySummary.expense, "expense");
    createSummaryCard(cards, "\u5E74\u5EA6\u51C0\u7ED3\u4F59", yearlySummary.surplus, "balance");
    createSummaryCard(cards, "\u5E74\u5EA6\u6708\u5747\u652F\u51FA", yearlySummary.averageMonthlyExpense, "expense");
    createSummaryCard(cards, "\u5E74\u5EA6\u6708\u5747\u6536\u5165", yearlySummary.averageMonthlyIncome, "income");
    createSummaryCard(cards, "\u5F53\u524D\u8D44\u4EA7\u8D26\u6237\u4F59\u989D", monthSummary.assetBalance, "balance");
    this.renderYearlyMonthlyTrend(content, yearlySummary.monthlySummaries);
    this.renderYearlyExpenseRanking(content, yearlySummary);
    this.renderYearlyAssetComposition(content, monthSummary.assetBreakdown);
    this.renderYearlyTopRecords(content, yearlySummary.topRecords);
  }
  renderYearlyMonthlyTrend(parent, monthlySummaries) {
    const section = parent.createDiv({ cls: "life-ledger-yearly-block" });
    section.createEl("h4", { text: "\u6BCF\u6708\u8D8B\u52BF" });
    const list = section.createEl("ul", { cls: "life-ledger-yearly-month-list" });
    for (const item of monthlySummaries) {
      const row = list.createEl("li", {
        cls: item.month === this.viewMonth ? "life-ledger-yearly-month-item is-current" : "life-ledger-yearly-month-item"
      });
      row.createSpan({ text: item.month });
      row.createSpan({ text: `\u6536\u5165 ${formatMoney(item.income)}` });
      row.createSpan({ text: `\u652F\u51FA ${formatMoney(item.expense)}` });
      row.createSpan({ text: `\u7ED3\u4F59 ${formatMoney(item.surplus)}` });
      row.createSpan({ text: `\u8BB0\u5F55 ${item.recordCount} \u6761` });
    }
  }
  renderYearlyExpenseRanking(parent, yearlySummary) {
    const section = parent.createDiv({ cls: "life-ledger-yearly-block" });
    section.createEl("h4", { text: "\u5E74\u5EA6\u652F\u51FA\u5206\u7C7B\u6392\u884C" });
    if (yearlySummary.expenseBreakdown.length === 0 || yearlySummary.expense <= 0) {
      section.createEl("p", { text: "\u6682\u65E0\u5E74\u5EA6\u652F\u51FA\u5206\u7C7B\u6570\u636E\u3002", cls: "life-ledger-empty" });
      return;
    }
    const list = section.createEl("ul", { cls: "life-ledger-yearly-ranking-list" });
    for (const item of yearlySummary.expenseBreakdown) {
      const row = list.createEl("li", { cls: "life-ledger-yearly-ranking-item" });
      row.createSpan({ text: item.category });
      row.createSpan({
        text: `${formatMoney(item.amount)} \u5143\uFF0C\u5360\u6BD4 ${formatPercent(item.amount, yearlySummary.expense)}`
      });
    }
  }
  renderYearlyAssetComposition(parent, assetBreakdown) {
    const section = parent.createDiv({ cls: "life-ledger-yearly-block" });
    section.createEl("h4", { text: "\u5E74\u5EA6\u8D44\u4EA7\u6784\u6210" });
    const positiveAssets = assetBreakdown.filter((item) => item.balance > 0);
    const total = positiveAssets.reduce((sum, item) => sum + item.balance, 0);
    if (positiveAssets.length === 0 || total <= 0) {
      section.createEl("p", { text: "\u6682\u65E0\u8D44\u4EA7\u8D26\u6237\u6570\u636E\u3002", cls: "life-ledger-empty" });
      return;
    }
    const list = section.createEl("ul", { cls: "life-ledger-yearly-ranking-list" });
    for (const item of positiveAssets) {
      const row = list.createEl("li", { cls: "life-ledger-yearly-ranking-item" });
      row.createSpan({ text: item.category });
      row.createSpan({
        text: `${formatMoney(item.balance)} \u5143\uFF0C\u5360\u6BD4 ${formatPercent(item.balance, total)}`
      });
    }
  }
  renderYearlyTopRecords(parent, topRecords) {
    const section = parent.createDiv({ cls: "life-ledger-yearly-block" });
    section.createEl("h4", { text: "\u5E74\u5EA6\u6700\u5927\u6D41\u6C34" });
    if (topRecords.length === 0) {
      section.createEl("p", { text: "\u6682\u65E0\u5E74\u5EA6\u6D41\u6C34\u8BB0\u5F55\u3002", cls: "life-ledger-empty" });
      return;
    }
    const list = section.createEl("ul", { cls: "life-ledger-yearly-record-list" });
    for (const record of topRecords) {
      const item = list.createEl("li", { cls: "life-ledger-yearly-record-item" });
      item.createDiv({ text: record.date, cls: "life-ledger-record-date" });
      item.createDiv({ text: getTypeLabel(record.type), cls: `life-ledger-record-type is-${record.type}` });
      item.createDiv({ text: getWalletLabel(record.wallet), cls: "life-ledger-record-wallet" });
      item.createDiv({ text: record.category, cls: "life-ledger-record-category" });
      item.createDiv({ text: record.assetCategory || "\u65E0\u8D44\u4EA7\u5206\u7C7B", cls: "life-ledger-record-category" });
      item.createDiv({
        text: `${record.type === "expense" ? "-" : "+"}${formatMoney(record.amount)}`,
        cls: `life-ledger-record-amount is-${record.type}`
      });
      item.createDiv({ text: record.note || "\u65E0\u5907\u6CE8", cls: "life-ledger-record-note" });
    }
  }
  renderRecordFilters(parent, summary) {
    const { content } = this.createCollapsibleSection(parent, "search", "\u8BB0\u5F55\u641C\u7D22\u4E0E\u7B5B\u9009", "h3", "life-ledger-filters");
    if (!content) return;
    const form = content.createDiv({ cls: "life-ledger-filter-form" });
    const keywordInput = createTextInput(form, "\u5173\u952E\u8BCD", "\u5206\u7C7B\u3001\u5907\u6CE8\u3001\u94B1\u5305\u3001\u7C7B\u578B");
    keywordInput.value = this.filterKeyword;
    const typeField = createField(form, "\u7C7B\u578B");
    const typeSelect = typeField.createEl("select");
    addSelectOption(typeSelect, "all", "\u5168\u90E8");
    addSelectOption(typeSelect, "income", "\u6536\u5165");
    addSelectOption(typeSelect, "expense", "\u652F\u51FA");
    addSelectOption(typeSelect, "initial", "\u671F\u521D\u4F59\u989D");
    typeSelect.value = this.filterType;
    const walletField = createField(form, "\u94B1\u5305");
    const walletSelect = walletField.createEl("select");
    addSelectOption(walletSelect, "all", "\u5168\u90E8");
    addSelectOption(walletSelect, "activity", "\u6D3B\u52A8\u94B1\u5305");
    addSelectOption(walletSelect, "reserve", "\u5907\u7528\u94B1\u5305");
    addSelectOption(walletSelect, "asset", "\u8D44\u4EA7\u8D26\u6237");
    walletSelect.value = this.filterWallet;
    const categoryInput = createDatalistInput(
      form,
      "\u5206\u7C7B",
      this.plugin.settings.normalCategories,
      "life-ledger-filter-category-list"
    );
    categoryInput.value = this.filterCategory;
    const assetCategoryInput = createDatalistInput(
      form,
      "\u8D44\u4EA7\u5206\u7C7B",
      this.plugin.settings.assetCategories,
      "life-ledger-filter-asset-category-list"
    );
    assetCategoryInput.value = this.filterAssetCategory;
    const minAmountInput = createNumberInput(form, "\u6700\u5C0F\u91D1\u989D");
    minAmountInput.value = this.filterMinAmount;
    const maxAmountInput = createNumberInput(form, "\u6700\u5927\u91D1\u989D");
    maxAmountInput.value = this.filterMaxAmount;
    const actions = content.createDiv({ cls: "life-ledger-filter-actions" });
    const applyButton = actions.createEl("button", { text: "\u5E94\u7528\u7B5B\u9009", cls: "mod-cta" });
    const clearButton = actions.createEl("button", { text: "\u6E05\u7A7A\u7B5B\u9009" });
    applyButton.addEventListener("click", async () => {
      this.filterKeyword = keywordInput.value.trim();
      this.filterType = typeSelect.value;
      this.filterWallet = walletSelect.value;
      this.filterCategory = categoryInput.value.trim();
      this.filterAssetCategory = assetCategoryInput.value.trim();
      this.filterMinAmount = minAmountInput.value.trim();
      this.filterMaxAmount = maxAmountInput.value.trim();
      this.filterApplied = true;
      this.filteredRecords = filterRecords(summary.records, this.getRecordFilterState());
      await this.rerenderPreserveScroll();
    });
    clearButton.addEventListener("click", async () => {
      this.clearRecordFilters();
      await this.rerenderPreserveScroll();
    });
    this.renderFilterResults(content, summary.records);
  }
  renderFilterResults(parent, records) {
    const resultSection = parent.createDiv({ cls: "life-ledger-filter-results" });
    if (!this.filterApplied) {
      resultSection.createEl("h4", { text: "\u7B5B\u9009\u7ED3\u679C" });
      resultSection.createEl("p", { text: "\u5C1A\u672A\u5E94\u7528\u7B5B\u9009\u3002", cls: "life-ledger-empty" });
      return;
    }
    this.filteredRecords = filterRecords(records, this.getRecordFilterState());
    resultSection.createEl("h4", { text: `\u7B5B\u9009\u7ED3\u679C\uFF08\u5171 ${this.filteredRecords.length} \u6761\uFF09` });
    if (this.filteredRecords.length === 0) {
      resultSection.createEl("p", { text: "\u6CA1\u6709\u7B26\u5408\u6761\u4EF6\u7684\u8BB0\u5F55\u3002", cls: "life-ledger-empty" });
      return;
    }
    const list = resultSection.createEl("ul", { cls: "life-ledger-filter-result-list" });
    for (const record of this.filteredRecords) {
      const item = list.createEl("li", { cls: "life-ledger-filter-result-item" });
      const details = item.createDiv({ cls: "life-ledger-filter-result-fields" });
      details.createDiv({ text: record.date, cls: "life-ledger-record-date" });
      details.createDiv({ text: getTypeLabel(record.type), cls: `life-ledger-record-type is-${record.type}` });
      details.createDiv({ text: getWalletLabel(record.wallet), cls: "life-ledger-record-wallet" });
      details.createDiv({ text: record.category, cls: "life-ledger-record-category" });
      details.createDiv({
        text: record.assetCategory || "\u65E0\u8D44\u4EA7\u5206\u7C7B",
        cls: "life-ledger-record-category"
      });
      details.createDiv({
        text: `${record.type === "expense" ? "-" : "+"}${formatMoney(record.amount)}`,
        cls: `life-ledger-record-amount is-${record.type}`
      });
      details.createDiv({ text: record.note || "\u65E0\u5907\u6CE8", cls: "life-ledger-record-note" });
      const actions = item.createDiv({ cls: "life-ledger-record-actions" });
      const editButton = actions.createEl("button", { text: "\u7F16\u8F91" });
      const deleteButton = actions.createEl("button", { text: "\u5220\u9664", cls: "life-ledger-danger-button" });
      editButton.addEventListener("click", async () => {
        await this.startEditingRecord(record);
      });
      deleteButton.addEventListener("click", async () => {
        await this.deleteRecordFromView(record, deleteButton);
      });
    }
  }
  getRecordFilterState() {
    return {
      keyword: this.filterKeyword,
      type: this.filterType,
      wallet: this.filterWallet,
      category: this.filterCategory,
      assetCategory: this.filterAssetCategory,
      minAmount: this.filterMinAmount,
      maxAmount: this.filterMaxAmount
    };
  }
  clearRecordFilters() {
    this.filterKeyword = "";
    this.filterType = "all";
    this.filterWallet = "all";
    this.filterCategory = "";
    this.filterAssetCategory = "";
    this.filterMinAmount = "";
    this.filterMaxAmount = "";
    this.filterApplied = false;
    this.filteredRecords = [];
  }
  renderAssetBreakdown(parent, assetBreakdown) {
    const section = parent.createDiv({ cls: "life-ledger-asset-breakdown" });
    section.createEl("h3", { text: "\u8D44\u4EA7\u6784\u6210" });
    if (assetBreakdown.length === 0) {
      section.createEl("p", {
        text: "\u6682\u65E0\u8D44\u4EA7\u8D26\u6237\u8BB0\u5F55",
        cls: "life-ledger-empty"
      });
      return;
    }
    const list = section.createEl("ul", { cls: "life-ledger-asset-list" });
    for (const item of assetBreakdown) {
      const row = list.createEl("li", { cls: "life-ledger-asset-item" });
      row.createSpan({ text: item.category });
      row.createEl("strong", { text: formatMoney(item.balance) });
    }
  }
  renderChartsOverview(parent, summary) {
    const { content } = this.createCollapsibleSection(parent, "charts", "\u56FE\u8868\u6982\u89C8", "h3", "life-ledger-charts");
    if (!content) return;
    const grid = content.createDiv({ cls: "life-ledger-chart-grid" });
    this.renderIncomeExpenseChart(grid, summary);
    this.renderExpenseCategoryChart(grid, summary.expenseBreakdown);
    this.renderAssetCompositionChart(grid, summary.assetBreakdown);
  }
  renderIncomeExpenseChart(parent, summary) {
    const card = parent.createDiv({ cls: "life-ledger-chart-card" });
    card.createEl("h4", { text: "\u6708\u5EA6\u6536\u5165 / \u652F\u51FA" });
    if (summary.income === 0 && summary.expense === 0) {
      card.createEl("p", { text: "\u6682\u65E0\u6536\u5165\u652F\u51FA\u6570\u636E", cls: "life-ledger-empty" });
      return;
    }
    const maxAmount = Math.max(summary.income, summary.expense);
    const bars = card.createDiv({ cls: "life-ledger-bar-chart" });
    createVerticalBar(bars, "\u6708\u6536\u5165", summary.income, maxAmount, "income");
    createVerticalBar(bars, "\u6708\u652F\u51FA", summary.expense, maxAmount, "expense");
  }
  renderExpenseCategoryChart(parent, expenseBreakdown) {
    const card = parent.createDiv({ cls: "life-ledger-chart-card" });
    card.createEl("h4", { text: "\u652F\u51FA\u5206\u7C7B\u5360\u6BD4" });
    if (expenseBreakdown.length === 0) {
      card.createEl("p", { text: "\u6682\u65E0\u652F\u51FA\u5206\u7C7B\u6570\u636E", cls: "life-ledger-empty" });
      return;
    }
    const total = expenseBreakdown.reduce((sum, item) => sum + item.amount, 0);
    for (const item of expenseBreakdown) {
      createHorizontalBar(card, item.category, item.amount, total, "expense");
    }
  }
  renderAssetCompositionChart(parent, assetBreakdown) {
    const card = parent.createDiv({ cls: "life-ledger-chart-card" });
    card.createEl("h4", { text: "\u8D44\u4EA7\u6784\u6210\u5360\u6BD4" });
    if (assetBreakdown.length === 0) {
      card.createEl("p", { text: "\u6682\u65E0\u8D44\u4EA7\u6784\u6210\u6570\u636E", cls: "life-ledger-empty" });
      return;
    }
    const positiveAssets = assetBreakdown.filter((item) => item.balance > 0);
    const total = positiveAssets.reduce((sum, item) => sum + item.balance, 0);
    if (total <= 0) {
      card.createEl("p", { text: "\u6682\u65E0\u8D44\u4EA7\u6784\u6210\u6570\u636E", cls: "life-ledger-empty" });
      return;
    }
    for (const item of positiveAssets) {
      createHorizontalBar(card, item.category, item.balance, total, "asset");
    }
  }
  renderBleedingSection(parent, summary) {
    const { content } = this.createCollapsibleSection(parent, "bleeding", "\u6D41\u8840\u9879\u76EE", "h3", "life-ledger-bleeding-projects");
    if (!content) return;
    const metrics = content.createDiv({ cls: "life-ledger-bleeding-metrics" });
    metrics.createDiv({ text: `\u4ECA\u65E5\u88AB\u52A8\u6D41\u8840\uFF1A${formatMoney(summary.dailyBleedingTotal)} \u5143 / \u5929` });
    metrics.createDiv({ text: `\u5F53\u524D\u67E5\u770B\u6708\u4EFD\u88AB\u52A8\u6D41\u8840\u5408\u8BA1\uFF1A${formatMoney(summary.monthBleedingTotal)} \u5143` });
    metrics.createDiv({ text: `\u6708\u771F\u5B9E\u652F\u51FA\u53C2\u8003\uFF1A${formatMoney(summary.realMonthlyExpenseReference)} \u5143` });
    content.createEl("h4", { text: "\u6B63\u5728\u6D41\u8840\u9879\u76EE\u5217\u8868" });
    if (summary.bleedingProjects.length === 0) {
      content.createEl("p", {
        text: "\u6682\u65E0\u6D41\u8840\u9879\u76EE",
        cls: "life-ledger-empty"
      });
    } else {
      const list = content.createEl("ul", { cls: "life-ledger-bleeding-list" });
      for (const project of summary.bleedingProjects) {
        const row = list.createEl("li", { cls: "life-ledger-bleeding-item" });
        const info = row.createDiv({ cls: "life-ledger-bleeding-info" });
        info.createDiv({
          text: `${project.name} \xB7 ${project.active ? "\u542F\u7528" : "\u505C\u7528"}`,
          cls: "life-ledger-bleeding-main"
        });
        info.createDiv({
          text: `\u603B\u91D1\u989D ${formatMoney(project.amount)} \xB7 ${project.startDate} \xB7 ${project.durationDays} \u5929 \xB7 \u6BCF\u65E5 ${formatMoney(getBleedingDailyCost(project))}`,
          cls: "life-ledger-bleeding-meta"
        });
        if (project.note) {
          info.createDiv({ text: project.note, cls: "life-ledger-bleeding-meta" });
        }
        const actions = row.createDiv({ cls: "life-ledger-bleeding-actions" });
        const editButton = actions.createEl("button", { text: "\u7F16\u8F91" });
        const toggleButton = actions.createEl("button", { text: project.active ? "\u505C\u7528" : "\u542F\u7528" });
        const deleteButton = actions.createEl("button", { text: "\u5220\u9664", cls: "life-ledger-danger-button" });
        editButton.addEventListener("click", async () => {
          this.editingBleedingProject = { ...project };
          await this.rerenderPreserveScroll();
        });
        toggleButton.addEventListener("click", async () => {
          try {
            await this.plugin.toggleBleedingProject(project.id);
            await this.rerenderPreserveScroll();
          } catch (error) {
            console.error(error);
            new import_obsidian.Notice("\u5207\u6362\u6D41\u8840\u9879\u76EE\u72B6\u6001\u5931\u8D25\uFF0C\u8BF7\u67E5\u770B\u63A7\u5236\u53F0");
          }
        });
        deleteButton.addEventListener("click", async () => {
          var _a;
          try {
            await this.plugin.deleteBleedingProject(project.id);
            if (((_a = this.editingBleedingProject) == null ? void 0 : _a.id) === project.id) {
              this.editingBleedingProject = null;
            }
            await this.rerenderPreserveScroll();
          } catch (error) {
            console.error(error);
            new import_obsidian.Notice("\u5220\u9664\u6D41\u8840\u9879\u76EE\u5931\u8D25\uFF0C\u8BF7\u67E5\u770B\u63A7\u5236\u53F0");
          }
        });
      }
    }
    this.renderBleedingProjectForm(content);
  }
  renderBleedingProjectForm(parent) {
    parent.createEl("h4", { text: this.editingBleedingProject ? "\u7F16\u8F91\u6D41\u8840\u9879\u76EE" : "\u65B0\u589E\u6D41\u8840\u9879\u76EE" });
    const form = parent.createDiv({ cls: "life-ledger-form" });
    const nameInput = createTextInput(form, "\u9879\u76EE\u540D\u79F0", "\u624B\u673A\u3001\u7535\u8111\u3001\u8BFE\u7A0B");
    const amountInput = createNumberInput(form, "\u603B\u91D1\u989D");
    const startDateField = createField(form, "\u5F00\u59CB\u65E5\u671F");
    const startDateInput = startDateField.createEl("input");
    startDateInput.type = "date";
    const durationInput = createNumberInput(form, "\u4F7F\u7528\u5468\u671F\u5929\u6570");
    durationInput.placeholder = "1095";
    durationInput.step = "1";
    const noteInput = createTextInput(form, "\u5907\u6CE8", "\u9884\u8BA1\u4F7F\u7528\u4E09\u5E74");
    if (this.editingBleedingProject) {
      nameInput.value = this.editingBleedingProject.name;
      amountInput.value = String(this.editingBleedingProject.amount);
      startDateInput.value = this.editingBleedingProject.startDate;
      durationInput.value = String(this.editingBleedingProject.durationDays);
      noteInput.value = this.editingBleedingProject.note;
    } else {
      startDateInput.value = getLocalDateString(/* @__PURE__ */ new Date());
    }
    const actions = form.createDiv({ cls: "life-ledger-actions" });
    const saveButton = actions.createEl("button", {
      text: this.editingBleedingProject ? "\u4FDD\u5B58\u4FEE\u6539" : "\u4FDD\u5B58\u6D41\u8840\u9879\u76EE",
      cls: "mod-cta"
    });
    if (this.editingBleedingProject) {
      const cancelButton = actions.createEl("button", { text: "\u53D6\u6D88\u7F16\u8F91" });
      cancelButton.addEventListener("click", async () => {
        this.editingBleedingProject = null;
        await this.rerenderPreserveScroll();
      });
    }
    saveButton.addEventListener("click", async () => {
      const name = nameInput.value.trim();
      const amount = Number(amountInput.value);
      const startDate = startDateInput.value.trim();
      const durationDays = Number(durationInput.value);
      const note = noteInput.value.trim();
      if (!name) {
        new import_obsidian.Notice("\u8BF7\u586B\u5199\u6D41\u8840\u9879\u76EE\u540D\u79F0");
        nameInput.focus();
        return;
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        new import_obsidian.Notice("\u6D41\u8840\u9879\u76EE\u91D1\u989D\u5FC5\u987B\u5927\u4E8E 0");
        amountInput.focus();
        return;
      }
      if (!isDateString(startDate)) {
        new import_obsidian.Notice("\u5F00\u59CB\u65E5\u671F\u5FC5\u987B\u662F YYYY-MM-DD \u683C\u5F0F");
        startDateInput.focus();
        return;
      }
      if (!Number.isFinite(durationDays) || durationDays <= 0) {
        new import_obsidian.Notice("\u4F7F\u7528\u5468\u671F\u5929\u6570\u5FC5\u987B\u5927\u4E8E 0");
        durationInput.focus();
        return;
      }
      try {
        if (this.editingBleedingProject) {
          await this.plugin.updateBleedingProject({
            ...this.editingBleedingProject,
            name,
            amount,
            startDate,
            durationDays: Math.round(durationDays),
            note
          });
          this.editingBleedingProject = null;
          new import_obsidian.Notice("\u6D41\u8840\u9879\u76EE\u4FEE\u6539\u5DF2\u4FDD\u5B58");
        } else {
          await this.plugin.saveBleedingProject({
            name,
            amount,
            startDate,
            durationDays: Math.round(durationDays),
            note
          });
          new import_obsidian.Notice("\u6D41\u8840\u9879\u76EE\u5DF2\u4FDD\u5B58");
        }
        await this.rerenderPreserveScroll();
      } catch (error) {
        console.error(error);
        new import_obsidian.Notice("\u4FDD\u5B58\u6D41\u8840\u9879\u76EE\u5931\u8D25\uFF0C\u8BF7\u67E5\u770B\u63A7\u5236\u53F0");
      }
    });
  }
  renderExportSection(parent) {
    const { content } = this.createCollapsibleSection(parent, "exportBackup", "\u6570\u636E\u5BFC\u51FA\u4E0E\u5907\u4EFD", "h3", "life-ledger-export");
    if (!content) return;
    const actions = content.createDiv({ cls: "life-ledger-export-actions" });
    const monthCsvButton = actions.createEl("button", { text: "\u5BFC\u51FA\u5F53\u524D\u6708\u4EFD CSV" });
    const yearCsvButton = actions.createEl("button", { text: "\u5BFC\u51FA\u5F53\u524D\u5E74\u4EFD CSV" });
    const allJsonButton = actions.createEl("button", { text: "\u5BFC\u51FA\u5168\u90E8\u8D26\u672C JSON" });
    const bleedingJsonButton = actions.createEl("button", { text: "\u5BFC\u51FA\u6D41\u8840\u9879\u76EE JSON" });
    monthCsvButton.addEventListener("click", async () => {
      await this.runExport(monthCsvButton, () => this.plugin.exportMonthCsv(this.viewMonth));
    });
    yearCsvButton.addEventListener("click", async () => {
      await this.runExport(yearCsvButton, () => this.plugin.exportYearCsv(this.viewMonth.slice(0, 4)));
    });
    allJsonButton.addEventListener("click", async () => {
      await this.runExport(allJsonButton, () => this.plugin.exportAllRecordsJson());
    });
    bleedingJsonButton.addEventListener("click", async () => {
      await this.runExport(bleedingJsonButton, () => this.plugin.exportBleedingProjectsJson());
    });
  }
  async runExport(button, exporter) {
    button.disabled = true;
    try {
      const path = await exporter();
      new import_obsidian.Notice(`\u5BFC\u51FA\u6210\u529F\uFF1A${path}`);
    } catch (error) {
      console.error(error);
      new import_obsidian.Notice("\u5BFC\u51FA\u5931\u8D25\uFF0C\u8BF7\u67E5\u770B\u63A7\u5236\u53F0");
    } finally {
      button.disabled = false;
    }
  }
  renderHealthCheckSection(parent) {
    const { content } = this.createCollapsibleSection(parent, "healthCheck", "\u6570\u636E\u5065\u5EB7\u68C0\u67E5", "h3", "life-ledger-health");
    if (!content) return;
    const actions = content.createDiv({ cls: "life-ledger-health-actions" });
    const checkButton = actions.createEl("button", { text: "\u68C0\u67E5\u6570\u636E\u5B8C\u6574\u6027", cls: "mod-cta" });
    checkButton.addEventListener("click", async () => {
      checkButton.disabled = true;
      try {
        this.healthCheckResult = await this.plugin.runDataHealthCheck();
        new import_obsidian.Notice(`\u6570\u636E\u5065\u5EB7\u68C0\u67E5\u62A5\u544A\u5DF2\u751F\u6210\uFF1A${this.healthCheckResult.reportPath}`);
        await this.rerenderPreserveScroll();
      } catch (error) {
        console.error(error);
        new import_obsidian.Notice("\u6570\u636E\u5065\u5EB7\u68C0\u67E5\u5931\u8D25\uFF0C\u8BF7\u67E5\u770B\u63A7\u5236\u53F0");
        checkButton.disabled = false;
      }
    });
    if (!this.healthCheckResult) {
      content.createEl("p", { text: "\u5C1A\u672A\u6267\u884C\u6570\u636E\u5065\u5EB7\u68C0\u67E5\u3002", cls: "life-ledger-empty" });
      return;
    }
    this.renderHealthCheckResult(content, this.healthCheckResult);
  }
  renderHealthCheckResult(parent, result) {
    parent.createEl("h4", { text: "\u6570\u636E\u5065\u5EB7\u68C0\u67E5\u7ED3\u679C\uFF1A" });
    const summary = parent.createEl("ul", { cls: "life-ledger-health-summary" });
    summary.createEl("li", { text: `\u9519\u8BEF\uFF1A${result.errors.length} \u4E2A` });
    summary.createEl("li", { text: `\u8B66\u544A\uFF1A${result.warnings.length} \u4E2A` });
    summary.createEl("li", { text: `\u666E\u901A\u8BB0\u5F55\uFF1A${result.ledgerRecords} \u6761` });
    summary.createEl("li", { text: `\u6D41\u8840\u9879\u76EE\uFF1A${result.bleedingProjects} \u4E2A` });
    summary.createEl("li", { text: `\u626B\u63CF\u6587\u4EF6\uFF1A${result.scannedFiles} \u4E2A` });
    if (result.errors.length === 0 && result.warnings.length === 0) {
      parent.createEl("p", {
        text: "\u6570\u636E\u68C0\u67E5\u901A\u8FC7\uFF0C\u672A\u53D1\u73B0\u660E\u663E\u95EE\u9898\u3002",
        cls: "life-ledger-empty"
      });
    }
    this.renderHealthIssueList(parent, "\u4E25\u91CD\u9519\u8BEF", result.errors, "\u65E0\u4E25\u91CD\u9519\u8BEF\u3002");
    this.renderHealthIssueList(parent, "\u8B66\u544A", result.warnings, "\u65E0\u8B66\u544A\u3002");
    this.renderHealthIssueList(parent, "\u4FE1\u606F", result.info, "\u6682\u65E0\u4FE1\u606F\u3002");
  }
  renderHealthIssueList(parent, title, issues, emptyText) {
    const section = parent.createDiv({ cls: "life-ledger-health-group" });
    section.createEl("h4", { text: title });
    if (issues.length === 0) {
      section.createEl("p", { text: emptyText, cls: "life-ledger-empty" });
      return;
    }
    const list = section.createEl("ul", { cls: "life-ledger-health-list" });
    for (const issue of issues) {
      list.createEl("li", { text: formatHealthIssue(issue) });
    }
  }
};
function createField(parent, label) {
  const field = parent.createDiv({ cls: "life-ledger-field" });
  field.createEl("label", { text: label });
  return field;
}
function createNumberField(parent, labelText) {
  const field = parent.createDiv({ cls: "life-ledger-field" });
  const label = field.createEl("label", { text: labelText });
  const input = field.createEl("input");
  input.type = "number";
  input.placeholder = "0.00";
  input.min = "0";
  input.step = "0.01";
  return { input, label };
}
function createTextInput(parent, label, placeholder) {
  const field = createField(parent, label);
  const input = field.createEl("input");
  input.type = "text";
  input.placeholder = placeholder;
  return input;
}
function createCategoryInput(parent, categories) {
  const field = createField(parent, "\u5206\u7C7B");
  const listId = "life-ledger-category-list";
  const input = field.createEl("input");
  const datalist = field.createEl("datalist");
  input.type = "text";
  input.placeholder = categories.join("\u3001");
  input.setAttr("list", listId);
  datalist.id = listId;
  for (const category of categories) {
    const option = datalist.createEl("option");
    option.value = category;
  }
  return input;
}
function createAssetCategoryInput(parent, categories) {
  const field = createField(parent, "\u8D44\u4EA7\u5206\u7C7B");
  const listId = "life-ledger-asset-category-list";
  const input = field.createEl("input");
  const datalist = field.createEl("datalist");
  input.type = "text";
  input.placeholder = categories.join("\u3001");
  input.setAttr("list", listId);
  datalist.id = listId;
  for (const category of categories) {
    const option = datalist.createEl("option");
    option.value = category;
  }
  return { field, input };
}
function createDatalistInput(parent, label, categories, listId) {
  const field = createField(parent, label);
  const input = field.createEl("input");
  const datalist = field.createEl("datalist");
  input.type = "text";
  input.placeholder = categories.join("\u3001");
  input.setAttr("list", listId);
  datalist.id = listId;
  for (const category of categories) {
    const option = datalist.createEl("option");
    option.value = category;
  }
  return input;
}
function createNumberInput(parent, label) {
  const field = createField(parent, label);
  const input = field.createEl("input");
  input.type = "number";
  input.placeholder = "0.00";
  input.min = "0";
  input.step = "0.01";
  return input;
}
function addSelectOption(select, value, text) {
  const option = select.createEl("option", { text });
  option.value = value;
}
function createSummaryCard(parent, label, amount, tone) {
  const card = parent.createDiv({ cls: `life-ledger-card is-${tone}` });
  card.createEl("span", { text: label, cls: "life-ledger-card-label" });
  card.createEl("strong", { text: formatMoney(amount), cls: "life-ledger-card-value" });
}
function createSummaryGroup(parent, title, isPrimary = false, description) {
  const group = parent.createDiv({
    cls: isPrimary ? "life-ledger-summary-group is-primary" : "life-ledger-summary-group"
  });
  const header = group.createDiv({ cls: "life-ledger-summary-group-header" });
  header.createEl("h3", { text: title });
  if (description) {
    header.createEl("p", { text: description });
  }
  return group.createDiv({ cls: "life-ledger-summary" });
}
function formatMonthlyReview(month, summary, settings) {
  const lines = [];
  lines.push(`# ${month} \u8D22\u52A1\u590D\u76D8`);
  lines.push("");
  lines.push("## \u4E00\u3001\u6708\u5EA6\u6982\u89C8");
  lines.push("");
  lines.push(`- \u6708\u6536\u5165\uFF1A${formatMoney(summary.income)} \u5143`);
  lines.push(`- \u6708\u652F\u51FA\uFF1A${formatMoney(summary.expense)} \u5143`);
  lines.push(`- \u6708\u7ED3\u4F59\uFF1A${formatMoney(summary.surplus)} \u5143`);
  lines.push(`- \u6D3B\u52A8\u94B1\u5305\u4F59\u989D\uFF1A${formatMoney(summary.activityBalance)} \u5143`);
  lines.push(`- \u5907\u7528\u94B1\u5305\u4F59\u989D\uFF1A${formatMoney(summary.reserveBalance)} \u5143`);
  lines.push(`- \u8D44\u4EA7\u8D26\u6237\u4F59\u989D\uFF1A${formatMoney(summary.assetBalance)} \u5143`);
  lines.push(`- \u6708\u771F\u5B9E\u652F\u51FA\u53C2\u8003\uFF1A${formatMoney(summary.realMonthlyExpenseReference)} \u5143`);
  lines.push("");
  lines.push("## \u4E8C\u3001\u652F\u51FA\u7ED3\u6784");
  lines.push("");
  if (summary.expenseBreakdown.length === 0 || summary.expense <= 0) {
    lines.push("\u672C\u6708\u6682\u65E0\u652F\u51FA\u8BB0\u5F55\u3002");
  } else {
    for (const item of summary.expenseBreakdown) {
      lines.push(`- ${item.category}\uFF1A${formatMoney(item.amount)} \u5143\uFF0C\u5360\u6BD4 ${formatPercent(item.amount, summary.expense)}`);
    }
  }
  lines.push("");
  lines.push("## \u4E09\u3001\u8D44\u4EA7\u6784\u6210");
  lines.push("");
  const positiveAssets = summary.assetBreakdown.filter((item) => item.balance > 0);
  const assetTotal = positiveAssets.reduce((sum, item) => sum + item.balance, 0);
  if (positiveAssets.length === 0 || assetTotal <= 0) {
    lines.push("\u6682\u65E0\u8D44\u4EA7\u8D26\u6237\u8BB0\u5F55\u3002");
  } else {
    for (const item of positiveAssets) {
      lines.push(`- ${item.category}\uFF1A${formatMoney(item.balance)} \u5143\uFF0C\u5360\u6BD4 ${formatPercent(item.balance, assetTotal)}`);
    }
  }
  lines.push("");
  lines.push("## \u56DB\u3001\u6D41\u8840\u9879\u76EE");
  lines.push("");
  lines.push(`- \u4ECA\u65E5\u88AB\u52A8\u6D41\u8840\uFF1A${formatMoney(summary.dailyBleedingTotal)} \u5143 / \u5929`);
  lines.push(`- \u5F53\u524D\u67E5\u770B\u6708\u4EFD\u88AB\u52A8\u6D41\u8840\u5408\u8BA1\uFF1A${formatMoney(summary.monthBleedingTotal)} \u5143`);
  lines.push(`- \u6708\u771F\u5B9E\u652F\u51FA\u53C2\u8003\uFF1A${formatMoney(summary.realMonthlyExpenseReference)} \u5143`);
  lines.push("");
  const activeBleedingProjects = summary.bleedingProjects.filter((project) => project.active);
  if (activeBleedingProjects.length === 0) {
    lines.push("\u6682\u65E0\u542F\u7528\u4E2D\u7684\u6D41\u8840\u9879\u76EE\u3002");
  } else {
    for (const project of activeBleedingProjects) {
      lines.push(
        `- ${project.name}\uFF1A\u6BCF\u65E5\u6D41\u8840 ${formatMoney(getBleedingDailyCost(project))} \u5143 / \u5929\uFF0C\u5F00\u59CB\u65E5\u671F ${project.startDate}\uFF0C\u9884\u8BA1\u6301\u7EED ${project.durationDays} \u5929`
      );
    }
  }
  lines.push("");
  lines.push("## \u4E94\u3001\u9884\u7B97\u4E0E\u63D0\u9192");
  lines.push("");
  const reminders = getBudgetWarningMessages(settings, summary);
  if (reminders.length === 0) {
    lines.push("\u6682\u65E0\u9884\u8B66\uFF0C\u5F53\u524D\u8D22\u52A1\u72B6\u6001\u6B63\u5E38\u3002");
  } else {
    for (const reminder of reminders) {
      lines.push(`- ${reminder}`);
    }
  }
  lines.push("");
  lines.push("## \u516D\u3001\u672C\u6708\u4E3B\u8981\u6D41\u6C34");
  lines.push("");
  if (summary.records.length === 0) {
    lines.push("\u672C\u6708\u6682\u65E0\u6D41\u6C34\u8BB0\u5F55\u3002");
  } else {
    const topRecords = [...summary.records].sort((a, b) => b.amount - a.amount).slice(0, 10);
    for (const record of topRecords) {
      lines.push(formatReviewRecord(record));
    }
  }
  lines.push("");
  lines.push("## \u4E03\u3001\u4E2A\u4EBA\u590D\u76D8");
  lines.push("");
  lines.push("### 1. \u672C\u6708\u94B1\u4E3B\u8981\u82B1\u5728\u54EA\u91CC\uFF1F");
  lines.push("");
  lines.push("### 2. \u54EA\u4E9B\u6D88\u8D39\u662F\u503C\u5F97\u7684\uFF1F");
  lines.push("");
  lines.push("### 3. \u54EA\u4E9B\u6D88\u8D39\u4E0B\u4E2A\u6708\u53EF\u4EE5\u51CF\u5C11\uFF1F");
  lines.push("");
  lines.push("### 4. \u672C\u6708\u8D44\u4EA7\u53D8\u5316\u662F\u5426\u7B26\u5408\u9884\u671F\uFF1F");
  lines.push("");
  lines.push("### 5. \u4E0B\u4E2A\u6708\u8D22\u52A1\u7B56\u7565");
  lines.push("");
  return `${lines.join("\n")}
`;
}
function formatRecordsCsv(records) {
  const headers = [
    "id",
    "date",
    "type",
    "typeLabel",
    "wallet",
    "walletLabel",
    "category",
    "assetCategory",
    "amount",
    "note"
  ];
  const rows = records.map((record) => [
    record.id,
    record.date,
    record.type,
    getTypeLabel(record.type),
    record.wallet,
    getWalletLabel(record.wallet),
    record.category,
    record.assetCategory || "",
    record.amount.toFixed(2),
    record.note
  ]);
  return [
    headers.map(escapeCsvField).join(","),
    ...rows.map((row) => row.map(escapeCsvField).join(","))
  ].join("\n") + "\n";
}
function escapeCsvField(value) {
  if (value === null || value === void 0) {
    return "";
  }
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}
function formatHealthCheckReport(result) {
  const lines = [];
  lines.push("# LifeLedger \u6570\u636E\u5065\u5EB7\u68C0\u67E5\u62A5\u544A");
  lines.push("");
  lines.push(`\u751F\u6210\u65F6\u95F4\uFF1A${getLocalDateTimeString(/* @__PURE__ */ new Date())}`);
  lines.push("");
  lines.push("## \u4E00\u3001\u68C0\u67E5\u6458\u8981");
  lines.push("");
  lines.push(`- \u626B\u63CF\u6587\u4EF6\u6570\uFF1A${result.scannedFiles}`);
  lines.push(`- \u666E\u901A\u8BB0\u5F55\u6570\uFF1A${result.ledgerRecords}`);
  lines.push(`- \u6D41\u8840\u9879\u76EE\u6570\uFF1A${result.bleedingProjects}`);
  lines.push(`- \u9519\u8BEF\u6570\uFF1A${result.errors.length}`);
  lines.push(`- \u8B66\u544A\u6570\uFF1A${result.warnings.length}`);
  lines.push("");
  lines.push("## \u4E8C\u3001\u4E25\u91CD\u9519\u8BEF");
  lines.push("");
  if (result.errors.length === 0) {
    lines.push("\u65E0\u4E25\u91CD\u9519\u8BEF\u3002");
  } else {
    for (const issue of result.errors) {
      lines.push(`- ${formatHealthIssue(issue)}`);
    }
  }
  lines.push("");
  lines.push("## \u4E09\u3001\u8B66\u544A");
  lines.push("");
  if (result.warnings.length === 0) {
    lines.push("\u65E0\u8B66\u544A\u3002");
  } else {
    for (const issue of result.warnings) {
      lines.push(`- ${formatHealthIssue(issue)}`);
    }
  }
  lines.push("");
  lines.push("## \u56DB\u3001\u4FE1\u606F");
  lines.push("");
  for (const issue of result.info) {
    lines.push(`- ${formatHealthIssue(issue)}`);
  }
  return `${lines.join("\n")}
`;
}
function formatHealthIssue(issue) {
  const parts = [];
  if (issue.filePath) {
    parts.push(issue.filePath);
  }
  if (issue.recordId) {
    parts.push(`id: ${issue.recordId}`);
  }
  return parts.length > 0 ? `${parts.join("\uFF5C")}\uFF5C${issue.message}` : issue.message;
}
function formatYearlyReview(year, yearlySummary, monthSummary, settings) {
  const lines = [];
  lines.push(`# ${year} \u5E74\u5EA6\u8D22\u52A1\u590D\u76D8`);
  lines.push("");
  lines.push("## \u4E00\u3001\u5E74\u5EA6\u6982\u89C8");
  lines.push("");
  lines.push(`- \u5E74\u5EA6\u603B\u6536\u5165\uFF1A${formatMoney(yearlySummary.income)} \u5143`);
  lines.push(`- \u5E74\u5EA6\u603B\u652F\u51FA\uFF1A${formatMoney(yearlySummary.expense)} \u5143`);
  lines.push(`- \u5E74\u5EA6\u51C0\u7ED3\u4F59\uFF1A${formatMoney(yearlySummary.surplus)} \u5143`);
  lines.push(`- \u5E74\u5EA6\u6708\u5747\u6536\u5165\uFF1A${formatMoney(yearlySummary.averageMonthlyIncome)} \u5143`);
  lines.push(`- \u5E74\u5EA6\u6708\u5747\u652F\u51FA\uFF1A${formatMoney(yearlySummary.averageMonthlyExpense)} \u5143`);
  lines.push(`- \u622A\u81F3\u5F53\u524D\u67E5\u770B\u6708\u4EFD\u7684\u6D3B\u52A8\u94B1\u5305\u4F59\u989D\uFF1A${formatMoney(monthSummary.activityBalance)} \u5143`);
  lines.push(`- \u622A\u81F3\u5F53\u524D\u67E5\u770B\u6708\u4EFD\u7684\u5907\u7528\u94B1\u5305\u4F59\u989D\uFF1A${formatMoney(monthSummary.reserveBalance)} \u5143`);
  lines.push(`- \u622A\u81F3\u5F53\u524D\u67E5\u770B\u6708\u4EFD\u7684\u8D44\u4EA7\u8D26\u6237\u4F59\u989D\uFF1A${formatMoney(monthSummary.assetBalance)} \u5143`);
  lines.push("");
  lines.push("## \u4E8C\u3001\u6708\u5EA6\u8D8B\u52BF");
  lines.push("");
  for (const item of yearlySummary.monthlySummaries) {
    lines.push(
      `- ${item.month}\uFF1A\u6536\u5165 ${formatMoney(item.income)} \u5143\uFF0C\u652F\u51FA ${formatMoney(item.expense)} \u5143\uFF0C\u7ED3\u4F59 ${formatMoney(item.surplus)} \u5143\uFF0C\u8BB0\u5F55 ${item.recordCount} \u6761`
    );
  }
  lines.push("");
  lines.push("## \u4E09\u3001\u5E74\u5EA6\u652F\u51FA\u5206\u7C7B\u6392\u884C");
  lines.push("");
  if (yearlySummary.expenseBreakdown.length === 0 || yearlySummary.expense <= 0) {
    lines.push("\u672C\u5E74\u5EA6\u6682\u65E0\u652F\u51FA\u8BB0\u5F55\u3002");
  } else {
    for (const item of yearlySummary.expenseBreakdown) {
      lines.push(`- ${item.category}\uFF1A\u91D1\u989D ${formatMoney(item.amount)} \u5143\uFF0C\u5360\u5E74\u5EA6\u652F\u51FA ${formatPercent(item.amount, yearlySummary.expense)}`);
    }
  }
  lines.push("");
  lines.push("## \u56DB\u3001\u5E74\u5EA6\u8D44\u4EA7\u6784\u6210");
  lines.push("");
  const positiveAssets = monthSummary.assetBreakdown.filter((item) => item.balance > 0);
  const assetTotal = positiveAssets.reduce((sum, item) => sum + item.balance, 0);
  if (positiveAssets.length === 0 || assetTotal <= 0) {
    lines.push("\u6682\u65E0\u8D44\u4EA7\u8D26\u6237\u6570\u636E\u3002");
  } else {
    for (const item of positiveAssets) {
      lines.push(`- ${item.category}\uFF1A\u91D1\u989D ${formatMoney(item.balance)} \u5143\uFF0C\u5360\u6BD4 ${formatPercent(item.balance, assetTotal)}`);
    }
  }
  lines.push("");
  lines.push("## \u4E94\u3001\u5E74\u5EA6\u6700\u5927\u6D41\u6C34");
  lines.push("");
  if (yearlySummary.topRecords.length === 0) {
    lines.push("\u672C\u5E74\u5EA6\u6682\u65E0\u6D41\u6C34\u8BB0\u5F55\u3002");
  } else {
    for (const record of yearlySummary.topRecords) {
      lines.push(formatYearlyReviewRecord(record));
    }
  }
  lines.push("");
  lines.push("## \u516D\u3001\u5E74\u5EA6\u6D41\u8840\u9879\u76EE\u603B\u7ED3");
  lines.push("");
  const activeBleedingProjects = monthSummary.bleedingProjects.filter((project) => project.active);
  if (activeBleedingProjects.length === 0) {
    lines.push("\u6682\u65E0\u542F\u7528\u4E2D\u7684\u6D41\u8840\u9879\u76EE\u3002");
  } else {
    for (const project of activeBleedingProjects) {
      lines.push(
        `- ${project.name}\uFF1A\u603B\u91D1\u989D ${formatMoney(project.amount)} \u5143\uFF0C\u6BCF\u65E5\u6D41\u8840 ${formatMoney(getBleedingDailyCost(project))} \u5143 / \u5929\uFF0C\u5F00\u59CB\u65E5\u671F ${project.startDate}\uFF0C\u9884\u8BA1\u6301\u7EED ${project.durationDays} \u5929`
      );
    }
  }
  lines.push("");
  lines.push(`- \u5F53\u524D\u67E5\u770B\u6708\u4EFD\u88AB\u52A8\u6D41\u8840\u5408\u8BA1\uFF1A${formatMoney(monthSummary.monthBleedingTotal)} \u5143`);
  lines.push(`- \u6708\u771F\u5B9E\u652F\u51FA\u53C2\u8003\uFF1A${formatMoney(monthSummary.realMonthlyExpenseReference)} \u5143`);
  lines.push("");
  lines.push("## \u4E03\u3001\u5E74\u5EA6\u9884\u7B97\u4E0E\u98CE\u9669\u63D0\u9192");
  lines.push("");
  const reminders = getBudgetWarningMessages(settings, monthSummary);
  if (reminders.length === 0) {
    lines.push("\u6682\u65E0\u660E\u663E\u9884\u8B66\u3002");
  } else {
    for (const reminder of reminders) {
      lines.push(`- ${reminder}`);
    }
  }
  lines.push("");
  lines.push("## \u516B\u3001\u4E2A\u4EBA\u5E74\u5EA6\u590D\u76D8");
  lines.push("");
  lines.push("### 1. \u4ECA\u5E74\u94B1\u4E3B\u8981\u6D41\u5411\u4E86\u54EA\u91CC\uFF1F");
  lines.push("");
  lines.push("### 2. \u54EA\u4E9B\u652F\u51FA\u771F\u6B63\u63D0\u5347\u4E86\u751F\u6D3B\u8D28\u91CF\u6216\u4E2A\u4EBA\u6210\u957F\uFF1F");
  lines.push("");
  lines.push("### 3. \u54EA\u4E9B\u652F\u51FA\u5C5E\u4E8E\u53EF\u4EE5\u51CF\u5C11\u7684\u6D88\u8017\uFF1F");
  lines.push("");
  lines.push("### 4. \u4ECA\u5E74\u8D44\u4EA7\u53D8\u5316\u662F\u5426\u7B26\u5408\u9884\u671F\uFF1F");
  lines.push("");
  lines.push("### 5. \u4ECA\u5E74\u6700\u503C\u5F97\u590D\u76D8\u7684\u4E00\u7B14\u5927\u989D\u652F\u51FA\u662F\u4EC0\u4E48\uFF1F");
  lines.push("");
  lines.push("### 6. \u660E\u5E74\u7684\u8D22\u52A1\u7B56\u7565\u662F\u4EC0\u4E48\uFF1F");
  lines.push("");
  return `${lines.join("\n")}
`;
}
function getBudgetWarningMessages(settings, summary) {
  const reminders = [];
  if (settings.monthlyExpenseBudget > 0) {
    const usageRate = summary.expense / settings.monthlyExpenseBudget * 100;
    if (usageRate >= 100) {
      reminders.push("\u672C\u6708\u652F\u51FA\u5DF2\u8D85\u8FC7\u9884\u7B97\u3002");
    } else if (usageRate >= 80) {
      reminders.push("\u672C\u6708\u652F\u51FA\u5DF2\u8D85\u8FC7\u9884\u7B97\u7684 80%\u3002");
    } else {
      reminders.push("\u672C\u6708\u652F\u51FA\u4ECD\u5728\u9884\u7B97\u8303\u56F4\u5185\u3002");
    }
  }
  if (settings.activityLowBalanceWarning > 0 && summary.activityBalance <= settings.activityLowBalanceWarning) {
    reminders.push("\u6D3B\u52A8\u94B1\u5305\u4F59\u989D\u5DF2\u4F4E\u4E8E\u9884\u8B66\u7EBF\u3002");
  }
  if (settings.reserveLowBalanceWarning > 0 && summary.reserveBalance <= settings.reserveLowBalanceWarning) {
    reminders.push("\u5907\u7528\u94B1\u5305\u4F59\u989D\u5DF2\u4F4E\u4E8E\u9884\u8B66\u7EBF\u3002");
  }
  if (settings.monthlyBleedingWarning > 0 && summary.monthBleedingTotal >= settings.monthlyBleedingWarning) {
    reminders.push("\u5F53\u524D\u6708\u4EFD\u88AB\u52A8\u6D41\u8840\u5DF2\u8D85\u8FC7\u9884\u8B66\u7EBF\u3002");
  }
  if (summary.records.some((record) => record.wallet === "asset" && record.type === "expense")) {
    reminders.push("\u672C\u6708\u5B58\u5728\u8D44\u4EA7\u8D26\u6237\u652F\u51FA\uFF0C\u8BF7\u786E\u8BA4\u662F\u5426\u5C5E\u4E8E\u5FC5\u8981\u8D44\u4EA7\u8C03\u6574\u3002");
  }
  return reminders;
}
function formatReviewRecord(record) {
  const sign = record.type === "expense" ? "-" : "+";
  const category = record.wallet === "asset" && record.assetCategory ? `${record.category} / ${record.assetCategory}` : record.category;
  const note = record.note || "\u65E0\u5907\u6CE8";
  return `- ${record.date}\uFF5C${getTypeLabel(record.type)}\uFF5C${getWalletLabel(record.wallet)}\uFF5C${category}\uFF5C${sign}${formatMoney(record.amount)} \u5143\uFF5C${note}`;
}
function formatYearlyReviewRecord(record) {
  const sign = record.type === "expense" ? "-" : "+";
  const assetCategory = record.assetCategory || "";
  const note = record.note || "\u65E0\u5907\u6CE8";
  return `- ${record.date}\uFF5C${getTypeLabel(record.type)}\uFF5C${getWalletLabel(record.wallet)}\uFF5C${record.category}\uFF5C${assetCategory}\uFF5C${sign}${formatMoney(record.amount)} \u5143\uFF5C${note}`;
}
function formatPercent(amount, total) {
  return `${(total > 0 ? amount / total * 100 : 0).toFixed(1)}%`;
}
function createVerticalBar(parent, label, amount, maxAmount, tone) {
  const item = parent.createDiv({ cls: "life-ledger-vertical-bar-item" });
  const track = item.createDiv({ cls: "life-ledger-vertical-bar-track" });
  const bar = track.createDiv({ cls: `life-ledger-vertical-bar is-${tone}` });
  bar.style.height = `${maxAmount > 0 ? Math.max(4, amount / maxAmount * 100) : 0}%`;
  item.createDiv({ text: label, cls: "life-ledger-chart-label" });
  item.createDiv({ text: formatMoney(amount), cls: "life-ledger-chart-value" });
}
function createHorizontalBar(parent, label, amount, total, tone) {
  const percent = total > 0 ? amount / total * 100 : 0;
  const row = parent.createDiv({ cls: "life-ledger-horizontal-bar-row" });
  const meta = row.createDiv({ cls: "life-ledger-horizontal-bar-meta" });
  meta.createSpan({ text: label });
  meta.createSpan({ text: `${formatMoney(amount)} \xB7 ${percent.toFixed(1)}%` });
  const track = row.createDiv({ cls: "life-ledger-horizontal-bar-track" });
  const fill = track.createDiv({ cls: `life-ledger-horizontal-bar-fill is-${tone}` });
  fill.style.width = `${Math.max(2, percent)}%`;
}
function parseLedgerRecords(content) {
  const match = content.match(/```life-ledger\s*([\s\S]*?)```/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[1].trim());
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeLedgerRecord).filter((record) => record !== null);
  } catch (e) {
    return [];
  }
}
function extractJsonCodeBlock(content, language) {
  const escapedLanguage = language.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(new RegExp(`\`\`\`${escapedLanguage}\\s*([\\s\\S]*?)\`\`\``));
  return match ? match[1] : null;
}
function parseBleedingProjects(content) {
  const match = content.match(/```life-ledger-bleeding\s*([\s\S]*?)```/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[1].trim());
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeBleedingProject).filter((project) => project !== null);
  } catch (e) {
    return [];
  }
}
function normalizeLedgerRecord(value) {
  if (!value || typeof value !== "object") return null;
  const record = value;
  const wallet = isWalletType(record.wallet) ? record.wallet : "activity";
  const isValid = typeof record.id === "string" && typeof record.date === "string" && isLedgerType(record.type) && typeof record.category === "string" && typeof record.amount === "number" && Number.isFinite(record.amount) && typeof record.note === "string";
  if (!isValid) {
    return null;
  }
  return {
    id: record.id,
    date: record.date,
    type: record.type,
    wallet,
    category: record.category,
    assetCategory: wallet === "asset" && record.assetCategory ? normalizeCategory(record.assetCategory) : void 0,
    amount: record.amount,
    note: record.note
  };
}
function normalizeBleedingProject(value) {
  if (!value || typeof value !== "object") return null;
  const project = value;
  const isValid = typeof project.id === "string" && typeof project.name === "string" && typeof project.amount === "number" && Number.isFinite(project.amount) && typeof project.startDate === "string" && typeof project.durationDays === "number" && Number.isFinite(project.durationDays);
  if (!isValid) {
    return null;
  }
  return {
    id: project.id,
    name: project.name,
    amount: project.amount,
    startDate: project.startDate,
    durationDays: Math.max(1, Math.round(project.durationDays)),
    note: typeof project.note === "string" ? project.note : "",
    active: project.active !== false
  };
}
function createRecordId(sequence = 0) {
  const now = /* @__PURE__ */ new Date();
  const pad = (value, length = 2) => String(value).padStart(length, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
    pad(now.getMilliseconds(), 3),
    pad(sequence, 2)
  ].join("");
}
function getLocalDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function getLocalDateTimeString(date) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${getLocalDateString(date)} ${hours}:${minutes}`;
}
function getCurrentMonthString() {
  return getLocalDateString(/* @__PURE__ */ new Date()).slice(0, 7);
}
function shiftMonth(month, offset) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(year, monthNumber - 1 + offset, 1);
  return getLocalDateString(date).slice(0, 7);
}
function isMonthString(value) {
  return /^\d{4}-\d{2}$/.test(value);
}
function isDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
function getTypeLabel(type) {
  if (type === "income") return "\u6536\u5165";
  if (type === "initial") return "\u671F\u521D\u4F59\u989D";
  return "\u652F\u51FA";
}
function getWalletLabel(wallet) {
  if (wallet === "reserve") return "\u5907\u7528\u94B1\u5305";
  if (wallet === "asset") return "\u8D44\u4EA7\u8D26\u6237";
  return "\u6D3B\u52A8\u94B1\u5305";
}
function getWalletDisplay(record) {
  if (record.wallet !== "asset") {
    return getWalletLabel(record.wallet);
  }
  return `${getWalletLabel(record.wallet)} / ${record.assetCategory || getDefaultAssetCategory(DEFAULT_ASSET_CATEGORIES)}`;
}
function sumRecords(records, type, wallet) {
  return records.filter((record) => record.type === type && (!wallet || record.wallet === wallet)).reduce((sum, record) => sum + record.amount, 0);
}
function getAssetBreakdown(records) {
  const balances = /* @__PURE__ */ new Map();
  for (const record of records) {
    if (record.wallet !== "asset") continue;
    const category = record.assetCategory || getDefaultAssetCategory(DEFAULT_ASSET_CATEGORIES);
    const signedAmount = record.type === "expense" ? -record.amount : record.amount;
    balances.set(category, roundMoney((balances.get(category) || 0) + signedAmount));
  }
  return Array.from(balances.entries()).map(([category, balance]) => ({ category, balance })).filter((item) => item.balance !== 0).sort((a, b) => b.balance - a.balance);
}
function getExpenseBreakdown(records) {
  const totals = /* @__PURE__ */ new Map();
  for (const record of records) {
    if (record.type !== "expense") continue;
    totals.set(record.category, roundMoney((totals.get(record.category) || 0) + record.amount));
  }
  return Array.from(totals.entries()).map(([category, amount]) => ({ category, amount })).filter((item) => item.amount > 0).sort((a, b) => b.amount - a.amount);
}
function getDailySummaries(month, records) {
  const recordsByDate = /* @__PURE__ */ new Map();
  for (const record of records) {
    if (!record.date.startsWith(month)) continue;
    const dayRecords = recordsByDate.get(record.date) || [];
    dayRecords.push(record);
    recordsByDate.set(record.date, dayRecords);
  }
  return getDatesInMonth(month).map((date) => {
    const dayRecords = recordsByDate.get(date) || [];
    const income = sumRecords(dayRecords, "income");
    const expense = sumRecords(dayRecords, "expense");
    return {
      date,
      income,
      expense,
      surplus: roundMoney(income - expense),
      records: dayRecords
    };
  });
}
function getDatesInMonth(month) {
  const dates = [];
  const firstDate = `${month}-01`;
  const lastDate = getMonthEndDate(month);
  const totalDays = daysBetween(firstDate, lastDate) + 1;
  for (let index = 0; index < totalDays; index += 1) {
    dates.push(addDays(firstDate, index));
  }
  return dates;
}
function filterRecords(records, filters) {
  const keyword = filters.keyword.trim().toLowerCase();
  const category = filters.category.trim().toLowerCase();
  const assetCategory = filters.assetCategory.trim().toLowerCase();
  const minAmount = parseOptionalAmount(filters.minAmount);
  const maxAmount = parseOptionalAmount(filters.maxAmount);
  return records.filter((record) => {
    if (filters.type !== "all" && record.type !== filters.type) return false;
    if (filters.wallet !== "all" && record.wallet !== filters.wallet) return false;
    const recordCategory = record.category.toLowerCase();
    const recordAssetCategory = (record.assetCategory || "").toLowerCase();
    if (category && !recordCategory.includes(category)) return false;
    if (assetCategory && !recordAssetCategory.includes(assetCategory)) return false;
    const absoluteAmount = Math.abs(record.amount);
    if (minAmount !== null && absoluteAmount < minAmount) return false;
    if (maxAmount !== null && absoluteAmount > maxAmount) return false;
    if (!keyword) return true;
    const searchableText = [
      record.category,
      record.note,
      record.assetCategory || "",
      getWalletLabel(record.wallet),
      getTypeLabel(record.type)
    ].join(" ").toLowerCase();
    return searchableText.includes(keyword);
  });
}
function parseOptionalAmount(value) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const amount = Number(trimmed);
  return Number.isFinite(amount) ? Math.abs(amount) : null;
}
function isLedgerCandidateFile(path) {
  if (!path.startsWith(`${DATA_ROOT}/`)) return false;
  if (path.startsWith(`${EXPORTS_PATH}/`)) return false;
  if (path === BLEEDING_PROJECTS_PATH) return false;
  if (!path.endsWith(".md")) return false;
  if (path.includes("_MonthlyReview_") || path.includes("_YearlyReview_")) return false;
  return /^LifeLedger\/\d{4}_LifeLedger\/\d{4}-\d{2}\/[^/]+\.md$/.test(path) || /^LifeLedger\/\d{4}-\d{2}\/[^/]+\.md$/.test(path);
}
function isStandardLedgerFileName(path) {
  const fileName = path.split("/").pop() || "";
  return /^\d{4}-\d{2}-\d{2}_LL\.md$/.test(fileName) || /^\d{4}-\d{2}-\d{2}\.md$/.test(fileName);
}
function getLedgerDateFromFilePath(path) {
  const fileName = path.split("/").pop() || "";
  const match = fileName.match(/^(\d{4}-\d{2}-\d{2})(?:_LL)?\.md$/);
  return match ? match[1] : null;
}
function getActiveBleedingProjects(projects, date) {
  return projects.filter((project) => isBleedingProjectActiveOnDate(project, date));
}
function getBleedingTotalForDate(projects, date) {
  return roundMoney(
    projects.filter((project) => isBleedingProjectActiveOnDate(project, date)).reduce((sum, project) => sum + getBleedingDailyCost(project), 0)
  );
}
function getBleedingTotalForMonth(projects, month) {
  const monthStart = `${month}-01`;
  const monthEnd = getMonthEndDate(month);
  return roundMoney(
    projects.reduce((sum, project) => {
      if (!project.active) return sum;
      const start = maxDateString(project.startDate, monthStart);
      const end = minDateString(getBleedingEndDate(project), monthEnd);
      if (end < start) return sum;
      return sum + getBleedingDailyCost(project) * (daysBetween(start, end) + 1);
    }, 0)
  );
}
function isBleedingProjectActiveOnDate(project, date) {
  return project.active && project.startDate <= date && getBleedingEndDate(project) >= date;
}
function getBleedingDailyCost(project) {
  return roundMoney(project.amount / project.durationDays);
}
function getBleedingEndDate(project) {
  return addDays(project.startDate, project.durationDays - 1);
}
function getMonthEndDate(month) {
  return addDays(shiftMonth(month, 1) + "-01", -1);
}
function addDays(date, days) {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(year, month - 1, day + days);
  return getLocalDateString(next);
}
function daysBetween(startDate, endDate) {
  const [startYear, startMonth, startDay] = startDate.split("-").map(Number);
  const [endYear, endMonth, endDay] = endDate.split("-").map(Number);
  const start = new Date(startYear, startMonth - 1, startDay).getTime();
  const end = new Date(endYear, endMonth - 1, endDay).getTime();
  return Math.round((end - start) / 864e5);
}
function maxDateString(first, second) {
  return first > second ? first : second;
}
function minDateString(first, second) {
  return first < second ? first : second;
}
function isWalletType(wallet) {
  return wallet === "activity" || wallet === "reserve" || wallet === "asset";
}
function isLedgerType(type) {
  return type === "income" || type === "expense" || type === "initial";
}
function getDistributionPair(value) {
  if (value === "reserve-asset") {
    return {
      firstWallet: "reserve",
      secondWallet: "asset",
      firstLabel: "\u5907\u7528\u94B1\u5305",
      secondLabel: "\u8D44\u4EA7\u8D26\u6237"
    };
  }
  return {
    firstWallet: "activity",
    secondWallet: "reserve",
    firstLabel: "\u6D3B\u52A8\u94B1\u5305",
    secondLabel: "\u5907\u7528\u94B1\u5305"
  };
}
function normalizeCategoryList(value, fallback) {
  const source = Array.isArray(value) ? value : [];
  const categories = source.map((item) => normalizeCategory(String(item))).filter((item) => item.length > 0);
  const unique = Array.from(new Set(categories));
  return unique.length > 0 ? unique : [...fallback];
}
function normalizeCategory(value) {
  return value.trim();
}
function addCategoryToList(categories, category) {
  const normalized = normalizeCategory(category);
  if (!normalized || categories.includes(normalized)) {
    return false;
  }
  categories.push(normalized);
  return true;
}
function getDefaultAssetCategory(categories) {
  if (categories.includes("\u5176\u4ED6\u8D44\u4EA7")) {
    return "\u5176\u4ED6\u8D44\u4EA7";
  }
  return categories[categories.length - 1] || "\u5176\u4ED6\u8D44\u4EA7";
}
function roundMoney(amount) {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}
function appendDistributionNote(note, walletLabel) {
  return `${note}${note ? "" : ""}\uFF08\u6309\u6BD4\u4F8B\u5206\u914D\uFF1A${walletLabel}\uFF09`;
}
function formatMoney(amount) {
  return amount.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}
