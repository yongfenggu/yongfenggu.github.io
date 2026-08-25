// OpenRouter API 配置
const CONFIG = {
    // openrouter api key:但是额度为0,只能调用免费模型,供 homepage 使用
    OPENROUTER_API_KEY: atob('c2stb3ItdjEtOTlkMzZjNDIwMGE4NGQyMTI0NDE1YzhmM2MzNzllY2M4NDllM2UwZTk4NGE5MzlhNGQ3NmNlNGM1OWM4ODg2ZQ=='),

    // LLM 模型配置
    MODEL: 'z-ai/glm-5.2:free',
    FALLBACK_MODELS: [
        'google/gemma-4-31b-it:free',
        'google/gemma-4-26b-a4b-it:free',
        'minimax/minimax-m3:free',
        'nvidia/nemotron-3-super-120b-a12b:free',
    ],

    // DeepSeek 兜底:当 OpenRouter 免费模型全部限流/失败时自动切换
    DEEPSEEK_API_KEY: atob('c2stZDY5OTJiMmJhYjlmNDBkNGJkM2Y1Nzc4MTU4OGVmZWQ='),
    DEEPSEEK_MODEL: 'deepseek-v4-flash' // 最便宜的模型
};
