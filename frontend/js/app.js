// 主控：UI 装配、文本编辑覆盖层、文件操作、快捷键、草稿自动保存
(function () {
    'use strict';

    const $ = id => document.getElementById(id);

    let filePath = null;
    let fileName = '未命名';
    let editingId = null;
    let drawQueued = false;
    let draftTimer = null;
    let toastTimer = null;

    const editor = $('editor');
    const PALETTE = ['#1d1d21', '#6b6f82', '#ffffff', '#e5484d', '#f5a524', '#12a594', '#3b82f6', '#8b5cf6'];

    // ---------- 渲染调度 ----------
    function requestDraw() {
        if (drawQueued) return;
        drawQueued = true;
        requestAnimationFrame(() => {
            drawQueued = false;
            Render.draw();
        });
    }

    function toast(msg) {
        const el = $('toast');
        el.textContent = msg;
        el.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
    }

    // ---------- 文本编辑 ----------
    function startEdit(id) {
        const s = State.shapes.get(id);
        if (!s) return;
        editingId = id;
        State.ui.editingId = id;
        const cam = State.camera;
        const b = Geom.boundsOf(s, sid => State.shapes.get(sid));
        const p0 = Render.w2s(b.x, b.y, cam);
        const isText = s.type === 'text';
        const size = Geom.FONT[s.props.font] || 24;

        editor.value = s.label || '';
        editor.style.display = 'block';
        editor.style.left = p0.x + 'px';
        editor.style.top = p0.y + 'px';
        editor.style.width = Math.max(60, b.w * cam.z) + 'px';
        editor.style.height = Math.max(size * 1.6, b.h * cam.z) + 'px';
        editor.style.font = '500 ' + (size * cam.z) + 'px "Segoe UI", "Microsoft YaHei", system-ui, sans-serif';
        editor.style.lineHeight = (size * Geom.LINE_H * cam.z) + 'px';
        editor.style.color = s.props.stroke || '#1d1d21';
        editor.style.textAlign = isText ? 'left' : 'center';
        editor.style.paddingTop = isText ? '0px' : Math.max(0, (b.h * cam.z - (Geom.labelLayout(s).textH * cam.z))) / 2 + 'px';
        editor.focus();
        editor.select();
    }

    function commitEdit(cancel) {
        if (!editingId) return;
        const id = editingId;
        editingId = null;
        State.ui.editingId = null;
        editor.style.display = 'none';

        const s = State.shapes.get(id);
        if (!s) { requestDraw(); return; }
        const val = cancel ? (s.label || '') : editor.value;

        if (s.type === 'text') {
            if (!val.trim()) {
                State.shapes.delete(id);
                State.selection.delete(id);
                if (!s._new) State.commit();
            } else if (val !== s.label) {
                s.label = val;
                s._layout = null;
                delete s._new;
                State.commit();
            } else if (s._new) {
                delete s._new;
                State.commit();
            }
        } else if (val !== (s.label || '')) {
            s.label = val;
            s._llayout = null;
            State.commit();
        }
        updateTitle();
        updateUI();
        requestDraw();
    }

    editor.addEventListener('blur', () => commitEdit(false));
    editor.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); commitEdit(true); }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); editor.blur(); }
    });
    editor.addEventListener('input', () => {
        // 自动增高（文本形状）
        if (!editingId) return;
        const s = State.shapes.get(editingId);
        if (!s || s.type !== 'text') return;
        editor.style.height = 'auto';
        editor.style.height = Math.max(Geom.FONT[s.props.font] * 1.6 * State.camera.z, editor.scrollHeight + 2) + 'px';
    });

    // ---------- 状态订阅 ----------
    State.onChange(() => {
        markDirty();
        scheduleDraft();
        updateUI();
        requestDraw();
    });

    function markDirty() {
        updateTitle();
    }

    // ---------- 标题 ----------
    function updateTitle() {
        const title = 'StepDraw — ' + fileName + (State.dirty ? ' •' : '');
        $('fileName').textContent = fileName + (State.dirty ? ' •' : '');
        Bridge.invoke('set_title', { title });
    }

    // ---------- 工具栏 ----------
    function setTool(t) {
        State.setTool(t);
        updateUI();
    }

    // ---------- 样式面板 ----------
    function currentProps() {
        for (const id of State.selection) {
            const s = State.shapes.get(id);
            if (s && s.props) return s.props;
        }
        return State.style;
    }

    function applyStyle(patch) {
        if (State.selection.size) {
            for (const id of State.selection) {
                const s = State.shapes.get(id);
                if (!s || !s.props) continue;
                Object.assign(s.props, patch);
                if (patch.font) { s._layout = null; s._llayout = null; }
            }
            State.commit();
        } else {
            Object.assign(State.style, patch);
            updateUI();
            requestDraw();
        }
    }

    function buildPalette(containerId, colors, key) {
        const box = $(containerId);
        box.innerHTML = '';
        const list = key === 'fill' ? ['transparent', ...colors] : colors;
        for (const c of list) {
            const b = document.createElement('button');
            b.className = 'sw' + (c === 'transparent' ? ' transparent' : '');
            b.style.background = c === 'transparent' ? '' : c;
            b.title = c === 'transparent' ? '无填充' : c;
            b.dataset.color = c;
            b.addEventListener('click', () => applyStyle({ [key]: c }));
            box.appendChild(b);
        }
    }

    function buildSeg(containerId, items, key) {
        const box = $(containerId);
        box.innerHTML = '';
        for (const it of items) {
            const b = document.createElement('button');
            b.textContent = it.label;
            b.title = it.title || it.label;
            b.dataset.value = it.value;
            b.addEventListener('click', () => applyStyle({ [key]: it.value }));
            box.appendChild(b);
        }
    }

    // ---------- UI 状态刷新 ----------
    function updateUI() {
        // 工具高亮
        document.querySelectorAll('#toolbar .tbtn[data-tool]').forEach(b => {
            b.classList.toggle('active', b.dataset.tool === State.tool);
        });

        // 样式面板反映当前属性
        const p = currentProps();
        document.querySelectorAll('.swatches').forEach(box => {
            const key = box.dataset.key;
            box.querySelectorAll('.sw').forEach(sw => {
                sw.classList.toggle('active', sw.dataset.color === p[key]);
            });
        });
        [['segSize', 'size'], ['segDash', 'dash'], ['segFont', 'font'], ['segRoute', 'route']].forEach(([id, key]) => {
            const box = $(id);
            if (!box) return;
            box.querySelectorAll('button').forEach(b => {
                b.classList.toggle('active', b.dataset.value === p[key]);
            });
        });
        // 撤销/重做按钮
        $('mUndo').disabled = !State.canUndo;
        $('mRedo').disabled = !State.canRedo;

        // 缩放显示
        $('zoomPct').textContent = Math.round(State.camera.z * 100) + '%';

        // 提示条
        const n = State.selection.size;
        $('hintbar').textContent = n > 0
            ? '已选中 ' + n + ' 个图形 · 拖动移动 / 手柄缩放 · Del 删除 · Ctrl+D 复制'
            : TOOLTIPS[State.tool] || '';
    }

    const TOOLTIPS = {
        select: '双击图形编辑文字 · 双击空白新建文本 · 滚轮缩放 · 空格+拖动平移',
        hand: '拖动平移画布 · 滚轮缩放',
        pencil: '按住鼠标任意绘制 · Shift+矩形/椭圆为正方形',
        eraser: '点击或划过图形即可擦除',
        rect: '拖动绘制矩形 · 单击生成默认大小',
        ellipse: '拖动绘制椭圆 · 单击生成默认大小',
        diamond: '拖动绘制菱形（流程图判断） · 单击生成默认大小',
        arrow: '从图形拖到图形自动连接 · 样式面板可切换直线/折线',
        text: '点击画布放置文本',
    };

    // ---------- 文件操作 ----------
    function basename(p) {
        if (!p) return '未命名';
        const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
        let name = i >= 0 ? p.slice(i + 1) : p;
        if (name.toLowerCase().endsWith('.stepdraw')) name = name.slice(0, -9);
        return name || '未命名';
    }

    function docJson() {
        return JSON.stringify({
            version: 1,
            app: 'stepdraw',
            shapes: State.exportShapes(),
            camera: { x: State.camera.x, y: State.camera.y, z: State.camera.z },
        });
    }

    function loadDoc(json, path) {
        const doc = JSON.parse(json);
        if (!doc || !Array.isArray(doc.shapes)) throw new Error('bad doc');
        State.importShapes(doc.shapes);
        if (doc.camera) {
            State.camera.x = doc.camera.x || 0;
            State.camera.y = doc.camera.y || 0;
            State.camera.z = Math.min(4, Math.max(0.1, doc.camera.z || 1));
        }
        State.resetHistory();
        filePath = path || null;
        fileName = basename(path);
        State.dirty = false;
        localStorage.removeItem('stepdraw.draft');
        updateTitle();
        updateUI();
        requestDraw();
    }

    async function doSave() {
        if (!filePath) return doSaveAs();
        const r = await Bridge.invoke('save_project', { path: filePath, content: docJson() });
        if (r.ok) {
            State.dirty = false;
            localStorage.removeItem('stepdraw.draft');
            toast('已保存');
            updateTitle();
        } else if (r.reason !== 'cancel') {
            toast('保存失败：' + (r.reason || ''));
        }
    }

    async function doSaveAs() {
        const r = await Bridge.invoke('save_project_as', {
            content: docJson(),
            default_name: fileName + '.stepdraw',
        });
        if (r.ok) {
            filePath = r.path;
            fileName = basename(r.path);
            State.dirty = false;
            localStorage.removeItem('stepdraw.draft');
            toast('已保存到 ' + fileName);
            updateTitle();
        }
    }

    async function doOpen() {
        if (State.dirty && !confirm('当前画板尚未保存，确定打开其他文件？')) return;
        const r = await Bridge.invoke('open_project');
        if (r.ok) {
            try {
                loadDoc(r.content, r.path);
                toast('已打开 ' + basename(r.path));
            } catch (err) {
                console.error(err);
                toast('文件格式错误');
            }
        }
    }

    function doNew() {
        if (State.dirty && !confirm('当前画板尚未保存，确定新建？')) return;
        State.clearAll();
        State.resetHistory();
        filePath = null;
        fileName = '未命名';
        localStorage.removeItem('stepdraw.draft');
        updateTitle();
        updateUI();
        requestDraw();
        toast('已新建画板');
    }

    function doExportPng() {
        let box = null;
        const getShape = id => State.shapes.get(id);
        for (const s of State.shapes.values()) {
            const b = Geom.boundsOf(s, getShape);
            box = box ? Geom.union(box, b) : { x: b.x, y: b.y, w: b.w, h: b.h };
        }
        if (!box) { toast('画板为空，先画点什么吧'); return; }
        box = Geom.inflate(box, 40);
        const scale = 2;
        const cv = document.createElement('canvas');
        cv.width = Math.min(8000, Math.round(box.w * scale));
        cv.height = Math.min(8000, Math.round(box.h * scale));
        const c = cv.getContext('2d');
        c.fillStyle = '#ffffff';
        c.fillRect(0, 0, cv.width, cv.height);
        Render.renderScenePublic(c, { x: box.x, y: box.y, z: scale }, cv.width / scale, cv.height / scale, { dpr: 1 });
        const data = cv.toDataURL('image/png').split(',')[1];
        Bridge.invoke('export_png', { data, default_name: (fileName === '未命名' ? '画板' : fileName) + '.png' })
            .then(r => { if (r.ok) toast('已导出 PNG'); });
    }

    // ---------- 选择操作 ----------
    function deleteSelection() {
        if (!State.selection.size) return;
        State.detachArrows(new Set(State.selection));
        for (const id of State.selection) State.shapes.delete(id);
        State.selection.clear();
        State.commit();
    }

    function duplicateSelection() {
        if (!State.selection.size) return;
        const newIds = [];
        for (const id of State.selection) {
            const s = State.shapes.get(id);
            if (!s) continue;
            const c = JSON.parse(JSON.stringify(s, (k, v) => (k && k[0] === '_' ? undefined : v)));
            c.id = Geom.uid();
            Geom.moveShape(c, 18, 18);
            State.shapes.set(c.id, c);
            newIds.push(c.id);
        }
        State.selection.clear();
        for (const id of newIds) State.selection.add(id);
        State.commit();
    }

    function selectAll() {
        State.selection.clear();
        for (const id of State.shapes.keys()) State.selection.add(id);
        updateUI();
        requestDraw();
    }

    // ---------- 草稿自动保存 ----------
    function scheduleDraft() {
        clearTimeout(draftTimer);
        draftTimer = setTimeout(saveDraft, 800);
    }

    function saveDraft() {
        try {
            if (!State.shapes.size) return;
            localStorage.setItem('stepdraw.draft', JSON.stringify({
                shapes: State.exportShapes(),
                camera: { x: State.camera.x, y: State.camera.y, z: State.camera.z },
            }));
        } catch (_) { /* 存储不可用时忽略 */ }
    }

    function loadDraft() {
        try {
            const raw = localStorage.getItem('stepdraw.draft');
            if (!raw) return false;
            const d = JSON.parse(raw);
            if (!d || !Array.isArray(d.shapes) || !d.shapes.length) return false;
            State.importShapes(d.shapes);
            if (d.camera) {
                State.camera.x = d.camera.x || 0;
                State.camera.y = d.camera.y || 0;
                State.camera.z = Math.min(4, Math.max(0.1, d.camera.z || 1));
            }
            State.dirty = true;
            return true;
        } catch (_) {
            return false;
        }
    }

    // ---------- 快捷键 ----------
    function onKeyDown(e) {
        if (State.ui.editingId) return;   // 编辑器自行处理
        const tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea') return;

        const mod = e.ctrlKey || e.metaKey;
        const k = e.key.toLowerCase();

        if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? State.redo() : State.undo(); return; }
        if (mod && k === 'y') { e.preventDefault(); State.redo(); return; }
        if (mod && k === 's') { e.preventDefault(); e.shiftKey ? doSaveAs() : doSave(); return; }
        if (mod && k === 'o') { e.preventDefault(); doOpen(); return; }
        if (mod && k === 'a') { e.preventDefault(); selectAll(); return; }
        if (mod && k === 'd') { e.preventDefault(); duplicateSelection(); return; }
        if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); Tools.zoomAt(viewCenter().x, viewCenter().y, 1.2); return; }
        if (mod && e.key === '-') { e.preventDefault(); Tools.zoomAt(viewCenter().x, viewCenter().y, 1 / 1.2); return; }
        if (mod && e.key === '0') { e.preventDefault(); Tools.zoomReset(); return; }
        if (mod) return;

        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); return; }
        if (e.key === 'Escape') {
            State.selection.clear();
            setTool('select');
            return;
        }
        if (e.key === '!' || (e.shiftKey && e.key === '1')) { Tools.zoomFit(); return; }

        const map = { v: 'select', h: 'hand', d: 'pencil', e: 'eraser', r: 'rect', o: 'ellipse', f: 'diamond', a: 'arrow', t: 'text' };
        if (map[k]) { setTool(map[k]); }
    }

    function viewCenter() {
        const wrap = $('canvasWrap');
        return { x: wrap.clientWidth / 2, y: wrap.clientHeight / 2 };
    }

    // ---------- 启动 ----------
    function boot() {
        Render.init($('canvas'), $('canvasWrap'));
        Tools.init({
            requestDraw,
            startEdit,
            commitEdit,
            updateUI,
            onZoom: updateUI,
        });

        // 工具栏
        document.querySelectorAll('#toolbar .tbtn[data-tool]').forEach(b => {
            b.addEventListener('click', () => setTool(b.dataset.tool));
        });

        // 菜单
        $('mNew').addEventListener('click', doNew);
        $('mOpen').addEventListener('click', doOpen);
        $('mSave').addEventListener('click', doSave);
        $('mSaveAs').addEventListener('click', doSaveAs);
        $('mExport').addEventListener('click', doExportPng);
        $('mUndo').addEventListener('click', () => State.undo());
        $('mRedo').addEventListener('click', () => State.redo());
        $('btnDelete').addEventListener('click', deleteSelection);
        $('btnDup').addEventListener('click', duplicateSelection);

        // 样式面板
        buildPalette('strokeColors', PALETTE, 'stroke');
        buildPalette('fillColors', PALETTE, 'fill');
        buildSeg('segSize', [
            { value: 's', label: '细' }, { value: 'm', label: '中' }, { value: 'l', label: '粗' },
        ], 'size');
        buildSeg('segDash', [
            { value: 'solid', label: '实线' }, { value: 'dashed', label: '虚线' }, { value: 'dotted', label: '点线' },
        ], 'dash');
        buildSeg('segFont', [
            { value: 's', label: '小' }, { value: 'm', label: '中' }, { value: 'l', label: '大' },
        ], 'font');
        buildSeg('segRoute', [
            { value: 'straight', label: '直线' }, { value: 'elbow', label: '折线' },
        ], 'route');

        // 缩放条
        $('zoomOut').addEventListener('click', () => { const c = viewCenter(); Tools.zoomAt(c.x, c.y, 1 / 1.2); });
        $('zoomIn').addEventListener('click', () => { const c = viewCenter(); Tools.zoomAt(c.x, c.y, 1.2); });
        $('zoomPct').addEventListener('click', Tools.zoomReset);
        $('zoomFit').addEventListener('click', Tools.zoomFit);

        // 全局
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('resize', () => { Render.resize(); requestDraw(); });
        window.addEventListener('beforeunload', e => {
            saveDraft();
            if (State.dirty) { e.preventDefault(); e.returnValue = ''; }
        });

        // 环境徽标
        if (!Bridge.isNative) $('envBadge').style.display = 'inline-block';

        // 恢复草稿
        if (loadDraft()) {
            toast('已恢复上次未保存的草稿');
        }
        updateTitle();
        updateUI();
        requestDraw();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    window.App = { requestDraw, toast };
})();
