const { z } = require('zod');

const runConfigSchema = z.object({
  useOllama: z.boolean().optional().default(false),
  llmProvider: z.enum(['gemini', 'claude', 'openai', 'ollama', 'cursor']).optional(),
  ollamaModel: z.string().min(1).optional(),
  geminiModel: z.string().min(1).optional(),
  claudeModel: z.string().min(1).optional(),
  anthropicModel: z.string().min(1).optional(),
  openaiModel: z.string().min(1).optional(),
  cursorModel: z.string().min(1).optional(),
  openaiBaseUrl: z.string().url().optional(),
  anthropicBaseUrl: z.string().url().optional(),
  projectId: z.string().optional().nullable(),
  targetPath: z.string().min(1).optional(),
  styleRules: z.array(z.string()).optional(),
  mode: z.enum(['forge', 'validate']).optional(),
  sourcePath: z.string().min(1).optional(),
  pendingNextStage: z.string().optional(),
  healingAttempts: z.number().int().nonnegative().optional(),
  environment: z.enum(['local', 'staging']).optional()
});

const runRequestSchema = z.object({
  prompt: z.string().trim().min(1, 'O prompt não pode ficar vazio'),
  config: runConfigSchema.optional().default({})
});

const validateRequestSchema = z.object({
  sourcePath: z.string().trim().min(1, 'sourcePath é obrigatório'),
  config: runConfigSchema.optional().default({})
});

const approveRequestSchema = z.object({
  config: runConfigSchema.optional().default({}),
  planPatch: z
    .object({
      files: z
        .array(
          z.object({
            name: z.string(),
            path: z.string()
          })
        )
        .optional(),
      adrs: z
        .array(
          z.object({
            id: z.string(),
            title: z.string(),
            status: z.string().optional(),
            context: z.string().optional(),
            decision: z.string().optional(),
            consequences: z.string().optional()
          })
        )
        .optional(),
      apiContracts: z.array(z.record(z.unknown())).optional(),
      dataModels: z.array(z.record(z.unknown())).optional(),
      dependencies: z.array(z.record(z.unknown())).optional(),
      nonFunctional: z.union([z.array(z.record(z.unknown())), z.record(z.unknown())]).optional()
    })
    .optional()
});

const userReportSchema = z.object({
  message: z.string().trim().min(1, 'Descreva o erro visto na tela')
});

const preferencesSchema = z.object({
  styleRules: z.array(z.string()).default([]),
  feedbacks: z.array(z.any()).default([])
});

const projectSchema = z.object({
  name: z.string().trim().min(1),
  path: z.string().trim().min(1)
});

const browseSchema = z.object({
  path: z.string().optional().default('.')
});

function parseOrThrow(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const message = result.error.issues.map((i) => i.message).join('; ');
    const err = new Error(message);
    err.status = 400;
    throw err;
  }
  return result.data;
}

module.exports = {
  runRequestSchema,
  approveRequestSchema,
  userReportSchema,
  validateRequestSchema,
  preferencesSchema,
  projectSchema,
  browseSchema,
  parseOrThrow
};
