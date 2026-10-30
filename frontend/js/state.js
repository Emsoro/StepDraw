// 文档状态：图形集合、相机、选择集、样式、撤销/重做历史
(function () {
    'use strict';

    const shapes = new Map();          // id → shape（插入顺序即 z 序）
    const camera = { x: 0, y: 0, z: 1 };
    const selection = new Set();       // 选中的 shape id
    const ui = { marquee: null, temp: null, hover: new Set(), editingId: null, ports: null };

    // 新图形的默认样式
    const style = {
        stroke: '#1d1d21',
        fill: 'transparent',
        size: 'm',      // 线宽 s/m/l
        dash: 'solid',  // solid/dashed/dotted
        font: 'm',      // 字号 s/m/l
        family: 'sans', // 字体 sans/serif/mono/kai
        route: 'elbow', // 箭头 straight/elbow
    };

    let tool = 'select';
    let dirty = false;
    let history = [];
    let future = [];
    const listeners = new Set();
    const HISTORY_LIMIT = 200;

    function notify() {
        for (const fn of listeners) fn();
    }

    function onChange(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
    }

    // ---------- 序列化 ----------
    function replacer(k, v) {
        return k && k[0] === '_' ? undefined : v;
    }

    function serialize() {
        return JSON.stringify([...shapes.values()], replacer);
    }

    function loadSnapshot(json) {
        shapes.clear();
        selection.clear();
        ui.hover.clear();
        ui.ports = null;
        for (const s of JSON.parse(json)) shapes.set(s.id, s);
    }

    // ---------- 历史 ----------
    function commit() {
        history.push(serialize());
        if (history.length > HISTORY_LIMIT) history.shift();
        future.length = 0;
        dirty = true;
        notify();
    }

    function undo() {
        if (!history.length) return;
        future.push(serialize());
        loadSnapshot(history.pop());
        dirty = true;
        notify();
    }

    function redo() {
        if (!future.length) return;
        history.push(serialize());
        loadSnapshot(future.pop());
        dirty = true;
        notify();
    }

    function resetHistory() {
        history = [];
        future = [];
        dirty = false;
        notify();
    }

    // ---------- 文档 ----------
    function exportShapes() {
        return JSON.parse(serialize());
    }

    function importShapes(arr) {
        shapes.clear();
        selection.clear();
        ui.hover.clear();
        ui.ports = null;
        ui.temp = null;
        ui.marquee = null;
        for (const s of arr || []) {
            if (s && s.id && s.type) shapes.set(s.id, s);
        }
    }

    function clearAll() {
        shapes.clear();
        selection.clear();
        ui.hover.clear();
        ui.ports = null;
        ui.temp = null;
        ui.marquee = null;
        camera.x = 0; camera.y = 0; camera.z = 1;
    }

    // 删除图形时，冻结绑定到它的箭头端点（改为绝对坐标）
    function detachArrows(deletedIds) {
        for (const s of shapes.values()) {
            if (s.type !== 'arrow') continue;
            const route = Geom.arrowRoute(s, id => shapes.get(id));
            if (s.a.id && deletedIds.has(s.a.id)) { s.a = { x: route.a.x, y: route.a.y }; }
            if (s.b.id && deletedIds.has(s.b.id)) { s.b = { x: route.b.x, y: route.b.y }; }
        }
    }

    function setTool(t) {
        tool = t;
        ui.hover.clear();
        ui.ports = null;
        notify();
    }

    window.State = {
        shapes, camera, selection, ui, style,
        get tool() { return tool; },
        get dirty() { return dirty; },
        get canUndo() { return history.length > 0; },
        get canRedo() { return future.length > 0; },
        set dirty(v) { dirty = v; },
        setTool, commit, undo, redo, resetHistory,
        exportShapes, importShapes, clearAll, detachArrows,
        onChange, serialize,
    };
})();
