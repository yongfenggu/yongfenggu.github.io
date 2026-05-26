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

## 教育背景

### 天津大学 · 硕士（2024.09 - 2027.06）
- 学院：精密仪器与光电子工程学院
- 专业：仪器科学与技术
- 研究方向：双目相机测量系统、相机标定算法、激光测距系统、嵌入式设计与开发

### 天津大学 · 本科（2020.09 - 2024.07）
- 学院：精密仪器与光电子工程学院
- 专业：智能感知工程
- 主修：计算机视觉、数字信号处理、自动控制原理等

## 最近在干嘛
在读研二，课题正在推进，但由于忙于实习，还好有师弟师妹来帮助推进课题。
计划今年发两篇论文，再去刷两段实习，争取秋招找个好工作。

## 爱好
- 喜欢的游戏：英雄联盟，最近痴迷海克斯大乱斗模式，杰斯一板一眼、蒙多钢化你心、歌利亚巨人最爽了
- 喜欢的歌手：陶喆、方大同、周杰伦

## 实习经历

### Research Intern @ DeepWisdom（2026.03 - 至今）· 深圳
参与三个核心项目：

#### Harnessing Agentic Evolution
- 状态：投稿 NeurIPS 2026
- 作者排位：二作
- AEvo 是智能体自主进化方向的研究工作，探索如何让 Agent 从历史经验中自动演化学习流程（Learning Procedures）。延续 DeepWisdom 团队在 MetaGPT、AFlow、SPO、AEvo 等一系列 Agentic Evolution 研究的积累，核心思想是让智能体不再依赖人工设计的固定流程，而是能够从自身执行经验中自动提炼、优化和演化出更高效的任务解决策略。

#### Foundation Protocol: A Coordination Layer for Agentic Society
- 状态：白皮书即将发布于 ArXiv
- 作者排位：共一
- Foundation Protocol 是面向 AI 社会的最小化、图优先的协议核心层。为异构实体（Agent、工具、资源、人类、机构、组织）提供统一的可寻址模型，支持原生多方组织与事件驱动协作，提供计量与结算等经济原语，将策略、溯源和审计作为一等公民。
- 核心架构——四平面设计：Entity & Trust Plane、Transport & Routing Plane、Interaction & Organization Plane、Regulation & Oversight Plane
- 核心词汇表：Entity / Session / Activity / Envelope / Event / Receipt-Settlement / Provenance

#### AutoWork: Build First-Party Agents for Long-Horizon Work
- 状态：白皮书阶段
- AutoWork 是一种 First-Person Agent 框架，使智能体能够直接进入用户的设备、账号与工作流，以用户身份处理消息、撰写文档、组织协作、生成代码并交付结果。核心差异在于从"建议型助手"范式转向"第一方执行系统"。
- 个人负责：记忆系统（SOUL.md/YOU.md/USER.md 三件套 + Memory Folds 跨 Session 长期记忆）、TUI/GUI/CLI 交互层、核心架构设计

### LLM Agent 算法实习生 @ Karis / invoko（2025.07 - 2026.02）· 北京
- ContextCompact - 上下文压缩策略：针对 ReAct 架构 Agent 在长步骤任务中的 Context 窗口限制问题，设计多层级上下文压缩策略（动态摘要 + 关键信息保留 + 滑动窗口），将平均 token 使用量降低 60%，使 Agent 能够持续执行超过 100 步的复杂任务
- memoryspace - Agent 记忆机制设计：设计自由迭代演化、通用可复制的 Agent Memory 架构，支持短期/长期/情景记忆分层存储与检索，采用向量数据库 + 关键词索引的混合检索策略，赋予 Agent 跨会话、超长程任务执行能力
- sophia-eval - Agent 评测框架：基于 pydantic-ai 从零搭建 Agent 评测框架（Dataset/Case/Runner 三层架构），支持多维度评测指标（准确率、推理步数、成本、延迟等）
- eval-plat - 内部评测平台全栈开发：前端 Vue + TypeScript + Ant Design，后端 FastAPI + SQLite，实现评测任务管理、结果可视化、历史版本追踪
- 基础设施建设：核心代码 refactor/debug，构建统一 CLI 工具链（Click/Typer），设计结构化日志系统

## 发表论文

| 工作 | 贡献 | 年份 | 发表 |
|------|------|------|------|
| Harnessing Agentic Evolution | 二作 | 2026 | NeurIPS 2026（投稿中） |
| Foundation Protocol: A Coordination Layer for Agentic Society | 二作 | 2026 | Hugging Face Papers：https://huggingface.co/papers/2605.23218 |
| Organic Neuromorphic Vision Devices with Multilevel Memory for Palmprint Identification | 二作 | 2026 | Chemical Science, Royal Society of Chemistry |

## 项目经历

### 教培订单管理系统（2024.12 - 2025.02）
- 机构：汇学家教
- 角色：全栈开发工程师
- 内容：开发覆盖 6 个城市的订单管理系统，支撑日活 2k+ 用户，日订单 300+
- 技术栈：Vue3/TypeScript/SCSS/Element Plus、Node.js/Express、MySQL、Nginx

### 基于深度学习预测儿童肺炎糖皮质激素治疗剂量（2024.07 - 2024.09）
- 机构：天津市儿童医院
- 角色：ML 算法工程师
- 内容：训练 CNN 模型通过胸部 X 光片分析肺炎严重程度，搭建推理应用为临床医生提供 RMPP 治疗剂量建议
- 技术栈：Python/PyTorch、ResNet/MobileNetV2、ONNX Runtime

### 工业夹具设备的远程控制系统开发（2023.09 - 2024.03）
- 机构：江苏北人公司
- 角色：嵌入式软件工程师
- 内容：为汽车产线开发高兼容性远程控制系统，实现生产状态远程控制与实时诊断，支持 16 种车型混线生产，换型效率提升 93%
- 技术栈：Vue/JavaScript/jQuery/Vite（上位机）、Node.js/Express/Shell（后端）

### 联轴器自动对中辅助设备开发（2025.02 - 至今）
- 机构：天津电建公司
- 角色：嵌入式软件工程师
- 内容：融合激光测距+陀螺仪搭建非接触式远程测量系统，取代千分尺人工测量，精度 ±0.01mm，效率提升 3 倍
- 职责：结构设计（SolidWorks）、嵌入式程序开发（ESP32）、上位机软件（Vue）全流程
- 技术栈：ESP32 + C++、SolidWorks、Vue、485/UART/Http

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
