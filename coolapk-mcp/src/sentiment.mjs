/**
 * 本地中文情感分析（可选模块）
 *
 * 依赖 @huggingface/transformers（optionalDependency）
 * 未安装时 graceful fallback，不影响核心功能。
 *
 * 安装：npm run install-sentiment
 * 模型：distilbert-base-multilingual-cased-sentiments-student (~100MB)
 * 速度：2ms/条 (M4 Max)
 */

let pipeline, env;
let available = false;

try {
  ({ pipeline, env } = await import('@huggingface/transformers'));
  available = true;
} catch {
  // @huggingface/transformers 未安装，情感分析不可用
}

if (available) {
  const { existsSync } = await import('fs');
  const localModels = new URL('../models', import.meta.url).pathname;
  if (existsSync(localModels)) {
    env.cacheDir = localModels;
  }
}

let classifier = null;
let loadPromise = null;

export function isAvailable() { return available; }
export function isReady() { return !!classifier; }

export async function init() {
  if (!available) throw new Error('情感分析未安装。运行 npm run install-sentiment 安装依赖。');
  if (classifier) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    console.log('🧠 加载情感分析模型...');
    const t = Date.now();
    classifier = await pipeline('sentiment-analysis',
      'Xenova/distilbert-base-multilingual-cased-sentiments-student',
      { dtype: 'q8' }
    );
    console.log(`✅ 模型就绪 (${((Date.now()-t)/1000).toFixed(1)}s) · 2ms/条`);
  })();
  return loadPromise;
}

export async function analyze(text) {
  await init();
  if (!text || text.length < 4) return { label: 'neutral', score: 0.5 };
  const r = await classifier(text.substring(0, 256));
  return { label: r[0].label, score: r[0].score };
}

export async function analyzeBatch(texts) {
  await init();
  const results = [];
  for (const text of texts) {
    if (!text || text.length < 4) { results.push({ label: 'neutral', score: 0.5 }); continue; }
    const r = await classifier(text.substring(0, 256));
    results.push({ label: r[0].label, score: r[0].score });
  }
  return results;
}
