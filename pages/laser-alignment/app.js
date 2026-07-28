(function loadThree() {
    // 依次尝试的 CDN 来源
    var sources = [
        'https://unpkg.com/three@0.128.0/build/three.min.js',
        'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'
    ];
    var i = 0;
    function tryNext() {
        if (typeof THREE !== 'undefined') return;          // 已加载成功
        if (i >= sources.length) {
            console.warn('Three.js 所有来源均加载失败');
            return;
        }
        var url = sources[i++];
        var s = document.createElement('script');
        s.src = url;
        s.onload = function () {
            if (typeof THREE !== 'undefined') {
                console.log('Three.js 已从以下来源加载:', url);
            } else {
                tryNext();   // 加载了但没暴露 THREE, 继续下一个
            }
        };
        s.onerror = function () { tryNext(); };
        document.head.appendChild(s);
    }
    tryNext();
})();


class AlignmentMeasurementSystem {
    constructor() {
        this.currentSession = {
            measurements: {
                top: [], bottom: [], left: [], right: []
            },
            activePosition: null
        };

        this.completedReports = [];
        // 3台ESP32: 2台轴向 + 1台径向
        this.axial1Host = '192.168.10.10';
        this.axial2Host = '192.168.10.11';
        this.radialHost = '192.168.10.12';
        this.useMockData = false;

        this.sensorLayout = {
            // 高压缸在哪一侧: left / right (基准/固定端, 由“缸体切换”按钮设置)
            highPressureSide: 'left'
        };

        // 传感器安装起始方位 (angleStep=0 时各传感器所在方位), 值可为 top/bottom/left/right 或 null(不安装)
        this.sensorStart = {
            axial1: 'top',
            axial2: 'bottom',
            radial: 'right'
        };

        // 传感器安装在哪一侧缸体: 'high' 高压缸 / 'low' 低压缸 (决定探头贴在哪半联轴器端面)
        this.installSide = 'high';

        // 是否已安装传感器(至少一路已选方位), 决定端面探头是否显示、能否测量
        this.installed = false;
        // 旋转方向: +1 正转 / -1 反转 (由“转换旋转方向”按钮切换, 不影响测量结果)
        this.rotateDir = 1;

        // ===== 安装方案 =====
        // 每个方案 = { id, name, highPressureSide, installSide, sensorStart, installed }
        // 上面的 sensorLayout / installSide / sensorStart / installed 为“当前生效方案”的镜像,
        // 计算逻辑仍直接读取这些字段, 因此保持不变。
        this.schemes = [];
        this.activeSchemeId = null;
        this._schemeSeq = 0;

        // 3D 视图状态
        this.view3D = {
            enabled: true,
            scene: null,
            camera: null,
            renderer: null,
            coupling: null,    // 联轴器模型组 (随盘车旋转)
            markerGroup: null, // 支架 + 传感器 + 贴片 (随盘车一起旋转)
            sensorMeshes: { axial1: null, axial2: null, radial: null }, // 传感器实体
            orbit: null,       // 轨道相机状态 {radius, theta, phi, target, minR, maxR}
            angleStep: 0,      // 当前盘车停位 0..3 → getRotationOrder()[step]
            rotX: 0,           // 联轴器绕 X 的连续弧度
            initialized: false,
            animationId: null
        };

        // 使用 v3 键名避免与旧数据冲突
        this.storageKey = 'alignment_settings_v3';
        this.sessionKey = 'alignment_current_session_v3';
        this.reportsKey = 'alignment_reports_v3';

        this.init();
    }

    init() {
        this.loadSettings();
        this.ensureSchemes();
        this.loadSession();
        this.loadReports();
        this.bindEvents();
        this.updateClock();
        this.updateUI();
        // 初始化按钮文案与安装面板
        this.populateInstallPanel();
        this.renderSchemeSelectors();
        this.updateCylinderBtn();
        this.updateRotateDirBtn();
        this.updateStopUI();
        this.renderResultLog();
        setInterval(() => this.updateClock(), 1000);
        // 延迟初始化 3D, 等待 Three.js 脚本加载完成
        this.initThreeWhenReady();
    }

    initThreeWhenReady(attempt = 0) {
        if (this.view3D.initialized) return;
        if (typeof THREE !== 'undefined') {
            this.init3DView();
            return;
        }
        // THREE 一旦就绪会自动初始化。持续轮询最多 ~30 秒。
        if (attempt === 30 && this.view3D.enabled) {
            console.warn('Three.js 尚未就绪, 正在等待加载完成');
        }
        if (attempt > 300) {
            console.warn('Three.js 加载超时, 请检查网络能否访问 CDN');
            return;
        }
        setTimeout(() => this.initThreeWhenReady(attempt + 1), 100);
    }

    bindEvents() {
        const bindTap = (el, handler) => {
            if (!el) return;
            let touchTriggered = false;
            el.addEventListener('touchend', (e) => {
                e.preventDefault();
                touchTriggered = true;
                handler(e);
                setTimeout(() => {
                    touchTriggered = false;
                }, 350);
            }, { passive: false });

            el.addEventListener('click', (e) => {
                if (touchTriggered) return;
                handler(e);
            });
        };

        bindTap(document.getElementById('settingsBtn'), () => this.showSettings());
        bindTap(document.getElementById('historyToggleBtn'), () => this.showHistoryModal());

        // 缸体切换 / 确认保存 / 关闭(×) / 编辑当前方案
        bindTap(document.getElementById('cylinderToggleBtn'), () => this.toggleHighPressureSide());
        bindTap(document.getElementById('installApplyBtn'), () => this.applyInstall());
        bindTap(document.getElementById('schemeEditClose'), () => this.cancelInstall());
        bindTap(document.getElementById('editSchemeBtn'), () => this.editScheme());

        // 方案编辑面板: 参数变动即实时渲染 (不保存)
        document.querySelectorAll('.sensor-pos').forEach(sel => {
            sel.addEventListener('change', () => this.applyPanelToLive());
        });
        document.querySelectorAll('input[name="installSide"]').forEach(r => {
            r.addEventListener('change', () => this.applyPanelToLive());
        });

        // 切换回原始视向
        bindTap(document.getElementById('resetViewBtn'), () => this.resetView());

        // 安装方案: 右侧切换下拉 / 设置内新建·删除
        const switchSel = document.getElementById('switchSchemeSelect');
        if (switchSel) switchSel.addEventListener('change', () => this.switchScheme(switchSel.value));
        bindTap(document.getElementById('newSchemeBtn'), () => this.addScheme());
        bindTap(document.getElementById('deleteSchemeBtn'), () => this.deleteScheme());

        // 测量 / 计算 / 重置
        bindTap(document.getElementById('measureNowBtn'), () => this.measure(this.currentStopKey()));
        bindTap(document.getElementById('calcResultBtn'), () => this.handleShowReport());
        bindTap(document.getElementById('resetBtn'), () => this.resetMeasurements());

        // 旋转角度: 下拉切换是否显示自定义输入框
        const degSelect = document.getElementById('rotateDegSelect');
        const degInput = document.getElementById('rotateDegInput');
        if (degSelect && degInput) {
            degSelect.addEventListener('change', () => {
                degInput.style.display = degSelect.value === 'custom' ? '' : 'none';
            });
        }
        bindTap(document.getElementById('rotateApplyBtn'), () => {
            let deg;
            if (degSelect && degSelect.value === 'custom') {
                deg = parseFloat(degInput && degInput.value) || 0;
            } else {
                deg = parseFloat(degSelect && degSelect.value) || 0;
            }
            this.rotateByDegrees(deg * this.rotateDir);
        });
        bindTap(document.getElementById('rotateDirBtn'), () => {
            this.rotateDir *= -1;
            this.updateRotateDirBtn();
        });

        bindTap(document.getElementById('closeHistoryModal'), () => this.hideHistoryModal());
        document.getElementById('historyModal').addEventListener('click', (e) => {
            if (e.target.id === 'historyModal') this.hideHistoryModal();
        });

        bindTap(document.getElementById('closeDetailModal'), () => this.hideDetailModal());
        document.getElementById('detailModal').addEventListener('click', (e) => {
            if (e.target.id === 'detailModal') this.hideDetailModal();
        });

        document.getElementById('reportModal').addEventListener('click', (e) => {
            if (e.target.id === 'reportModal') this.hideReport();
        });
    }

    updateClock() {
        const el = document.getElementById('currentTime');
        if (!el) return;
        const now = new Date();
        el.textContent = now.toLocaleTimeString('zh-CN', { hour12: false });
    }

    /**
     * 记录一次测量: 同时向 3 台 ESP32 发请求 → 存储 3 个值到当前停位
     */
    async measure(position) {
        if (!this.installed) {
            alert('请先安装传感器');
            return;
        }
        try {
            const [axial1Resp, axial2Resp, radialResp] = await Promise.all([
                this.fetchMeasurement(this.axial1Host),
                this.fetchMeasurement(this.axial2Host),
                this.fetchMeasurement(this.radialHost)
            ]);

            const a1 = axial1Resp.sensor;
            const a2 = axial2Resp.sensor;
            const rd = radialResp.sensor;

            // 至少一个传感器连接成功才继续
            if (!a1.success && !a2.success && !rd.success) {
                throw new Error('所有传感器均无法连接');
            }

            const axial1Val = (a1.success && a1.value !== 0.0000) ? a1.value : 0;
            const axial2Val = (a2.success && a2.value !== 0.0000) ? a2.value : 0;
            const radialVal = (rd.success && rd.value !== 0.0000) ? rd.value : 0;

            const record = {
                axial1: axial1Val,
                axial2: axial2Val,
                radial: radialVal,
                time: new Date().toLocaleString('zh-CN'),
                timestamp: Date.now()
            };

            this.currentSession.measurements[position].push(record);

            this.hideInlineResult();   // 开始新一轮测量记录 → 清掉上次的计算结果显示
            this.saveSession();
            this.updateUI();
            this.checkCompletion();

        } catch (error) {
            console.error('测量错误:', error);
            alert('测量失败: ' + error.message);
        }
    }

    async fetchMeasurement(host) {
        if (this.useMockData) {
            return this.generateMockData();
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        try {
            const response = await fetch(`http://${host}/getdistance`, {
                method: 'GET',
                signal: controller.signal
            });
            clearTimeout(timeout);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (error) {
            clearTimeout(timeout);
            console.warn(`${host} 连接失败:`, error.message);
            return { sensor: { success: false, value: 0 } };
        }
    }

    generateMockData() {
        return {
            sensor: {
                success: true,
                value: parseFloat((Math.random() * 20 + 30).toFixed(4))
            }
        };
    }

    /**
     * 从测量记录数组中提取指定字段的平均值
     */
    calculateAverage(measurements, field) {
        const valid = measurements.filter(m => m[field] !== null && m[field] !== undefined);
        if (valid.length === 0) return null;
        const sum = valid.reduce((acc, m) => acc + m[field], 0);
        return sum / valid.length;
    }

    buildPhysicalDisplayValues() {
        return this.buildPhysicalDisplayValuesFrom(this.currentSession.measurements);
    }

    updateUI() {
        this.updateReportButtonState();
        this.renderResultLog();
        if (this.view3D && this.view3D.initialized) {
            this.updateStopUI();
        }
    }

    updateReportButtonState() {
        const btn = document.getElementById('calcResultBtn');
        if (!btn) return;
        const allComplete = ['top', 'bottom', 'left', 'right'].every(pos =>
            this.currentSession.measurements[pos].length > 0
        );
        btn.disabled = !allComplete;
    }

    // 右侧结果日志: 每条测量一行, 显示方位(Metadata) + 已安装传感器读数汇总
    renderResultLog() {
        const box = document.getElementById('resultLog');
        if (!box) return;

        const all = [];
        ['top', 'right', 'bottom', 'left'].forEach(pos => {
            (this.currentSession.measurements[pos] || []).forEach(r => all.push({ pos, r }));
        });
        all.sort((a, b) => (a.r.timestamp || 0) - (b.r.timestamp || 0));

        if (all.length === 0) {
            box.innerHTML = '<div class="rl-empty">暂无测量记录</div>';
            return;
        }

        const sensors = [
            ['axial1', '轴向1', '#2a6496'],
            ['axial2', '轴向2', '#2a6496'],
            ['radial', '径向', '#a0522d']
        ];

        box.innerHTML = all.map((item, i) => {
            const vals = sensors
                .filter(([k]) => this.sensorStart[k])   // 仅显示已安装(已选方位)的传感器
                .map(([k, label, color]) => {
                    const v = Number(item.r[k]);
                    const txt = Number.isFinite(v) ? v.toFixed(4) + ' mm' : '--';
                    return `<div class="rl-val"><span style="color:${color};font-weight:600;">${label}</span><span>${txt}</span></div>`;
                }).join('');
            const body = vals || '<div class="rl-val" style="color:#a3a3a3;">无已安装传感器</div>';
            return `<div class="rl-item">
                <div class="rl-head">#${i + 1} 方位 <b>${this.sideName(item.pos)}</b><span class="rl-time">${item.r.time || ''}</span></div>
                ${body}
            </div>`;
        }).join('');
    }

    getRotationOrder() {
        return ['top', 'right', 'bottom', 'left'];
    }

    getOppositeSide(side) {
        const map = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
        return map[side];
    }

    sideName(side) {
        const map = { top: '上', bottom: '下', left: '前', right: '后' };
        return map[side] || '--';
    }

    stableRound2(value) {
        return Math.round((value + 1e-9) * 100) / 100;
    }

    // 依据传感器起始方位 + 当前停位的旋转步数, 推导某停位下各路读数对应的物理方位。
    // 未安装的传感器返回 null (下游做空值容错)。
    getAxialSideMap(position) {
        const order = this.getRotationOrder();
        const rotateSteps = order.indexOf(position);
        const sideOrder = ['top', 'right', 'bottom', 'left'];
        const rot = (start) => {
            if (!start) return null;
            const idx = sideOrder.indexOf(start);
            if (idx < 0) return null;
            return sideOrder[(idx + rotateSteps + 4) % 4];
        };
        return {
            axial1: rot(this.sensorStart.axial1),
            axial2: rot(this.sensorStart.axial2)
        };
    }

    getRadialSide(position) {
        const order = this.getRotationOrder();
        const rotateSteps = order.indexOf(position);
        const sideOrder = ['top', 'right', 'bottom', 'left'];
        const start = this.sensorStart.radial;
        if (!start) return null;
        const idx = sideOrder.indexOf(start);
        if (idx < 0) return null;
        return sideOrder[(idx + rotateSteps + 4) % 4];
    }

    formatOpeningResult(sideA, valueA, sideB, valueB) {
        if (valueA === null || valueB === null) {
            return '--';
        }

        if (valueA === valueB) {
            return '无张口 0.00 丝';
        }

        const largerSide = valueA > valueB ? sideA : sideB;
        const openingValue = Math.abs(valueA - valueB) * 100;
        const roundedValue = this.stableRound2(openingValue);
        return `${this.sideName(largerSide)}张口 ${roundedValue.toFixed(2)} 丝`;
    }

    buildOpeningMeasure(sideA, valueA, sideB, valueB) {
        if (valueA === null || valueB === null) {
            return null;
        }

        if (valueA === valueB) {
            return { side: sideA, value: 0 };
        }

        return {
            side: valueA > valueB ? sideA : sideB,
            value: Math.abs(valueA - valueB) * 100
        };
    }

    formatCombinedOpeningResult(openingA, openingB) {
        if (!openingA || !openingB) {
            return '--';
        }

        const isSameSide = openingA.side === openingB.side;

        let combinedValue;
        if (isSameSide) {
            combinedValue = (openingA.value + openingB.value) / 2;
        } else {
            combinedValue = Math.abs(openingA.value - openingB.value) / 2;
        }

        if (combinedValue === 0) {
            return '无张口 0.00 丝';
        }

        const largerOpening = openingA.value > openingB.value ? openingA : openingB;
        const roundedValue = this.stableRound2(combinedValue);
        return `${this.sideName(largerOpening.side)}张口 ${roundedValue.toFixed(2)} 丝`;
    }

    formatCircularDeviationResult(sideA, valueA, sideB, valueB) {
        if (valueA === null || valueB === null) {
            return '--';
        }

        if (valueA === valueB) {
            return '无偏差 0.00 丝';
        }

        const smallerSide = valueA < valueB ? sideA : sideB;
        const deviationValue = Math.abs(valueA - valueB) * 100 / 2;
        const roundedValue = this.stableRound2(deviationValue);
        return `${this.sideName(smallerSide)}偏 ${roundedValue.toFixed(2)} 丝`;
    }

    buildPhysicalStatsFrom(measurements) {
        const sides = ['top', 'right', 'bottom', 'left'];
        const stats = {
            top: { axial1: { avg: null, count: 0 }, axial2: { avg: null, count: 0 }, radial: { avg: null, count: 0 } },
            right: { axial1: { avg: null, count: 0 }, axial2: { avg: null, count: 0 }, radial: { avg: null, count: 0 } },
            bottom: { axial1: { avg: null, count: 0 }, axial2: { avg: null, count: 0 }, radial: { avg: null, count: 0 } },
            left: { axial1: { avg: null, count: 0 }, axial2: { avg: null, count: 0 }, radial: { avg: null, count: 0 } }
        };

        sides.forEach(position => {
            const meas = measurements[position] || [];
            const avgA1 = this.calculateAverage(meas, 'axial1');
            const avgA2 = this.calculateAverage(meas, 'axial2');
            const avgRd = this.calculateAverage(meas, 'radial');
            const countA1 = meas.filter(r => r.axial1 !== null && r.axial1 !== undefined).length;
            const countA2 = meas.filter(r => r.axial2 !== null && r.axial2 !== undefined).length;
            const countRd = meas.filter(r => r.radial !== null && r.radial !== undefined).length;

            const axialSideMap = this.getAxialSideMap(position);
            const radialSide = this.getRadialSide(position);

            if (axialSideMap.axial1 && stats[axialSideMap.axial1]) stats[axialSideMap.axial1].axial1 = { avg: avgA1, count: countA1 };
            if (axialSideMap.axial2 && stats[axialSideMap.axial2]) stats[axialSideMap.axial2].axial2 = { avg: avgA2, count: countA2 };
            if (radialSide && stats[radialSide]) stats[radialSide].radial = { avg: avgRd, count: countRd };
        });

        return stats;
    }

    buildComputedTexts(measurements) {
        const avg = {
            top: {
                axial1: this.calculateAverage(measurements.top || [], 'axial1'),
                axial2: this.calculateAverage(measurements.top || [], 'axial2'),
                radial: this.calculateAverage(measurements.top || [], 'radial')
            },
            right: {
                axial1: this.calculateAverage(measurements.right || [], 'axial1'),
                axial2: this.calculateAverage(measurements.right || [], 'axial2'),
                radial: this.calculateAverage(measurements.right || [], 'radial')
            },
            bottom: {
                axial1: this.calculateAverage(measurements.bottom || [], 'axial1'),
                axial2: this.calculateAverage(measurements.bottom || [], 'axial2'),
                radial: this.calculateAverage(measurements.bottom || [], 'radial')
            },
            left: {
                axial1: this.calculateAverage(measurements.left || [], 'axial1'),
                axial2: this.calculateAverage(measurements.left || [], 'axial2'),
                radial: this.calculateAverage(measurements.left || [], 'radial')
            }
        };

        const topAxialMap = this.getAxialSideMap('top');
        const rightAxialMap = this.getAxialSideMap('right');
        const bottomAxialMap = this.getAxialSideMap('bottom');
        const leftAxialMap = this.getAxialSideMap('left');
        const physical = this.buildPhysicalDisplayValuesFrom(measurements);

        const openingTopRaw = this.buildOpeningMeasure(topAxialMap.axial1, avg.top.axial1, topAxialMap.axial2, avg.top.axial2);
        const openingRightRaw = this.buildOpeningMeasure(rightAxialMap.axial1, avg.right.axial1, rightAxialMap.axial2, avg.right.axial2);
        const openingBottomRaw = this.buildOpeningMeasure(bottomAxialMap.axial1, avg.bottom.axial1, bottomAxialMap.axial2, avg.bottom.axial2);
        const openingLeftRaw = this.buildOpeningMeasure(leftAxialMap.axial1, avg.left.axial1, leftAxialMap.axial2, avg.left.axial2);

        const openingTB = this.formatCombinedOpeningResult(openingTopRaw, openingBottomRaw);
        const openingLR = this.formatCombinedOpeningResult(openingRightRaw, openingLeftRaw);

        return {
            openingTB,
            openingLR,
            circularDeviationTB: this.formatCircularDeviationResult('top', physical.top.radial, 'bottom', physical.bottom.radial),
            circularDeviationLR: this.formatCircularDeviationResult('left', physical.left.radial, 'right', physical.right.radial)
        };
    }

    buildPhysicalDisplayValuesFrom(measurements) {
        const display = {
            top: { axial1: null, axial2: null, radial: null },
            right: { axial1: null, axial2: null, radial: null },
            bottom: { axial1: null, axial2: null, radial: null },
            left: { axial1: null, axial2: null, radial: null }
        };

        ['top', 'right', 'bottom', 'left'].forEach(position => {
            const meas = measurements[position] || [];
            const avgA1 = this.calculateAverage(meas, 'axial1');
            const avgA2 = this.calculateAverage(meas, 'axial2');
            const avgRd = this.calculateAverage(meas, 'radial');

            const axialSideMap = this.getAxialSideMap(position);
            const radialSide = this.getRadialSide(position);

            if (axialSideMap.axial1 && display[axialSideMap.axial1]) display[axialSideMap.axial1].axial1 = avgA1;
            if (axialSideMap.axial2 && display[axialSideMap.axial2]) display[axialSideMap.axial2].axial2 = avgA2;
            if (radialSide && display[radialSide]) display[radialSide].radial = avgRd;
        });

        return display;
    }

    buildResultEntries(measurements) {
        const computed = this.buildComputedTexts(measurements);
        return [
            { label: '上下张口', value: computed.openingTB },
            { label: '左右张口', value: computed.openingLR },
            { label: '圆周偏差1（上/下对点）', value: computed.circularDeviationTB },
            { label: '圆周偏差2（左/右对点）', value: computed.circularDeviationLR }
        ];
    }

    formatMeasurementValue(value) {
        return (typeof value === 'number' && Number.isFinite(value))
            ? value.toFixed(4)
            : '--';
    }

    buildMeasurementRows(measurements) {
        const posLabels = { top: '上', bottom: '下', left: '左', right: '右' };
        const rows = [];

        ['top', 'bottom', 'left', 'right'].forEach(position => {
            (measurements[position] || []).forEach((record, index) => {
                const axial1 = Number(record.axial1);
                const axial2 = Number(record.axial2);
                const radial = Number(record.radial);
                rows.push({
                    position: posLabels[position],
                    index: index + 1,
                    axial1: Number.isFinite(axial1) ? axial1 : null,
                    axial2: Number.isFinite(axial2) ? axial2 : null,
                    radial: Number.isFinite(radial) ? radial : null,
                    time: record.time || '--'
                });
            });
        });

        return rows;
    }

    buildMeasurementLogHtml(measurements) {
        const rows = this.buildMeasurementRows(measurements);
        if (rows.length === 0) {
            return '<div style="font-size:12px;color:#737373;">暂无原始测量记录</div>';
        }

        const htmlRows = rows.map(row => `
            <tr>
                <td style="padding:6px 10px;border:1px solid #ddd;color:#222;background:#fff;">${row.position}</td>
                <td style="padding:6px 10px;border:1px solid #ddd;color:#222;background:#fff;">${row.index}</td>
                <td style="padding:6px 10px;border:1px solid #ddd;color:#222;background:#fff;">${this.formatMeasurementValue(row.axial1)} mm</td>
                <td style="padding:6px 10px;border:1px solid #ddd;color:#222;background:#fff;">${this.formatMeasurementValue(row.axial2)} mm</td>
                <td style="padding:6px 10px;border:1px solid #ddd;color:#222;background:#fff;">${this.formatMeasurementValue(row.radial)} mm</td>
                <td style="padding:6px 10px;border:1px solid #ddd;color:#222;background:#fff;">${row.time}</td>
            </tr>
        `).join('');

        return `
            <table style="width:100%;border-collapse:collapse;margin-bottom:18px;font-size:12px;">
                <tr style="background:#f0f0f0;">
                    <th style="padding:6px 10px;border:1px solid #ddd;text-align:left;color:#444;">方位</th>
                    <th style="padding:6px 10px;border:1px solid #ddd;text-align:left;color:#444;">序号</th>
                    <th style="padding:6px 10px;border:1px solid #ddd;text-align:left;color:#444;">轴向1</th>
                    <th style="padding:6px 10px;border:1px solid #ddd;text-align:left;color:#444;">轴向2</th>
                    <th style="padding:6px 10px;border:1px solid #ddd;text-align:left;color:#444;">径向</th>
                    <th style="padding:6px 10px;border:1px solid #ddd;text-align:left;color:#444;">时间</th>
                </tr>
                ${htmlRows}
            </table>
        `;
    }

    checkCompletion() {
        this.updateReportButtonState();
    }

    handleShowReport() {
        const allComplete = ['top', 'bottom', 'left', 'right'].every(pos =>
            this.currentSession.measurements[pos].length > 0
        );
        if (!allComplete) {
            alert('请先完成四个方位测量');
            return;
        }
        this.showReport();
    }

    showReport() {
        const now = new Date();
        const defaultName = `对中测量_${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}_${now.getHours().toString().padStart(2,'0')}${now.getMinutes().toString().padStart(2,'0')}`;

        document.getElementById('reportName').value = defaultName;

        const report = this.generateReportContent();
        document.getElementById('reportContent').innerHTML = report;
        document.getElementById('reportModal').style.display = 'block';

        this.renderInlineResult();          // 在测量结果下方显示简要计算结果
        this.saveCompletedMeasurement(defaultName);
        this.clearWorkingData();
    }

    // 在“测量结果”下方内联显示本次对中的简要计算结果
    renderInlineResult() {
        const box = document.getElementById('calcResultBox');
        if (!box) return;
        const c = this.buildComputedTexts(this.currentSession.measurements);
        box.innerHTML = `
            <div class="cr-title">计算结果</div>
            <div class="cr-row"><span>上下张口</span><b>${c.openingTB}</b></div>
            <div class="cr-row"><span>左右张口</span><b>${c.openingLR}</b></div>
            <div class="cr-row"><span>上下圆周偏差</span><b>${c.circularDeviationTB}</b></div>
            <div class="cr-row"><span>左右圆周偏差</span><b>${c.circularDeviationLR}</b></div>
        `;
        box.style.display = 'block';
    }

    hideInlineResult() {
        const box = document.getElementById('calcResultBox');
        if (box) { box.style.display = 'none'; box.innerHTML = ''; }
    }

    hideReport() {
        this.syncLatestReportName();
        document.getElementById('reportModal').style.display = 'none';
    }

    syncLatestReportName() {
        if (this.completedReports.length === 0) return;

        const inputEl = document.getElementById('reportName');
        if (!inputEl) return;

        const reportName = inputEl.value.trim();
        if (!reportName) return;

        this.completedReports[this.completedReports.length - 1].name = reportName;
        localStorage.setItem(this.reportsKey, JSON.stringify(this.completedReports));
    }

    saveCompletedMeasurement(name) {
        const completedMeasurement = {
            name: name,
            timestamp: Date.now(),
            date: new Date().toLocaleString('zh-CN'),
            measurements: JSON.parse(JSON.stringify(this.currentSession.measurements))
        };
        this.completedReports.push(completedMeasurement);
        localStorage.setItem(this.reportsKey, JSON.stringify(this.completedReports));
    }

    clearWorkingData() {
        this.currentSession = {
            measurements: { top: [], bottom: [], left: [], right: [] },
            activePosition: null
        };
        this.saveSession();
        this.updateUI();
    }

    generateReportContent() {
        const m = this.currentSession.measurements;
        const positions = ['top', 'bottom', 'left', 'right'];
        const posNames = ['上', '下', '左', '右'];
        const fields = ['axial1', 'axial2', 'radial'];
        const fieldNames = ['轴向1', '轴向2', '径向'];
        const physicalStats = this.buildPhysicalStatsFrom(m);

        const computed = this.buildComputedTexts(m);

        const pressCounts = positions.map((pos, i) => {
            const count = (m[pos] || []).length;
            return `<div class="detail-data-item">
                    <div class="detail-data-label">${posNames[i]} 按下次数</div>
                    <div class="detail-data-value">${count} 次</div>
                </div>`;
        }).join('');

        const fmt = (pos, field) => {
            const cell = physicalStats[pos][field];
            return `${cell.avg !== null ? cell.avg.toFixed(4) : '--'} mm (${cell.count}次)`;
        };

        let gridItems = '';
        positions.forEach((pos, pi) => {
            fields.forEach((f, fi) => {
                gridItems += `
                <div class="detail-data-item">
                    <div class="detail-data-label">${posNames[pi]} ${fieldNames[fi]}</div>
                    <div class="detail-data-value">${fmt(pos, f)}</div>
                </div>`;
            });
        });

        let resultItems = `
                <div class="result-item">
                    <div class="result-label">上下张口</div>
                    <div class="result-value">${computed.openingTB}</div>
                </div>`;
        resultItems += `
                <div class="result-item">
                    <div class="result-label">左右张口</div>
                    <div class="result-value">${computed.openingLR}</div>
                </div>`;
        resultItems += `
                <div class="result-item">
                    <div class="result-label">圆周偏差1（上/下对点）</div>
                    <div class="result-value">${computed.circularDeviationTB}</div>
                </div>
                <div class="result-item">
                    <div class="result-label">圆周偏差2（左/右对点）</div>
                    <div class="result-value">${computed.circularDeviationLR}</div>
                </div>`;

        return `
            <div class="detail-data-grid">${pressCounts}
            </div>

            <div class="detail-data-grid" style="margin-top: 18px;">${gridItems}
            </div>

            <div style="margin-top: 25px;">
                <h4 style="color: #737373; font-size: 0.9em; margin-bottom: 15px; text-transform: uppercase;">原始测量记录</h4>
                ${this.buildMeasurementLogHtml(m)}
            </div>

            <div style="margin-top: 25px;">
                <h4 style="color: #737373; font-size: 0.9em; margin-bottom: 15px; text-transform: uppercase;">计算结果</h4>
                ${resultItems}
            </div>
        `;
    }

    async exportPDF() {
        const reportName = document.getElementById('reportName').value || '对中测量报告';

        this.syncLatestReportName();

        const lastReport = this.completedReports[this.completedReports.length - 1];
        const m = lastReport.measurements;

        // 构建测量数据表格行
        const posLabels = ['上', '下', '左', '右'];
        const posKeys = ['top', 'bottom', 'left', 'right'];
        const sensors = ['axial1', 'axial2', 'radial'];
        const sensorLabels = ['轴向1', '轴向2', '径向'];
        const physicalStats = this.buildPhysicalStatsFrom(m);

        let pressRows = '';
        posKeys.forEach((pos, pi) => {
            const count = (m[pos] || []).length;
            pressRows += `<tr><td style="padding:6px 10px;border:1px solid #ddd;">${posLabels[pi]}</td><td style="padding:6px 10px;border:1px solid #ddd;">${count} 次</td></tr>`;
        });

        let dataRows = '';
        posKeys.forEach((pos, pi) => {
            sensors.forEach((s, si) => {
                const cell = physicalStats[pos][s];
                dataRows += `<tr><td style="padding:6px 10px;border:1px solid #ddd;">${posLabels[pi]}</td><td style="padding:6px 10px;border:1px solid #ddd;">${sensorLabels[si]}</td><td style="padding:6px 10px;border:1px solid #ddd;">${cell.avg !== null ? cell.avg.toFixed(4) : '--'} mm</td></tr>`;
            });
        });

        const resultsHtml = this.buildResultEntries(m)
            .map(item => `<p style="margin:4px 0;">${item.label}: ${item.value}</p>`)
            .join('');

        const htmlContent = `
        <div style="font-family:'Microsoft YaHei','SimHei','PingFang SC',sans-serif;padding:25px;width:700px;background:white;color:#333;font-size:13px;">
            <h2 style="text-align:center;margin:0 0 5px 0;font-size:18px;">${reportName}</h2>
            <p style="text-align:center;color:#666;font-size:12px;margin:0 0 18px 0;">测量时间: ${lastReport.date}</p>
            <h3 style="font-size:14px;margin:0 0 8px 0;border-bottom:1px solid #eee;padding-bottom:5px;">按下次数</h3>
            <table style="width:100%;border-collapse:collapse;margin-bottom:18px;font-size:12px;">
                <tr style="background:#f0f0f0;">
                    <th style="padding:6px 10px;border:1px solid #ddd;text-align:left;">方位</th>
                    <th style="padding:6px 10px;border:1px solid #ddd;text-align:left;">次数</th>
                </tr>
                ${pressRows}
            </table>
            <h3 style="font-size:14px;margin:0 0 8px 0;border-bottom:1px solid #eee;padding-bottom:5px;">测量数据</h3>
            <table style="width:100%;border-collapse:collapse;margin-bottom:18px;font-size:12px;">
                <tr style="background:#f0f0f0;">
                    <th style="padding:6px 10px;border:1px solid #ddd;text-align:left;">方位</th>
                    <th style="padding:6px 10px;border:1px solid #ddd;text-align:left;">传感器</th>
                    <th style="padding:6px 10px;border:1px solid #ddd;text-align:left;">平均值</th>
                </tr>
                ${dataRows}
            </table>
            <h3 style="font-size:14px;margin:0 0 8px 0;border-bottom:1px solid #eee;padding-bottom:5px;">原始测量记录</h3>
            ${this.buildMeasurementLogHtml(m)}
            <h3 style="font-size:14px;margin:0 0 8px 0;border-bottom:1px solid #eee;padding-bottom:5px;">计算结果</h3>
            <div style="margin-bottom:18px;font-size:12px;">${resultsHtml}</div>
        </div>`;

        // 优先尝试使用html2canvas+jsPDF，如果CDN不可用则降级为浏览器打印保存PDF
        const libsReady = await this.ensurePdfLibraries();
        if (!libsReady) {
            this.exportPDFByPrint(reportName, htmlContent);
            this.hideReport();
            return;
        }

        const container = document.createElement('div');
        container.style.position = 'fixed';
        container.style.left = '-9999px';
        container.style.top = '0';
        container.innerHTML = htmlContent;
        document.body.appendChild(container);

        try {
            const canvas = await html2canvas(container.firstElementChild, { scale: 2, useCORS: true });
            const imgData = canvas.toDataURL('image/png');
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF('p', 'mm', 'a4');
            const pageWidth = doc.internal.pageSize.getWidth();
            const pageHeight = doc.internal.pageSize.getHeight();
            const margin = 10;
            const imgWidth = pageWidth - margin * 2;
            const imgHeight = (canvas.height * imgWidth) / canvas.width;

            if (imgHeight <= pageHeight - margin * 2) {
                doc.addImage(imgData, 'PNG', margin, margin, imgWidth, imgHeight);
            } else {
                const pageContentHeight = pageHeight - margin * 2;
                const sourcePageHeight = (pageContentHeight / imgHeight) * canvas.height;
                const pages = Math.ceil(canvas.height / sourcePageHeight);
                for (let p = 0; p < pages; p++) {
                    if (p > 0) doc.addPage();
                    const srcY = p * sourcePageHeight;
                    const srcH = Math.min(sourcePageHeight, canvas.height - srcY);
                    const destH = (srcH / canvas.height) * imgHeight;
                    const pageCanvas = document.createElement('canvas');
                    pageCanvas.width = canvas.width;
                    pageCanvas.height = srcH;
                    const ctx = pageCanvas.getContext('2d');
                    ctx.drawImage(canvas, 0, srcY, canvas.width, srcH, 0, 0, canvas.width, srcH);
                    doc.addImage(pageCanvas.toDataURL('image/png'), 'PNG', margin, margin, imgWidth, destH);
                }
            }

            doc.save(`${reportName}.pdf`);
            alert('PDF已导出');
        } catch (error) {
            console.error('PDF导出失败:', error);
            alert('PDF导出失败: ' + error.message);
        } finally {
            document.body.removeChild(container);
        }
        this.hideReport();
    }

    loadScript(url) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = url;
            script.async = true;
            script.onload = () => resolve(true);
            script.onerror = () => reject(new Error('加载失败: ' + url));
            document.head.appendChild(script);
        });
    }

    async tryLoadFromList(urls, checker) {
        if (checker()) return true;
        for (const url of urls) {
            try {
                await this.loadScript(url);
                if (checker()) return true;
            } catch (e) {
                console.warn(e.message);
            }
        }
        return checker();
    }

    async ensurePdfLibraries() {
        const html2canvasReady = () => typeof window.html2canvas === 'function';
        const jsPdfReady = () => window.jspdf && typeof window.jspdf.jsPDF === 'function';

        // 从 CDN 加载（Service Worker 会缓存, 联网一次后离线也可用）
        const html2canvasOk = await this.tryLoadFromList([
            'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
            'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
            'https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js'
        ], html2canvasReady);

        const jsPdfOk = await this.tryLoadFromList([
            'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
            'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
            'https://unpkg.com/jspdf@2.5.1/dist/jspdf.umd.min.js'
        ], jsPdfReady);

        return html2canvasOk && jsPdfOk;
    }

    exportPDFByPrint(reportName, htmlContent) {
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            alert('PDF导出失败: 无法打开打印窗口，请允许弹窗或改用CSV导出');
            return;
        }

        const printable = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${reportName}</title>
    <style>
body { margin: 0; padding: 20px; background: #fff; color: #333; }
    </style>
</head>
<body>
${htmlContent}
</body>
</html>`;

        printWindow.document.open();
        printWindow.document.write(printable);
        printWindow.document.close();
        setTimeout(() => {
            printWindow.focus();
            printWindow.print();
        }, 300);
        alert('当前网络无法加载PDF库，已切换为打印保存PDF');
    }

    exportCSV() {
        const reportName = document.getElementById('reportName').value || '对中测量报告';

        this.syncLatestReportName();

        const lastReport = this.completedReports[this.completedReports.length - 1];
        const m = lastReport.measurements;

        const posLabels = ['上', '下', '左', '右'];
        const posKeys = ['top', 'bottom', 'left', 'right'];
        const sensors = ['axial1', 'axial2', 'radial'];
        const sensorLabels = ['轴向1', '轴向2', '径向'];
        const physicalStats = this.buildPhysicalStatsFrom(m);

        let rows = [];
        // BOM for UTF-8 Excel compatibility
        rows.push('测量名称,' + reportName);
        rows.push('测量时间,' + lastReport.date);
        rows.push('');
        rows.push('按下次数,次数');
        posKeys.forEach((pos, pi) => {
            rows.push(`${posLabels[pi]},${(m[pos] || []).length}`);
        });
        rows.push('');
        rows.push('方位,传感器,平均值(mm)');

        posKeys.forEach((pos, pi) => {
            sensors.forEach((s, si) => {
                const cell = physicalStats[pos][s];
                rows.push(`${posLabels[pi]},${sensorLabels[si]},${cell.avg !== null ? cell.avg.toFixed(4) : '--'}`);
            });
        });

        rows.push('');
        rows.push('计算结果,数值');
        this.buildResultEntries(m).forEach(item => {
            rows.push(`${item.label},${item.value}`);
        });

        rows.push('');
        rows.push('原始测量记录');
        rows.push('方位,序号,轴向1(mm),轴向2(mm),径向(mm),时间');
        this.buildMeasurementRows(m).forEach(row => {
            rows.push(`${row.position},${row.index},${this.formatMeasurementValue(row.axial1)},${this.formatMeasurementValue(row.axial2)},${this.formatMeasurementValue(row.radial)},${row.time}`);
        });

        const csvContent = '﻿' + rows.join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${reportName}.csv`;
        link.click();
        URL.revokeObjectURL(link.href);
        alert('CSV已导出');
        this.hideReport();
    }

    resetMeasurements() {
        if (!confirm('确定要删除全部测量记录？')) return;
        this.currentSession = {
            measurements: { top: [], bottom: [], left: [], right: [] },
            activePosition: null
        };
        this.saveSession();
        this.hideInlineResult();       // 清掉计算结果显示
        this.resetRotationAndView();   // 模型旋转 + 视向也回到最初状态
        this.updateUI();
    }

    showSettings() {
        document.getElementById('axial1IP').value = this.axial1Host;
        document.getElementById('axial2IP').value = this.axial2Host;
        document.getElementById('radialIP').value = this.radialHost;
        document.getElementById('useMockData').checked = this.useMockData;
        document.getElementById('settingsModal').style.display = 'block';
    }

    hideSettings() {
        document.getElementById('settingsModal').style.display = 'none';
    }

    // ============ Three.js 3D 场景 ============
    init3DView() {
        if (this.view3D.initialized) return;
        const container = document.getElementById('view3dContainer');
        if (!container || typeof THREE === 'undefined') return;

        const w = container.clientWidth || 800;
        const h = container.clientHeight || 520;

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0xe8ebef);

        const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 2000);
        camera.position.set(220, 140, 260);
        camera.lookAt(0, 0, 0);

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(window.devicePixelRatio || 1);
        renderer.setSize(w, h);
        container.appendChild(renderer.domElement);

        // 光照
        scene.add(new THREE.AmbientLight(0xffffff, 0.75));
        const dir = new THREE.DirectionalLight(0xffffff, 0.6);
        dir.position.set(150, 250, 200);
        scene.add(dir);
        const dir2 = new THREE.DirectionalLight(0xffffff, 0.3);
        dir2.position.set(-150, -100, -200);
        scene.add(dir2);

        // 地面网格参考
        const grid = new THREE.GridHelper(600, 30, 0xbbbbbb, 0xdddddd);
        grid.position.y = -90;
        scene.add(grid);

        this.view3D.scene = scene;
        this.view3D.camera = camera;
        this.view3D.renderer = renderer;

        this.buildCouplingModel();
        this.initOrbit();
        this.setupOrbitInteraction();

        this.view3D.initialized = true;
        this.applyConfigToScene();     // 上色 (高压侧蓝 / 低压侧灰)
        this.rebuildSensorMeshes();    // 依据 installed + sensorStart 构建支架/传感器/贴片
        this.updateRotationArrow();    // 旋转方向弧形箭头
        this.updateCameraFromOrbit();
        this.animate3D();
        this.updateStopUI();
        // 布局生效后再校正一次尺寸, 防止初始化时容器尺寸为 0 而空白
        requestAnimationFrame(() => this.onResize3D());

        window.addEventListener('resize', () => this.onResize3D());
    }

    buildCouplingModel() {
        const scene = this.view3D.scene;
        const group = new THREE.Group();       // 联轴器组 (随盘车绕 X 旋转)
        const markerGroup = new THREE.Group();  // 支架 / 传感器 / 贴片 (随盘车绕 X 旋转)

        // 轴沿 X 方向。左半联轴器(基准) + 右半联轴器(调整), 中间为对开面(测量面)
        // gap 为两圆盘对开面之间的缝隙
        const flangeR = 60, flangeLen = 24, shaftR = 26, shaftLen = 120, gap = 30;
        this.view3D.dims = { flangeR, flangeLen, shaftR, shaftLen, gap };

        // 高压侧/低压侧用金属黑白灰色系表现轴瓦质感 (偏白 / 偏灰), 由 applyConfigToScene 按高压缸侧赋色
        const matLeft = new THREE.MeshPhongMaterial({ color: 0xd2d7dd, shininess: 60 });
        const matRight = new THREE.MeshPhongMaterial({ color: 0x8b9199, shininess: 60 });

        const mkFlange = (mat) => new THREE.Mesh(new THREE.CylinderGeometry(flangeR, flangeR, flangeLen, 48), mat);
        const mkShaft = (mat) => new THREE.Mesh(new THREE.CylinderGeometry(shaftR, shaftR, shaftLen, 32), mat);

        // 左侧半联轴器 (法兰 + 轴), 圆柱默认沿 Y, 旋转到 X
        const leftFlange = mkFlange(matLeft);
        leftFlange.rotation.z = Math.PI / 2;
        leftFlange.position.x = -(gap / 2 + flangeLen / 2);
        const leftShaft = mkShaft(matLeft);
        leftShaft.rotation.z = Math.PI / 2;
        leftShaft.position.x = -(gap / 2 + flangeLen + shaftLen / 2);

        const rightFlange = mkFlange(matRight);
        rightFlange.rotation.z = Math.PI / 2;
        rightFlange.position.x = (gap / 2 + flangeLen / 2);
        const rightShaft = mkShaft(matRight);
        rightShaft.rotation.z = Math.PI / 2;
        rightShaft.position.x = (gap / 2 + flangeLen + shaftLen / 2);

        const leftHalf = new THREE.Group();
        leftHalf.add(leftFlange, leftShaft);
        leftHalf.userData.side = 'left';
        const rightHalf = new THREE.Group();
        rightHalf.add(rightFlange, rightShaft);
        rightHalf.userData.side = 'right';

        group.add(leftHalf, rightHalf);

        this.view3D.leftHalf = leftHalf;
        this.view3D.rightHalf = rightHalf;
        this.view3D.leftMat = matLeft;
        this.view3D.rightMat = matRight;
        this.view3D.flangeR = flangeR;
        this.view3D.gap = gap;

        scene.add(group);
        scene.add(markerGroup);
        this.view3D.coupling = group;
        this.view3D.markerGroup = markerGroup;
        this.buildFaceLabels();
    }

    // 文字精灵 (画布贴图), 用于端面角度标注
    makeTextSprite(text, opts = {}) {
        const size = opts.size || 128;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, size, size);
        ctx.fillStyle = opts.bg || 'rgba(26,26,26,0.82)';
        const r = size * 0.22;
        // 圆角矩形底
        ctx.beginPath();
        ctx.moveTo(r, size * 0.28);
        ctx.arcTo(size - 4, size * 0.28, size - 4, size * 0.72, r);
        ctx.arcTo(size - 4, size * 0.72, 4, size * 0.72, r);
        ctx.arcTo(4, size * 0.72, 4, size * 0.28, r);
        ctx.arcTo(4, size * 0.28, size - 4, size * 0.28, r);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = opts.color || '#ffffff';
        ctx.font = `bold ${opts.font || 46}px 'Segoe UI', Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, size / 2, size / 2);
        const tex = new THREE.CanvasTexture(canvas);
        tex.minFilter = THREE.LinearFilter;
        const mat = new THREE.SpriteMaterial({ map: tex, depthTest: true, depthWrite: false, transparent: true });
        const spr = new THREE.Sprite(mat);
        const scale = opts.scale || 26;
        spr.scale.set(scale, scale, 1);
        spr.renderOrder = 5;
        return spr;
    }

    // 联轴器后侧面 (低压侧法兰的后端面) 外缘的四个角度标注:
    //   0°(上) / 90°(后) / 180°(下) / 270°(前)
    // 标签随盘车一起旋转(挂到 coupling 组), 表示端面上的物理刻度; 贴着法兰后侧面外缘, 不伸到细轴上。
    buildFaceLabels() {
        const grp = this.view3D.coupling;
        if (!grp) return;
        const dims = this.view3D.dims || {};
        const half = (dims.gap || 30) / 2;
        const flangeR = dims.flangeR || 60;
        // 后侧面: 右半(低压侧)法兰背向缝隙的那个端面 x 坐标 (稍微外移一点避免 z-fighting)
        const faceX = half + (dims.flangeLen || 24) + 3;
        const R = flangeR + 10;   // 紧挨法兰外缘
        // 端面局部坐标: +Y=上=0°, -Z=后=90°, -Y=下=180°, +Z=前=270° (随停位顺序 上→后→下→前)
        const specs = [
            { t: '0°',   y: R,  z: 0  },
            { t: '90°',  y: 0,  z: -R },
            { t: '180°', y: -R, z: 0  },
            { t: '270°', y: 0,  z: R  }
        ];
        specs.forEach(s => {
            const spr = this.makeTextSprite(s.t, { scale: 18, font: 40 });
            spr.position.set(faceX, s.y, s.z);
            grp.add(spr);
        });
    }

    // 旋转方向示意: 沿联轴器圆柱面外一定距离的弧形箭头 (顺/逆时针随 rotateDir 翻转)。
    // 该箭头固定在空间中, 不随盘车旋转, 仅表示“正转/反转”的方向感。
    updateRotationArrow() {
        if (!this.view3D.initialized || typeof THREE === 'undefined') return;
        const scene = this.view3D.scene;
        if (this.view3D.dirArrow) {
            scene.remove(this.view3D.dirArrow);
            this.view3D.dirArrow = null;
        }
        const R = (this.view3D.flangeR || 60) + 42;   // 距圆柱面一定距离
        const xPos = 0;                                // 位于对开面处, 环绕接缝
        const mat = new THREE.MeshPhongMaterial({ color: 0xf0a020 });
        const dir = this.rotateDir > 0 ? 1 : -1;
        const startA = -Math.PI / 12;
        const sweep = Math.PI / 6 * dir;               // ~30° 弧, 示意即可, 方向由 rotateDir 决定
        const N = 20;
        const pts = [];
        for (let i = 0; i <= N; i++) {
            const a = startA + sweep * (i / N);
            pts.push(new THREE.Vector3(xPos, R * Math.cos(a), R * Math.sin(a)));
        }
        const grp = new THREE.Group();
        const curve = new THREE.CatmullRomCurve3(pts);
        grp.add(new THREE.Mesh(new THREE.TubeGeometry(curve, N, 2.2, 10, false), mat));
        // 末端箭头 (沿切线方向的圆锥)
        const pEnd = pts[pts.length - 1];
        const pPrev = pts[pts.length - 2];
        const tangent = new THREE.Vector3().subVectors(pEnd, pPrev).normalize();
        const cone = new THREE.Mesh(new THREE.ConeGeometry(7, 18, 16), mat);
        cone.position.copy(pEnd);
        cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
        grp.add(cone);
        scene.add(grp);
        this.view3D.dirArrow = grp;
    }

    // ============ 轨道相机控制 ============
    initOrbit() {
        this.view3D.orbit = {
            radius: 380,
            theta: Math.PI * 0.25,   // 方位角 (水平)
            phi: Math.PI * 0.36,     // 天顶角 (垂直, 从 +Y 起)
            target: new THREE.Vector3(0, 0, 0),
            minR: 150,
            maxR: 900
        };
        // 记录初始视向, 供“切换回原始视向”一键恢复
        this.view3D.orbitHome = { radius: 380, theta: Math.PI * 0.25, phi: Math.PI * 0.36 };
    }

    // 一键恢复到最初的视向 (不动模型旋转/测量数据)
    resetView() {
        const o = this.view3D.orbit, home = this.view3D.orbitHome;
        if (!o || !home) return;
        o.radius = home.radius;
        o.theta = home.theta;
        o.phi = home.phi;
        o.target.set(0, 0, 0);
        this.updateCameraFromOrbit();
    }

    // 模型旋转 + 视向都回到最初状态 (盘车回到最上方停位)
    resetRotationAndView() {
        this.view3D.rotTween = null;   // 取消进行中的旋转动画
        this.view3D.rotX = 0;
        this.view3D.angleStep = 0;
        this.applyRotation();
        this.updateStopUI();
        this.resetView();
    }

    updateCameraFromOrbit() {
        const cam = this.view3D.camera;
        const o = this.view3D.orbit;
        if (!cam || !o) return;
        const sinPhi = Math.sin(o.phi);
        cam.position.set(
            o.target.x + o.radius * sinPhi * Math.cos(o.theta),
            o.target.y + o.radius * Math.cos(o.phi),
            o.target.z + o.radius * sinPhi * Math.sin(o.theta)
        );
        cam.lookAt(o.target);
    }

    _pointerDist(pointers) {
        const pts = Array.from(pointers.values());
        return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    }

    // 画布上拖动 = 轨道旋转视角; 滚轮/双指 = 缩放
    setupOrbitInteraction() {
        const dom = this.view3D.renderer.domElement;
        if (!dom) return;
        dom.style.touchAction = 'none';
        const o = this.view3D.orbit;
        const pointers = new Map();
        let dragging = false, lastX = 0, lastY = 0, pinchDist = 0;

        dom.addEventListener('pointerdown', (e) => {
            if (dom.setPointerCapture) { try { dom.setPointerCapture(e.pointerId); } catch (_) {} }
            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pointers.size === 1) {
                dragging = true; lastX = e.clientX; lastY = e.clientY;
            } else if (pointers.size === 2) {
                dragging = false; pinchDist = this._pointerDist(pointers);
            }
        });

        dom.addEventListener('pointermove', (e) => {
            if (!pointers.has(e.pointerId)) return;
            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

            if (pointers.size >= 2) {
                const d = this._pointerDist(pointers);
                if (pinchDist > 0) {
                    o.radius = Math.min(o.maxR, Math.max(o.minR, o.radius * (pinchDist / d)));
                    this.updateCameraFromOrbit();
                }
                pinchDist = d;
                return;
            }
            if (!dragging) return;
            const dx = e.clientX - lastX, dy = e.clientY - lastY;
            lastX = e.clientX; lastY = e.clientY;
            // 向左拖 → 视角向左转 (修正此前水平方向相反的问题)
            o.theta += dx * 0.005;
            o.phi = Math.min(Math.PI - 0.12, Math.max(0.12, o.phi - dy * 0.005));
            this.updateCameraFromOrbit();
        });

        const endPointer = (e) => {
            pointers.delete(e.pointerId);
            if (pointers.size < 2) pinchDist = 0;
            if (pointers.size === 0) dragging = false;
        };
        window.addEventListener('pointerup', endPointer);
        dom.addEventListener('pointercancel', endPointer);

        dom.addEventListener('wheel', (e) => {
            e.preventDefault();
            const factor = 1 + (e.deltaY > 0 ? 0.1 : -0.1);
            o.radius = Math.min(o.maxR, Math.max(o.minR, o.radius * factor));
            this.updateCameraFromOrbit();
        }, { passive: false });
    }

    // 把联轴器 + 四方位标签 + 传感器实体一起绕 X 转到当前弧度
    applyRotation() {
        const r = this.view3D.rotX;
        if (this.view3D.coupling) this.view3D.coupling.rotation.x = r;
        if (this.view3D.markerGroup) this.view3D.markerGroup.rotation.x = r;
    }

    // 吸附到最近 90° 停位, 更新当前停位 (不含动画; 由动画结束时调用)
    snapRotation() {
        const half = Math.PI / 2;
        const step = Math.round(this.view3D.rotX / half);
        this.view3D.rotX = step * half;
        this.applyRotation();
        this.view3D.angleStep = ((step % 4) + 4) % 4;
        this.updateStopUI();
    }

    // 在当前基础上转 deg 度, 吸附到最近 90°, 并带过渡动画平滑转过去
    rotateByDegrees(deg) {
        if (!deg) return;
        const half = Math.PI / 2;
        const from = this.view3D.rotX;
        const rawTarget = from + deg * Math.PI / 180;
        const step = Math.round(rawTarget / half);
        const target = step * half;            // 最终吸附到的停位角
        if (target === from) return;
        this.startRotationTween(from, target, () => {
            this.view3D.rotX = target;
            this.view3D.angleStep = ((step % 4) + 4) % 4;
            this.applyRotation();
            this.updateStopUI();
        });
    }

    // 旋转过渡动画: 在 animate3D 循环里按时间插值推进
    startRotationTween(from, to, onDone) {
        // 动画时长与转过的角度成正比 (每 90° 约 360ms), 上限 1200ms
        const span = Math.abs(to - from);
        const duration = Math.min(1200, Math.max(280, span / (Math.PI / 2) * 360));
        this.view3D.rotTween = {
            from, to, onDone,
            start: Date.now(),
            duration
        };
    }

    // 每帧推进旋转动画 (在 animate3D 中调用)
    stepRotationTween() {
        const tw = this.view3D.rotTween;
        if (!tw) return;
        const t = Math.min(1, (Date.now() - tw.start) / tw.duration);
        // easeInOutCubic
        const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        this.view3D.rotX = tw.from + (tw.to - tw.from) * e;
        this.applyRotation();
        if (t >= 1) {
            this.view3D.rotTween = null;
            if (tw.onDone) tw.onDone();
        }
    }

    currentStopKey() {
        return this.getRotationOrder()[this.view3D.angleStep || 0];
    }

    updateStopUI() {
        const el = document.getElementById('currentStopLabel');
        if (el) el.textContent = this.sideName(this.currentStopKey());
    }

    updateCylinderBtn() {
        const btn = document.getElementById('cylinderToggleBtn');
        if (btn) btn.textContent = '切换高/低压缸位置';
    }

    updateRotateDirBtn() {
        const btn = document.getElementById('rotateDirBtn');
        if (btn) btn.title = '切换旋转方向：当前是' + (this.rotateDir > 0 ? '正转' : '反转');
        this.updateRotationArrow();
    }

    setHighPressureSide(side) {
        if (side !== 'left' && side !== 'right') return;
        this.sensorLayout.highPressureSide = side;
        this.saveToStorage();
        this.applyConfigToScene();
    }

    toggleHighPressureSide() {
        const next = this.sensorLayout.highPressureSide === 'left' ? 'right' : 'left';
        this.setHighPressureSide(next);
        // 高低压缸互换后, 安装侧(mountHalfSide)随之改变, 重建支架与传感器
        this.rebuildSensorMeshes();
    }

    // 用 sensorStart / installSide 回填安装面板控件
    populateInstallPanel() {
        // 方位以联轴器端面刻度标注: top=0° right=90° bottom=180° left=270° (与 buildFaceLabels 一致)
        const opts = [['top', '0°'], ['right', '90°'], ['bottom', '180°'], ['left', '270°'], ['', '不安装']];
        document.querySelectorAll('.sensor-pos').forEach(sel => {
            const key = sel.dataset.sensor;
            sel.innerHTML = opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
            sel.value = this.sensorStart[key] || '';
        });
        const radio = document.querySelector(`input[name="installSide"][value="${this.installSide}"]`);
        if (radio) radio.checked = true;
    }

    // 实时把面板上的选择读入生效字段并立即渲染 (不保存, 保存由“确认保存”负责)
    applyPanelToLive() {
        const radio = document.querySelector('input[name="installSide"]:checked');
        this.installSide = radio ? radio.value : 'high';
        document.querySelectorAll('.sensor-pos').forEach(sel => {
            this.sensorStart[sel.dataset.sensor] = sel.value || null;
        });
        this.installed = ['axial1', 'axial2', 'radial'].some(k => this.sensorStart[k]);
        this.applyConfigToScene();
        this.rebuildSensorMeshes();
    }

    // 「确认保存」: 把当前配置写回方案并持久化, 然后回到测量模式
    applyInstall() {
        this.applyPanelToLive();
        // 新建方案首次保存 → 开启新的测量历史(重置当前测量)
        if (this._editingNew) {
            this.currentSession = { measurements: { top: [], bottom: [], left: [], right: [] }, activePosition: null };
            this.saveSession();
        }
        this._editingNew = false;
        this._prevActiveId = null;
        this._editBackup = null;
        this.saveToStorage();          // 内部 syncActiveSchemeFromLive() 写回当前方案
        this.renderSchemeSelectors();
        this.updateUI();
        this.hideSchemeEdit();
    }

    // 「×」关闭: 回到测量模式。新建草稿 → 丢弃; 修改已有 → 还原到打开前的快照
    cancelInstall() {
        if (this._editingNew) {
            this.schemes = this.schemes.filter(s => s.id !== this.activeSchemeId);
            this.activeSchemeId = this._prevActiveId || (this.schemes[0] && this.schemes[0].id) || null;
            this.applySchemeToLive(this.getActiveScheme());
        } else if (this._editBackup) {
            // 还原修改前的方案内容
            const s = this.getActiveScheme();
            if (s) Object.assign(s, this._editBackup);
            this.applySchemeToLive(this.getActiveScheme());
        }
        this._editingNew = false;
        this._prevActiveId = null;
        this._editBackup = null;
        this.saveToStorage();
        this.renderSchemeSelectors();
        this.populateInstallPanel();
        this.applyConfigToScene();
        this.rebuildSensorMeshes();
        this.updateUI();
        this.hideSchemeEdit();
    }

    // 显示方案编辑视图(隐藏测量视图), 设置标题
    showSchemeEdit(titleText) {
        const mv = document.getElementById('measureView');
        const ev = document.getElementById('schemeEditView');
        const title = document.getElementById('schemeEditTitle');
        if (title && titleText) title.textContent = titleText;
        if (mv) mv.style.display = 'none';
        if (ev) ev.style.display = 'block';
    }

    hideSchemeEdit() {
        const mv = document.getElementById('measureView');
        const ev = document.getElementById('schemeEditView');
        if (ev) ev.style.display = 'none';
        if (mv) mv.style.display = 'block';
    }

    // ============ 安装方案(多方案)管理 ============
    makeSchemeId() {
        return 'scheme_' + Date.now().toString(36) + '_' + (this._schemeSeq++);
    }

    getActiveScheme() {
        return this.schemes.find(s => s.id === this.activeSchemeId) || null;
    }

    // 把某方案套用到当前生效字段(计算逻辑读取的镜像)
    applySchemeToLive(scheme) {
        if (!scheme) return;
        this.sensorLayout.highPressureSide = scheme.highPressureSide === 'right' ? 'right' : 'left';
        this.installSide = scheme.installSide === 'low' ? 'low' : 'high';
        this.sensorStart = Object.assign({ axial1: null, axial2: null, radial: null }, scheme.sensorStart || {});
        this.installed = ['axial1', 'axial2', 'radial'].some(k => this.sensorStart[k]);
    }

    // 把当前生效字段写回当前方案(保存时调用, 保持方案与镜像一致)
    syncActiveSchemeFromLive() {
        const s = this.getActiveScheme();
        if (!s) return;
        s.highPressureSide = this.sensorLayout.highPressureSide;
        s.installSide = this.installSide;
        s.sensorStart = Object.assign({}, this.sensorStart);
        s.installed = this.installed;
    }

    // 启动时确保至少有一个方案; 无方案则用当前(或旧数据)字段建默认方案
    ensureSchemes() {
        if (!Array.isArray(this.schemes) || this.schemes.length === 0) {
            const def = {
                id: this.makeSchemeId(),
                name: '方案1',
                highPressureSide: this.sensorLayout.highPressureSide,
                installSide: this.installSide,
                sensorStart: Object.assign({}, this.sensorStart),
                installed: this.installed
            };
            this.schemes = [def];
            this.activeSchemeId = def.id;
            this.saveToStorage();
        } else if (!this.getActiveScheme()) {
            this.activeSchemeId = this.schemes[0].id;
        }
        this.applySchemeToLive(this.getActiveScheme());
    }

    renderSchemeSelectors() {
        const opts = this.schemes.map(s => `<option value="${s.id}">${this.escapeHtml(s.name)}</option>`).join('');
        const el = document.getElementById('switchSchemeSelect');
        if (!el) return;
        el.innerHTML = opts;
        el.value = this.activeSchemeId;
    }

    escapeHtml(str) {
        return String(str == null ? '' : str).replace(/[&<>"']/g, c => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    }

    // 切换生效方案: 有测量数据时提示“开启新测量历史”, 切换后重置当前测量
    switchScheme(id) {
        if (!id || id === this.activeSchemeId) { this.renderSchemeSelectors(); return; }
        const target = this.schemes.find(s => s.id === id);
        if (!target) { this.renderSchemeSelectors(); return; }

        const hasData = ['top', 'bottom', 'left', 'right']
            .some(p => (this.currentSession.measurements[p] || []).length > 0);
        if (hasData && !confirm('切换安装方案将会开启一个新的测量历史。\n\n确定要切换吗？')) {
            this.renderSchemeSelectors();   // 取消: 下拉复位到当前方案
            return;
        }

        this.activeSchemeId = id;
        this.applySchemeToLive(target);
        // 重置当前测量结果 → 开启新的测量历史
        this.currentSession = { measurements: { top: [], bottom: [], left: [], right: [] }, activePosition: null };
        this.saveSession();
        this.saveToStorage();
        this.populateInstallPanel();
        this.renderSchemeSelectors();
        this.applyConfigToScene();
        this.rebuildSensorMeshes();
        this.updateUI();
    }

    addScheme() {
        const name = (prompt('新安装方案名称：', '方案' + (this.schemes.length + 1)) || '').trim();
        if (!name) return;
        this._prevActiveId = this.activeSchemeId;   // 记录以便取消时回退
        this._editBackup = null;
        const scheme = {
            id: this.makeSchemeId(),
            name,
            highPressureSide: this.sensorLayout.highPressureSide,
            installSide: 'high',
            sensorStart: { axial1: 'top', axial2: 'bottom', radial: 'right' },
            installed: true
        };
        this.schemes.push(scheme);
        this.activeSchemeId = scheme.id;
        this._editingNew = true;
        this.applySchemeToLive(scheme);
        this.populateInstallPanel();
        this.renderSchemeSelectors();
        this.applyConfigToScene();
        this.rebuildSensorMeshes();
        this.hideSettings();                          // 关闭设置弹窗(若从设置进入)
        this.showSchemeEdit('新建安装方案：' + name);  // 右侧切换到方案编辑视图
    }

    // 编辑当前生效方案 (标题显示“修改：<名称>”; × 取消可还原)
    editScheme() {
        const s = this.getActiveScheme();
        if (!s) return;
        this._editingNew = false;
        this._prevActiveId = null;
        // 备份当前方案内容, 供 × 取消时还原
        this._editBackup = {
            highPressureSide: s.highPressureSide,
            installSide: s.installSide,
            sensorStart: Object.assign({}, s.sensorStart),
            installed: s.installed
        };
        this.applySchemeToLive(s);
        this.populateInstallPanel();
        this.applyConfigToScene();
        this.rebuildSensorMeshes();
        this.showSchemeEdit('修改安装方案：' + s.name);
    }

    deleteScheme() {
        if (this.schemes.length <= 1) { alert('至少保留一个安装方案'); return; }
        const active = this.getActiveScheme();
        if (!active) return;
        if (!confirm(`确定删除安装方案「${active.name}」？`)) return;
        this.schemes = this.schemes.filter(s => s.id !== active.id);
        this.activeSchemeId = this.schemes[0].id;
        this.applySchemeToLive(this.getActiveScheme());
        // 删除后重置当前测量并切到剩余方案
        this.currentSession = { measurements: { top: [], bottom: [], left: [], right: [] }, activePosition: null };
        this.saveSession();
        this.saveToStorage();
        this.populateInstallPanel();
        this.renderSchemeSelectors();
        this.applyConfigToScene();
        this.rebuildSensorMeshes();
        this.updateUI();
    }

    // 传感器颜色: 轴向青绿, 径向棕 (与联轴器金属灰、基准贴片米色明显区分)
    sensorColor(sensor) {
        return sensor === 'radial' ? 0xa0522d : 0x1f9e89;
    }

    // 探头所在半联轴器: installSide=high → 高压缸侧; low → 低压缸侧(高压对侧)
    mountHalfSide() {
        const hp = this.sensorLayout.highPressureSide;
        return this.installSide === 'high' ? hp : (hp === 'left' ? 'right' : 'left');
    }

    // 某方位、半径 r、轴向 x 处的坐标 (top=+Y, bottom=-Y, left=+Z, right=-Z)
    radialVec(side, r, x) {
        const map = {
            top:    new THREE.Vector3(x, r, 0),
            bottom: new THREE.Vector3(x, -r, 0),
            left:   new THREE.Vector3(x, 0, r),
            right:  new THREE.Vector3(x, 0, -r)
        };
        return map[side] || null;
    }

    // 轴对齐长方体传感器: 沿轴(X)最长, 径向厚度最矮, 平行表面(切向)宽度居中
    makeSensorBox(side, axisLen, radialThick, tangentWidth, xCenter, radius, color, opts = {}) {
        const isVert = side === 'top' || side === 'bottom';
        const sy = isVert ? radialThick : tangentWidth;
        const sz = isVert ? tangentWidth : radialThick;
        const mat = new THREE.MeshPhongMaterial({
            color,
            transparent: opts.opacity != null,
            opacity: opts.opacity != null ? opts.opacity : 1
        });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(axisLen, sy, sz), mat);
        const sign = (side === 'top' || side === 'left') ? 1 : -1;
        mesh.position.x = xCenter;
        if (isVert) mesh.position.y = sign * radius; else mesh.position.z = sign * radius;
        return mesh;
    }

    // 两点间的圆柱 (通用): 用于激光束与结构连接柱
    cylBetween(from, to, radius, mat) {
        const dir = new THREE.Vector3().subVectors(to, from);
        const len = dir.length() || 0.001;
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 12), mat);
        mesh.position.copy(new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5));
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
        return mesh;
    }

    // 激光束: 圆的、细、鲜红
    makeBeam(from, to) {
        return this.cylBetween(from, to, 0.7, new THREE.MeshBasicMaterial({ color: 0xff1500 }));
    }

    // 结构连接柱 (默认灰, 可传色)
    makeStrut(from, to, radius = 3.5, color = 0x6a7482) {
        return this.cylBetween(from, to, radius, new THREE.MeshPhongMaterial({ color }));
    }

    // 生成单个传感器组 (长方体探头 + 贴片/连接柱/测距光束), 挂到随盘车旋转的 markerGroup
    makeSensorMesh(sensor, side) {
        const flangeR = this.view3D.flangeR || 60;
        const flangeLen = (this.view3D.dims && this.view3D.dims.flangeLen) || 24;
        const gap = this.view3D.gap || 30;
        const half = gap / 2;
        const mountSign = this.mountHalfSide() === 'left' ? -1 : 1;
        const color = this.sensorColor(sensor);
        const g = new THREE.Group();
        g.userData.sensor = sensor;

        if (sensor === 'radial') {
            // 径向: 悬臂沿轴越过缝隙伸到对侧圆盘外圆周上方; 安装侧用一段连接柱
            // 接到本侧圆盘外圆周(圆柱面对圆柱面); 末端激光打到对侧圆盘外圆周表面
            const rArm = flangeR + 18;
            const xStart = mountSign * (half + flangeLen * 0.6);
            const xEnd = -mountSign * (half + flangeLen * 0.5);
            const xCenter = (xStart + xEnd) / 2;
            const axisLen = Math.abs(xEnd - xStart);
            g.add(this.makeSensorBox(side, axisLen, 12, 18, xCenter, rArm, color));
            // 安装侧连接柱: 从本侧圆盘外圆周(r=flangeR)接到悬臂, 颜色与径向传感器一致
            g.add(this.makeStrut(
                this.radialVec(side, flangeR, xStart),
                this.radialVec(side, rArm, xStart),
                4, color
            ));
            // 激光束: 悬臂末端径向打到对侧圆盘外圆周表面
            g.add(this.makeBeam(
                this.radialVec(side, rArm, xEnd),
                this.radialVec(side, flangeR, xEnd)
            ));
        } else {
            // 轴向: 探头贴着本侧圆盘外圆周(圆弧面)沿轴放置, 尖端探到缝隙边缘;
            // 对侧圆盘端面上吸附一小块很薄的基准贴片(靠磁铁固定); 激光束示意两者间的轴向距离
            const rOD = flangeR + 5;                              // 贴着外圆柱面
            const xStart = mountSign * (half + flangeLen * 0.7);  // 压在本侧圆盘外缘上
            const xTip = mountSign * (half - 3);                  // 尖端探到缝隙边缘
            const xCenter = (xStart + xTip) / 2;
            const axisLen = Math.abs(xTip - xStart);
            g.add(this.makeSensorBox(side, axisLen, 10, 18, xCenter, rOD, color));
            // 对侧圆盘端面上的薄基准贴片: 内面贴住端面(接触/磁吸), 呈长条状(径向长、切向窄)
            const patchThick = 2.2;                               // 更薄
            const patchFaceX = -mountSign * half;                 // 对侧圆盘朝缝隙的端面
            const patchX = patchFaceX + mountSign * (patchThick / 2);
            g.add(this.makeSensorBox(side, patchThick, 34, 8, patchX, flangeR - 6, 0xe8e2cf));
            // 激光束: 探头尖端 → 贴片 (跨过缝隙的轴向距离)
            g.add(this.makeBeam(
                this.radialVec(side, rOD, xTip),
                this.radialVec(side, rOD, patchX)
            ));
        }
        return g;
    }

    // 依据当前 installed + sensorStart 重建支架与传感器
    rebuildSensorMeshes() {
        if (!this.view3D.initialized || !this.view3D.markerGroup) return;
        const mg = this.view3D.markerGroup;
        while (mg.children.length) mg.remove(mg.children[0]);   // 清空旧的支架/传感器/贴片
        this.view3D.sensorMeshes = { axial1: null, axial2: null, radial: null };
        const anySensor = ['axial1', 'axial2', 'radial'].some(s => this.sensorStart[s]);
        if (!this.installed || !anySensor) return;
        ['axial1', 'axial2', 'radial'].forEach(sensor => {
            const side = this.sensorStart[sensor];
            if (!side) return;
            const mesh = this.makeSensorMesh(sensor, side);
            mg.add(mesh);
            this.view3D.sensorMeshes[sensor] = mesh;
        });
    }

    animate3D() {
        if (!this.view3D.initialized) return;
        this.view3D.animationId = requestAnimationFrame(() => this.animate3D());
        if (this.view3D.rotTween) this.stepRotationTween();   // 推进旋转过渡动画
        if (this.view3D.enabled && this.view3D.renderer) {
            this.view3D.renderer.render(this.view3D.scene, this.view3D.camera);
        }
    }

    onResize3D() {
        const container = document.getElementById('view3dContainer');
        if (!container || !this.view3D.renderer) return;
        const w = container.clientWidth, h = container.clientHeight;
        if (w === 0 || h === 0) return;
        this.view3D.camera.aspect = w / h;
        this.view3D.camera.updateProjectionMatrix();
        this.view3D.renderer.setSize(w, h);
    }

    // 依据配置调整 3D 场景颜色 (高压缸侧偏白, 低压侧偏灰; 金属黑白灰表现轴瓦; 法兰与轴同色)
    applyConfigToScene() {
        if (!this.view3D.initialized) return;
        const hpLeft = this.sensorLayout.highPressureSide === 'left';
        const light = 0xd2d7dd, dark = 0x8b9199;
        if (this.view3D.leftMat) this.view3D.leftMat.color.setHex(hpLeft ? light : dark);
        if (this.view3D.rightMat) this.view3D.rightMat.color.setHex(hpLeft ? dark : light);
    }

    saveSettings() {
        const axial1IP = document.getElementById('axial1IP').value.trim();
        const axial2IP = document.getElementById('axial2IP').value.trim();
        const radialIP = document.getElementById('radialIP').value.trim();
        const useMockData = document.getElementById('useMockData').checked;

        const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;

        if (!useMockData) {
            if (!ipPattern.test(axial1IP)) {
                alert('轴向传感器1 IP地址格式不正确');
                return;
            }
            if (!ipPattern.test(axial2IP)) {
                alert('轴向传感器2 IP地址格式不正确');
                return;
            }
            if (!ipPattern.test(radialIP)) {
                alert('径向传感器 IP地址格式不正确');
                return;
            }
        }

        this.axial1Host = axial1IP;
        this.axial2Host = axial2IP;
        this.radialHost = radialIP;
        this.useMockData = useMockData;

        this.saveToStorage();
        this.hideSettings();
        this.updateUI();
        this.applyConfigToScene();
        alert('设置已保存');
    }

    saveToStorage() {
        try {
            this.syncActiveSchemeFromLive();   // 生效字段写回当前方案
            localStorage.setItem(this.storageKey, JSON.stringify({
                axial1Host: this.axial1Host,
                axial2Host: this.axial2Host,
                radialHost: this.radialHost,
                useMockData: this.useMockData,
                sensorLayout: this.sensorLayout,
                sensorStart: this.sensorStart,
                installSide: this.installSide,
                installed: this.installed,
                schemes: this.schemes,
                activeSchemeId: this.activeSchemeId,
                _schemeSeq: this._schemeSeq
            }));
        } catch (error) {
            console.error('保存设置失败:', error);
        }
    }

    loadSettings() {
        try {
            const saved = localStorage.getItem(this.storageKey);
            if (saved) {
                const settings = JSON.parse(saved);
                this.axial1Host = settings.axial1Host || this.axial1Host;
                this.axial2Host = settings.axial2Host || this.axial2Host;
                this.radialHost = settings.radialHost || this.radialHost;
                this.useMockData = settings.useMockData || false;
                this.installed = settings.installed || false;
                if (settings.installSide === 'high' || settings.installSide === 'low') {
                    this.installSide = settings.installSide;
                }
                if (settings.sensorLayout && settings.sensorLayout.highPressureSide) {
                    this.sensorLayout.highPressureSide = settings.sensorLayout.highPressureSide;
                }
                if (settings.sensorStart) {
                    this.sensorStart = Object.assign({}, this.sensorStart, settings.sensorStart);
                }
                if (Array.isArray(settings.schemes)) this.schemes = settings.schemes;
                if (settings.activeSchemeId) this.activeSchemeId = settings.activeSchemeId;
                if (typeof settings._schemeSeq === 'number') this._schemeSeq = settings._schemeSeq;
            }
        } catch (error) {
            console.error('加载设置失败:', error);
        }
    }

    saveSession() {
        try {
            localStorage.setItem(this.sessionKey, JSON.stringify(this.currentSession));
        } catch (error) {
            console.error('保存会话失败:', error);
        }
    }

    loadSession() {
        try {
            const saved = localStorage.getItem(this.sessionKey);
            if (saved) {
                this.currentSession = JSON.parse(saved);
            }
        } catch (error) {
            console.error('加载会话失败:', error);
        }
    }

    loadReports() {
        try {
            const saved = localStorage.getItem(this.reportsKey);
            if (saved) {
                this.completedReports = JSON.parse(saved);
            }
        } catch (error) {
            console.error('加载报告失败:', error);
        }
    }

    showHistoryModal() {
        const historyList = document.getElementById('historyList');
        const exportBar = document.getElementById('historyExportBar');

        if (this.completedReports.length === 0) {
            historyList.innerHTML = '<div class="history-empty">暂无历史记录</div>';
            exportBar.style.display = 'none';
        } else {
            exportBar.style.display = 'block';
            let html = '';
            for (let i = this.completedReports.length - 1; i >= 0; i--) {
                const report = this.completedReports[i];
                html += this.generateHistoryItemHTML(report, i);
            }
            historyList.innerHTML = html;
            this.updateHistorySelectedCount();
        }
        document.getElementById('historyModal').style.display = 'block';
    }

    generateHistoryItemHTML(report, index) {
        const m = report.measurements;
        const physical = this.buildPhysicalDisplayValuesFrom(m);

        return `
            <div class="history-item" style="position:relative;">
                <label style="position:absolute;top:12px;right:12px;cursor:pointer;z-index:1;" onclick="event.stopPropagation();">
                    <input type="checkbox" class="history-checkbox" data-index="${index}" onchange="system.updateHistorySelectedCount()">
                </label>
                <div onclick="system.showDetailModal(${index})" style="cursor:pointer;">
                    <div class="history-item-header">
                        <div class="history-item-title" id="historyTitle-${index}">${report.name}</div>
                        <div class="history-item-time" style="margin-right:25px;">${report.date}</div>
                    </div>
                    <div class="history-item-data">
                        <div class="history-data-item">
                            <div class="history-data-label">上 轴向1</div>
                            <div class="history-data-value">${physical.top.axial1 !== null ? physical.top.axial1.toFixed(2) : '--'} mm</div>
                        </div>
                        <div class="history-data-item">
                            <div class="history-data-label">上 径向</div>
                            <div class="history-data-value">${physical.top.radial !== null ? physical.top.radial.toFixed(2) : '--'} mm</div>
                        </div>
                        <div class="history-data-item">
                            <div class="history-data-label">下 轴向1</div>
                            <div class="history-data-value">${physical.bottom.axial1 !== null ? physical.bottom.axial1.toFixed(2) : '--'} mm</div>
                        </div>
                        <div class="history-data-item">
                            <div class="history-data-label">下 径向</div>
                            <div class="history-data-value">${physical.bottom.radial !== null ? physical.bottom.radial.toFixed(2) : '--'} mm</div>
                        </div>
                    </div>
                </div>
                <div style="margin-top:8px;display:flex;gap:6px;">
                    <button class="btn-mini" onclick="event.stopPropagation();system.startEditReportName(${index});">改名</button>
                </div>
                <div class="history-rename" id="historyRename-${index}" style="display:none;" onclick="event.stopPropagation();">
                    <input class="history-rename-input" id="historyRenameInput-${index}" type="text" placeholder="输入新名称">
                    <button class="btn-mini" onclick="system.saveReportName(${index})">保存</button>
                    <button class="btn-mini" onclick="system.cancelReportName(${index})">取消</button>
                </div>
            </div>
        `;
    }

    updateHistorySelectedCount() {
        const checked = document.querySelectorAll('.history-checkbox:checked').length;
        document.getElementById('historySelectedCount').textContent = checked;
    }

    historySelectAll() {
        document.querySelectorAll('.history-checkbox').forEach(cb => cb.checked = true);
        this.updateHistorySelectedCount();
    }

    historyDeselectAll() {
        document.querySelectorAll('.history-checkbox').forEach(cb => cb.checked = false);
        this.updateHistorySelectedCount();
    }

    startEditReportName(index) {
        const report = this.completedReports[index];
        if (!report) return;
        const box = document.getElementById(`historyRename-${index}`);
        const input = document.getElementById(`historyRenameInput-${index}`);
        if (!box || !input) return;
        input.value = report.name || '';
        box.style.display = 'flex';
        input.focus();
        input.select();
    }

    cancelReportName(index) {
        const box = document.getElementById(`historyRename-${index}`);
        if (box) box.style.display = 'none';
    }

    saveReportName(index) {
        const report = this.completedReports[index];
        const input = document.getElementById(`historyRenameInput-${index}`);
        if (!report || !input) return;
        const newName = input.value.trim();
        if (!newName) {
            alert('名称不能为空');
            return;
        }
        report.name = newName;
        localStorage.setItem(this.reportsKey, JSON.stringify(this.completedReports));
        const titleEl = document.getElementById(`historyTitle-${index}`);
        if (titleEl) titleEl.textContent = newName;
        this.cancelReportName(index);
    }

    getSelectedHistoryIndices() {
        const indices = [];
        document.querySelectorAll('.history-checkbox:checked').forEach(cb => {
            indices.push(parseInt(cb.dataset.index));
        });
        indices.sort((a, b) => a - b);
        return indices;
    }

    buildReportDataForIndex(idx) {
        const report = this.completedReports[idx];
        const m = report.measurements;
        const posLabels = ['上', '下', '左', '右'];
        const posKeys = ['top', 'bottom', 'left', 'right'];
        const sensors = ['axial1', 'axial2', 'radial'];
        const sensorLabels = ['轴向1', '轴向2', '径向'];
        const physicalStats = this.buildPhysicalStatsFrom(m);

        let dataRows = [];
        posKeys.forEach((pos, pi) => {
            sensors.forEach((s, si) => {
                const cell = physicalStats[pos][s];
                dataRows.push({ pos: posLabels[pi], sensor: sensorLabels[si], avg: cell.avg !== null ? cell.avg.toFixed(4) : '--', count: cell.count });
            });
        });

        const results = this.buildResultEntries(m).map(item => `${item.label}: ${item.value}`);
        return { report, dataRows, results };
    }

    async exportHistoryPDF() {
        const indices = this.getSelectedHistoryIndices();
        if (indices.length === 0) { alert('请先勾选要导出的历史记录'); return; }

        const allData = indices.map(idx => this.buildReportDataForIndex(idx));
        const title = indices.length === 1 ? allData[0].report.name : `对中测量报告(${indices.length}轮)`;

        // 单条：和之前一样独立显示
        if (indices.length === 1) {
            const data = allData[0];
            const report = data.report;
            let dataRowsHtml = '';
            data.dataRows.forEach(r => {
                dataRowsHtml += `<tr><td style="padding:6px 10px;border:1px solid #ddd;">${r.pos}</td><td style="padding:6px 10px;border:1px solid #ddd;">${r.sensor}</td><td style="padding:6px 10px;border:1px solid #ddd;">${r.avg} mm</td></tr>`;
            });
            let resultsHtml = data.results.map(r => `<p style="margin:4px 0;">${r}</p>`).join('');
            const rawLogsHtml = `
            <h3 style="font-size:13px;margin:0 0 8px 0;border-bottom:1px solid #eee;padding-bottom:5px;">原始测量记录</h3>
            ${this.buildMeasurementLogHtml(report.measurements)}`;
            var fullHtml = `
            <h2 style="text-align:center;margin:0 0 5px 0;font-size:16px;">${report.name}</h2>
            <p style="text-align:center;color:#666;font-size:11px;margin:0 0 15px 0;">测量时间: ${report.date}</p>
            <h3 style="font-size:13px;margin:0 0 8px 0;border-bottom:1px solid #eee;padding-bottom:5px;">测量数据</h3>
            <table style="width:100%;border-collapse:collapse;margin-bottom:15px;font-size:11px;">
                <tr style="background:#f0f0f0;"><th style="padding:5px 8px;border:1px solid #ddd;text-align:left;">方位</th><th style="padding:5px 8px;border:1px solid #ddd;text-align:left;">传感器</th><th style="padding:5px 8px;border:1px solid #ddd;text-align:left;">平均值</th></tr>
                ${dataRowsHtml}
            </table>
            ${rawLogsHtml}
            <h3 style="font-size:13px;margin:0 0 8px 0;border-bottom:1px solid #eee;padding-bottom:5px;">计算结果</h3>
            <div style="margin-bottom:15px;font-size:11px;">${resultsHtml}</div>`;
        } else {
            // 多条：整合到统一表格
            const posLabels = ['上', '下', '左', '右'];
            const posKeys = ['top', 'bottom', 'left', 'right'];
            const sensors = ['axial1', 'axial2', 'radial'];
            const sensorLabels = ['轴向1', '轴向2', '径向'];
            const thStyle = 'padding:5px 6px;border:1px solid #ddd;text-align:center;font-size:10px;';
            const tdStyle = 'padding:5px 6px;border:1px solid #ddd;text-align:center;font-size:10px;';

            // 测量数据整合表：行=方位×传感器，列=各轮次
            let headerCols = `<th style="${thStyle}background:#f0f0f0;">方位</th><th style="${thStyle}background:#f0f0f0;">传感器</th>`;
            allData.forEach((d, i) => {
                headerCols += `<th style="${thStyle}background:#f0f0f0;">${d.report.name}<br><span style="font-weight:normal;color:#888;font-size:9px;">${d.report.date}</span></th>`;
            });

            let dataBodyHtml = '';
            posKeys.forEach((pos, pi) => {
                sensors.forEach((s, si) => {
                    dataBodyHtml += `<tr><td style="${tdStyle}">${posLabels[pi]}</td><td style="${tdStyle}">${sensorLabels[si]}</td>`;
                    allData.forEach(d => {
                        const row = d.dataRows.find(r => r.pos === posLabels[pi] && r.sensor === sensorLabels[si]);
                        dataBodyHtml += `<td style="${tdStyle}">${row ? row.avg : '--'} mm</td>`;
                    });
                    dataBodyHtml += '</tr>';
                });
            });

            // 计算结果整合表
            const resultLabels = [
                '上下张口',
                '左右张口',
                '圆周偏差1（上/下对点）',
                '圆周偏差2（左/右对点）'
            ];

            let resultHeaderCols = `<th style="${thStyle}background:#f0f0f0;">项目</th>`;
            allData.forEach(d => {
                resultHeaderCols += `<th style="${thStyle}background:#f0f0f0;">${d.report.name}<br><span style="font-weight:normal;color:#888;font-size:9px;">${d.report.date}</span></th>`;
            });
            let resultBodyHtml = '';
            resultLabels.forEach((label, li) => {
                resultBodyHtml += `<tr><td style="${tdStyle}font-weight:600;">${label}</td>`;
                allData.forEach(d => {
                    const matchResult = d.results.find(r => r.startsWith(label + ':'));
                    const val = matchResult ? matchResult.split(': ')[1] : '--';
                    resultBodyHtml += `<td style="${tdStyle}">${val}</td>`;
                });
                resultBodyHtml += '</tr>';
            });

            const rawLogsHtml = allData.map(d => `
            <div style="margin-top:18px;">
                <h3 style="font-size:13px;margin:0 0 8px 0;border-bottom:1px solid #eee;padding-bottom:5px;">原始测量记录 - ${d.report.name}</h3>
                ${this.buildMeasurementLogHtml(d.report.measurements)}
            </div>`).join('');

            var fullHtml = `
            <h2 style="text-align:center;margin:0 0 15px 0;font-size:16px;">${title}</h2>
            <h3 style="font-size:13px;margin:0 0 8px 0;border-bottom:1px solid #eee;padding-bottom:5px;">测量数据</h3>
            <table style="width:100%;border-collapse:collapse;margin-bottom:18px;">
                <tr>${headerCols}</tr>
                ${dataBodyHtml}
            </table>
            <h3 style="font-size:13px;margin:0 0 8px 0;border-bottom:1px solid #eee;padding-bottom:5px;">计算结果</h3>
            <table style="width:100%;border-collapse:collapse;margin-bottom:18px;">
                <tr>${resultHeaderCols}</tr>
                ${resultBodyHtml}
            </table>
            ${rawLogsHtml}`;
        }

        const htmlContent = `
        <div style="font-family:'Microsoft YaHei','SimHei','PingFang SC',sans-serif;padding:25px;width:750px;background:white;color:#333;font-size:13px;">
            ${fullHtml}
        </div>`;

        // 历史导出同样依赖html2canvas+jsPDF，网络受限时降级为打印保存PDF
        const libsReady = await this.ensurePdfLibraries();
        if (!libsReady) {
            this.exportPDFByPrint(title, htmlContent);
            return;
        }

        const container = document.createElement('div');
        container.style.position = 'fixed';
        container.style.left = '-9999px';
        container.style.top = '0';
        container.innerHTML = htmlContent;
        document.body.appendChild(container);

        try {
            const canvas = await html2canvas(container.firstElementChild, { scale: 2, useCORS: true });
            const imgData = canvas.toDataURL('image/png');
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF('p', 'mm', 'a4');
            const pageWidth = doc.internal.pageSize.getWidth();
            const pageHeight = doc.internal.pageSize.getHeight();
            const margin = 10;
            const imgWidth = pageWidth - margin * 2;
            const imgHeight = (canvas.height * imgWidth) / canvas.width;

            if (imgHeight <= pageHeight - margin * 2) {
                doc.addImage(imgData, 'PNG', margin, margin, imgWidth, imgHeight);
            } else {
                const pageContentHeight = pageHeight - margin * 2;
                const sourcePageHeight = (pageContentHeight / imgHeight) * canvas.height;
                const pages = Math.ceil(canvas.height / sourcePageHeight);
                for (let p = 0; p < pages; p++) {
                    if (p > 0) doc.addPage();
                    const srcY = p * sourcePageHeight;
                    const srcH = Math.min(sourcePageHeight, canvas.height - srcY);
                    const destH = (srcH / canvas.height) * imgHeight;
                    const pageCanvas = document.createElement('canvas');
                    pageCanvas.width = canvas.width;
                    pageCanvas.height = srcH;
                    const ctx = pageCanvas.getContext('2d');
                    ctx.drawImage(canvas, 0, srcY, canvas.width, srcH, 0, 0, canvas.width, srcH);
                    doc.addImage(pageCanvas.toDataURL('image/png'), 'PNG', margin, margin, imgWidth, destH);
                }
            }
            doc.save(`${title}.pdf`);
            alert('PDF已导出');
        } catch (error) {
            console.error('PDF导出失败:', error);
            alert('PDF导出失败: ' + error.message);
        } finally {
            document.body.removeChild(container);
        }
    }

    exportHistoryCSV() {
        const indices = this.getSelectedHistoryIndices();
        if (indices.length === 0) { alert('请先勾选要导出的历史记录'); return; }

        const allData = indices.map(idx => this.buildReportDataForIndex(idx));
        const title = indices.length === 1 ? allData[0].report.name : `对中测量报告_${indices.length}轮`;

        let rows = [];

        if (indices.length === 1) {
            // 单条：保持原格式
            const data = allData[0];
            const report = data.report;
            rows.push('测量名称,' + report.name);
            rows.push('测量时间,' + report.date);
            rows.push('');
            rows.push('方位,传感器,平均值(mm)');
            data.dataRows.forEach(r => {
                rows.push(`${r.pos},${r.sensor},${r.avg}`);
            });
            rows.push('');
            rows.push('计算结果,数值');
            data.results.forEach(r => rows.push(r.replace(': ', ',')));
            rows.push('');
            rows.push('原始测量记录');
            rows.push('方位,序号,轴向1(mm),轴向2(mm),径向(mm),时间');
            this.buildMeasurementRows(report.measurements).forEach(row => {
                rows.push(`${row.position},${row.index},${this.formatMeasurementValue(row.axial1)},${this.formatMeasurementValue(row.axial2)},${this.formatMeasurementValue(row.radial)},${row.time}`);
            });
        } else {
            // 多条：整合表格
            const posLabels = ['上', '下', '左', '右'];
            const posKeys = ['top', 'bottom', 'left', 'right'];
            const sensors = ['axial1', 'axial2', 'radial'];
            const sensorLabels = ['轴向1', '轴向2', '径向'];

            // 标题行
            rows.push('对中测量报告汇总 - 共' + allData.length + '轮');
            rows.push('');

            // 测量数据整合表
            rows.push('测量数据');
            let header = '方位,传感器';
            allData.forEach(d => { header += `,${d.report.name}(${d.report.date})`; });
            rows.push(header);

            posKeys.forEach((pos, pi) => {
                sensors.forEach((s, si) => {
                    let row = `${posLabels[pi]},${sensorLabels[si]}`;
                    allData.forEach(d => {
                        const match = d.dataRows.find(r => r.pos === posLabels[pi] && r.sensor === sensorLabels[si]);
                        row += `,${match ? match.avg : '--'}`;
                    });
                    rows.push(row);
                });
            });

            // 计算结果整合表
            rows.push('');
            rows.push('计算结果');
            let resultHeader = '项目';
            allData.forEach(d => { resultHeader += `,${d.report.name}(${d.report.date})`; });
            rows.push(resultHeader);

            const resultLabels = [
                '上下张口',
                '左右张口',
                '圆周偏差1（上/下对点）',
                '圆周偏差2（左/右对点）'
            ];

            resultLabels.forEach(label => {
                let row = label;
                allData.forEach(d => {
                    const matchResult = d.results.find(r => r.startsWith(label + ':'));
                    const val = matchResult ? matchResult.split(': ')[1] : '--';
                    row += `,${val}`;
                });
                rows.push(row);
            });

            // 原始测量记录分报告追加
            allData.forEach(d => {
                rows.push('');
                rows.push(`原始测量记录 - ${d.report.name}`);
                rows.push('方位,序号,轴向1(mm),轴向2(mm),径向(mm),时间');
                this.buildMeasurementRows(d.report.measurements).forEach(row => {
                    rows.push(`${row.position},${row.index},${this.formatMeasurementValue(row.axial1)},${this.formatMeasurementValue(row.axial2)},${this.formatMeasurementValue(row.radial)},${row.time}`);
                });
            });

        }

        const csvContent = '﻿' + rows.join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${title}.csv`;
        link.click();
        URL.revokeObjectURL(link.href);
        alert('CSV已导出');
    }

    hideHistoryModal() {
        document.getElementById('historyModal').style.display = 'none';
    }

    showDetailModal(index) {
        const report = this.completedReports[index];
        if (!report) return;

        document.getElementById('detailTitle').textContent = report.name;
        const m = report.measurements;
        const physicalStats = this.buildPhysicalStatsFrom(m);

        const positions = ['top', 'bottom', 'left', 'right'];
        const posNames = ['上', '下', '左', '右'];
        const fields = ['axial1', 'axial2', 'radial'];
        const fieldNames = ['轴向1', '轴向2', '径向'];

        let gridItems = '';
        positions.forEach((pos, pi) => {
            fields.forEach((f, fi) => {
                const cell = physicalStats[pos][f];
                gridItems += `
                <div class="detail-data-item">
                    <div class="detail-data-label">${posNames[pi]} ${fieldNames[fi]} (${cell.count}次)</div>
                    <div class="detail-data-value">${cell.avg !== null ? cell.avg.toFixed(4) : '--'} mm</div>
                </div>`;
            });
        });

        const resultItems = this.buildResultEntries(m)
            .map(item => `
                <div class="result-item">
                    <div class="result-label">${item.label}</div>
                    <div class="result-value">${item.value}</div>
                </div>`)
            .join('');

        const detailHTML = `
            <div style="margin-bottom: 20px; padding: 15px; background: #fafafa; border-radius: 6px; border: 1px solid #e5e5e5;">
                <div style="color: #737373; font-size: 0.9em; margin-bottom: 5px;">测量时间</div>
                <div style="color: #1a1a1a; font-weight: 600;">${report.date}</div>
            </div>

            <div class="detail-data-grid">${gridItems}
            </div>

            <div style="margin-top: 25px;">
                <h4 style="color: #737373; font-size: 0.9em; margin-bottom: 15px; text-transform: uppercase;">原始测量记录</h4>
                ${this.buildMeasurementLogHtml(m)}
            </div>

            <div style="margin-top: 25px;">
                <h4 style="color: #737373; font-size: 0.9em; margin-bottom: 15px; text-transform: uppercase;">计算结果</h4>
                ${resultItems}
            </div>
        `;

        document.getElementById('detailContent').innerHTML = detailHTML;
        document.getElementById('detailModal').style.display = 'block';
    }

    hideDetailModal() {
        document.getElementById('detailModal').style.display = 'none';
    }
}

let system;
document.addEventListener('DOMContentLoaded', () => {
    system = new AlignmentMeasurementSystem();
    window.system = system;
});
