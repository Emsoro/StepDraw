// 交互工具：选择/手型/铅笔/橡皮/文本/形状/箭头 + 平移缩放
(function () {
    'use strict';

    let deps = null;          // { requestDraw, startEdit, commitEdit, updateUI, onZoom }
    let canvas = null, wrap = null;
    let spaceHeld = false;

    const gesture = {
        mode: 'idle',         // idle|pan|marquee|move|resize|create|draw|erase|arrow
        startW: null,         // 按下时世界坐标
        startS: null,         // 按下时屏幕坐标
        startCam: null,
        handle: null,
        origBox: null,
        originals: new Map(), // id → 克隆快照
        marqueeBase: null,
        pts: [],
        changed: false,
        pointerId: null,
    };

    const BINDABLE = new Set(['rect', 'ellipse', 'diamond', 'text']);

    function init(d) {
        deps = d;
        canvas = document.getElementById('canvas');
        wrap = document.getElementById('canvasWrap');
        canvas.addEventListener('pointerdown', onDown);
        canvas.addEventListener('pointermove', onMove);
        canvas.addEventListener('pointerup', onUp);
        canvas.addEventListener('pointercancel', onUp);
        canvas.addEventListener('dblclick', onDblClick);
        canvas.addEventListener('contextmenu', e => e.preventDefault());
        wrap.addEventListener('wheel', onWheel, { passive: false });

        window.addEventListener('keydown', e => {
            if (State.ui.editingId) return;
            if (e.code === 'Space' && !spaceHeld) {
                spaceHeld = true;
                updateCursor(null);
                e.preventDefault();
            }
        });
        window.addEventListener('keyup', e => {
            if (e.code === 'Space') { spaceHeld = false; updateCursor(null); }
        });
    }

    // ---------- 坐标 ----------
    function relPt(e) {
        const r = canvas.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    function s2w(px, py) {
        return Render.s2w(px, py, State.camera);
    }

    function getShape(id) {
        return State.shapes.get(id);
    }

    // ---------- 命中 ----------
    function topHit(wpt, filter) {
        const tol = 4 / State.camera.z;
        const arr = [...State.shapes.values()];
        for (let i = arr.length - 1; i >= 0; i--) {
            const s = arr[i];
            if (filter && !filter(s)) continue;
            if (Geom.hitShape(s, wpt.x, wpt.y, tol, getShape)) return s;
        }
        return null;
    }

    // ---------- 连接点 ----------
    // 就近连接点：指针落在图形内部（含容差）或贴近某个连接点时吸附
    function portHit(wpt, excludeId) {
        const z = State.camera.z;
        const pad = 12 / z;
        const shapes = [...State.shapes.values()];
        const nearestOf = s => {
            let best = null, bestD = Infinity;
            for (const p of Geom.portsOf(s, getShape)) {
                const d = Math.hypot(wpt.x - p.x, wpt.y - p.y);
                if (d < bestD) { bestD = d; best = p; }
            }
            return best ? { shape: s, port: best } : null;
        };
        // 1) 落在图形内部（含容差）：吸附到最近的连接点（无需精确压中描边）
        for (let i = shapes.length - 1; i >= 0; i--) {
            const s = shapes[i];
            if (!BINDABLE.has(s.type) || s.id === excludeId) continue;
            const b = Geom.boundsOf(s, getShape);
            if (wpt.x < b.x - pad || wpt.x > b.x + b.w + pad) continue;
            if (wpt.y < b.y - pad || wpt.y > b.y + b.h + pad) continue;
            return nearestOf(s);
        }
        // 2) 贴近某个连接点
        const r = 18 / z;
        let best = null, bestD = Infinity;
        for (const s of shapes) {
            if (!BINDABLE.has(s.type) || s.id === excludeId) continue;
            for (const p of Geom.portsOf(s, getShape)) {
                const d = Math.hypot(wpt.x - p.x, wpt.y - p.y);
                if (d <= r && d < bestD) { bestD = d; best = { shape: s, port: p }; }
            }
        }
        return best;
    }

    // 指针附近的图形连接点（渲染提示点使用）
    function nearPorts(wpt, excludeId, active) {
        const r = 170 / State.camera.z;
        const map = new Map();
        if (active) map.set(active.shape.id, active.port.id);
        for (const s of State.shapes.values()) {
            if (!BINDABLE.has(s.type) || s.id === excludeId || map.has(s.id)) continue;
            const b = Geom.boundsOf(s, getShape);
            const dx = Math.max(b.x - wpt.x, 0, wpt.x - (b.x + b.w));
            const dy = Math.max(b.y - wpt.y, 0, wpt.y - (b.y + b.h));
            if (Math.hypot(dx, dy) > r) continue;
            map.set(s.id, null);
        }
        return map.size ? map : null;
    }

    function setPorts(map) {
        const cur = State.ui.ports;
        if (cur === map) return;
        if (!cur && !map) return;
        if (cur && map && cur.size === map.size) {
            let same = true;
            for (const [k, v] of map) {
                if (!cur.has(k) || cur.get(k) !== v) { same = false; break; }
            }
            if (same) return;
        }
        State.ui.ports = map;
        deps.requestDraw();
    }

    // 当前唯一选中的箭头
    function selectedArrow() {
        if (State.selection.size !== 1) return null;
        const s = State.shapes.get([...State.selection][0]);
        return s && s.type === 'arrow' ? s : null;
    }

    // 箭头端点命中（拖拽端点重新连接）
    function arrowEndAt(wpt) {
        const s = selectedArrow();
        if (!s) return null;
        const r = Geom.arrowRoute(s, getShape);
        const tol = 9 / State.camera.z;
        for (const key of ['b', 'a']) {
            const p = key === 'a' ? r.a : r.b;
            if (Math.hypot(wpt.x - p.x, wpt.y - p.y) <= tol) return { shape: s, key };
        }
        return null;
    }

    function selectionBounds() {
        let box = null;
        for (const id of State.selection) {
            const s = State.shapes.get(id);
            if (!s) continue;
            const b = Geom.boundsOf(s, getShape);
            box = box ? Geom.union(box, b) : { x: b.x, y: b.y, w: b.w, h: b.h };
        }
        return box;
    }

    // ---------- 快照 ----------
    function clone(orig) {
        return JSON.parse(JSON.stringify(orig, (k, v) => (k && k[0] === '_' ? undefined : v)));
    }

    function snapshotSelection() {
        gesture.originals.clear();
        for (const id of State.selection) {
            const s = State.shapes.get(id);
            if (s) gesture.originals.set(id, clone(s));
        }
    }

    function mkShape(type, wpt) {
        const s = {
            id: Geom.uid(),
            type,
            x: wpt.x, y: wpt.y, w: 0, h: 0,
            label: '',
            props: { ...State.style },
        };
        if (type === 'draw') s.points = [];
        if (type === 'arrow') {
            s.a = { x: wpt.x, y: wpt.y };
            s.b = { x: wpt.x, y: wpt.y };
        }
        if (type === 'rect' || type === 'ellipse' || type === 'diamond' || type === 'arrow') {
            s.props.fill = 'transparent';
        }
        return s;
    }

    function endRef(wpt, hit) {
        return hit
            ? { id: hit.shape.id, anchor: hit.port.id, x: hit.port.x, y: hit.port.y }
            : { x: wpt.x, y: wpt.y };
    }

    // ---------- 指针事件 ----------
    function onDown(e) {
        deps.commitEdit(false);  // 若正在编辑，点击画布视为确认提交

        const sp = relPt(e);
        const wpt = s2w(sp.x, sp.y);
        const tool = State.tool;
        gesture.startS = sp;
        gesture.startW = wpt;
        gesture.changed = false;
        setPorts(null);

        if (e.button === 1 || spaceHeld || tool === 'hand') {
            gesture.mode = 'pan';
            gesture.startCam = { x: State.camera.x, y: State.camera.y };
            canvas.setPointerCapture(e.pointerId);
            canvas.style.cursor = 'grabbing';
            e.preventDefault();
            return;
        }
        if (e.button !== 0) return;
        canvas.setPointerCapture(e.pointerId);
        gesture.pointerId = e.pointerId;

        switch (tool) {
            case 'select': {
                // 箭头端点优先：拖动端点可重新连接
                const endHit = arrowEndAt(wpt);
                if (endHit) {
                    const other = endHit.key === 'a' ? endHit.shape.b : endHit.shape.a;
                    gesture.mode = 'end';
                    gesture.arrowId = endHit.shape.id;
                    gesture.endKey = endHit.key;
                    gesture.otherId = other && other.id;
                    gesture.originals.clear();
                    gesture.originals.set(endHit.shape.id, clone(endHit.shape));
                    setPorts(nearPorts(wpt, gesture.otherId, portHit(wpt, gesture.otherId)));
                    break;
                }
                const box = selectionBounds();
                if (box) {
                    const hd = Geom.handleAt(box, wpt.x, wpt.y, 8 / State.camera.z);
                    if (hd) {
                        gesture.mode = 'resize';
                        gesture.handle = hd;
                        gesture.origBox = box;
                        snapshotSelection();
                        break;
                    }
                }
                const hit = topHit(wpt);
                if (hit) {
                    if (e.shiftKey) {
                        if (State.selection.has(hit.id)) State.selection.delete(hit.id);
                        else State.selection.add(hit.id);
                        gesture.mode = 'idle';
                        deps.updateUI();
                    } else {
                        if (!State.selection.has(hit.id)) {
                            State.selection.clear();
                            State.selection.add(hit.id);
                            deps.updateUI();
                        }
                        gesture.mode = 'move';
                        snapshotSelection();
                    }
                } else {
                    if (!e.shiftKey) {
                        State.selection.clear();
                        deps.updateUI();
                    }
                    gesture.mode = 'marquee';
                    gesture.marqueeBase = new Set(State.selection);
                    State.ui.marquee = null;
                }
                break;
            }
            case 'eraser':
                gesture.mode = 'erase';
                eraseAt(wpt);
                break;
            case 'pencil':
                gesture.mode = 'draw';
                gesture.pts = [wpt];
                State.ui.temp = mkShape('draw', wpt);
                break;
            case 'rect': case 'ellipse': case 'diamond':
                gesture.mode = 'create';
                State.ui.temp = mkShape(tool, wpt);
                break;
            case 'arrow': {
                gesture.mode = 'arrow';
                const h0 = portHit(wpt, null);
                const temp = mkShape('arrow', wpt);
                temp.a = endRef(wpt, h0);
                State.ui.temp = temp;
                setPorts(nearPorts(wpt, null, h0));
                break;
            }
            case 'text': {
                const t = mkShape('text', wpt);
                t.w = 220;
                t.x = wpt.x - t.w / 2;
                t.y = wpt.y - (Geom.FONT[t.props.font] || 24) * 0.7;
                t.label = '';
                t._new = true;
                State.shapes.set(t.id, t);
                State.selection.clear();
                State.selection.add(t.id);
                State.setTool('select');
                gesture.mode = 'idle';
                deps.startEdit(t.id);
                deps.updateUI();
                break;
            }
        }
        deps.requestDraw();
    }

    function onMove(e) {
        const sp = relPt(e);
        const wpt = s2w(sp.x, sp.y);
        const cam = State.camera;

        switch (gesture.mode) {
            case 'pan':
                cam.x = gesture.startCam.x - (sp.x - gesture.startS.x) / cam.z;
                cam.y = gesture.startCam.y - (sp.y - gesture.startS.y) / cam.z;
                deps.requestDraw();
                return;
            case 'marquee': {
                State.ui.marquee = Geom.normRect(gesture.startW.x, gesture.startW.y, wpt.x, wpt.y);
                const sel = new Set(gesture.marqueeBase);
                for (const s of State.shapes.values()) {
                    const b = Geom.boundsOf(s, getShape);
                    if (Geom.rectsIntersect(b, State.ui.marquee)) sel.add(s.id);
                }
                State.selection.clear();
                for (const id of sel) State.selection.add(id);
                break;
            }
            case 'move': {
                if (!gesture.changed && Math.abs(sp.x - gesture.startS.x) < 3 && Math.abs(sp.y - gesture.startS.y) < 3) return;
                const dx = wpt.x - gesture.startW.x, dy = wpt.y - gesture.startW.y;
                gesture.changed = true;
                for (const [id, orig] of gesture.originals) {
                    const live = State.shapes.get(id);
                    if (!live) continue;
                    Object.assign(live, clone(orig));
                    Geom.moveShape(live, dx, dy);
                }
                break;
            }
            case 'resize': {
                gesture.changed = true;
                const nb = Geom.resizeBox(gesture.origBox, gesture.handle.id, wpt.x, wpt.y);
                const map = Geom.mapper(gesture.origBox, nb);
                for (const [id, orig] of gesture.originals) {
                    const live = State.shapes.get(id);
                    if (!live) continue;
                    Object.assign(live, clone(orig));
                    Geom.scaleShape(live, map);
                }
                break;
            }
            case 'create': {
                const t = State.ui.temp;
                const r = Geom.normRect(gesture.startW.x, gesture.startW.y, wpt.x, wpt.y);
                if (e.shiftKey) {
                    const sz = Math.max(r.w, r.h);
                    r.x = wpt.x < gesture.startW.x ? gesture.startW.x - sz : gesture.startW.x;
                    r.y = wpt.y < gesture.startW.y ? gesture.startW.y - sz : gesture.startW.y;
                    r.w = sz; r.h = sz;
                }
                Object.assign(t, r);
                gesture.changed = true;
                break;
            }
            case 'draw': {
                const last = gesture.pts[gesture.pts.length - 1];
                if (Math.hypot(wpt.x - last.x, wpt.y - last.y) > 1.5 / cam.z) {
                    gesture.pts.push(wpt);
                    State.ui.temp.points = gesture.pts;
                }
                break;
            }
            case 'erase':
                eraseAt(wpt);
                break;
            case 'end': {
                const s = State.shapes.get(gesture.arrowId);
                if (!s) break;
                gesture.changed = true;
                const h = portHit(wpt, gesture.otherId);
                s[gesture.endKey] = endRef(wpt, h);
                setPorts(nearPorts(wpt, gesture.otherId, h));
                break;
            }
            case 'arrow': {
                const t = State.ui.temp;
                const exclude = t.a.id || null;
                const h = portHit(wpt, exclude);
                t.b = endRef(wpt, h);
                setPorts(nearPorts(wpt, exclude, h));
                break;
            }
            default:
                if (!spaceHeld) hoverCursor(sp, wpt);
                return;
        }
        deps.requestDraw();
    }

    function onUp(e) {
        const sp = relPt(e);
        const wpt = s2w(sp.x, sp.y);
        const cam = State.camera;

        switch (gesture.mode) {
            case 'move': case 'resize':
                if (gesture.changed) State.commit();
                break;
            case 'marquee':
                State.ui.marquee = null;
                break;
            case 'create': {
                const t = State.ui.temp;
                if (!(gesture.changed && t.w > 6 && t.h > 6)) {
                    // 单击：创建默认大小
                    const def = t.type === 'diamond' ? { w: 160, h: 110 } : { w: 140, h: 90 };
                    t.x = gesture.startW.x - def.w / 2;
                    t.y = gesture.startW.y - def.h / 2;
                    t.w = def.w; t.h = def.h;
                }
                State.shapes.set(t.id, t);
                State.selection.clear();
                State.selection.add(t.id);
                State.setTool('select');
                State.commit();
                State.ui.temp = null;
                break;
            }
            case 'draw': {
                const pts = Geom.simplify(gesture.pts, 1.2 / cam.z);
                if (pts.length) {
                    const s = mkShape('draw', pts[0]);
                    s.points = pts;
                    s.props.fill = 'transparent';
                    State.shapes.set(s.id, s);
                    State.commit();
                }
                State.ui.temp = null;
                break;
            }
            case 'arrow': {
                const t = State.ui.temp;
                const len = Math.hypot(t.b.x - t.a.x, t.b.y - t.a.y);
                const valid = len > 5 / cam.z || (t.a.id && t.b.id && t.a.id !== t.b.id);
                if (valid) {
                    State.shapes.set(t.id, t);
                    State.selection.clear();
                    State.selection.add(t.id);   // 选中新建箭头，可直接拖动端点
                    State.setTool('select');
                    State.commit();
                }
                State.ui.temp = null;
                break;
            }
            case 'end':
                if (gesture.changed) State.commit();
                break;
            case 'erase':
                if (gesture.changed) State.commit();
                break;
        }

        gesture.mode = 'idle';
        gesture.changed = false;
        gesture.handle = null;
        gesture.arrowId = null;
        gesture.endKey = null;
        gesture.otherId = null;
        gesture.originals.clear();
        State.ui.hover.clear();
        setPorts(null);
        if (gesture.pointerId !== null) {
            try { canvas.releasePointerCapture(gesture.pointerId); } catch (_) { /* ignore */ }
            gesture.pointerId = null;
        }
        updateCursor(sp);
        deps.requestDraw();
        deps.updateUI();
    }

    function onDblClick(e) {
        if (State.tool !== 'select') return;
        const sp = relPt(e);
        const wpt = s2w(sp.x, sp.y);
        const hit = topHit(wpt);
        if (hit && (BINDABLE.has(hit.type))) {
            State.selection.clear();
            State.selection.add(hit.id);
            State.setTool('select');
            deps.startEdit(hit.id);
        } else if (!hit) {
            // 空白处双击：新建文本
            const t = mkShape('text', wpt);
            t.w = 220;
            t.x = wpt.x - t.w / 2;
            t.y = wpt.y - (Geom.FONT[t.props.font] || 24) * 0.7;
            t.label = '';
            t._new = true;
            State.shapes.set(t.id, t);
            State.selection.clear();
            State.selection.add(t.id);
            State.setTool('select');
            deps.startEdit(t.id);
        }
        deps.updateUI();
        deps.requestDraw();
    }

    // ---------- 橡皮 ----------
    function eraseAt(wpt) {
        const hit = topHit(wpt);
        if (hit) {
            State.detachArrows(new Set([hit.id]));
            State.shapes.delete(hit.id);
            State.selection.delete(hit.id);
            State.ui.hover.delete(hit.id);
            gesture.changed = true;
            deps.requestDraw();
        }
    }

    function eraserHover(wpt) {
        State.ui.hover.clear();
        const hit = topHit(wpt);
        if (hit) State.ui.hover.add(hit.id);
        deps.requestDraw();
    }

    // ---------- 光标与缩放 ----------
    function hoverCursor(sp, wpt) {
        if (State.tool === 'eraser') {
            setPorts(null);
            eraserHover(wpt);
            canvas.style.cursor = 'cell';
            return;
        }
        State.ui.hover.clear();

        // 箭头工具：高亮即将吸附的连接点
        if (State.tool === 'arrow') {
            setPorts(nearPorts(wpt, null, portHit(wpt, null)));
            canvas.style.cursor = 'crosshair';
            return;
        }
        if (State.tool !== 'select') {
            setPorts(null);
            canvas.style.cursor = '';
            return;
        }

        if (arrowEndAt(wpt)) {
            setPorts(nearPorts(wpt, null, portHit(wpt, null)));
            canvas.style.cursor = 'pointer';
            return;
        }
        const box = selectionBounds();
        if (box) {
            const hd = Geom.handleAt(box, wpt.x, wpt.y, 8 / State.camera.z);
            if (hd) { setPorts(null); canvas.style.cursor = hd.cursor; return; }
        }
        // 选中箭头时提示可连接的位置
        setPorts(selectedArrow() ? nearPorts(wpt, null, portHit(wpt, null)) : null);
        canvas.style.cursor = topHit(wpt) ? 'move' : 'default';
    }

    function updateCursor(sp) {
        const tool = State.tool;
        if (spaceHeld || tool === 'hand') { canvas.style.cursor = spaceHeld ? 'grab' : 'grab'; return; }
        if (tool === 'select') { canvas.style.cursor = 'default'; return; }
        if (tool === 'text') { canvas.style.cursor = 'text'; return; }
        if (tool === 'eraser') { canvas.style.cursor = 'cell'; return; }
        canvas.style.cursor = 'crosshair';
    }

    function onWheel(e) {
        e.preventDefault();
        const sp = relPt(e);
        const cam = State.camera;
        if (e.shiftKey && !e.ctrlKey) {
            cam.x += (e.deltaY + e.deltaX) / cam.z;
        } else {
            const f = Math.exp(-(e.ctrlKey ? e.deltaY * 0.004 : e.deltaY * 0.0016));
            zoomAt(sp.x, sp.y, f);
        }
        deps.onZoom();
    }

    function zoomAt(px, py, factor) {
        const cam = State.camera;
        const z2 = Math.min(4, Math.max(0.1, cam.z * factor));
        if (z2 === cam.z) return;
        cam.x += px / cam.z - px / z2;
        cam.y += py / cam.z - py / z2;
        cam.z = z2;
        deps.onZoom();
        deps.requestDraw();
    }

    function zoomReset() {
        const cam = State.camera;
        const cx = cam.x + (wrap.clientWidth / 2) / cam.z;
        const cy = cam.y + (wrap.clientHeight / 2) / cam.z;
        cam.z = 1;
        cam.x = cx - wrap.clientWidth / 2;
        cam.y = cy - wrap.clientHeight / 2;
        deps.onZoom();
        deps.requestDraw();
    }

    function zoomFit() {
        const cam = State.camera;
        let box = null;
        for (const s of State.shapes.values()) {
            const b = Geom.boundsOf(s, getShape);
            box = box ? Geom.union(box, b) : { x: b.x, y: b.y, w: b.w, h: b.h };
        }
        if (!box || (box.w === 0 && box.h === 0)) {
            cam.x = -wrap.clientWidth / 2;
            cam.y = -wrap.clientHeight / 2;
            cam.z = 1;
        } else {
            const margin = 80;
            const z = Math.min(4, Math.max(0.1, Math.min(
                (wrap.clientWidth - margin * 2) / Math.max(box.w, 1),
                (wrap.clientHeight - margin * 2) / Math.max(box.h, 1)
            )));
            cam.z = z;
            cam.x = box.x + box.w / 2 - wrap.clientWidth / (2 * z);
            cam.y = box.y + box.h / 2 - wrap.clientHeight / (2 * z);
        }
        deps.onZoom();
        deps.requestDraw();
    }

    window.Tools = {
        init, zoomAt, zoomReset, zoomFit,
        get spaceHeld() { return spaceHeld; },
    };
})();
