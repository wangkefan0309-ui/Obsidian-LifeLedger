import { App, ItemView, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf } from "obsidian";

const VIEW_TYPE_LIFE_LEDGER = "life-ledger-dashboard";
const DATA_ROOT = "LifeLedger";
const BLEEDING_PROJECTS_PATH = `${DATA_ROOT}/BleedingProjects.md`;
const EXPORTS_PATH = `${DATA_ROOT}/Exports`;
const DEFAULT_NORMAL_CATEGORIES = ["饮食", "交通", "购物", "学习", "娱乐", "生活费", "创业", "其他"];
const DEFAULT_ASSET_CATEGORIES = [
  "银行卡储蓄",
  "微信零钱",
  "支付宝零钱",
  "微信余额宝",
  "基金",
  "虚拟货币",
  "其他资产"
];
const RECORD_PAGE_SIZE = 8;

type LedgerType = "income" | "expense" | "initial";
type WalletType = "activity" | "reserve" | "asset";
type SectionKey =
  | "quickEntry"
  | "dashboard"
  | "budgetWarnings"
  | "charts"
  | "bleeding"
  | "calendar"
  | "search"
  | "yearlyOverview"
  | "monthlyRecords"
  | "exportBackup"
  | "healthCheck";

const DEFAULT_SECTION_COLLAPSE_STATE: Record<SectionKey, boolean> = {
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

interface LifeLedgerSettings {
  systemStartMonth: string;
  activityWalletInitialAmount: number;
  reserveWalletInitialAmount: number;
  assetWalletInitialAmount: number;
  monthlyExpenseBudget: number;
  activityLowBalanceWarning: number;
  reserveLowBalanceWarning: number;
  monthlyBleedingWarning: number;
  normalCategories: string[];
  assetCategories: string[];
  collapsedSections: Record<string, boolean>;
}

interface LedgerRecord {
  id: string;
  date: string;
  type: LedgerType;
  wallet: WalletType;
  category: string;
  assetCategory?: string;
  amount: number;
  note: string;
}

interface AssetBreakdownItem {
  category: string;
  balance: number;
}

interface ExpenseCategoryItem {
  category: string;
  amount: number;
}

interface BleedingProject {
  id: string;
  name: string;
  amount: number;
  startDate: string;
  durationDays: number;
  note: string;
  active: boolean;
}

interface MonthSummary {
  income: number;
  expense: number;
  surplus: number;
  activityBalance: number;
  reserveBalance: number;
  assetBalance: number;
  assetBreakdown: AssetBreakdownItem[];
  expenseBreakdown: ExpenseCategoryItem[];
  bleedingProjects: BleedingProject[];
  activeBleedingProjects: BleedingProject[];
  dailyBleedingTotal: number;
  monthBleedingTotal: number;
  realMonthlyExpenseReference: number;
  records: LedgerRecord[];
}

interface DailySummary {
  date: string;
  income: number;
  expense: number;
  surplus: number;
  records: LedgerRecord[];
}

interface YearlyMonthlySummary {
  month: string;
  income: number;
  expense: number;
  surplus: number;
  recordCount: number;
}

interface YearSummary {
  year: string;
  income: number;
  expense: number;
  surplus: number;
  averageMonthlyExpense: number;
  averageMonthlyIncome: number;
  monthlySummaries: YearlyMonthlySummary[];
  expenseBreakdown: ExpenseCategoryItem[];
  topRecords: LedgerRecord[];
  records: LedgerRecord[];
}

interface RecordFilterState {
  keyword: string;
  type: LedgerType | "all";
  wallet: WalletType | "all";
  category: string;
  assetCategory: string;
  minAmount: string;
  maxAmount: string;
}

interface HealthIssue {
  filePath?: string;
  recordId?: string;
  message: string;
}

interface HealthCheckResult {
  errors: HealthIssue[];
  warnings: HealthIssue[];
  info: HealthIssue[];
  scannedFiles: number;
  ledgerRecords: number;
  bleedingProjects: number;
  reportPath: string;
}

const DEFAULT_SETTINGS: LifeLedgerSettings = {
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

export default class LifeLedgerPlugin extends Plugin {
  settings: LifeLedgerSettings = DEFAULT_SETTINGS;

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

  async loadSettings(): Promise<void> {
    const loaded = await this.loadData();
    const systemStartMonth =
      typeof loaded?.systemStartMonth === "string" && isMonthString(loaded.systemStartMonth)
        ? loaded.systemStartMonth
        : getCurrentMonthString();
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loaded,
      systemStartMonth,
      normalCategories: normalizeCategoryList(
        loaded?.normalCategories,
        DEFAULT_NORMAL_CATEGORIES
      ),
      assetCategories: normalizeCategoryList(
        loaded?.assetCategories,
        DEFAULT_ASSET_CATEGORIES
      ),
      collapsedSections: {
        ...DEFAULT_SECTION_COLLAPSE_STATE,
        ...(loaded?.collapsedSections || {})
      }
    };

    if (!loaded?.systemStartMonth) {
      await this.saveData(this.settings);
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    await this.refreshDashboardViews();
  }

  async saveSectionCollapseState(): Promise<void> {
    await this.saveData(this.settings);
  }

  async refreshDashboardViews(): Promise<void> {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_LIFE_LEDGER)) {
      const view = leaf.view;
      if (view instanceof LifeLedgerDashboardView) {
        await view.render();
      }
    }
  }

  async saveRecord(input: Omit<LedgerRecord, "id" | "date">): Promise<void> {
    await this.saveRecords([input]);
  }

  async saveRecords(inputs: Array<Omit<LedgerRecord, "id" | "date">>): Promise<void> {
    const today = getLocalDateString(new Date());
    const yearPath = this.getYearPath(today);
    const monthPath = this.getMonthPath(today);
    const dayPath = this.getNewDailyPath(today);
    const recordsToAdd: LedgerRecord[] = inputs.map((input, index) => ({
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

  async updateRecord(record: LedgerRecord): Promise<void> {
    const { file, content } = await this.findDailyFileForRecord(record);
    const records = parseLedgerRecords(content);
    const index = records.findIndex((item) => item.id === record.id);

    if (index === -1) {
      throw new Error(`未找到记录：${record.id}`);
    }

    const updatedRecord = this.prepareRecordForSave({
      ...record,
      amount: roundMoney(record.amount)
    }) as LedgerRecord;
    records[index] = updatedRecord;
    await this.learnCategories([updatedRecord]);
    await this.app.vault.modify(file, this.replaceLedgerBlock(content, record.date, records));
  }

  async deleteRecord(record: LedgerRecord): Promise<void> {
    const { file, content } = await this.findDailyFileForRecord(record);
    const records = parseLedgerRecords(content);
    const nextRecords = records.filter((item) => item.id !== record.id);

    if (nextRecords.length === records.length) {
      throw new Error(`未找到记录：${record.id}`);
    }

    await this.app.vault.modify(file, this.replaceLedgerBlock(content, record.date, nextRecords));
  }

  async saveBleedingProject(input: Omit<BleedingProject, "id" | "active">): Promise<void> {
    await this.ensureFolder(DATA_ROOT);
    const project: BleedingProject = {
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
      throw new Error(`无法读取文件：${BLEEDING_PROJECTS_PATH}`);
    }

    const content = await this.app.vault.read(file);
    const projects = parseBleedingProjects(content);
    projects.push(project);
    await this.app.vault.modify(file, this.replaceBleedingBlock(content, projects));
  }

  async updateBleedingProject(project: BleedingProject): Promise<void> {
    const { file, content } = await this.readBleedingFile();
    const projects = parseBleedingProjects(content);
    const index = projects.findIndex((item) => item.id === project.id);

    if (index === -1) {
      throw new Error(`未找到流血项目：${project.id}`);
    }

    projects[index] = {
      ...project,
      amount: roundMoney(project.amount),
      durationDays: Math.round(project.durationDays)
    };
    await this.app.vault.modify(file, this.replaceBleedingBlock(content, projects));
  }

  async deleteBleedingProject(projectId: string): Promise<void> {
    const { file, content } = await this.readBleedingFile();
    const projects = parseBleedingProjects(content);
    const nextProjects = projects.filter((project) => project.id !== projectId);

    if (nextProjects.length === projects.length) {
      throw new Error(`未找到流血项目：${projectId}`);
    }

    await this.app.vault.modify(file, this.replaceBleedingBlock(content, nextProjects));
  }

  async toggleBleedingProject(projectId: string): Promise<void> {
    const { file, content } = await this.readBleedingFile();
    const projects = parseBleedingProjects(content);
    const project = projects.find((item) => item.id === projectId);

    if (!project) {
      throw new Error(`未找到流血项目：${projectId}`);
    }

    project.active = !project.active;
    await this.app.vault.modify(file, this.replaceBleedingBlock(content, projects));
  }

  async getBleedingProjects(): Promise<BleedingProject[]> {
    const { file, content } = await this.readBleedingFile();
    if (!/```life-ledger-bleeding\s*([\s\S]*?)```/.test(content)) {
      await this.app.vault.modify(file, this.replaceBleedingBlock(content, []));
      return [];
    }

    return parseBleedingProjects(content);
  }

  async getMonthSummary(month: string): Promise<MonthSummary> {
    const monthlyRecords = await this.loadMonthRecords(month);
    const canUseCumulativeBalances = month >= this.settings.systemStartMonth;
    const cumulativeRecords = canUseCumulativeBalances
      ? await this.loadRecordsBetweenMonths(this.settings.systemStartMonth, month)
      : [];

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
    const today = getLocalDateString(new Date());

    return {
      income,
      expense,
      surplus,
      activityBalance:
        canUseCumulativeBalances
          ? this.settings.activityWalletInitialAmount + activityIncome + activityInitial - activityExpense
          : 0,
      reserveBalance:
        canUseCumulativeBalances
          ? this.settings.reserveWalletInitialAmount + reserveIncome + reserveInitial - reserveExpense
          : 0,
      assetBalance:
        canUseCumulativeBalances
          ? this.settings.assetWalletInitialAmount + assetIncome + assetInitial - assetExpense
          : 0,
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

  async generateMonthlyReview(month: string): Promise<void> {
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

    new Notice("月度复盘文件已存在，将覆盖原文件。");
    const file = this.app.vault.getFileByPath(reviewPath);
    if (!file) {
      throw new Error(`无法读取文件：${reviewPath}`);
    }

    await this.app.vault.modify(file, content);
  }

  async generateYearlyReview(year: string, viewMonth: string): Promise<void> {
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

    new Notice("年度复盘文件已存在，将覆盖原文件。");
    const file = this.app.vault.getFileByPath(reviewPath);
    if (!file) {
      throw new Error(`无法读取文件：${reviewPath}`);
    }

    await this.app.vault.modify(file, content);
  }

  async getYearSummary(year: string): Promise<YearSummary> {
    const monthlySummaries: YearlyMonthlySummary[] = [];
    const yearlyRecords: LedgerRecord[] = [];

    for (let monthIndex = 1; monthIndex <= 12; monthIndex += 1) {
      const month = `${year}-${String(monthIndex).padStart(2, "0")}`;
      const records = await this.loadMonthRecords(month);
      const income = sumRecords(records, "income");
      const expense = sumRecords(records, "expense");

      yearlyRecords.push(...records);
      monthlySummaries.push({
        month,
        income,
        expense,
        surplus: roundMoney(income - expense),
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
      topRecords: [...yearlyRecords]
        .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
        .slice(0, 10),
      records: yearlyRecords
    };
  }

  async exportMonthCsv(month: string): Promise<string> {
    const summary = await this.getMonthSummary(month);
    const path = `${EXPORTS_PATH}/${month}_LifeLedger_Records.csv`;
    await this.writeExportFile(path, formatRecordsCsv(summary.records));
    return path;
  }

  async exportYearCsv(year: string): Promise<string> {
    const yearlySummary = await this.getYearSummary(year);
    const path = `${EXPORTS_PATH}/${year}_LifeLedger_Records.csv`;
    await this.writeExportFile(path, formatRecordsCsv(yearlySummary.records));
    return path;
  }

  async exportAllRecordsJson(): Promise<string> {
    const records = await this.loadAllLedgerRecords();
    const path = `${EXPORTS_PATH}/LifeLedger_All_Records.json`;
    await this.writeExportFile(path, `${JSON.stringify(records, null, 2)}\n`);
    return path;
  }

  async exportBleedingProjectsJson(): Promise<string> {
    const projects = await this.getBleedingProjects();
    const path = `${EXPORTS_PATH}/LifeLedger_BleedingProjects.json`;
    await this.writeExportFile(path, `${JSON.stringify(projects, null, 2)}\n`);
    return path;
  }

  async runDataHealthCheck(): Promise<HealthCheckResult> {
    const result: HealthCheckResult = {
      errors: [],
      warnings: [],
      info: [],
      scannedFiles: 0,
      ledgerRecords: 0,
      bleedingProjects: 0,
      reportPath: `${EXPORTS_PATH}/LifeLedger_DataHealthReport.md`
    };
    const ledgerIds = new Map<string, HealthIssue>();
    const bleedingIds = new Map<string, HealthIssue>();

    await this.scanLedgerFiles(result, ledgerIds);
    await this.scanBleedingProjects(result, bleedingIds);

    result.info.push({ message: `检查了 ${result.scannedFiles} 个文件。` });
    result.info.push({ message: `检查了 ${result.ledgerRecords} 条普通记录。` });
    result.info.push({ message: `检查了 ${result.bleedingProjects} 个流血项目。` });
    result.info.push({
      message:
        result.errors.length === 0 && result.warnings.length === 0
          ? "数据检查通过，未发现明显问题。"
          : "数据检查完成，发现需要关注的问题。"
    });

    await this.writeExportFile(result.reportPath, formatHealthCheckReport(result));
    return result;
  }

  private async ensureFolder(path: string): Promise<void> {
    const exists = await this.app.vault.adapter.exists(path);
    if (!exists) {
      await this.app.vault.createFolder(path);
    }
  }

  private async writeExportFile(path: string, content: string): Promise<void> {
    await this.ensureFolder(DATA_ROOT);
    await this.ensureFolder(EXPORTS_PATH);

    const exists = await this.app.vault.adapter.exists(path);
    if (!exists) {
      await this.app.vault.create(path, content);
      return;
    }

    new Notice("导出文件已存在，将覆盖原文件。");
    const file = this.app.vault.getFileByPath(path);
    if (!file) {
      throw new Error(`无法读取文件：${path}`);
    }

    await this.app.vault.modify(file, content);
  }

  private async loadAllLedgerRecords(): Promise<LedgerRecord[]> {
    const records: Array<{ record: LedgerRecord; index: number }> = [];
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((file) => file.path.startsWith(`${DATA_ROOT}/`));

    for (const file of files) {
      const content = await this.app.vault.read(file);
      for (const record of parseLedgerRecords(content)) {
        records.push({ record, index: records.length });
      }
    }

    return records
      .sort((a, b) => {
        const dateCompare = a.record.date.localeCompare(b.record.date);
        return dateCompare !== 0 ? dateCompare : a.index - b.index;
      })
      .map((item) => item.record);
  }

  private async scanLedgerFiles(
    result: HealthCheckResult,
    seenIds: Map<string, HealthIssue>
  ): Promise<void> {
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((file) => isLedgerCandidateFile(file.path));

    for (const file of files) {
      result.scannedFiles += 1;
      const fileDate = getLedgerDateFromFilePath(file.path);

      if (!isStandardLedgerFileName(file.path)) {
        result.warnings.push({
          filePath: file.path,
          message: "文件命名不规范。"
        });
      }

      const content = await this.app.vault.read(file);
      const block = extractJsonCodeBlock(content, "life-ledger");
      if (block === null) {
        result.warnings.push({
          filePath: file.path,
          message: "缺少 life-ledger 代码块。"
        });
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(block.trim());
      } catch {
        result.errors.push({
          filePath: file.path,
          message: "life-ledger JSON 解析失败。"
        });
        continue;
      }

      if (!Array.isArray(parsed)) {
        result.errors.push({
          filePath: file.path,
          message: "life-ledger 代码块内容不是 JSON 数组。"
        });
        continue;
      }

      parsed.forEach((value, index) => {
        result.ledgerRecords += 1;
        this.validateLedgerRecord(value, file.path, index, fileDate, result, seenIds);
      });
    }
  }

  private validateLedgerRecord(
    value: unknown,
    filePath: string,
    index: number,
    fileDate: string | null,
    result: HealthCheckResult,
    seenIds: Map<string, HealthIssue>
  ): void {
    const record = value && typeof value === "object" ? value as Record<string, unknown> : null;
    const fallbackId = `第 ${index + 1} 条记录`;
    const recordId = typeof record?.id === "string" ? record.id : fallbackId;

    if (!record) {
      result.errors.push({ filePath, recordId, message: "记录不是有效对象。" });
      return;
    }

    if (typeof record.id !== "string" || record.id.length === 0) {
      result.errors.push({ filePath, recordId, message: "记录 id 缺失或不是字符串。" });
    } else {
      const previous = seenIds.get(record.id);
      if (previous) {
        result.errors.push({ filePath, recordId: record.id, message: "记录 id 重复。" });
      } else {
        seenIds.set(record.id, { filePath, recordId: record.id, message: "记录 id 已登记。" });
      }
    }

    if (typeof record.date !== "string" || !isDateString(record.date)) {
      result.errors.push({ filePath, recordId, message: "记录 date 缺失或格式非法。" });
    } else if (fileDate && record.date !== fileDate) {
      result.warnings.push({ filePath, recordId, message: "文件日期和记录 date 不一致。" });
    }

    if (!isLedgerType(record.type)) {
      result.errors.push({ filePath, recordId, message: "记录 type 非法。" });
    }

    const hasWallet = Object.prototype.hasOwnProperty.call(record, "wallet");
    if (!hasWallet) {
      result.warnings.push({
        filePath,
        recordId,
        message: "旧记录缺少 wallet，将按 activity 兼容处理。"
      });
    } else if (!isWalletType(record.wallet)) {
      result.errors.push({ filePath, recordId, message: "记录 wallet 非法。" });
    }

    if (typeof record.category !== "string" || record.category.trim().length === 0) {
      result.errors.push({ filePath, recordId, message: "记录 category 缺失或为空。" });
    }

    if (typeof record.amount !== "number" || !Number.isFinite(record.amount) || record.amount <= 0) {
      result.errors.push({ filePath, recordId, message: "记录 amount 非法。" });
    }

    const wallet = isWalletType(record.wallet) ? record.wallet : hasWallet ? null : "activity";
    const assetCategory =
      typeof record.assetCategory === "string" ? record.assetCategory.trim() : "";
    if (wallet === "asset" && !assetCategory) {
      result.warnings.push({
        filePath,
        recordId,
        message: "资产账户记录缺少 assetCategory，将在统计中归为其他资产。"
      });
    }

    if (wallet !== "asset" && assetCategory) {
      result.warnings.push({
        filePath,
        recordId,
        message: "非资产账户记录存在 assetCategory，建议清理。"
      });
    }
  }

  private async scanBleedingProjects(
    result: HealthCheckResult,
    seenIds: Map<string, HealthIssue>
  ): Promise<void> {
    const file = this.app.vault.getFileByPath(BLEEDING_PROJECTS_PATH);
    if (!file) {
      result.info.push({ filePath: BLEEDING_PROJECTS_PATH, message: "暂无流血项目文件。" });
      return;
    }

    result.scannedFiles += 1;
    const content = await this.app.vault.read(file);
    const block = extractJsonCodeBlock(content, "life-ledger-bleeding");
    if (block === null) {
      result.warnings.push({
        filePath: BLEEDING_PROJECTS_PATH,
        message: "缺少 life-ledger-bleeding 代码块。"
      });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(block.trim());
    } catch {
      result.errors.push({
        filePath: BLEEDING_PROJECTS_PATH,
        message: "life-ledger-bleeding JSON 解析失败。"
      });
      return;
    }

    if (!Array.isArray(parsed)) {
      result.errors.push({
        filePath: BLEEDING_PROJECTS_PATH,
        message: "life-ledger-bleeding 代码块内容不是 JSON 数组。"
      });
      return;
    }

    parsed.forEach((value, index) => {
      result.bleedingProjects += 1;
      this.validateBleedingProject(value, index, result, seenIds);
    });
  }

  private validateBleedingProject(
    value: unknown,
    index: number,
    result: HealthCheckResult,
    seenIds: Map<string, HealthIssue>
  ): void {
    const project = value && typeof value === "object" ? value as Record<string, unknown> : null;
    const fallbackId = `第 ${index + 1} 个流血项目`;
    const recordId = typeof project?.id === "string" ? project.id : fallbackId;

    if (!project) {
      result.errors.push({ filePath: BLEEDING_PROJECTS_PATH, recordId, message: "流血项目不是有效对象。" });
      return;
    }

    if (typeof project.id !== "string" || project.id.length === 0) {
      result.errors.push({ filePath: BLEEDING_PROJECTS_PATH, recordId, message: "流血项目 id 缺失或不是字符串。" });
    } else if (seenIds.has(project.id)) {
      result.errors.push({ filePath: BLEEDING_PROJECTS_PATH, recordId: project.id, message: "流血项目 id 重复。" });
    } else {
      seenIds.set(project.id, { filePath: BLEEDING_PROJECTS_PATH, recordId: project.id, message: "流血项目 id 已登记。" });
    }

    if (typeof project.name !== "string" || project.name.trim().length === 0) {
      result.errors.push({ filePath: BLEEDING_PROJECTS_PATH, recordId, message: "流血项目 name 缺失或为空。" });
    }

    if (typeof project.amount !== "number" || !Number.isFinite(project.amount) || project.amount <= 0) {
      result.errors.push({ filePath: BLEEDING_PROJECTS_PATH, recordId, message: "流血项目 amount 非法。" });
    }

    if (typeof project.startDate !== "string" || !isDateString(project.startDate)) {
      result.errors.push({ filePath: BLEEDING_PROJECTS_PATH, recordId, message: "流血项目 startDate 缺失或格式非法。" });
    }

    if (typeof project.durationDays !== "number" || !Number.isFinite(project.durationDays) || project.durationDays <= 0) {
      result.errors.push({ filePath: BLEEDING_PROJECTS_PATH, recordId, message: "流血项目 durationDays 非法。" });
    }

    if (typeof project.active !== "boolean") {
      result.errors.push({ filePath: BLEEDING_PROJECTS_PATH, recordId, message: "流血项目 active 不是 boolean。" });
    }
  }

  private async loadMonthRecords(month: string): Promise<LedgerRecord[]> {
    const markdownFiles = await this.listMonthLedgerFiles(month);
    const records: LedgerRecord[] = [];

    for (const path of markdownFiles) {
      const file = this.app.vault.getFileByPath(path);
      if (!file) continue;

      const content = await this.app.vault.read(file);
      records.push(...parseLedgerRecords(content));
    }

    return records;
  }

  private async loadRecordsBetweenMonths(
    startMonth: string,
    endMonth: string
  ): Promise<LedgerRecord[]> {
    if (endMonth < startMonth) {
      return [];
    }

    const records: LedgerRecord[] = [];
    let cursor = startMonth;

    while (cursor <= endMonth) {
      records.push(...(await this.loadMonthRecords(cursor)));
      cursor = shiftMonth(cursor, 1);
    }

    return records;
  }

  private getOldDailyPath(date: string): string {
    return `${DATA_ROOT}/${date.slice(0, 7)}/${date}.md`;
  }

  private getYearPath(date: string): string {
    return `${DATA_ROOT}/${date.slice(0, 4)}_LifeLedger`;
  }

  private getMonthPath(date: string): string {
    return `${this.getYearPath(date)}/${date.slice(0, 7)}`;
  }

  private getNewDailyPath(date: string): string {
    return `${this.getMonthPath(date)}/${date}_LL.md`;
  }

  private getMonthlyReviewPath(month: string): string {
    return `${this.getMonthPath(`${month}-01`)}/${month}_MonthlyReview_LL.md`;
  }

  private getYearlyReviewPath(year: string): string {
    return `${this.getYearPath(`${year}-01-01`)}/${year}_YearlyReview_LL.md`;
  }

  private async listMonthLedgerFiles(date: string): Promise<string[]> {
    const newMonthPath = this.getMonthPath(date);
    const oldMonthPath = `${DATA_ROOT}/${date.slice(0, 7)}`;
    const paths = new Set<string>();

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

  private async findDailyFileForRecord(record: LedgerRecord) {
    for (const path of [this.getNewDailyPath(record.date), this.getOldDailyPath(record.date)]) {
      const file = this.app.vault.getFileByPath(path);
      if (!file) continue;

      const content = await this.app.vault.read(file);
      if (parseLedgerRecords(content).some((item) => item.id === record.id)) {
        return { file, content };
      }
    }

    throw new Error(`无法定位记录文件：${record.id}`);
  }

  private async readDailyFile(path: string) {
    const file = this.app.vault.getFileByPath(path);
    if (!file) {
      throw new Error(`无法读取文件：${path}`);
    }

    return {
      file,
      content: await this.app.vault.read(file)
    };
  }

  private async readBleedingFile(): Promise<{ file: TFile; content: string }> {
    await this.ensureFolder(DATA_ROOT);
    const exists = await this.app.vault.adapter.exists(BLEEDING_PROJECTS_PATH);

    if (!exists) {
      await this.app.vault.create(BLEEDING_PROJECTS_PATH, this.formatBleedingFile([]));
    }

    const file = this.app.vault.getFileByPath(BLEEDING_PROJECTS_PATH);
    if (!file) {
      throw new Error(`无法读取文件：${BLEEDING_PROJECTS_PATH}`);
    }

    return {
      file,
      content: await this.app.vault.read(file)
    };
  }

  private prepareRecordForSave<T extends Omit<LedgerRecord, "id" | "date"> | LedgerRecord>(
    record: T
  ): T {
    const next = {
      ...record,
      category: record.category.trim(),
      amount: roundMoney(record.amount)
    };

    if (next.wallet === "asset") {
      const assetCategory = normalizeCategory(next.assetCategory || "");
      return assetCategory ? { ...next, assetCategory } : next;
    }

    const { assetCategory, ...withoutAssetCategory } = next;
    return withoutAssetCategory as T;
  }

  private async learnCategories(records: LedgerRecord[]): Promise<void> {
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

  private formatDailyFile(date: string, records: LedgerRecord[]): string {
    return `# ${date}\n\n\`\`\`life-ledger\n${JSON.stringify(records, null, 2)}\n\`\`\`\n`;
  }

  private replaceLedgerBlock(content: string, date: string, records: LedgerRecord[]): string {
    const block = `\`\`\`life-ledger\n${JSON.stringify(records, null, 2)}\n\`\`\``;
    const blockRegex = /```life-ledger\s*([\s\S]*?)```/;

    if (blockRegex.test(content)) {
      return content.replace(blockRegex, block);
    }

    const base = content.trim().length > 0 ? content.replace(/\s+$/, "") : `# ${date}`;
    return `${base}\n\n${block}\n`;
  }

  private formatBleedingFile(projects: BleedingProject[]): string {
    return `# Bleeding Projects\n\n\`\`\`life-ledger-bleeding\n${JSON.stringify(projects, null, 2)}\n\`\`\`\n`;
  }

  private replaceBleedingBlock(content: string, projects: BleedingProject[]): string {
    const block = `\`\`\`life-ledger-bleeding\n${JSON.stringify(projects, null, 2)}\n\`\`\``;
    const blockRegex = /```life-ledger-bleeding\s*([\s\S]*?)```/;

    if (blockRegex.test(content)) {
      return content.replace(blockRegex, block);
    }

    const base = content.trim().length > 0 ? content.replace(/\s+$/, "") : "# Bleeding Projects";
    return `${base}\n\n${block}\n`;
  }
}

class LifeLedgerSettingTab extends PluginSettingTab {
  plugin: LifeLedgerPlugin;

  constructor(app: App, plugin: LifeLedgerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "LifeLedger 设置" });

    new Setting(containerEl)
      .setName("系统起始月份")
      .setDesc("用于跨月累计余额，格式为 YYYY-MM。起始月份之前的钱包余额显示为 0。")
      .addText((text) => {
        text
          .setPlaceholder(getCurrentMonthString())
          .setValue(this.plugin.settings.systemStartMonth)
          .onChange(async (value) => {
            const month = value.trim();
            this.plugin.settings.systemStartMonth = isMonthString(month)
              ? month
              : getCurrentMonthString();
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "month";
      });

    new Setting(containerEl)
      .setName("活动钱包初始金额")
      .setDesc("用于计算本月活动钱包余额，默认 1500。")
      .addText((text) => {
        text
          .setPlaceholder("1500")
          .setValue(String(this.plugin.settings.activityWalletInitialAmount))
          .onChange(async (value) => {
            const amount = Number(value);
            this.plugin.settings.activityWalletInitialAmount =
              Number.isFinite(amount) ? amount : DEFAULT_SETTINGS.activityWalletInitialAmount;
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "number";
        text.inputEl.step = "0.01";
      });

    new Setting(containerEl)
      .setName("备用钱包初始金额")
      .setDesc("用于计算本月备用钱包余额，默认 0。")
      .addText((text) => {
        text
          .setPlaceholder("0")
          .setValue(String(this.plugin.settings.reserveWalletInitialAmount))
          .onChange(async (value) => {
            const amount = Number(value);
            this.plugin.settings.reserveWalletInitialAmount =
              Number.isFinite(amount) ? amount : DEFAULT_SETTINGS.reserveWalletInitialAmount;
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "number";
        text.inputEl.step = "0.01";
      });

    new Setting(containerEl)
      .setName("资产账户初始金额")
      .setDesc("用于计算本月资产账户余额，默认 0。")
      .addText((text) => {
        text
          .setPlaceholder("0")
          .setValue(String(this.plugin.settings.assetWalletInitialAmount))
          .onChange(async (value) => {
            const amount = Number(value);
            this.plugin.settings.assetWalletInitialAmount =
              Number.isFinite(amount) ? amount : DEFAULT_SETTINGS.assetWalletInitialAmount;
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "number";
        text.inputEl.step = "0.01";
      });

    new Setting(containerEl)
      .setName("月度支出预算")
      .setDesc("为 0 时不启用月度支出预算提醒。")
      .addText((text) => {
        text
          .setPlaceholder("0")
          .setValue(String(this.plugin.settings.monthlyExpenseBudget))
          .onChange(async (value) => {
            const amount = Number(value);
            this.plugin.settings.monthlyExpenseBudget =
              Number.isFinite(amount) && amount >= 0 ? amount : DEFAULT_SETTINGS.monthlyExpenseBudget;
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "number";
        text.inputEl.step = "0.01";
        text.inputEl.min = "0";
      });

    new Setting(containerEl)
      .setName("活动钱包低余额预警线")
      .setDesc("为 0 时不启用活动钱包低余额提醒。")
      .addText((text) => {
        text
          .setPlaceholder("0")
          .setValue(String(this.plugin.settings.activityLowBalanceWarning))
          .onChange(async (value) => {
            const amount = Number(value);
            this.plugin.settings.activityLowBalanceWarning =
              Number.isFinite(amount) && amount >= 0 ? amount : DEFAULT_SETTINGS.activityLowBalanceWarning;
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "number";
        text.inputEl.step = "0.01";
        text.inputEl.min = "0";
      });

    new Setting(containerEl)
      .setName("备用钱包低余额预警线")
      .setDesc("为 0 时不启用备用钱包低余额提醒。")
      .addText((text) => {
        text
          .setPlaceholder("0")
          .setValue(String(this.plugin.settings.reserveLowBalanceWarning))
          .onChange(async (value) => {
            const amount = Number(value);
            this.plugin.settings.reserveLowBalanceWarning =
              Number.isFinite(amount) && amount >= 0 ? amount : DEFAULT_SETTINGS.reserveLowBalanceWarning;
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "number";
        text.inputEl.step = "0.01";
        text.inputEl.min = "0";
      });

    new Setting(containerEl)
      .setName("月度被动流血预警线")
      .setDesc("为 0 时不启用流血预警。")
      .addText((text) => {
        text
          .setPlaceholder("0")
          .setValue(String(this.plugin.settings.monthlyBleedingWarning))
          .onChange(async (value) => {
            const amount = Number(value);
            this.plugin.settings.monthlyBleedingWarning =
              Number.isFinite(amount) && amount >= 0 ? amount : DEFAULT_SETTINGS.monthlyBleedingWarning;
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "number";
        text.inputEl.step = "0.01";
        text.inputEl.min = "0";
      });

    new Setting(containerEl)
      .setName("普通收支分类")
      .setDesc("每行一个分类，用于活动钱包和备用钱包。清空后会恢复默认分类。")
      .addTextArea((text) => {
        text
          .setPlaceholder(DEFAULT_NORMAL_CATEGORIES.join("\n"))
          .setValue(this.plugin.settings.normalCategories.join("\n"))
          .onChange(async (value) => {
            this.plugin.settings.normalCategories = normalizeCategoryList(
              value.split("\n"),
              DEFAULT_NORMAL_CATEGORIES
            );
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 8;
      });

    new Setting(containerEl)
      .setName("资产分类")
      .setDesc("每行一个分类，用于资产账户。清空后会恢复默认资产分类。")
      .addTextArea((text) => {
        text
          .setPlaceholder(DEFAULT_ASSET_CATEGORIES.join("\n"))
          .setValue(this.plugin.settings.assetCategories.join("\n"))
          .onChange(async (value) => {
            this.plugin.settings.assetCategories = normalizeCategoryList(
              value.split("\n"),
              DEFAULT_ASSET_CATEGORIES
            );
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 8;
      });
  }
}

class LifeLedgerDashboardView extends ItemView {
  private editingRecord: LedgerRecord | null = null;
  private editingBleedingProject: BleedingProject | null = null;
  private plugin: LifeLedgerPlugin;
  private viewMonth = getCurrentMonthString();
  private visibleRecordCount = RECORD_PAGE_SIZE;
  private scrollTopBeforeRecordEdit: number | null = null;
  private expandedDates = new Set<string>();
  private filterKeyword = "";
  private filterType: LedgerType | "all" = "all";
  private filterWallet: WalletType | "all" = "all";
  private filterCategory = "";
  private filterAssetCategory = "";
  private filterMinAmount = "";
  private filterMaxAmount = "";
  private filterApplied = false;
  private filteredRecords: LedgerRecord[] = [];
  private healthCheckResult: HealthCheckResult | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: LifeLedgerPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_LIFE_LEDGER;
  }

  getDisplayText(): string {
    return "LifeLedger Dashboard";
  }

  getIcon(): string {
    return "wallet-cards";
  }

  async onOpen(): Promise<void> {
    await this.render();
  }

  async render(): Promise<void> {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.addClass("life-ledger-container");
    const root = containerEl.createDiv({ cls: "life-ledger-root" });
    const view = root.createDiv({ cls: "life-ledger-view" });
    view.createEl("h1", { text: "LifeLedger 人生账本" });

    this.renderQuickEntry(view);
    this.renderMonthSwitcher(view);
    await this.renderDashboard(view);
  }

  private getRootScrollTop(): number {
    const root = this.containerEl.querySelector<HTMLElement>(".life-ledger-root");
    return root?.scrollTop ?? 0;
  }

  private async rerenderPreserveScroll(scrollTop = this.getRootScrollTop()): Promise<void> {
    const previousScrollTop = scrollTop;

    await this.render();

    requestAnimationFrame(() => {
      const newRoot = this.containerEl.querySelector<HTMLElement>(".life-ledger-root");
      if (newRoot) {
        newRoot.scrollTop = previousScrollTop;
      }
    });
  }

  private async startEditingRecord(record: LedgerRecord): Promise<void> {
    this.scrollTopBeforeRecordEdit = this.getRootScrollTop();
    this.editingRecord = { ...record };
    await this.render();
  }

  private async deleteRecordFromView(record: LedgerRecord, deleteButton: HTMLButtonElement): Promise<void> {
    deleteButton.disabled = true;

    try {
      await this.plugin.deleteRecord(record);
      if (this.editingRecord?.id === record.id) {
        this.editingRecord = null;
        this.scrollTopBeforeRecordEdit = null;
      }
      new Notice("记录已删除");
      await this.rerenderPreserveScroll();
    } catch (error) {
      console.error(error);
      new Notice("删除失败，请查看控制台");
      deleteButton.disabled = false;
    }
  }

  private isSectionCollapsed(sectionKey: SectionKey): boolean {
    return this.plugin.settings.collapsedSections[sectionKey] ?? DEFAULT_SECTION_COLLAPSE_STATE[sectionKey];
  }

  private async toggleSection(sectionKey: SectionKey): Promise<void> {
    this.plugin.settings.collapsedSections[sectionKey] = !this.isSectionCollapsed(sectionKey);
    await this.plugin.saveSectionCollapseState();
    await this.rerenderPreserveScroll();
  }

  private createCollapsibleSection(
    parent: HTMLElement,
    sectionKey: SectionKey,
    title: string,
    headingLevel: "h2" | "h3" = "h3",
    extraClass = ""
  ): { section: HTMLElement; content: HTMLElement | null; header: HTMLElement; collapsed: boolean } {
    const collapsed = this.isSectionCollapsed(sectionKey);
    const section = parent.createDiv({
      cls: `life-ledger-section life-ledger-collapsible-section ${extraClass}`.trim()
    });
    const header = section.createDiv({ cls: "life-ledger-section-header" });
    header.createEl(headingLevel, { text: title });
    const button = header.createEl("button", {
      text: `${collapsed ? "▸ 展开" : "▾ 收起"}`,
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

  private renderQuickEntry(root: HTMLElement): void {
    const { content } = this.createCollapsibleSection(root, "quickEntry", "快速记账", "h2");
    if (!content) return;

    const form = content.createDiv({ cls: "life-ledger-form" });

    const typeField = createField(form, "类型");
    const typeSelect = typeField.createEl("select");
    const expenseOption = typeSelect.createEl("option", { text: "支出" });
    expenseOption.value = "expense";
    const incomeOption = typeSelect.createEl("option", { text: "收入" });
    incomeOption.value = "income";
    const initialOption = typeSelect.createEl("option", { text: "期初余额" });
    initialOption.value = "initial";

    const walletField = createField(form, "钱包");
    const walletSelect = walletField.createEl("select");
    const activityOption = walletSelect.createEl("option", { text: "活动钱包" });
    activityOption.value = "activity";
    const reserveOption = walletSelect.createEl("option", { text: "备用钱包" });
    reserveOption.value = "reserve";
    const assetOption = walletSelect.createEl("option", { text: "资产账户" });
    assetOption.value = "asset";

    const categoryInput = createCategoryInput(form, this.plugin.settings.normalCategories);
    const assetCategoryInput = createAssetCategoryInput(form, this.plugin.settings.assetCategories);
    const amountInput = createNumberInput(form, "金额");
    const noteInput = createTextInput(form, "备注", "可为空");
    const distributionSection = form.createDiv({ cls: "life-ledger-distribution" });
    const distributionModeField = createField(distributionSection, "收入分配模式");
    const distributionModeSelect = distributionModeField.createEl("select");
    const singleWalletOption = distributionModeSelect.createEl("option", { text: "单一钱包" });
    singleWalletOption.value = "single";
    const ratioOption = distributionModeSelect.createEl("option", { text: "按比例分配" });
    ratioOption.value = "ratio";
    const distributionPairField = createField(distributionSection, "分配组合");
    const distributionPairSelect = distributionPairField.createEl("select");
    const activityReserveOption = distributionPairSelect.createEl("option", {
      text: "活动钱包 / 备用钱包"
    });
    activityReserveOption.value = "activity-reserve";
    const reserveAssetOption = distributionPairSelect.createEl("option", {
      text: "备用钱包 / 资产账户"
    });
    reserveAssetOption.value = "reserve-asset";
    const ratioFields = distributionSection.createDiv({ cls: "life-ledger-ratio-fields" });
    const firstRatio = createNumberField(ratioFields, "活动钱包比例");
    firstRatio.input.value = "60";
    const secondRatio = createNumberField(ratioFields, "备用钱包比例");
    secondRatio.input.value = "40";

    const syncDistributionVisibility = () => {
      const isIncome = typeSelect.value === "income";
      const isRatio = distributionModeSelect.value === "ratio";
      const usesAssetWallet =
        walletSelect.value === "asset" ||
        (isIncome && !this.editingRecord && isRatio && distributionPairSelect.value === "reserve-asset");
      distributionSection.toggle(isIncome && !this.editingRecord);
      distributionPairField.toggle(isIncome && !this.editingRecord && isRatio);
      ratioFields.toggle(isIncome && !this.editingRecord && isRatio);
      assetCategoryInput.field.toggle(usesAssetWallet);

      if (distributionPairSelect.value === "reserve-asset") {
        firstRatio.label.setText("备用钱包比例");
        secondRatio.label.setText("资产账户比例");
        if (firstRatio.input.value === "60" && secondRatio.input.value === "40") {
          firstRatio.input.value = "40";
          secondRatio.input.value = "60";
        }
      } else {
        firstRatio.label.setText("活动钱包比例");
        secondRatio.label.setText("备用钱包比例");
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
        text: `正在编辑：${this.editingRecord.date} ${getTypeLabel(this.editingRecord.type)} ${getWalletLabel(this.editingRecord.wallet)} ${this.editingRecord.category}`,
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
      text: this.editingRecord ? "保存修改" : "保存记录",
      cls: "mod-cta"
    });

    if (this.editingRecord) {
      const cancelButton = actions.createEl("button", { text: "取消编辑" });
      cancelButton.addEventListener("click", async () => {
        const recordEditScrollTop = this.scrollTopBeforeRecordEdit;
        this.editingRecord = null;
        this.scrollTopBeforeRecordEdit = null;
        await this.rerenderPreserveScroll(recordEditScrollTop ?? undefined);
      });
    }

    saveButton.addEventListener("click", async () => {
      const recordEditScrollTop = this.editingRecord ? this.scrollTopBeforeRecordEdit : null;
      const amount = Number(amountInput.value);
      const category = categoryInput.value.trim();
      const assetCategory = assetCategoryInput.input.value.trim();
      const note = noteInput.value.trim();
      const type = typeSelect.value as LedgerType;
      const wallet = walletSelect.value as WalletType;
      const isRatioIncome = type === "income" && distributionModeSelect.value === "ratio";
      const distributionPair = isRatioIncome
        ? getDistributionPair(distributionPairSelect.value)
        : null;
      const requiresAssetCategory =
        wallet === "asset" ||
        (distributionPair !== null &&
          (distributionPair.firstWallet === "asset" || distributionPair.secondWallet === "asset"));

      if (!Number.isFinite(amount) || amount <= 0) {
        new Notice("金额必须为正数");
        amountInput.focus();
        return;
      }

      if (!category) {
        new Notice("请填写分类");
        categoryInput.focus();
        return;
      }

      if (requiresAssetCategory && !assetCategory) {
        new Notice("请填写资产分类");
        assetCategoryInput.input.focus();
        return;
      }

      saveButton.disabled = true;

      try {
        if (this.editingRecord) {
          if (typeSelect.value === "expense" && walletSelect.value === "asset") {
            new Notice("资产账户原则上只存不取，请确认这是一次资产支出记录。");
          }

          await this.plugin.updateRecord({
            ...this.editingRecord,
            type,
            wallet,
            category,
            assetCategory: wallet === "asset" ? assetCategory : undefined,
            amount,
            note
          });
          this.editingRecord = null;
          new Notice("修改已保存");
        } else {
          if (isRatioIncome) {
            const firstRatioValue = Number(firstRatio.input.value);
            const secondRatioValue = Number(secondRatio.input.value);
            if (!distributionPair) return;

            if (
              !Number.isFinite(firstRatioValue) ||
              !Number.isFinite(secondRatioValue) ||
              firstRatioValue + secondRatioValue !== 100
            ) {
              new Notice(`${distributionPair.firstLabel}比例和${distributionPair.secondLabel}比例之和必须等于 100`);
              saveButton.disabled = false;
              return;
            }

            const totalAmount = roundMoney(amount);
            const firstAmount = roundMoney((totalAmount * firstRatioValue) / 100);
            const secondAmount = roundMoney(totalAmount - firstAmount);
            await this.plugin.saveRecords([
              {
                type: "income",
                wallet: distributionPair.firstWallet,
                category,
                assetCategory:
                  distributionPair.firstWallet === "asset"
                    ? assetCategory
                    : undefined,
                amount: firstAmount,
                note: appendDistributionNote(note, distributionPair.firstLabel)
              },
              {
                type: "income",
                wallet: distributionPair.secondWallet,
                category,
                assetCategory:
                  distributionPair.secondWallet === "asset"
                    ? assetCategory
                    : undefined,
                amount: secondAmount,
                note: appendDistributionNote(note, distributionPair.secondLabel)
              }
            ]);
          } else {
            if (type === "expense" && wallet === "asset") {
              new Notice("资产账户原则上只存不取，请确认这是一次资产支出记录。");
            }

            await this.plugin.saveRecord({
              type,
              wallet,
              category,
              assetCategory: wallet === "asset" ? assetCategory : undefined,
              amount,
              note
            });
          }
          new Notice("记录已保存");
        }

        categoryInput.value = "";
        assetCategoryInput.input.value = "";
        amountInput.value = "";
        noteInput.value = "";
        await this.rerenderPreserveScroll(recordEditScrollTop ?? undefined);
        this.scrollTopBeforeRecordEdit = null;
      } catch (error) {
        console.error(error);
        new Notice("保存失败，请查看控制台");
        saveButton.disabled = false;
      }
    });
  }

  private renderMonthSwitcher(root: HTMLElement): void {
    const section = root.createDiv({ cls: "life-ledger-month-switcher" });
    section.createEl("span", { text: `当前查看月份：${this.viewMonth}` });

    const actions = section.createDiv({ cls: "life-ledger-month-actions" });
    const prevButton = actions.createEl("button", { text: "上个月" });
    const nextButton = actions.createEl("button", { text: "下个月" });
    const currentButton = actions.createEl("button", { text: "回到本月" });
    const reviewButton = actions.createEl("button", { text: "生成月度复盘" });

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
        new Notice("月度复盘已生成。");
      } catch (error) {
        console.error(error);
        new Notice("生成月度复盘失败，请查看控制台");
      } finally {
        reviewButton.disabled = false;
      }
    });
  }

  private async renderDashboard(root: HTMLElement): Promise<void> {
    const isCurrentMonth = this.viewMonth === getCurrentMonthString();
    const dashboardTitle = isCurrentMonth ? "本月数据仪表盘" : `${this.viewMonth} 数据仪表盘`;
    const recordTitle = isCurrentMonth ? "本月记录" : `${this.viewMonth} 记录`;
    const summary = await this.plugin.getMonthSummary(this.viewMonth);

    const dashboardSection = this.createCollapsibleSection(root, "dashboard", dashboardTitle, "h2");
    if (dashboardSection.content) {
      const summaryGroups = dashboardSection.content.createDiv({ cls: "life-ledger-summary-groups" });

      const monthlyOverview = createSummaryGroup(summaryGroups, "本月收支概览", true);
      createSummaryCard(monthlyOverview, "月收入", summary.income, "income");
      createSummaryCard(monthlyOverview, "月支出", summary.expense, "expense");
      createSummaryCard(monthlyOverview, "月结余", summary.surplus, "balance");

      const walletStatus = createSummaryGroup(summaryGroups, "资金账户状态");
      createSummaryCard(walletStatus, "活动钱包余额", summary.activityBalance, "balance");
      createSummaryCard(walletStatus, "备用钱包余额", summary.reserveBalance, "balance");
      createSummaryCard(walletStatus, "资产账户余额", summary.assetBalance, "balance");

      const bleedingStatus = createSummaryGroup(
        summaryGroups,
        "流血与真实支出参考",
        false,
        "用于提示被动损耗与真实支出压力"
      );
      createSummaryCard(bleedingStatus, "今日被动流血", summary.dailyBleedingTotal, "expense");
      createSummaryCard(bleedingStatus, "月被动流血合计", summary.monthBleedingTotal, "expense");
      createSummaryCard(bleedingStatus, "月真实支出参考", summary.realMonthlyExpenseReference, "expense");
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

  private renderMonthlyRecords(
    parent: HTMLElement,
    summary: MonthSummary,
    recordTitle: string,
    isCurrentMonth: boolean
  ): void {
    this.visibleRecordCount = Math.max(
      RECORD_PAGE_SIZE,
      Math.min(this.visibleRecordCount, summary.records.length)
    );

    const monthlyRecords = this.createCollapsibleSection(parent, "monthlyRecords", recordTitle, "h3", "life-ledger-recent");
    if (!monthlyRecords.content) return;

    const recent = monthlyRecords.content;
    const recentHeader = recent.createDiv({ cls: "life-ledger-record-header" });
    recentHeader.createEl("h3", {
      text: `${recordTitle}（共 ${summary.records.length} 条，当前显示 ${Math.min(this.visibleRecordCount, summary.records.length)} 条）`
    });
    const pagination = recentHeader.createDiv({ cls: "life-ledger-record-pagination" });

    if (this.visibleRecordCount < summary.records.length) {
      const showMoreButton = pagination.createEl("button", { text: "显示更多" });
      showMoreButton.addEventListener("click", async () => {
        this.visibleRecordCount = Math.min(
          this.visibleRecordCount + RECORD_PAGE_SIZE,
          summary.records.length
        );
        await this.rerenderPreserveScroll();
      });
    }

    if (this.visibleRecordCount > RECORD_PAGE_SIZE) {
      const collapseButton = pagination.createEl("button", { text: "收起" });
      collapseButton.addEventListener("click", async () => {
        this.visibleRecordCount = RECORD_PAGE_SIZE;
        await this.rerenderPreserveScroll();
      });
    }

    if (summary.records.length === 0) {
      recent.createEl("p", {
        text: isCurrentMonth ? "本月暂无记录" : `${this.viewMonth} 暂无记录`,
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
      details.createDiv({ text: record.note || "无备注", cls: "life-ledger-record-note" });

      const actions = item.createDiv({ cls: "life-ledger-record-actions" });
      const editButton = actions.createEl("button", { text: "编辑" });
      const deleteButton = actions.createEl("button", { text: "删除", cls: "life-ledger-danger-button" });

      editButton.addEventListener("click", async () => {
        await this.startEditingRecord(record);
      });

      deleteButton.addEventListener("click", async () => {
        await this.deleteRecordFromView(record, deleteButton);
      });
    }
  }

  private renderBudgetWarnings(parent: HTMLElement, summary: MonthSummary): void {
    const { content } = this.createCollapsibleSection(parent, "budgetWarnings", "预算与提醒", "h3", "life-ledger-budget-warnings");
    if (!content) return;

    const reminders = getBudgetWarningMessages(this.plugin.settings, summary);

    if (reminders.length === 0) {
      content.createEl("p", {
        text: "暂无预警，当前财务状态正常。",
        cls: "life-ledger-empty"
      });
      return;
    }

    const list = content.createEl("ul", { cls: "life-ledger-budget-warning-list" });
    for (const reminder of reminders) {
      list.createEl("li", { text: reminder, cls: "life-ledger-budget-warning-item" });
    }
  }

  private renderCalendarView(parent: HTMLElement, summary: MonthSummary): void {
    const { content } = this.createCollapsibleSection(parent, "calendar", "日历视图", "h3", "life-ledger-calendar");
    if (!content) return;

    const dailySummaries = getDailySummaries(this.viewMonth, summary.records);
    const list = content.createEl("ul", { cls: "life-ledger-calendar-list" });

    for (const day of dailySummaries) {
      const item = list.createEl("li", { cls: "life-ledger-calendar-day" });
      const row = item.createDiv({ cls: "life-ledger-calendar-day-row" });
      const info = row.createDiv({ cls: "life-ledger-calendar-day-info" });
      info.createEl("strong", { text: day.date, cls: "life-ledger-calendar-date" });
      const metrics = info.createDiv({ cls: "life-ledger-calendar-metrics" });
      metrics.createSpan({ text: `收入：${formatMoney(day.income)}` });
      metrics.createSpan({ text: `支出：${formatMoney(day.expense)}` });
      metrics.createSpan({ text: `结余：${formatMoney(day.surplus)}` });
      metrics.createSpan({ text: `记录：${day.records.length} 条` });

      if (day.records.length > 0) {
        const isExpanded = this.expandedDates.has(day.date);
        const detailButton = row.createEl("button", { text: isExpanded ? "收起明细" : "查看明细" });
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

  private renderCalendarDetails(parent: HTMLElement, records: LedgerRecord[]): void {
    const detailList = parent.createEl("ul", { cls: "life-ledger-calendar-detail-list" });
    const sortedRecords = [...records].sort((a, b) => a.id.localeCompare(b.id));

    for (const record of sortedRecords) {
      const item = detailList.createEl("li", { cls: "life-ledger-calendar-detail-item" });
      const details = item.createDiv({ cls: "life-ledger-calendar-detail-fields" });
      details.createDiv({ text: getTypeLabel(record.type), cls: `life-ledger-record-type is-${record.type}` });
      details.createDiv({ text: getWalletLabel(record.wallet), cls: "life-ledger-record-wallet" });
      details.createDiv({ text: record.category, cls: "life-ledger-record-category" });
      details.createDiv({
        text: record.assetCategory || "无资产分类",
        cls: "life-ledger-record-category"
      });
      details.createDiv({
        text: `${record.type === "expense" ? "-" : "+"}${formatMoney(record.amount)}`,
        cls: `life-ledger-record-amount is-${record.type}`
      });
      details.createDiv({ text: record.note || "无备注", cls: "life-ledger-record-note" });

      const actions = item.createDiv({ cls: "life-ledger-record-actions" });
      const editButton = actions.createEl("button", { text: "编辑" });
      const deleteButton = actions.createEl("button", { text: "删除", cls: "life-ledger-danger-button" });

      editButton.addEventListener("click", async () => {
        await this.startEditingRecord(record);
      });

      deleteButton.addEventListener("click", async () => {
        await this.deleteRecordFromView(record, deleteButton);
      });
    }
  }

  private async renderYearlyOverview(parent: HTMLElement, monthSummary: MonthSummary): Promise<void> {
    const year = this.viewMonth.slice(0, 4);
    const collapsed = this.isSectionCollapsed("yearlyOverview");
    const section = parent.createDiv({ cls: "life-ledger-section life-ledger-collapsible-section life-ledger-yearly" });
    const header = section.createDiv({ cls: "life-ledger-yearly-header" });
    header.createEl("h3", { text: `年度概览（${year}）` });
    const actions = header.createDiv({ cls: "life-ledger-yearly-actions" });
    const reviewButton = actions.createEl("button", { text: "生成年度复盘" });
    const toggleButton = actions.createEl("button", {
      text: `${collapsed ? "▸ 展开" : "▾ 收起"}`
    });

    reviewButton.addEventListener("click", async () => {
      reviewButton.disabled = true;

      try {
        await this.plugin.generateYearlyReview(year, this.viewMonth);
        new Notice("年度复盘已生成。");
      } catch (error) {
        console.error(error);
        new Notice("生成年度复盘失败，请查看控制台");
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
    createSummaryCard(cards, "年度总收入", yearlySummary.income, "income");
    createSummaryCard(cards, "年度总支出", yearlySummary.expense, "expense");
    createSummaryCard(cards, "年度净结余", yearlySummary.surplus, "balance");
    createSummaryCard(cards, "年度月均支出", yearlySummary.averageMonthlyExpense, "expense");
    createSummaryCard(cards, "年度月均收入", yearlySummary.averageMonthlyIncome, "income");
    createSummaryCard(cards, "当前资产账户余额", monthSummary.assetBalance, "balance");

    this.renderYearlyMonthlyTrend(content, yearlySummary.monthlySummaries);
    this.renderYearlyExpenseRanking(content, yearlySummary);
    this.renderYearlyAssetComposition(content, monthSummary.assetBreakdown);
    this.renderYearlyTopRecords(content, yearlySummary.topRecords);
  }

  private renderYearlyMonthlyTrend(parent: HTMLElement, monthlySummaries: YearlyMonthlySummary[]): void {
    const section = parent.createDiv({ cls: "life-ledger-yearly-block" });
    section.createEl("h4", { text: "每月趋势" });
    const list = section.createEl("ul", { cls: "life-ledger-yearly-month-list" });

    for (const item of monthlySummaries) {
      const row = list.createEl("li", {
        cls: item.month === this.viewMonth
          ? "life-ledger-yearly-month-item is-current"
          : "life-ledger-yearly-month-item"
      });
      row.createSpan({ text: item.month });
      row.createSpan({ text: `收入 ${formatMoney(item.income)}` });
      row.createSpan({ text: `支出 ${formatMoney(item.expense)}` });
      row.createSpan({ text: `结余 ${formatMoney(item.surplus)}` });
      row.createSpan({ text: `记录 ${item.recordCount} 条` });
    }
  }

  private renderYearlyExpenseRanking(parent: HTMLElement, yearlySummary: YearSummary): void {
    const section = parent.createDiv({ cls: "life-ledger-yearly-block" });
    section.createEl("h4", { text: "年度支出分类排行" });

    if (yearlySummary.expenseBreakdown.length === 0 || yearlySummary.expense <= 0) {
      section.createEl("p", { text: "暂无年度支出分类数据。", cls: "life-ledger-empty" });
      return;
    }

    const list = section.createEl("ul", { cls: "life-ledger-yearly-ranking-list" });
    for (const item of yearlySummary.expenseBreakdown) {
      const row = list.createEl("li", { cls: "life-ledger-yearly-ranking-item" });
      row.createSpan({ text: item.category });
      row.createSpan({
        text: `${formatMoney(item.amount)} 元，占比 ${formatPercent(item.amount, yearlySummary.expense)}`
      });
    }
  }

  private renderYearlyAssetComposition(parent: HTMLElement, assetBreakdown: AssetBreakdownItem[]): void {
    const section = parent.createDiv({ cls: "life-ledger-yearly-block" });
    section.createEl("h4", { text: "年度资产构成" });

    const positiveAssets = assetBreakdown.filter((item) => item.balance > 0);
    const total = positiveAssets.reduce((sum, item) => sum + item.balance, 0);

    if (positiveAssets.length === 0 || total <= 0) {
      section.createEl("p", { text: "暂无资产账户数据。", cls: "life-ledger-empty" });
      return;
    }

    const list = section.createEl("ul", { cls: "life-ledger-yearly-ranking-list" });
    for (const item of positiveAssets) {
      const row = list.createEl("li", { cls: "life-ledger-yearly-ranking-item" });
      row.createSpan({ text: item.category });
      row.createSpan({
        text: `${formatMoney(item.balance)} 元，占比 ${formatPercent(item.balance, total)}`
      });
    }
  }

  private renderYearlyTopRecords(parent: HTMLElement, topRecords: LedgerRecord[]): void {
    const section = parent.createDiv({ cls: "life-ledger-yearly-block" });
    section.createEl("h4", { text: "年度最大流水" });

    if (topRecords.length === 0) {
      section.createEl("p", { text: "暂无年度流水记录。", cls: "life-ledger-empty" });
      return;
    }

    const list = section.createEl("ul", { cls: "life-ledger-yearly-record-list" });
    for (const record of topRecords) {
      const item = list.createEl("li", { cls: "life-ledger-yearly-record-item" });
      item.createDiv({ text: record.date, cls: "life-ledger-record-date" });
      item.createDiv({ text: getTypeLabel(record.type), cls: `life-ledger-record-type is-${record.type}` });
      item.createDiv({ text: getWalletLabel(record.wallet), cls: "life-ledger-record-wallet" });
      item.createDiv({ text: record.category, cls: "life-ledger-record-category" });
      item.createDiv({ text: record.assetCategory || "无资产分类", cls: "life-ledger-record-category" });
      item.createDiv({
        text: `${record.type === "expense" ? "-" : "+"}${formatMoney(record.amount)}`,
        cls: `life-ledger-record-amount is-${record.type}`
      });
      item.createDiv({ text: record.note || "无备注", cls: "life-ledger-record-note" });
    }
  }

  private renderRecordFilters(parent: HTMLElement, summary: MonthSummary): void {
    const { content } = this.createCollapsibleSection(parent, "search", "记录搜索与筛选", "h3", "life-ledger-filters");
    if (!content) return;

    const form = content.createDiv({ cls: "life-ledger-filter-form" });
    const keywordInput = createTextInput(form, "关键词", "分类、备注、钱包、类型");
    keywordInput.value = this.filterKeyword;

    const typeField = createField(form, "类型");
    const typeSelect = typeField.createEl("select");
    addSelectOption(typeSelect, "all", "全部");
    addSelectOption(typeSelect, "income", "收入");
    addSelectOption(typeSelect, "expense", "支出");
    addSelectOption(typeSelect, "initial", "期初余额");
    typeSelect.value = this.filterType;

    const walletField = createField(form, "钱包");
    const walletSelect = walletField.createEl("select");
    addSelectOption(walletSelect, "all", "全部");
    addSelectOption(walletSelect, "activity", "活动钱包");
    addSelectOption(walletSelect, "reserve", "备用钱包");
    addSelectOption(walletSelect, "asset", "资产账户");
    walletSelect.value = this.filterWallet;

    const categoryInput = createDatalistInput(
      form,
      "分类",
      this.plugin.settings.normalCategories,
      "life-ledger-filter-category-list"
    );
    categoryInput.value = this.filterCategory;

    const assetCategoryInput = createDatalistInput(
      form,
      "资产分类",
      this.plugin.settings.assetCategories,
      "life-ledger-filter-asset-category-list"
    );
    assetCategoryInput.value = this.filterAssetCategory;

    const minAmountInput = createNumberInput(form, "最小金额");
    minAmountInput.value = this.filterMinAmount;
    const maxAmountInput = createNumberInput(form, "最大金额");
    maxAmountInput.value = this.filterMaxAmount;

    const actions = content.createDiv({ cls: "life-ledger-filter-actions" });
    const applyButton = actions.createEl("button", { text: "应用筛选", cls: "mod-cta" });
    const clearButton = actions.createEl("button", { text: "清空筛选" });

    applyButton.addEventListener("click", async () => {
      this.filterKeyword = keywordInput.value.trim();
      this.filterType = typeSelect.value as LedgerType | "all";
      this.filterWallet = walletSelect.value as WalletType | "all";
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

  private renderFilterResults(parent: HTMLElement, records: LedgerRecord[]): void {
    const resultSection = parent.createDiv({ cls: "life-ledger-filter-results" });

    if (!this.filterApplied) {
      resultSection.createEl("h4", { text: "筛选结果" });
      resultSection.createEl("p", { text: "尚未应用筛选。", cls: "life-ledger-empty" });
      return;
    }

    this.filteredRecords = filterRecords(records, this.getRecordFilterState());
    resultSection.createEl("h4", { text: `筛选结果（共 ${this.filteredRecords.length} 条）` });

    if (this.filteredRecords.length === 0) {
      resultSection.createEl("p", { text: "没有符合条件的记录。", cls: "life-ledger-empty" });
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
        text: record.assetCategory || "无资产分类",
        cls: "life-ledger-record-category"
      });
      details.createDiv({
        text: `${record.type === "expense" ? "-" : "+"}${formatMoney(record.amount)}`,
        cls: `life-ledger-record-amount is-${record.type}`
      });
      details.createDiv({ text: record.note || "无备注", cls: "life-ledger-record-note" });

      const actions = item.createDiv({ cls: "life-ledger-record-actions" });
      const editButton = actions.createEl("button", { text: "编辑" });
      const deleteButton = actions.createEl("button", { text: "删除", cls: "life-ledger-danger-button" });

      editButton.addEventListener("click", async () => {
        await this.startEditingRecord(record);
      });

      deleteButton.addEventListener("click", async () => {
        await this.deleteRecordFromView(record, deleteButton);
      });
    }
  }

  private getRecordFilterState(): RecordFilterState {
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

  private clearRecordFilters(): void {
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

  private renderAssetBreakdown(parent: HTMLElement, assetBreakdown: AssetBreakdownItem[]): void {
    const section = parent.createDiv({ cls: "life-ledger-asset-breakdown" });
    section.createEl("h3", { text: "资产构成" });

    if (assetBreakdown.length === 0) {
      section.createEl("p", {
        text: "暂无资产账户记录",
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

  private renderChartsOverview(parent: HTMLElement, summary: MonthSummary): void {
    const { content } = this.createCollapsibleSection(parent, "charts", "图表概览", "h3", "life-ledger-charts");
    if (!content) return;

    const grid = content.createDiv({ cls: "life-ledger-chart-grid" });

    this.renderIncomeExpenseChart(grid, summary);
    this.renderExpenseCategoryChart(grid, summary.expenseBreakdown);
    this.renderAssetCompositionChart(grid, summary.assetBreakdown);
  }

  private renderIncomeExpenseChart(parent: HTMLElement, summary: MonthSummary): void {
    const card = parent.createDiv({ cls: "life-ledger-chart-card" });
    card.createEl("h4", { text: "月度收入 / 支出" });

    if (summary.income === 0 && summary.expense === 0) {
      card.createEl("p", { text: "暂无收入支出数据", cls: "life-ledger-empty" });
      return;
    }

    const maxAmount = Math.max(summary.income, summary.expense);
    const bars = card.createDiv({ cls: "life-ledger-bar-chart" });
    createVerticalBar(bars, "月收入", summary.income, maxAmount, "income");
    createVerticalBar(bars, "月支出", summary.expense, maxAmount, "expense");
  }

  private renderExpenseCategoryChart(parent: HTMLElement, expenseBreakdown: ExpenseCategoryItem[]): void {
    const card = parent.createDiv({ cls: "life-ledger-chart-card" });
    card.createEl("h4", { text: "支出分类占比" });

    if (expenseBreakdown.length === 0) {
      card.createEl("p", { text: "暂无支出分类数据", cls: "life-ledger-empty" });
      return;
    }

    const total = expenseBreakdown.reduce((sum, item) => sum + item.amount, 0);
    for (const item of expenseBreakdown) {
      createHorizontalBar(card, item.category, item.amount, total, "expense");
    }
  }

  private renderAssetCompositionChart(parent: HTMLElement, assetBreakdown: AssetBreakdownItem[]): void {
    const card = parent.createDiv({ cls: "life-ledger-chart-card" });
    card.createEl("h4", { text: "资产构成占比" });

    if (assetBreakdown.length === 0) {
      card.createEl("p", { text: "暂无资产构成数据", cls: "life-ledger-empty" });
      return;
    }

    const positiveAssets = assetBreakdown.filter((item) => item.balance > 0);
    const total = positiveAssets.reduce((sum, item) => sum + item.balance, 0);

    if (total <= 0) {
      card.createEl("p", { text: "暂无资产构成数据", cls: "life-ledger-empty" });
      return;
    }

    for (const item of positiveAssets) {
      createHorizontalBar(card, item.category, item.balance, total, "asset");
    }
  }

  private renderBleedingSection(parent: HTMLElement, summary: MonthSummary): void {
    const { content } = this.createCollapsibleSection(parent, "bleeding", "流血项目", "h3", "life-ledger-bleeding-projects");
    if (!content) return;

    const metrics = content.createDiv({ cls: "life-ledger-bleeding-metrics" });
    metrics.createDiv({ text: `今日被动流血：${formatMoney(summary.dailyBleedingTotal)} 元 / 天` });
    metrics.createDiv({ text: `当前查看月份被动流血合计：${formatMoney(summary.monthBleedingTotal)} 元` });
    metrics.createDiv({ text: `月真实支出参考：${formatMoney(summary.realMonthlyExpenseReference)} 元` });

    content.createEl("h4", { text: "正在流血项目列表" });

    if (summary.bleedingProjects.length === 0) {
      content.createEl("p", {
        text: "暂无流血项目",
        cls: "life-ledger-empty"
      });
    } else {
      const list = content.createEl("ul", { cls: "life-ledger-bleeding-list" });

      for (const project of summary.bleedingProjects) {
        const row = list.createEl("li", { cls: "life-ledger-bleeding-item" });
        const info = row.createDiv({ cls: "life-ledger-bleeding-info" });
        info.createDiv({
          text: `${project.name} · ${project.active ? "启用" : "停用"}`,
          cls: "life-ledger-bleeding-main"
        });
        info.createDiv({
          text: `总金额 ${formatMoney(project.amount)} · ${project.startDate} · ${project.durationDays} 天 · 每日 ${formatMoney(getBleedingDailyCost(project))}`,
          cls: "life-ledger-bleeding-meta"
        });
        if (project.note) {
          info.createDiv({ text: project.note, cls: "life-ledger-bleeding-meta" });
        }

        const actions = row.createDiv({ cls: "life-ledger-bleeding-actions" });
        const editButton = actions.createEl("button", { text: "编辑" });
        const toggleButton = actions.createEl("button", { text: project.active ? "停用" : "启用" });
        const deleteButton = actions.createEl("button", { text: "删除", cls: "life-ledger-danger-button" });

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
            new Notice("切换流血项目状态失败，请查看控制台");
          }
        });

        deleteButton.addEventListener("click", async () => {
          try {
            await this.plugin.deleteBleedingProject(project.id);
            if (this.editingBleedingProject?.id === project.id) {
              this.editingBleedingProject = null;
            }
            await this.rerenderPreserveScroll();
          } catch (error) {
            console.error(error);
            new Notice("删除流血项目失败，请查看控制台");
          }
        });
      }
    }

    this.renderBleedingProjectForm(content);
  }

  private renderBleedingProjectForm(parent: HTMLElement): void {
    parent.createEl("h4", { text: this.editingBleedingProject ? "编辑流血项目" : "新增流血项目" });
    const form = parent.createDiv({ cls: "life-ledger-form" });
    const nameInput = createTextInput(form, "项目名称", "手机、电脑、课程");
    const amountInput = createNumberInput(form, "总金额");
    const startDateField = createField(form, "开始日期");
    const startDateInput = startDateField.createEl("input");
    startDateInput.type = "date";
    const durationInput = createNumberInput(form, "使用周期天数");
    durationInput.placeholder = "1095";
    durationInput.step = "1";
    const noteInput = createTextInput(form, "备注", "预计使用三年");

    if (this.editingBleedingProject) {
      nameInput.value = this.editingBleedingProject.name;
      amountInput.value = String(this.editingBleedingProject.amount);
      startDateInput.value = this.editingBleedingProject.startDate;
      durationInput.value = String(this.editingBleedingProject.durationDays);
      noteInput.value = this.editingBleedingProject.note;
    } else {
      startDateInput.value = getLocalDateString(new Date());
    }

    const actions = form.createDiv({ cls: "life-ledger-actions" });
    const saveButton = actions.createEl("button", {
      text: this.editingBleedingProject ? "保存修改" : "保存流血项目",
      cls: "mod-cta"
    });

    if (this.editingBleedingProject) {
      const cancelButton = actions.createEl("button", { text: "取消编辑" });
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
        new Notice("请填写流血项目名称");
        nameInput.focus();
        return;
      }

      if (!Number.isFinite(amount) || amount <= 0) {
        new Notice("流血项目金额必须大于 0");
        amountInput.focus();
        return;
      }

      if (!isDateString(startDate)) {
        new Notice("开始日期必须是 YYYY-MM-DD 格式");
        startDateInput.focus();
        return;
      }

      if (!Number.isFinite(durationDays) || durationDays <= 0) {
        new Notice("使用周期天数必须大于 0");
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
          new Notice("流血项目修改已保存");
        } else {
          await this.plugin.saveBleedingProject({
            name,
            amount,
            startDate,
            durationDays: Math.round(durationDays),
            note
          });
          new Notice("流血项目已保存");
        }
        await this.rerenderPreserveScroll();
      } catch (error) {
        console.error(error);
        new Notice("保存流血项目失败，请查看控制台");
      }
    });
  }

  private renderExportSection(parent: HTMLElement): void {
    const { content } = this.createCollapsibleSection(parent, "exportBackup", "数据导出与备份", "h3", "life-ledger-export");
    if (!content) return;

    const actions = content.createDiv({ cls: "life-ledger-export-actions" });

    const monthCsvButton = actions.createEl("button", { text: "导出当前月份 CSV" });
    const yearCsvButton = actions.createEl("button", { text: "导出当前年份 CSV" });
    const allJsonButton = actions.createEl("button", { text: "导出全部账本 JSON" });
    const bleedingJsonButton = actions.createEl("button", { text: "导出流血项目 JSON" });

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

  private async runExport(button: HTMLButtonElement, exporter: () => Promise<string>): Promise<void> {
    button.disabled = true;

    try {
      const path = await exporter();
      new Notice(`导出成功：${path}`);
    } catch (error) {
      console.error(error);
      new Notice("导出失败，请查看控制台");
    } finally {
      button.disabled = false;
    }
  }

  private renderHealthCheckSection(parent: HTMLElement): void {
    const { content } = this.createCollapsibleSection(parent, "healthCheck", "数据健康检查", "h3", "life-ledger-health");
    if (!content) return;

    const actions = content.createDiv({ cls: "life-ledger-health-actions" });
    const checkButton = actions.createEl("button", { text: "检查数据完整性", cls: "mod-cta" });

    checkButton.addEventListener("click", async () => {
      checkButton.disabled = true;

      try {
        this.healthCheckResult = await this.plugin.runDataHealthCheck();
        new Notice(`数据健康检查报告已生成：${this.healthCheckResult.reportPath}`);
        await this.rerenderPreserveScroll();
      } catch (error) {
        console.error(error);
        new Notice("数据健康检查失败，请查看控制台");
        checkButton.disabled = false;
      }
    });

    if (!this.healthCheckResult) {
      content.createEl("p", { text: "尚未执行数据健康检查。", cls: "life-ledger-empty" });
      return;
    }

    this.renderHealthCheckResult(content, this.healthCheckResult);
  }

  private renderHealthCheckResult(parent: HTMLElement, result: HealthCheckResult): void {
    parent.createEl("h4", { text: "数据健康检查结果：" });
    const summary = parent.createEl("ul", { cls: "life-ledger-health-summary" });
    summary.createEl("li", { text: `错误：${result.errors.length} 个` });
    summary.createEl("li", { text: `警告：${result.warnings.length} 个` });
    summary.createEl("li", { text: `普通记录：${result.ledgerRecords} 条` });
    summary.createEl("li", { text: `流血项目：${result.bleedingProjects} 个` });
    summary.createEl("li", { text: `扫描文件：${result.scannedFiles} 个` });

    if (result.errors.length === 0 && result.warnings.length === 0) {
      parent.createEl("p", {
        text: "数据检查通过，未发现明显问题。",
        cls: "life-ledger-empty"
      });
    }

    this.renderHealthIssueList(parent, "严重错误", result.errors, "无严重错误。");
    this.renderHealthIssueList(parent, "警告", result.warnings, "无警告。");
    this.renderHealthIssueList(parent, "信息", result.info, "暂无信息。");
  }

  private renderHealthIssueList(
    parent: HTMLElement,
    title: string,
    issues: HealthIssue[],
    emptyText: string
  ): void {
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
}

function createField(parent: HTMLElement, label: string): HTMLElement {
  const field = parent.createDiv({ cls: "life-ledger-field" });
  field.createEl("label", { text: label });
  return field;
}

function createNumberField(
  parent: HTMLElement,
  labelText: string
): { input: HTMLInputElement; label: HTMLElement } {
  const field = parent.createDiv({ cls: "life-ledger-field" });
  const label = field.createEl("label", { text: labelText });
  const input = field.createEl("input");
  input.type = "number";
  input.placeholder = "0.00";
  input.min = "0";
  input.step = "0.01";
  return { input, label };
}

function createTextInput(parent: HTMLElement, label: string, placeholder: string): HTMLInputElement {
  const field = createField(parent, label);
  const input = field.createEl("input");
  input.type = "text";
  input.placeholder = placeholder;
  return input;
}

function createCategoryInput(parent: HTMLElement, categories: string[]): HTMLInputElement {
  const field = createField(parent, "分类");
  const listId = "life-ledger-category-list";
  const input = field.createEl("input");
  const datalist = field.createEl("datalist");

  input.type = "text";
  input.placeholder = categories.join("、");
  input.setAttr("list", listId);
  datalist.id = listId;

  for (const category of categories) {
    const option = datalist.createEl("option");
    option.value = category;
  }

  return input;
}

function createAssetCategoryInput(
  parent: HTMLElement,
  categories: string[]
): { field: HTMLElement; input: HTMLInputElement } {
  const field = createField(parent, "资产分类");
  const listId = "life-ledger-asset-category-list";
  const input = field.createEl("input");
  const datalist = field.createEl("datalist");

  input.type = "text";
  input.placeholder = categories.join("、");
  input.setAttr("list", listId);
  datalist.id = listId;

  for (const category of categories) {
    const option = datalist.createEl("option");
    option.value = category;
  }

  return { field, input };
}

function createDatalistInput(
  parent: HTMLElement,
  label: string,
  categories: string[],
  listId: string
): HTMLInputElement {
  const field = createField(parent, label);
  const input = field.createEl("input");
  const datalist = field.createEl("datalist");

  input.type = "text";
  input.placeholder = categories.join("、");
  input.setAttr("list", listId);
  datalist.id = listId;

  for (const category of categories) {
    const option = datalist.createEl("option");
    option.value = category;
  }

  return input;
}

function createNumberInput(parent: HTMLElement, label: string): HTMLInputElement {
  const field = createField(parent, label);
  const input = field.createEl("input");
  input.type = "number";
  input.placeholder = "0.00";
  input.min = "0";
  input.step = "0.01";
  return input;
}

function addSelectOption(select: HTMLSelectElement, value: string, text: string): void {
  const option = select.createEl("option", { text });
  option.value = value;
}

function createSummaryCard(
  parent: HTMLElement,
  label: string,
  amount: number,
  tone: "income" | "expense" | "balance"
): void {
  const card = parent.createDiv({ cls: `life-ledger-card is-${tone}` });
  card.createEl("span", { text: label, cls: "life-ledger-card-label" });
  card.createEl("strong", { text: formatMoney(amount), cls: "life-ledger-card-value" });
}

function createSummaryGroup(
  parent: HTMLElement,
  title: string,
  isPrimary = false,
  description?: string
): HTMLElement {
  const group = parent.createDiv({
    cls: isPrimary
      ? "life-ledger-summary-group is-primary"
      : "life-ledger-summary-group"
  });
  const header = group.createDiv({ cls: "life-ledger-summary-group-header" });
  header.createEl("h3", { text: title });

  if (description) {
    header.createEl("p", { text: description });
  }

  return group.createDiv({ cls: "life-ledger-summary" });
}

function formatMonthlyReview(
  month: string,
  summary: MonthSummary,
  settings: LifeLedgerSettings
): string {
  const lines: string[] = [];

  lines.push(`# ${month} 财务复盘`);
  lines.push("");
  lines.push("## 一、月度概览");
  lines.push("");
  lines.push(`- 月收入：${formatMoney(summary.income)} 元`);
  lines.push(`- 月支出：${formatMoney(summary.expense)} 元`);
  lines.push(`- 月结余：${formatMoney(summary.surplus)} 元`);
  lines.push(`- 活动钱包余额：${formatMoney(summary.activityBalance)} 元`);
  lines.push(`- 备用钱包余额：${formatMoney(summary.reserveBalance)} 元`);
  lines.push(`- 资产账户余额：${formatMoney(summary.assetBalance)} 元`);
  lines.push(`- 月真实支出参考：${formatMoney(summary.realMonthlyExpenseReference)} 元`);
  lines.push("");
  lines.push("## 二、支出结构");
  lines.push("");

  if (summary.expenseBreakdown.length === 0 || summary.expense <= 0) {
    lines.push("本月暂无支出记录。");
  } else {
    for (const item of summary.expenseBreakdown) {
      lines.push(`- ${item.category}：${formatMoney(item.amount)} 元，占比 ${formatPercent(item.amount, summary.expense)}`);
    }
  }

  lines.push("");
  lines.push("## 三、资产构成");
  lines.push("");

  const positiveAssets = summary.assetBreakdown.filter((item) => item.balance > 0);
  const assetTotal = positiveAssets.reduce((sum, item) => sum + item.balance, 0);
  if (positiveAssets.length === 0 || assetTotal <= 0) {
    lines.push("暂无资产账户记录。");
  } else {
    for (const item of positiveAssets) {
      lines.push(`- ${item.category}：${formatMoney(item.balance)} 元，占比 ${formatPercent(item.balance, assetTotal)}`);
    }
  }

  lines.push("");
  lines.push("## 四、流血项目");
  lines.push("");
  lines.push(`- 今日被动流血：${formatMoney(summary.dailyBleedingTotal)} 元 / 天`);
  lines.push(`- 当前查看月份被动流血合计：${formatMoney(summary.monthBleedingTotal)} 元`);
  lines.push(`- 月真实支出参考：${formatMoney(summary.realMonthlyExpenseReference)} 元`);
  lines.push("");

  const activeBleedingProjects = summary.bleedingProjects.filter((project) => project.active);
  if (activeBleedingProjects.length === 0) {
    lines.push("暂无启用中的流血项目。");
  } else {
    for (const project of activeBleedingProjects) {
      lines.push(
        `- ${project.name}：每日流血 ${formatMoney(getBleedingDailyCost(project))} 元 / 天，开始日期 ${project.startDate}，预计持续 ${project.durationDays} 天`
      );
    }
  }

  lines.push("");
  lines.push("## 五、预算与提醒");
  lines.push("");

  const reminders = getBudgetWarningMessages(settings, summary);
  if (reminders.length === 0) {
    lines.push("暂无预警，当前财务状态正常。");
  } else {
    for (const reminder of reminders) {
      lines.push(`- ${reminder}`);
    }
  }

  lines.push("");
  lines.push("## 六、本月主要流水");
  lines.push("");

  if (summary.records.length === 0) {
    lines.push("本月暂无流水记录。");
  } else {
    const topRecords = [...summary.records]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10);
    for (const record of topRecords) {
      lines.push(formatReviewRecord(record));
    }
  }

  lines.push("");
  lines.push("## 七、个人复盘");
  lines.push("");
  lines.push("### 1. 本月钱主要花在哪里？");
  lines.push("");
  lines.push("### 2. 哪些消费是值得的？");
  lines.push("");
  lines.push("### 3. 哪些消费下个月可以减少？");
  lines.push("");
  lines.push("### 4. 本月资产变化是否符合预期？");
  lines.push("");
  lines.push("### 5. 下个月财务策略");
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function formatRecordsCsv(records: LedgerRecord[]): string {
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

function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function formatHealthCheckReport(result: HealthCheckResult): string {
  const lines: string[] = [];

  lines.push("# LifeLedger 数据健康检查报告");
  lines.push("");
  lines.push(`生成时间：${getLocalDateTimeString(new Date())}`);
  lines.push("");
  lines.push("## 一、检查摘要");
  lines.push("");
  lines.push(`- 扫描文件数：${result.scannedFiles}`);
  lines.push(`- 普通记录数：${result.ledgerRecords}`);
  lines.push(`- 流血项目数：${result.bleedingProjects}`);
  lines.push(`- 错误数：${result.errors.length}`);
  lines.push(`- 警告数：${result.warnings.length}`);
  lines.push("");
  lines.push("## 二、严重错误");
  lines.push("");

  if (result.errors.length === 0) {
    lines.push("无严重错误。");
  } else {
    for (const issue of result.errors) {
      lines.push(`- ${formatHealthIssue(issue)}`);
    }
  }

  lines.push("");
  lines.push("## 三、警告");
  lines.push("");

  if (result.warnings.length === 0) {
    lines.push("无警告。");
  } else {
    for (const issue of result.warnings) {
      lines.push(`- ${formatHealthIssue(issue)}`);
    }
  }

  lines.push("");
  lines.push("## 四、信息");
  lines.push("");

  for (const issue of result.info) {
    lines.push(`- ${formatHealthIssue(issue)}`);
  }

  return `${lines.join("\n")}\n`;
}

function formatHealthIssue(issue: HealthIssue): string {
  const parts = [];
  if (issue.filePath) {
    parts.push(issue.filePath);
  }
  if (issue.recordId) {
    parts.push(`id: ${issue.recordId}`);
  }

  return parts.length > 0 ? `${parts.join("｜")}｜${issue.message}` : issue.message;
}

function formatYearlyReview(
  year: string,
  yearlySummary: YearSummary,
  monthSummary: MonthSummary,
  settings: LifeLedgerSettings
): string {
  const lines: string[] = [];

  lines.push(`# ${year} 年度财务复盘`);
  lines.push("");
  lines.push("## 一、年度概览");
  lines.push("");
  lines.push(`- 年度总收入：${formatMoney(yearlySummary.income)} 元`);
  lines.push(`- 年度总支出：${formatMoney(yearlySummary.expense)} 元`);
  lines.push(`- 年度净结余：${formatMoney(yearlySummary.surplus)} 元`);
  lines.push(`- 年度月均收入：${formatMoney(yearlySummary.averageMonthlyIncome)} 元`);
  lines.push(`- 年度月均支出：${formatMoney(yearlySummary.averageMonthlyExpense)} 元`);
  lines.push(`- 截至当前查看月份的活动钱包余额：${formatMoney(monthSummary.activityBalance)} 元`);
  lines.push(`- 截至当前查看月份的备用钱包余额：${formatMoney(monthSummary.reserveBalance)} 元`);
  lines.push(`- 截至当前查看月份的资产账户余额：${formatMoney(monthSummary.assetBalance)} 元`);
  lines.push("");
  lines.push("## 二、月度趋势");
  lines.push("");

  for (const item of yearlySummary.monthlySummaries) {
    lines.push(
      `- ${item.month}：收入 ${formatMoney(item.income)} 元，支出 ${formatMoney(item.expense)} 元，结余 ${formatMoney(item.surplus)} 元，记录 ${item.recordCount} 条`
    );
  }

  lines.push("");
  lines.push("## 三、年度支出分类排行");
  lines.push("");

  if (yearlySummary.expenseBreakdown.length === 0 || yearlySummary.expense <= 0) {
    lines.push("本年度暂无支出记录。");
  } else {
    for (const item of yearlySummary.expenseBreakdown) {
      lines.push(`- ${item.category}：金额 ${formatMoney(item.amount)} 元，占年度支出 ${formatPercent(item.amount, yearlySummary.expense)}`);
    }
  }

  lines.push("");
  lines.push("## 四、年度资产构成");
  lines.push("");

  const positiveAssets = monthSummary.assetBreakdown.filter((item) => item.balance > 0);
  const assetTotal = positiveAssets.reduce((sum, item) => sum + item.balance, 0);
  if (positiveAssets.length === 0 || assetTotal <= 0) {
    lines.push("暂无资产账户数据。");
  } else {
    for (const item of positiveAssets) {
      lines.push(`- ${item.category}：金额 ${formatMoney(item.balance)} 元，占比 ${formatPercent(item.balance, assetTotal)}`);
    }
  }

  lines.push("");
  lines.push("## 五、年度最大流水");
  lines.push("");

  if (yearlySummary.topRecords.length === 0) {
    lines.push("本年度暂无流水记录。");
  } else {
    for (const record of yearlySummary.topRecords) {
      lines.push(formatYearlyReviewRecord(record));
    }
  }

  lines.push("");
  lines.push("## 六、年度流血项目总结");
  lines.push("");

  const activeBleedingProjects = monthSummary.bleedingProjects.filter((project) => project.active);
  if (activeBleedingProjects.length === 0) {
    lines.push("暂无启用中的流血项目。");
  } else {
    for (const project of activeBleedingProjects) {
      lines.push(
        `- ${project.name}：总金额 ${formatMoney(project.amount)} 元，每日流血 ${formatMoney(getBleedingDailyCost(project))} 元 / 天，开始日期 ${project.startDate}，预计持续 ${project.durationDays} 天`
      );
    }
  }

  lines.push("");
  lines.push(`- 当前查看月份被动流血合计：${formatMoney(monthSummary.monthBleedingTotal)} 元`);
  lines.push(`- 月真实支出参考：${formatMoney(monthSummary.realMonthlyExpenseReference)} 元`);
  lines.push("");
  lines.push("## 七、年度预算与风险提醒");
  lines.push("");

  const reminders = getBudgetWarningMessages(settings, monthSummary);
  if (reminders.length === 0) {
    lines.push("暂无明显预警。");
  } else {
    for (const reminder of reminders) {
      lines.push(`- ${reminder}`);
    }
  }

  lines.push("");
  lines.push("## 八、个人年度复盘");
  lines.push("");
  lines.push("### 1. 今年钱主要流向了哪里？");
  lines.push("");
  lines.push("### 2. 哪些支出真正提升了生活质量或个人成长？");
  lines.push("");
  lines.push("### 3. 哪些支出属于可以减少的消耗？");
  lines.push("");
  lines.push("### 4. 今年资产变化是否符合预期？");
  lines.push("");
  lines.push("### 5. 今年最值得复盘的一笔大额支出是什么？");
  lines.push("");
  lines.push("### 6. 明年的财务策略是什么？");
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function getBudgetWarningMessages(settings: LifeLedgerSettings, summary: MonthSummary): string[] {
  const reminders: string[] = [];

  if (settings.monthlyExpenseBudget > 0) {
    const usageRate = (summary.expense / settings.monthlyExpenseBudget) * 100;
    if (usageRate >= 100) {
      reminders.push("本月支出已超过预算。");
    } else if (usageRate >= 80) {
      reminders.push("本月支出已超过预算的 80%。");
    } else {
      reminders.push("本月支出仍在预算范围内。");
    }
  }

  if (
    settings.activityLowBalanceWarning > 0 &&
    summary.activityBalance <= settings.activityLowBalanceWarning
  ) {
    reminders.push("活动钱包余额已低于预警线。");
  }

  if (
    settings.reserveLowBalanceWarning > 0 &&
    summary.reserveBalance <= settings.reserveLowBalanceWarning
  ) {
    reminders.push("备用钱包余额已低于预警线。");
  }

  if (
    settings.monthlyBleedingWarning > 0 &&
    summary.monthBleedingTotal >= settings.monthlyBleedingWarning
  ) {
    reminders.push("当前月份被动流血已超过预警线。");
  }

  if (summary.records.some((record) => record.wallet === "asset" && record.type === "expense")) {
    reminders.push("本月存在资产账户支出，请确认是否属于必要资产调整。");
  }

  return reminders;
}

function formatReviewRecord(record: LedgerRecord): string {
  const sign = record.type === "expense" ? "-" : "+";
  const category =
    record.wallet === "asset" && record.assetCategory
      ? `${record.category} / ${record.assetCategory}`
      : record.category;
  const note = record.note || "无备注";
  return `- ${record.date}｜${getTypeLabel(record.type)}｜${getWalletLabel(record.wallet)}｜${category}｜${sign}${formatMoney(record.amount)} 元｜${note}`;
}

function formatYearlyReviewRecord(record: LedgerRecord): string {
  const sign = record.type === "expense" ? "-" : "+";
  const assetCategory = record.assetCategory || "";
  const note = record.note || "无备注";
  return `- ${record.date}｜${getTypeLabel(record.type)}｜${getWalletLabel(record.wallet)}｜${record.category}｜${assetCategory}｜${sign}${formatMoney(record.amount)} 元｜${note}`;
}

function formatPercent(amount: number, total: number): string {
  return `${(total > 0 ? (amount / total) * 100 : 0).toFixed(1)}%`;
}

function createVerticalBar(
  parent: HTMLElement,
  label: string,
  amount: number,
  maxAmount: number,
  tone: "income" | "expense"
): void {
  const item = parent.createDiv({ cls: "life-ledger-vertical-bar-item" });
  const track = item.createDiv({ cls: "life-ledger-vertical-bar-track" });
  const bar = track.createDiv({ cls: `life-ledger-vertical-bar is-${tone}` });
  bar.style.height = `${maxAmount > 0 ? Math.max(4, (amount / maxAmount) * 100) : 0}%`;
  item.createDiv({ text: label, cls: "life-ledger-chart-label" });
  item.createDiv({ text: formatMoney(amount), cls: "life-ledger-chart-value" });
}

function createHorizontalBar(
  parent: HTMLElement,
  label: string,
  amount: number,
  total: number,
  tone: "expense" | "asset"
): void {
  const percent = total > 0 ? (amount / total) * 100 : 0;
  const row = parent.createDiv({ cls: "life-ledger-horizontal-bar-row" });
  const meta = row.createDiv({ cls: "life-ledger-horizontal-bar-meta" });
  meta.createSpan({ text: label });
  meta.createSpan({ text: `${formatMoney(amount)} · ${percent.toFixed(1)}%` });
  const track = row.createDiv({ cls: "life-ledger-horizontal-bar-track" });
  const fill = track.createDiv({ cls: `life-ledger-horizontal-bar-fill is-${tone}` });
  fill.style.width = `${Math.max(2, percent)}%`;
}

function parseLedgerRecords(content: string): LedgerRecord[] {
  const match = content.match(/```life-ledger\s*([\s\S]*?)```/);
  if (!match) return [];

  try {
    const parsed = JSON.parse(match[1].trim());
    if (!Array.isArray(parsed)) return [];

    return parsed.map(normalizeLedgerRecord).filter((record): record is LedgerRecord => record !== null);
  } catch {
    return [];
  }
}

function extractJsonCodeBlock(content: string, language: string): string | null {
  const escapedLanguage = language.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(new RegExp(`\`\`\`${escapedLanguage}\\s*([\\s\\S]*?)\`\`\``));
  return match ? match[1] : null;
}

function parseBleedingProjects(content: string): BleedingProject[] {
  const match = content.match(/```life-ledger-bleeding\s*([\s\S]*?)```/);
  if (!match) return [];

  try {
    const parsed = JSON.parse(match[1].trim());
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map(normalizeBleedingProject)
      .filter((project): project is BleedingProject => project !== null);
  } catch {
    return [];
  }
}

function normalizeLedgerRecord(value: unknown): LedgerRecord | null {
  if (!value || typeof value !== "object") return null;

  const record = value as Partial<LedgerRecord>;
  const wallet = isWalletType(record.wallet) ? record.wallet : "activity";
  const isValid =
    typeof record.id === "string" &&
    typeof record.date === "string" &&
    isLedgerType(record.type) &&
    typeof record.category === "string" &&
    typeof record.amount === "number" &&
    Number.isFinite(record.amount) &&
    typeof record.note === "string";

  if (!isValid) {
    return null;
  }

  return {
    id: record.id,
    date: record.date,
    type: record.type,
    wallet,
    category: record.category,
    assetCategory:
      wallet === "asset" && record.assetCategory
        ? normalizeCategory(record.assetCategory)
        : undefined,
    amount: record.amount,
    note: record.note
  };
}

function normalizeBleedingProject(value: unknown): BleedingProject | null {
  if (!value || typeof value !== "object") return null;

  const project = value as Partial<BleedingProject>;
  const isValid =
    typeof project.id === "string" &&
    typeof project.name === "string" &&
    typeof project.amount === "number" &&
    Number.isFinite(project.amount) &&
    typeof project.startDate === "string" &&
    typeof project.durationDays === "number" &&
    Number.isFinite(project.durationDays);

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

function createRecordId(sequence = 0): string {
  const now = new Date();
  const pad = (value: number, length = 2) => String(value).padStart(length, "0");

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

function getLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getLocalDateTimeString(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${getLocalDateString(date)} ${hours}:${minutes}`;
}

function getCurrentMonthString(): string {
  return getLocalDateString(new Date()).slice(0, 7);
}

function shiftMonth(month: string, offset: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(year, monthNumber - 1 + offset, 1);
  return getLocalDateString(date).slice(0, 7);
}

function isMonthString(value: string): boolean {
  return /^\d{4}-\d{2}$/.test(value);
}

function isDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function getTypeLabel(type: LedgerType): string {
  if (type === "income") return "收入";
  if (type === "initial") return "期初余额";
  return "支出";
}

function getWalletLabel(wallet: WalletType): string {
  if (wallet === "reserve") return "备用钱包";
  if (wallet === "asset") return "资产账户";
  return "活动钱包";
}

function getWalletDisplay(record: LedgerRecord): string {
  if (record.wallet !== "asset") {
    return getWalletLabel(record.wallet);
  }

  return `${getWalletLabel(record.wallet)} / ${record.assetCategory || getDefaultAssetCategory(DEFAULT_ASSET_CATEGORIES)}`;
}

function sumRecords(records: LedgerRecord[], type: LedgerType, wallet?: WalletType): number {
  return records
    .filter((record) => record.type === type && (!wallet || record.wallet === wallet))
    .reduce((sum, record) => sum + record.amount, 0);
}

function getAssetBreakdown(records: LedgerRecord[]): AssetBreakdownItem[] {
  const balances = new Map<string, number>();

  for (const record of records) {
    if (record.wallet !== "asset") continue;

    const category = record.assetCategory || getDefaultAssetCategory(DEFAULT_ASSET_CATEGORIES);
    const signedAmount = record.type === "expense" ? -record.amount : record.amount;
    balances.set(category, roundMoney((balances.get(category) || 0) + signedAmount));
  }

  return Array.from(balances.entries())
    .map(([category, balance]) => ({ category, balance }))
    .filter((item) => item.balance !== 0)
    .sort((a, b) => b.balance - a.balance);
}

function getExpenseBreakdown(records: LedgerRecord[]): ExpenseCategoryItem[] {
  const totals = new Map<string, number>();

  for (const record of records) {
    if (record.type !== "expense") continue;

    totals.set(record.category, roundMoney((totals.get(record.category) || 0) + record.amount));
  }

  return Array.from(totals.entries())
    .map(([category, amount]) => ({ category, amount }))
    .filter((item) => item.amount > 0)
    .sort((a, b) => b.amount - a.amount);
}

function getDailySummaries(month: string, records: LedgerRecord[]): DailySummary[] {
  const recordsByDate = new Map<string, LedgerRecord[]>();

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

function getDatesInMonth(month: string): string[] {
  const dates: string[] = [];
  const firstDate = `${month}-01`;
  const lastDate = getMonthEndDate(month);
  const totalDays = daysBetween(firstDate, lastDate) + 1;

  for (let index = 0; index < totalDays; index += 1) {
    dates.push(addDays(firstDate, index));
  }

  return dates;
}

function filterRecords(records: LedgerRecord[], filters: RecordFilterState): LedgerRecord[] {
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

function parseOptionalAmount(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const amount = Number(trimmed);
  return Number.isFinite(amount) ? Math.abs(amount) : null;
}

function isLedgerCandidateFile(path: string): boolean {
  if (!path.startsWith(`${DATA_ROOT}/`)) return false;
  if (path.startsWith(`${EXPORTS_PATH}/`)) return false;
  if (path === BLEEDING_PROJECTS_PATH) return false;
  if (!path.endsWith(".md")) return false;
  if (path.includes("_MonthlyReview_") || path.includes("_YearlyReview_")) return false;

  return (
    /^LifeLedger\/\d{4}_LifeLedger\/\d{4}-\d{2}\/[^/]+\.md$/.test(path) ||
    /^LifeLedger\/\d{4}-\d{2}\/[^/]+\.md$/.test(path)
  );
}

function isStandardLedgerFileName(path: string): boolean {
  const fileName = path.split("/").pop() || "";
  return /^\d{4}-\d{2}-\d{2}_LL\.md$/.test(fileName) || /^\d{4}-\d{2}-\d{2}\.md$/.test(fileName);
}

function getLedgerDateFromFilePath(path: string): string | null {
  const fileName = path.split("/").pop() || "";
  const match = fileName.match(/^(\d{4}-\d{2}-\d{2})(?:_LL)?\.md$/);
  return match ? match[1] : null;
}

function getActiveBleedingProjects(projects: BleedingProject[], date: string): BleedingProject[] {
  return projects.filter((project) => isBleedingProjectActiveOnDate(project, date));
}

function getBleedingTotalForDate(projects: BleedingProject[], date: string): number {
  return roundMoney(
    projects
      .filter((project) => isBleedingProjectActiveOnDate(project, date))
      .reduce((sum, project) => sum + getBleedingDailyCost(project), 0)
  );
}

function getBleedingTotalForMonth(projects: BleedingProject[], month: string): number {
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

function isBleedingProjectActiveOnDate(project: BleedingProject, date: string): boolean {
  return project.active && project.startDate <= date && getBleedingEndDate(project) >= date;
}

function getBleedingDailyCost(project: BleedingProject): number {
  return roundMoney(project.amount / project.durationDays);
}

function getBleedingEndDate(project: BleedingProject): string {
  return addDays(project.startDate, project.durationDays - 1);
}

function getMonthEndDate(month: string): string {
  return addDays(shiftMonth(month, 1) + "-01", -1);
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(year, month - 1, day + days);
  return getLocalDateString(next);
}

function daysBetween(startDate: string, endDate: string): number {
  const [startYear, startMonth, startDay] = startDate.split("-").map(Number);
  const [endYear, endMonth, endDay] = endDate.split("-").map(Number);
  const start = new Date(startYear, startMonth - 1, startDay).getTime();
  const end = new Date(endYear, endMonth - 1, endDay).getTime();
  return Math.round((end - start) / 86400000);
}

function maxDateString(first: string, second: string): string {
  return first > second ? first : second;
}

function minDateString(first: string, second: string): string {
  return first < second ? first : second;
}

function isWalletType(wallet: unknown): wallet is WalletType {
  return wallet === "activity" || wallet === "reserve" || wallet === "asset";
}

function isLedgerType(type: unknown): type is LedgerType {
  return type === "income" || type === "expense" || type === "initial";
}

function getDistributionPair(value: string): {
  firstWallet: WalletType;
  secondWallet: WalletType;
  firstLabel: string;
  secondLabel: string;
} {
  if (value === "reserve-asset") {
    return {
      firstWallet: "reserve",
      secondWallet: "asset",
      firstLabel: "备用钱包",
      secondLabel: "资产账户"
    };
  }

  return {
    firstWallet: "activity",
    secondWallet: "reserve",
    firstLabel: "活动钱包",
    secondLabel: "备用钱包"
  };
}

function normalizeCategoryList(value: unknown, fallback: string[]): string[] {
  const source = Array.isArray(value) ? value : [];
  const categories = source
    .map((item) => normalizeCategory(String(item)))
    .filter((item) => item.length > 0);
  const unique = Array.from(new Set(categories));
  return unique.length > 0 ? unique : [...fallback];
}

function normalizeCategory(value: string): string {
  return value.trim();
}

function addCategoryToList(categories: string[], category: string): boolean {
  const normalized = normalizeCategory(category);
  if (!normalized || categories.includes(normalized)) {
    return false;
  }

  categories.push(normalized);
  return true;
}

function getDefaultAssetCategory(categories: string[]): string {
  if (categories.includes("其他资产")) {
    return "其他资产";
  }

  return categories[categories.length - 1] || "其他资产";
}

function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function appendDistributionNote(note: string, walletLabel: string): string {
  return `${note}${note ? "" : ""}（按比例分配：${walletLabel}）`;
}

function formatMoney(amount: number): string {
  return amount.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}
