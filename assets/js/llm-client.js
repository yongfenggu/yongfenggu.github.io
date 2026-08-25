/**
 * OpenRouter LLM Client
 * 用于调用 OpenRouter API 与大语言模型交互
 */

class LLMClient {
    constructor(config = {}) {
        // 默认使用硬编码的 API Key（来自 .env 文件）
        this.apiKey = config.apiKey || (typeof CONFIG !== 'undefined' ? CONFIG.OPENROUTER_API_KEY : null);
        this.model = config.model || (typeof CONFIG !== 'undefined' ? CONFIG.MODEL : 'z-ai/glm-5.2:free');
        this.fallbackModels = config.fallbackModels || (typeof CONFIG !== 'undefined' ? CONFIG.FALLBACK_MODELS || [] : []);
        this.baseURL = 'https://openrouter.ai/api/v1/chat/completions';
        this.modelsURL = 'https://openrouter.ai/api/v1/models';
        this.systemPrompt = config.systemPrompt || '';

        // DeepSeek 兜底配置：OpenRouter 免费模型全部失败时启用
        this.deepseekApiKey = config.deepseekApiKey || (typeof CONFIG !== 'undefined' ? CONFIG.DEEPSEEK_API_KEY : null);
        this.deepseekModel = config.deepseekModel || (typeof CONFIG !== 'undefined' ? CONFIG.DEEPSEEK_MODEL : 'deepseek-v4-flash');
        this.deepseekURL = 'https://api.deepseek.com/chat/completions';

        // 动态发现的免费模型（本次会话内）
        this.dynamicModels = null;
        // 免费模型列表的本地缓存配置
        this.modelCacheKey = 'openrouter_free_models_v1';
        this.modelCacheTTL = 6 * 60 * 60 * 1000; // 6 小时
        // 质量优先级：命中前缀的模型排在候选前面
        this.preferredModelOrder = [
            'z-ai/glm',
            'minimax/minimax-m3',
            'minimax/minimax-m2',
            'deepseek/',
            'qwen/',
            'meta-llama/',
            'nvidia/nemotron-3-ultra',
            'nvidia/nemotron-3-super',
            'google/gemma-4-31b',
            'google/gemma-4-26b',
            'openrouter/free'
        ];
        // 排除不适合闲聊的模型（安全分类、音频、隐身测试等）
        this.excludedModelKeywords = ['content-safety', 'guard', 'lyria', 'clip', 'stealth', 'embed'];
    }

    /**
     * 设置 API Key
     * @param {string} apiKey - OpenRouter API Key
     */
    setApiKey(apiKey) {
        this.apiKey = apiKey;
    }

    /**
     * 设置系统提示词
     * @param {string} prompt - 系统提示词
     */
    setSystemPrompt(prompt) {
        this.systemPrompt = prompt;
    }

    /**
     * 从 localStorage 读取缓存的免费模型列表（未过期时）。
     * @returns {Array<string>|null}
     */
    readModelCache() {
        try {
            const raw = localStorage.getItem(this.modelCacheKey);
            if (!raw) return null;
            const { models, ts } = JSON.parse(raw);
            if (!Array.isArray(models) || !models.length) return null;
            if (Date.now() - ts > this.modelCacheTTL) return null;
            return models;
        } catch (e) {
            return null;
        }
    }

    /**
     * 将免费模型列表写入 localStorage 缓存。
     * @param {Array<string>} models
     */
    writeModelCache(models) {
        try {
            localStorage.setItem(this.modelCacheKey, JSON.stringify({ models, ts: Date.now() }));
        } catch (e) {
            // localStorage 不可用时静默忽略
        }
    }

    /**
     * 判断某模型是否为可用于文本对话的免费模型。
     * @param {Object} model - OpenRouter 模型对象
     * @returns {boolean}
     */
    isUsableFreeModel(model) {
        const pricing = model.pricing || {};
        const isFree = pricing.prompt === '0' && pricing.completion === '0';
        if (!isFree) return false;

        const id = (model.id || '').toLowerCase();
        if (this.excludedModelKeywords.some(k => id.includes(k))) return false;

        // 必须能输出文本
        const arch = model.architecture || {};
        const outputs = arch.output_modalities || [];
        if (outputs.length && !outputs.includes('text')) return false;

        return true;
    }

    /**
     * 按预设的质量优先级对模型 ID 排序。
     * @param {Array<string>} ids
     * @returns {Array<string>}
     */
    sortByPreference(ids) {
        const rank = id => {
            const idx = this.preferredModelOrder.findIndex(prefix => id.startsWith(prefix));
            return idx === -1 ? this.preferredModelOrder.length : idx;
        };
        return [...ids].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    }

    /**
     * 实时从 OpenRouter 拉取当前可用的免费模型列表。
     * 结果会缓存到 localStorage，失败时回退到缓存或写死配置。
     * @returns {Promise<Array<string>>}
     */
    async fetchFreeModels() {
        if (this.dynamicModels) return this.dynamicModels;

        const cached = this.readModelCache();
        if (cached) {
            this.dynamicModels = cached;
            return cached;
        }

        try {
            const response = await fetch(this.modelsURL, {
                headers: { 'Content-Type': 'application/json' }
            });
            if (!response.ok) throw new Error(`获取模型列表失败: ${response.status}`);

            const data = await response.json();
            const models = (data.data || [])
                .filter(m => this.isUsableFreeModel(m))
                .map(m => m.id);

            if (!models.length) throw new Error('未发现可用的免费模型');

            const sorted = this.sortByPreference(models);
            this.dynamicModels = sorted;
            this.writeModelCache(sorted);
            return sorted;
        } catch (error) {
            console.warn('动态获取免费模型失败，使用写死配置作为兜底。', error);
            return null;
        }
    }

    /**
     * 按顺序返回候选模型：优先动态发现的免费模型，其次写死的主/备选模型。
     * @returns {Promise<Array<string>>}
     */
    async getModelCandidates() {
        const staticList = [this.model, ...this.fallbackModels].filter(Boolean);
        const dynamic = await this.fetchFreeModels();

        if (!dynamic || !dynamic.length) return staticList;

        // 动态列表在前，写死配置补在后面去重兜底
        const merged = [...dynamic];
        for (const id of staticList) {
            if (!merged.includes(id)) merged.push(id);
        }
        return merged;
    }

    /**
     * 判断是否需要切换到 fallback 模型。
     * @param {number} status - HTTP 状态码
     * @param {Object} errorData - API 错误数据
     * @returns {boolean}
     */
    shouldFallback(status, errorData) {
        const message = errorData.error?.message || '';
        return (
            status === 404 ||
            status === 429 ||
            status === 402 ||
            message.includes('Provider returned error') ||
            message.includes('unavailable') ||
            message.includes('No endpoints found')
        );
    }

    /**
     * 为每次请求附带当前时间，避免模型按过期上下文判断时间。
     * @param {Array} messages - 消息历史数组
     * @returns {Array}
     */
    buildMessagesWithSystem(messages) {
        const now = new Date();
        const timeInfo = [
            '',
            `当前时间（Asia/Shanghai）: ${now.toLocaleString('zh-CN', {
                timeZone: 'Asia/Shanghai',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            })}`
        ].join('\n');

        const content = this.systemPrompt
            ? `${this.systemPrompt}\n${timeInfo}`
            : timeInfo;

        return [{ role: 'system', content }, ...messages];
    }

    /**
     * 调用 OpenRouter API。
     * @param {Object} requestBody - 请求体
     * @returns {Promise<Object>}
     */
    async postChatCompletion(requestBody) {
        const response = await fetch(this.baseURL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
                'HTTP-Referer': window.location.href,
                'X-OpenRouter-Title': 'Yongfeng Gu Personal Homepage'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const error = new Error(
                `API 请求失败: ${response.status} ${response.statusText}` +
                (errorData.error?.message ? ` - ${errorData.error.message}` : '')
            );
            error.status = response.status;
            error.errorData = errorData;
            throw error;
        }

        return response.json();
    }

    /**
     * 调用 OpenRouter 流式 API。
     * @param {Object} requestBody - 请求体
     * @returns {Promise<ReadableStreamDefaultReader>}
     */
    async postChatCompletionStream(requestBody) {
        const response = await fetch(this.baseURL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
                'HTTP-Referer': window.location.href,
                'X-OpenRouter-Title': 'Yongfeng Gu Personal Homepage'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const error = new Error(
                `API 请求失败: ${response.status} ${response.statusText}` +
                (errorData.error?.message ? ` - ${errorData.error.message}` : '')
            );
            error.status = response.status;
            error.errorData = errorData;
            throw error;
        }

        return response.body.getReader();
    }

    /**
     * 调用 DeepSeek API（OpenRouter 免费模型全部失败时的兜底）。
     * DeepSeek 兼容 OpenAI 格式，但用独立的 key、URL，并需关闭思考模式以省 token。
     * @param {Object} requestBody - 请求体（不含 model）
     * @param {boolean} stream - 是否流式
     * @returns {Promise<Object|ReadableStreamDefaultReader>}
     */
    async postDeepSeek(requestBody, stream = false) {
        if (!this.deepseekApiKey) {
            throw new Error('DeepSeek API Key 未配置');
        }

        const response = await fetch(this.deepseekURL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.deepseekApiKey}`
            },
            body: JSON.stringify({
                model: this.deepseekModel,
                thinking: { type: 'disabled' }, // 关闭思考模式，闲聊无需推理，省输出 token
                ...requestBody,
                stream
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const error = new Error(
                `DeepSeek 请求失败: ${response.status} ${response.statusText}` +
                (errorData.error?.message ? ` - ${errorData.error.message}` : '')
            );
            error.status = response.status;
            error.errorData = errorData;
            throw error;
        }

        return stream ? response.body.getReader() : response.json();
    }

    /**
     * 调用 LLM API
     * @param {Array} messages - 消息历史数组
     * @param {Object} options - 可选配置
     * @returns {Promise<Object>} - API 响应
     */
    async chat(messages, options = {}) {
        if (!this.apiKey) {
            throw new Error('API Key 未设置，请先调用 setApiKey() 方法');
        }

        const messagesWithSystem = this.buildMessagesWithSystem(messages);

        try {
            let lastError = null;
            const candidates = await this.getModelCandidates();
            for (const model of candidates) {
                const requestBody = {
                    model,
                    messages: messagesWithSystem,
                    ...options
                };

                try {
                    return await this.postChatCompletion(requestBody);
                } catch (error) {
                    lastError = error;
                    if (!this.shouldFallback(error.status, error.errorData || {})) {
                        // 换其它 OpenRouter 模型也无意义，跳出去走 DeepSeek 兜底
                        break;
                    }
                    console.warn(`模型 ${model} 暂不可用，尝试 fallback 模型。`);
                }
            }

            // OpenRouter 免费模型全部失败，切换到 DeepSeek 兜底
            if (this.deepseekApiKey) {
                console.warn('OpenRouter 免费模型全部不可用，切换到 DeepSeek。');
                try {
                    return await this.postDeepSeek({ messages: messagesWithSystem, ...options }, false);
                } catch (dsError) {
                    console.error('DeepSeek 兜底也失败：', dsError);
                    lastError = dsError;
                }
            }

            throw lastError;
        } catch (error) {
            console.error('LLM API 调用错误:', error);
            throw error;
        }
    }

    /**
     * 发送单条消息并获取回复
     * @param {string} userMessage - 用户消息
     * @param {Array} history - 历史消息（可选）
     * @returns {Promise<string>} - AI 回复内容
     */
    async sendMessage(userMessage, history = []) {
        const messages = [
            ...history,
            { role: 'user', content: userMessage }
        ];

        const response = await this.chat(messages);
        return response.choices[0].message.content;
    }

    /**
     * 流式调用 LLM API
     * @param {Array} messages - 消息历史数组
     * @param {Function} onChunk - 接收到新内容块时的回调函数
     * @param {Object} options - 可选配置
     * @returns {Promise<string>} - 完整的响应内容
     */
    async chatStream(messages, onChunk, options = {}) {
        if (!this.apiKey) {
            throw new Error('API Key 未设置，请先调用 setApiKey() 方法');
        }

        const messagesWithSystem = this.buildMessagesWithSystem(messages);

        try {
            let lastError = null;
            let reader = null;
            const candidates = await this.getModelCandidates();
            for (const model of candidates) {
                const requestBody = {
                    model,
                    messages: messagesWithSystem,
                    stream: true,
                    ...options
                };

                try {
                    reader = await this.postChatCompletionStream(requestBody);
                    break;
                } catch (error) {
                    lastError = error;
                    if (!this.shouldFallback(error.status, error.errorData || {})) {
                        // 换其它 OpenRouter 模型也无意义，跳出去走 DeepSeek 兜底
                        break;
                    }
                    console.warn(`模型 ${model} 暂不可用，尝试 fallback 模型。`);
                }
            }

            // OpenRouter 免费模型全部失败，切换到 DeepSeek 兜底（流式）
            if (!reader && this.deepseekApiKey) {
                console.warn('OpenRouter 免费模型全部不可用，切换到 DeepSeek（流式）。');
                try {
                    reader = await this.postDeepSeek({ messages: messagesWithSystem, ...options }, true);
                } catch (dsError) {
                    console.error('DeepSeek 流式兜底也失败：', dsError);
                    lastError = dsError;
                }
            }

            if (!reader) {
                throw lastError;
            }

            const decoder = new TextDecoder();
            let fullContent = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') continue;

                        try {
                            const parsed = JSON.parse(data);
                            const content = parsed.choices[0]?.delta?.content || '';
                            if (content) {
                                fullContent += content;
                                if (onChunk) onChunk(content);
                            }
                        } catch (e) {
                            // 忽略解析错误
                        }
                    }
                }
            }

            return fullContent;
        } catch (error) {
            console.error('LLM 流式 API 调用错误:', error);
            throw error;
        }
    }
}

// 导出供其他模块使用
if (typeof module !== 'undefined' && module.exports) {
    module.exports = LLMClient;
}
