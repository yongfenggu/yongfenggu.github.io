## 基本信息
- 姓名：古永丰 (Yongfeng Gu)
- 性别：男
- 身份：天津大学硕士研究生
- 专业：仪器科学与技术
- 学院：精密仪器与光电子工程学院
- 硕士就读时间：2024.09 - 2027.06
- 政治身份：中共党员
- 邮箱：yongfenggu@tju.edu.cn
- GitHub：@yongfenggu
- Google Scholar：BwrMcW0AAAAJ
- 个人主页：https://yongfenggu.github.io

## 日记

**2026.08.24**
我从 DeepWisdom 离职了。最近正忙着毕设课题。

接下来的计划是：
1. 计划发一篇小论文,就是激光基准线点定位系统 · 中国能源建设集团 那个项目的，发一个小论文达到硕士毕业要求
2. 正在寻找秋招机会，应届生岗的求职，Focus on Agentic AI，主要关注算法工程师或者算法研究员岗位。
3. 同时，也非常欢迎并希望有更多的实习机会
## 过往经历时间线

### 2026.03 - 2028.08 · Research Intern @ DeepWisdom · 深圳
Mentor：张佳钇。参与三个核心项目：

**Harnessing Agentic Evolution (AEvo)** — 二作，投稿 NeurIPS 2026，arXiv https://arxiv.org/abs/2605.13821
- 关键词：meta-learning、AutoResearch、long-horizon
- 背景：现有 agentic evolution 方案存在两难——人工设计的流程模块化但僵硬，通用 Agent 灵活但在 long-horizon 演化中容易漂移、早停、陷入局部最优和 reward hacking。
- 方法：提出 AEvo meta-editing harness，把"演化"重构成一个以累积上下文为过程级状态的交互环境；Meta-Agent 不直接生成解，而是去编辑控制后续演化的 Workflow / TaskAgent，为 Workflow-based 与 Agent-based 两类演化提供统一接口。
- 成果：在 ARC-AGI-2、Terminal-Bench 上超过 ADAS、DGM、AFlow、SPO、GEPA 等 5 个 baseline，相对最强 baseline 提升约 10%；3 个 open-ended 优化任务在同等迭代预算下相对 HyperAgent 达到 SOTA。

**Foundation Protocol: A Coordination Layer for Agentic Society (FP)** — 二作，Hugging Face Papers / ArXiv 白皮书 https://huggingface.co/papers/2605.23218
- 关键词：Multi-Agent System
- 背景：Agent 规模化之后，瓶颈从模型能力转向"协调"；现有协议各管一段边界，导致集成成本高、provenance 断裂、监管分散。
- 方法：设计 graph-native 协调层，把 Agent、工具、资源、人、机构统一为可寻址节点，采用四层架构（Entity & Trust / Transport & Routing / Interaction & Organization / Regulation & Oversight）；个人主导协议核心架构与协议 SDK / 应用层实现。
- 成果：受邀在 DataFun Agentic AI 会议分享；公司内部基于 FP 落地 Ai Link Net、Agent Economy Bench、AgentLab 等项目。

**Scaling Open-ended Task & Reasoning Data**（最近在做的工作）
- 关键词：Open-ended Discovery、Verifier-based RL、Data Scaling
- 背景：FrontierCS、Frontier-Eng、AutoLab 分别从 CS、工程任务、autoresearch 的角度定义了 Open-ended Discovery，FrontierSmith 进一步验证了"CS 问题 → open-ended coding task → single-turn GRPO"这条路径的可行性。我们的目标是把这套思路扩展到更多真实的工程与科学任务上，构建来源可信、verifier-based、dense-reward、open-ended 的任务与数据。
- 方法：从真实的 engineering / science / auto-research-like 数据源自动构建 open-ended discovery tasks，再用 single-turn GRPO、on-policy SFT 等方法，验证模型跨领域单步推理能力的提升效果。

### 2025.08 - 2026.12 · 激光基准线点定位系统 · 中国能源建设集团
- 角色：算法 / 上位机开发
- 背景：大型转动设备（汽轮机等，转子直径 1–2 m）多段轴瓦的轴系对中测量，工程精度要求达两丝（0.02 mm）；行业主流的钢丝找中法存在下坠挠度、振动敏感、需反复拆装等固有缺陷。
- 方法：用激光基准线替代钢丝，通过双相机拍摄光斑 + 镜面虚像重建，在统一设备坐标系下恢复激光基准轴，并解析求解任意点到该轴的垂距；上位机采用 FastAPI + React/Three.js 前后端架构，图像处理与数值解算基于 OpenCV 与 SciPy。
- 成果：完成原理验证（精度达设计要求）并研制初版设备投入使用，目前处于迭代改进阶段；已获授 6 项专利，已申请中文核心期刊论文 1 篇。
- 技术栈：FastAPI、React、Three.js、OpenCV、SciPy、双目视觉

### 2025.07 - 2026.02 · Agent 算法实习生 @ Karis / invoko · 北京
Mentor：向劲宇、白岳霖。两个核心方向：

**Karis Harness**（SmolAgent、Harness Engineering、Agent Memory）
- 基于 SmolAgent 搭建 KarisHarness，参与 Tooling、Lifecycle、Observability、Context 等核心模块，重点负责 Agent Memory 的设计与实现。
- Agent Memory：设计并实现存储长期记忆的 Memory Space，以及 Dream 机制（周期性提炼有效经验、沉淀归档、淘汰冗余记忆）；针对不同模式下的运行时上下文设计 Context Compact 策略，显著提升长程任务的执行能力。
- 成果：在真实业务场景推动产品 Agent 在"效果—成本"曲线上达到 Pareto frontier；在 WebArena、GAIA、ResearchQA 等 agent benchmark 上相对基线 harness 平均提升约 +5%。

**Karis Evol**（Harbor、Vue、FastAPI、PGSQL）
- 聚焦真实业务增长场景，构建内部测评 Benchmark 与全栈评测平台，持续测评并提升产品 Agent 能力；基于 Harbor 设计 task package；技术栈 Vue + FastAPI。

### 2024.12 - 2025.02 · 教培订单管理系统 · 汇学家教
- 角色：全栈开发工程师
- 内容：开发覆盖 6 个城市的订单管理系统，支撑日活 2k+ 用户，日订单 300+
- 技术栈：Vue3/TypeScript/SCSS/Element Plus、Node.js/Express、MySQL、Nginx

### 2024.09 - 2027.06 · 天津大学 · 硕士
- 学院：精密仪器与光电子工程学院
- 专业：仪器科学与技术
- 研究方向：视觉测量

### 2024.07 - 2024.09 · 基于深度学习预测儿童肺炎糖皮质激素治疗剂量 · 天津市儿童医院
- 角色：ML 算法工程师
- 内容：训练 CNN 模型通过胸部 X 光片分析肺炎严重程度，搭建推理应用为临床医生提供 RMPP 治疗剂量建议
- 技术栈：Python/PyTorch、ResNet/MobileNetV2、ONNX Runtime

### 2020.09 - 2024.07 · 天津大学 · 本科
- 学院：精密仪器与光电子工程学院
- 专业：智能感知工程
- 主修：计算机视觉、数字信号处理、自动控制原理等

## 发表论文

| 工作 | 贡献 | 年份 | 发表 | 链接 |
|------|------|------|------|------|
| Harnessing Agentic Evolution | 二作 | 2026 | NeurIPS 2026（投稿中） | arXiv：https://arxiv.org/abs/2605.13821 |
| Foundation Protocol: A Coordination Layer for Agentic Society | 二作 | 2026 | Hugging Face Papers | https://huggingface.co/papers/2605.23218 |
| Organic Neuromorphic Vision Devices with Multilevel Memory for Palmprint Identification | 二作 | 2026 | Chemical Science, Royal Society of Chemistry | https://pubs.rsc.org/en/content/articlelanding/2026/sc/d5sc07902k |

## 技能
- LLM Agent：ClaudeCode/Opencode/Cursor；熟悉 LangChain/Smolagents/pydantic-ai；AgentMemory 设计；Agent 评测框架
- 机器学习：MLP/CNN/RNN/Transformer 原理与经典模型；PyTorch/ONNX Runtime
- 全栈开发：Vue 全家桶/TypeScript/SCSS/Tailwind；Node.js(Express)/Python(FastAPI)；MySQL/SQLite；Nginx/Docker
- 嵌入式：ESP32/ESP-IDF；UART/TTL/RS485；SolidWorks/Fusion 360；PCB 设计
- 语言：Python, JavaScript/TypeScript, C/C++

## 荣誉
- iCAN 大学生创新创业大赛天津赛区三等奖
- 优秀学生干部、优秀三好学生
- 英语六级
- 校学生会新闻媒体部部长、院年委会文体专员、班级班长、党支部宣传委员

## 爱好
- 喜欢的游戏：英雄联盟，最近痴迷海克斯大乱斗模式，杰斯一板一眼、蒙多钢化你心、歌利亚巨人最爽了
- 喜欢的歌手：陶喆、方大同、周杰伦、卢广仲
- 最近爱听卢广仲的专辑，一百种生活