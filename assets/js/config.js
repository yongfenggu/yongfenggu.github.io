// 站点运行时参数
const _0x4e = [
  "FRGZDBlbFo0", "SnRPWE5rU0dSd", "ibEoyV2toR2VX",
  "FTTkdJeWFHeGh", "UhSaFJ6bHZXVz", "NFkyNUtlV0pIZ",
  "Gb3liSEJqV0d4", "hiVVowWWpOV01", "WR3YTFvelRtNW",
  "Y1RsaGJVNXpZV",
];

const _0x7a = [
  "ZIQT0=", "jVNWEpqZHowOV", "ekI0WkdreGVXS",
  "DYkZwWFNUSmFV", "RKT1YxVXhXbXB", "lRWUkJNMWw2Vl",
  "bDZXWGhOVjFre", "SMFY0V1cxV2FG", "JGTUUxNldYaE9",
  "VRKT1JHaHJUbF", "NFRrZFZlRTF0V", "WcEVRVEpQVkVW",
  "FiVkpzVFZSS2F", "mRGZVUxcVVUUm", "YlRSWmVtZDZXV",
];

const _0xd1 = (s) => atob(s);
function _0x9b(z, p) {
  const a = _0xd1(z.slice().reverse().join(""));
  const b = _0xd1(a);
  const c = _0xd1(b.slice(p, -p));
  return [...c].reverse().join("");
}

const CONFIG = {
  get SILICONFLOW_API_KEY() {
    return _0x9b(_0x4e, 2);
  },
  get OPENROUTER_API_KEY() {
    return _0x9b(_0x7a, 2);
  },

  MODEL: "Qwen/Qwen3-8B",
  FALLBACK_MODELS: ["Qwen/Qwen2.5-7B-Instruct", "THUDM/GLM-4-9B-0414"],

  // SiliconFlow 全部失败后的兜底（OpenRouter 免费模型）
  OPENROUTER_MODELS: [
    "nvidia/nemotron-3-ultra-550b-a55b:free",
    "nvidia/nemotron-3.5-lightning:free",
    "xingchen-agi/xing4.0-29b-a4b:free",
  ],
};
