// OpenRouter API 配置
const CONFIG = {
    // openrouter api key:但是额度为0,只能调用免费模型,供 homepage 使用
    OPENROUTER_API_KEY: atob('c2stb3ItdjEtOTlkMzZjNDIwMGE4NGQyMTI0NDE1YzhmM2MzNzllY2M4NDllM2UwZTk4NGE5MzlhNGQ3NmNlNGM1OWM4ODg2ZQ=='),

    // LLM 模型配置
    MODEL: 'google/gemma-4-31b-it:free',
    FALLBACK_MODELS: [
        'openai/gpt-oss-20b:free'
    ]
};
