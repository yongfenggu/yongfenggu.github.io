/**
 * OpenRouter LLM Client
 * 用于调用 OpenRouter API 与大语言模型交互
 */

class LLMClient {
    constructor(config = {}) {
        // 默认使用硬编码的 API Key（来自 .env 文件）
        this.apiKey = config.apiKey || (typeof CONFIG !== 'undefined' ? CONFIG.OPENROUTER_API_KEY : null);
        this.model = config.model || (typeof CONFIG !== 'undefined' ? CONFIG.MODEL : 'arcee-ai/trinity-large-preview:free');
        this.fallbackModels = config.fallbackModels || (typeof CONFIG !== 'undefined' ? CONFIG.FALLBACK_MODELS || [] : []);
        this.baseURL = 'https://openrouter.ai/api/v1/chat/completions';
        this.systemPrompt = config.systemPrompt || '';
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
     * 按顺序返回主模型和 fallback 模型。
     * @returns {Array<string>}
     */
    getModelCandidates() {
        return [this.model, ...this.fallbackModels].filter(Boolean);
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
            (status === 404 && message.includes('No endpoints found')) ||
            status === 429 ||
            message.includes('Provider returned error')
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
            })}`,
            '回答时请以这个当前时间为准，判断早晚、工作日和时间相关表达。'
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
            for (const model of this.getModelCandidates()) {
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
                        throw error;
                    }
                    console.warn(`模型 ${model} 暂不可用，尝试 fallback 模型。`);
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
            for (const model of this.getModelCandidates()) {
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
                        throw error;
                    }
                    console.warn(`模型 ${model} 暂不可用，尝试 fallback 模型。`);
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
