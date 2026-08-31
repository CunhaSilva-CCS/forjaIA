import type {
  ADR,
  ApiContract,
  ArchitectPlan,
  ArchitectSeniorReview,
  DataModel,
  NonFunctionalRequirement,
  PlanDependency,
  TestScenario
} from '../types/agent';

export const EMPTY_ARCHITECT_PLAN: ArchitectPlan = {
  files: [],
  adrs: [],
  apiContracts: [],
  dataModels: [],
  dependencies: [],
  nonFunctional: [],
  testScenarios: []
};

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Normaliza plano vindo do backend/WebSocket (retrocompatível com só files/adrs). */
export function normalizeArchitectPlan(raw: unknown, fallback?: { adrs?: ADR[]; files?: ArchitectPlan['files'] }): ArchitectPlan {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const files = asArray<ArchitectPlan['files'][number]>(src.files);
  const fromFallbackFiles = fallback?.files || [];
  return {
    files: files.length ? files : fromFallbackFiles,
    adrs: asArray<ADR>(src.adrs).length ? asArray<ADR>(src.adrs) : fallback?.adrs || [],
    apiContracts: asArray<ApiContract>(src.apiContracts),
    dataModels: asArray<DataModel>(src.dataModels),
    dependencies: asArray<PlanDependency>(src.dependencies),
    nonFunctional: asArray<NonFunctionalRequirement>(src.nonFunctional),
    testScenarios: asArray<TestScenario>(src.testScenarios),
    seniorReview:
      src.seniorReview && typeof src.seniorReview === 'object'
        ? (src.seniorReview as ArchitectSeniorReview)
        : undefined
  };
}

export function buildPlanPatch(input: {
  adrs: ADR[];
  files: Array<{ name: string; path: string; content?: string; purpose?: string }>;
  apiContracts: ApiContract[];
  dataModels: DataModel[];
  dependencies: PlanDependency[];
  nonFunctional: NonFunctionalRequirement[];
  testScenarios: TestScenario[];
  seniorReview?: ArchitectSeniorReview;
}): ArchitectPlan {
  return normalizeArchitectPlan({
    adrs: input.adrs,
    files: input.files.map((f) => ({
      name: f.name,
      path: f.path,
      ...(f.purpose ? { purpose: f.purpose } : {})
    })),
    apiContracts: input.apiContracts,
    dataModels: input.dataModels,
    dependencies: input.dependencies,
    nonFunctional: input.nonFunctional,
    testScenarios: input.testScenarios,
    seniorReview: input.seniorReview
  });
}

export function planHasArchitectureDetails(plan: ArchitectPlan): boolean {
  return (
    plan.apiContracts.length > 0 ||
    plan.dataModels.length > 0 ||
    plan.dependencies.length > 0 ||
    plan.nonFunctional.length > 0 ||
    plan.testScenarios.length > 0 ||
    Boolean(plan.seniorReview?.summary)
  );
}
