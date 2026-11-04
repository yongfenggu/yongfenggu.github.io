/**
 * SiliconFlow LLM Client
 * 调用硅基流动（OpenAI 兼容接口）的免费模型，主模型失败时按顺序切换备选模型。
 */

class LLMClient {
    constructor(config = {}) {
        const hasConfig = typeof CONFIG !== 'undefined';
        this.apiKey = config.apiKey || (hasConfig ? CONFIG.SILICONFLOW_API_KEY : null);
        this.model = config.model || (hasConfig ? CONFIG.MODEL : 'Qwen/Qwen3-8B');
        this.fallbackModels = config.fallbackModels || (hasConfig ? CONFIG.FALLBACK_MODELS || [] : []);
        this.baseURL = 'https://api.siliconflow.cn/v1/chat/completions';
        this.systemPrompt = config.systemPrompt || '';

        // OpenRouter 兜底：SiliconFlow 全部失败时启用（均为免费模型）
        this.orApiKey = config.orApiKey || (hasConfig ? CONFIG.OPENROUTER_API_KEY : null);
        this.orModels = config.orModels || (hasConfig ? CONFIG.OPENROUTER_MODELS || [] : []);
        this.orURL = 'https://openrouter.ai/api/v1/chat/completions';
    }

    /**
     * 设置 API Key
     * @param {string} apiKey - SiliconFlow API Key
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
     * 候选模型：主模型在前，备选模型按顺序去重补在后面。
     * @returns {Array<string>}
     */
    getModelCandidates() {
        return [...new Set([this.model, ...this.fallbackModels].filter(Boolean))];
    }

    /**
     * 判断是否需要切换到下一个模型（限流、模型不存在、服务端错误等）。
     * 401/403 这类 key 问题换模型也没用，直接抛出。
     * @param {number} status - HTTP 状态码
     * @returns {boolean}
     */
    shouldFallback(status) {
        return status === undefined || status === 400 || status === 404 || status === 429 || status >= 500;
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
     * 调用 SiliconFlow 接口。
     * @param {Object} requestBody - 请求体
     * @param {boolean} stream - 是否流式
     * @returns {Promise<Object|ReadableStreamDefaultReader>}
     */
    async post(requestBody, stream = false) {
        const body = { ...requestBody, stream };
        // Qwen3 默认开启思考模式，闲聊不需要，关掉以加快首字速度
        if (/qwen3/i.test(body.model)) {
            body.enable_thinking = false;
        }

        const response = await fetch(this.baseURL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const detail = errorData.message || errorData.error?.message || '';
            const error = new Error(
                `API 请求失败: ${response.status} ${response.statusText}` +
                (detail ? ` - ${detail}` : '')
            );
            error.status = response.status;
            error.errorData = errorData;
            throw error;
        }

        return stream ? response.body.getReader() : response.json();
    }

    /**
     * 调用 OpenRouter 接口（兜底）。
     * @param {Object} requestBody - 请求体
     * @param {boolean} stream - 是否流式
     * @returns {Promise<Object|ReadableStreamDefaultReader>}
     */
    async postOpenRouter(requestBody, stream = false) {
        const response = await fetch(this.orURL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.orApiKey}`,
                'HTTP-Referer': typeof window !== 'undefined' ? window.location.href : '',
                'X-Title': 'Yongfeng Gu Personal Homepage'
            },
            body: JSON.stringify({ ...requestBody, stream })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const detail = errorData.error?.message || errorData.message || '';
            const error = new Error(
                `OpenRouter 请求失败: ${response.status} ${response.statusText}` +
                (detail ? ` - ${detail}` : '')
            );
            error.status = response.status;
            error.errorData = errorData;
            throw error;
        }

        return stream ? response.body.getReader() : response.json();
    }

    /**
     * 依次尝试候选模型，返回第一个成功的结果。
     * 先走 SiliconFlow，全部失败后切 OpenRouter 免费模型兜底。
     * @param {Array} messagesWithSystem - 含系统提示的消息
     * @param {Object} options - 额外请求参数
     * @param {boolean} stream - 是否流式
     * @returns {Promise<Object|ReadableStreamDefaultReader>}
     */
    async requestWithFallback(messagesWithSystem, options, stream) {
        if (!this.apiKey && !this.orApiKey) {
            throw new Error('API Key 未设置');
        }

        let lastError = null;

        if (this.apiKey) {
            for (const model of this.getModelCandidates()) {
                try {
                    return await this.post({ model, messages: messagesWithSystem, ...options }, stream);
                } catch (error) {
                    lastError = error;
                    if (!this.shouldFallback(error.status)) break;
                    console.warn(`模型 ${model} 暂不可用，尝试下一个模型。`, error.message);
                }
            }
        }

        // SiliconFlow 全部失败，切 OpenRouter 免费模型
        if (this.orApiKey && this.orModels.length) {
            console.warn('SiliconFlow 不可用，切换到 OpenRouter 兜底。');
            for (const model of this.orModels) {
                try {
                    return await this.postOpenRouter({ model, messages: messagesWithSystem, ...options }, stream);
                } catch (error) {
                    lastError = error;
                    console.warn(`OpenRouter 模型 ${model} 暂不可用。`, error.message);
                }
            }
        }

        throw lastError;
    }

    /**
     * 调用 LLM API
     * @param {Array} messages - 消息历史数组
     * @param {Object} options - 可选配置
     * @returns {Promise<Object>} - API 响应
     */
    async chat(messages, options = {}) {
        try {
            return await this.requestWithFallback(this.buildMessagesWithSystem(messages), options, false);
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
        try {
            const reader = await this.requestWithFallback(this.buildMessagesWithSystem(messages), options, true);

            const decoder = new TextDecoder();
            let fullContent = '';
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                // 保留未完整的最后一行，避免 SSE 行被网络分包截断
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const data = line.slice(6).trim();
                    if (data === '[DONE]') continue;

                    try {
                        const parsed = JSON.parse(data);
                        const content = parsed.choices?.[0]?.delta?.content || '';
                        if (content) {
                            fullContent += content;
                            if (onChunk) onChunk(content);
                        }
                    } catch (e) {
                        // 忽略解析错误
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
