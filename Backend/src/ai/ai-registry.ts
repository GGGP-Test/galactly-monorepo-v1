// Pluggable AI providers. FREE uses transformers.js locally.
// PRO can call paid APIs (kept off until upgrade).

export type Embedder = (texts: string[]) => Promise<number[][]>;
export type Reranker = (query: string, docs: string[]) => Promise<number[]>; // relevance scores 0..1

export interface AIRegistry {
  embed: Embedder;
  rerank?: Reranker;
  mode: "FREE" | "PRO";
}

const loadTransformers = async () => {
  // Lazy import to keep cold starts OK
  const { pipeline } = await import("@xenova/transformers"); // add to deps
  return { pipeline };
};

async function makeFree(): Promise<AIRegistry> {
  const { pipeline } = await loadTransformers();

  const embedPipe = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  const rerankPipe = await pipeline("text-classification", "Xenova/baai-bge-reranker-base", { quantized: true });

  const embed: Embedder = async (texts) => {
    const out: number[][] = [];
    for (const t of texts) {
      const res: any = await embedPipe(t, { pooling: "mean", normalize: true });
      out.push(Array.from(res.data));
    }
    return out;
  };

  const rerank: Reranker = async (query, docs) => {
    const scores: number[] = [];
    for (const d of docs) {
      const res: any = await rerankPipe({ text: query, text_pair: d });
      // convert logits to 0..1
      const s = 1 / (1 + Math.exp(-res[0].score));
      scores.push(s);
    }
    return scores;
  };

  return { embed, rerank, mode: "FREE" };
}

async function makePro(): Promise<AIRegistry> {
  // Placeholders for PRO (OpenAI/Vertex/etc.). Keep off until upgrade.
  // You’ll just switch by env flag without changing callers.
  const embed: Embedder = async (texts) => {
    throw new Error("PRO embedder not enabled");
  };
  return { embed, mode: "PRO" };
}

export async function getAIRegistry(): Promise<AIRegistry> {
  return process.env.PRO_AI === "1" ? makePro() : makeFree();
}
