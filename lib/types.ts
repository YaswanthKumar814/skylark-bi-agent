// Shared domain + agent types. Kept in one file to stay compact.

export type DealStatus = "open" | "won" | "dead" | "on_hold" | "unknown";
export type ProbabilityBand = "high" | "medium" | "low" | "unknown";

export type Deal = {
  mondayItemId: string;
  dealName: string | null;
  ownerCode: string | null;
  clientCode: string | null;
  status: DealStatus;
  statusRaw: string | null;
  actualCloseDate: string | null;
  closureProbability: ProbabilityBand;
  probabilityWeight: number | null;
  maskedDealValueInr: number | null;
  tentativeCloseDate: string | null;
  stageRaw: string | null;
  stageNormalized: string;
  productDeal: string | null;
  sectorRaw: string | null;
  sectorNormalized: string;
  createdDate: string | null;
  qualityIssues: string[];
};

export type ExecutionStatus =
  | "completed"
  | "ongoing"
  | "executed_until_current_month"
  | "not_started"
  | "paused_or_stuck"
  | "partially_completed"
  | "details_pending"
  | "unknown";

export type WorkOrder = {
  mondayItemId: string;
  serialNumber: string;
  dealNameMasked: string | null;
  customerCode: string | null;
  natureOfWork: string | null;
  executionStatus: ExecutionStatus;
  executionStatusRaw: string | null;
  dataDeliveryDate: string | null;
  poDate: string | null;
  documentType: string | null;
  probableStartDate: string | null;
  probableEndDate: string | null;
  ownerCode: string | null;
  sectorRaw: string | null;
  sectorNormalized: string;
  typeOfWork: string | null;
  platformDeliverable: string;
  amountExclGstInr: number | null;
  amountInclGstInr: number | null;
  billedExclGstInr: number | null;
  billedInclGstInr: number | null;
  collectedInclGstInr: number | null;
  amountToBillExclGstInr: number | null;
  receivableInr: number | null;
  arPriority: boolean;
  invoiceStatus: string | null;
  woBillingStatus: "open" | "closed" | "unknown";
  billingStatus: string | null;
  lastInvoiceDate: string | null;
  qualityIssues: string[];
};

export type DataQualityReport = {
  board: string;
  totalRecords: number;
  validRecords: number;
  excludedRecords: { id: string; reason: string }[];
  missingFields: Record<string, number>;
  warnings: string[];
};

export type MetricCard = {
  label: string;
  value: string;
  hint?: string;
};

export type ResultTable = {
  title: string;
  columns: string[];
  rows: (string | number)[][];
};

export type BusinessIntent =
  | "pipeline_summary"
  | "sector_analysis"
  | "work_order_operations"
  | "revenue_summary"
  | "risk_summary"
  | "leadership_update"
  | "data_quality_summary"
  | "unsupported";

export type ParsedQuery = {
  intent: BusinessIntent;
  boards: ("deals" | "work_orders")[];
  filters: { sector?: string | null; ownerCode?: string | null; status?: string | null };
  needsClarification: boolean;
  clarificationQuestion?: string | null;
};

export type AnalyticsResult = {
  intent: BusinessIntent;
  summary: string;
  metrics: MetricCard[];
  insights: string[];
  caveats: string[];
  recommendedActions: string[];
  tables: ResultTable[];
  dataSources: string[];
  facts: Record<string, unknown>;
};

export type ChatResponse = {
  answer: string;
  intent: BusinessIntent;
  keyMetrics: MetricCard[];
  insights: string[];
  caveats: string[];
  recommendedActions: string[];
  tables: ResultTable[];
  dataSources: string[];
  dataQuality: DataQualityReport[];
  lastSyncedAt: string;
  degraded?: string | null;
};

export type BusinessData = {
  fetchedAt: string;
  deals: Deal[];
  workOrders: WorkOrder[];
  quality: DataQualityReport[];
};
