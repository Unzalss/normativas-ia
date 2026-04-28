import { SupabaseClient } from "@supabase/supabase-js";

export interface EstimateCostParams {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface EstimateCostResult {
  inputCost: number;
  outputCost: number;
  totalCost: number;
  currency: "USD";
  unknownModel?: boolean;
}

// Precios por cada 1.000.000 de tokens en USD
const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "gpt-4.1-mini": { input: 0.15, output: 0.60 },
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
  "text-embedding-3-small": { input: 0.02, output: 0.00 },
};

export function estimateOpenAICost({ model, inputTokens, outputTokens }: EstimateCostParams): EstimateCostResult {
  const prices = MODEL_PRICES[model];
  
  if (!prices) {
    return {
      inputCost: 0,
      outputCost: 0,
      totalCost: 0,
      currency: "USD",
      unknownModel: true
    };
  }

  const inputCost = (inputTokens / 1_000_000) * prices.input;
  const outputCost = (outputTokens / 1_000_000) * prices.output;
  const totalCost = inputCost + outputCost;

  return {
    inputCost: Number(inputCost.toFixed(6)),
    outputCost: Number(outputCost.toFixed(6)),
    totalCost: Number(totalCost.toFixed(6)),
    currency: "USD"
  };
}

export interface LogAIUsageParams {
  supabase: SupabaseClient;
  userId: string | null;
  normaId?: number | null;
  requestId: string;
  operationType: string;
  provider?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  route?: string;
  success?: boolean;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

export async function logAIUsage(params: LogAIUsageParams) {
  try {
    const costEstimate = estimateOpenAICost({
      model: params.model,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens
    });

    const totalTokens = params.inputTokens + params.outputTokens;
    let finalMetadata = params.metadata || {};

    // Inyectar un aviso si el modelo no está en nuestra tabla de precios
    if (costEstimate.unknownModel) {
      finalMetadata = { ...finalMetadata, warning: `Unknown pricing for model: ${params.model}` };
    }

    const { data, error } = await params.supabase
      .from("ai_usage_logs")
      .insert({
        user_id: params.userId,
        norma_id: params.normaId || null,
        request_id: params.requestId,
        operation_type: params.operationType,
        provider: params.provider || "openai",
        model: params.model,
        input_tokens: params.inputTokens,
        output_tokens: params.outputTokens,
        total_tokens: totalTokens,
        estimated_input_cost: costEstimate.inputCost,
        estimated_output_cost: costEstimate.outputCost,
        estimated_total_cost: costEstimate.totalCost,
        currency: costEstimate.currency,
        route: params.route || null,
        success: params.success !== undefined ? params.success : true,
        error_message: params.errorMessage || null,
        metadata: finalMetadata
      })
      .select()
      .single();

    if (error) {
      console.warn("[ai-cost-logger] Error insertando log de uso AI en base de datos:", error);
      return null;
    }

    return data;
  } catch (err) {
    console.warn("[ai-cost-logger] Excepción fatal insertando log de uso AI:", err);
    return null;
  }
}
