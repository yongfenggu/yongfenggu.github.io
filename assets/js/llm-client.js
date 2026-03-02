/**
 * OpenRouter LLM Client
 * 用于调用 OpenRouter API 与大语言模型交互
 */

class LLMClient {
    constructor(config = {}) {
        // 默认使用硬编码的 API Key（来自 .env 文件）
        this.apiKey = config.apiKey || (typeof CONFIG !== 'undefined' ? CONFIG.OPENROUTER_API_KEY : null);
        this.model = config.model || (typeof CONFIG !== 'undefined' ? CONFIG.MODEL : 'arcee-ai/trinity-large-preview:free');
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
     * 调用 LLM API
     * @param {Array} messages - 消息历史数组
     * @param {Object} options - 可选配置
     * @returns {Promise<Object>} - API 响应
     */
    async chat(messages, options = {}) {
        if (!this.apiKey) {
            throw new Error('API Key 未设置，请先调用 setApiKey() 方法');
        }

        // 如果有系统提示词，添加到消息开头
        const messagesWithSystem = this.systemPrompt
            ? [{ role: 'system', content: this.systemPrompt }, ...messages]
            : messages;

        const requestBody = {
            model: this.model,
            messages: messagesWithSystem,
            ...options
        };

        try {
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
                throw new Error(
                    `API 请求失败: ${response.status} ${response.statusText}` +
                    (errorData.error?.message ? ` - ${errorData.error.message}` : '')
                );
            }

            const data = await response.json();
            return data;
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

        const messagesWithSystem = this.systemPrompt
            ? [{ role: 'system', content: this.systemPrompt }, ...messages]
            : messages;

        const requestBody = {
            model: this.model,
            messages: messagesWithSystem,
            stream: true,
            ...options
        };

        try {
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
                throw new Error(
                    `API 请求失败: ${response.status} ${response.statusText}` +
                    (errorData.error?.message ? ` - ${errorData.error.message}` : '')
                );
            }

            const reader = response.body.getReader();
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
