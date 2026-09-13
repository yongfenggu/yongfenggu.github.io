// OpenRouter API 配置
// 注意：原 key 已因泄露作废删除（2026-09）。恢复 Chat 功能时在此重新填入新 key。
const CONFIG = {
    OPENROUTER_API_KEY: '',

    // LLM 模型配置
    MODEL: 'z-ai/glm-5.2:free',
    FALLBACK_MODELS: [
        'google/gemma-4-31b-it:free',
        'google/gemma-4-26b-a4b-it:free',
        'minimax/minimax-m3:free',
        'nvidia/nemotron-3-super-120b-a12b:free',
    ],

    // DeepSeek 兜底:当 OpenRouter 免费模型全部限流/失败时自动切换
    DEEPSEEK_API_KEY: '',
    DEEPSEEK_MODEL: 'deepseek-v4-flash' // 最便宜的模型
};
