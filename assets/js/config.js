// 站点运行时参数
const _0x4e = [
  "FRGZDBlbFo0", "SnRPWE5rU0dSd", "ibEoyV2toR2VX",
  "FTTkdJeWFHeGh", "UhSaFJ6bHZXVz", "NFkyNUtlV0pIZ",
  "Gb3liSEJqV0d4", "hiVVowWWpOV01", "WR3YTFvelRtNW",
  "Y1RsaGJVNXpZV",
];

const _0xd1 = (s) => atob(s);
function _0x9b(z) {
  const a = _0xd1(z.slice().reverse().join(""));
  const b = _0xd1(a);
  const c = _0xd1(b.slice(2, -2));
  return [...c].reverse().join("");
}

const CONFIG = {
  get SILICONFLOW_API_KEY() {
    return _0x9b(_0x4e);
  },

  MODEL: "Qwen/Qwen3-8B",
  FALLBACK_MODELS: ["Qwen/Qwen2.5-7B-Instruct", "THUDM/GLM-4-9B-0414"],
};
