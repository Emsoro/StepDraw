// 几何工具库：包围盒、命中测试、箭头路由、缩放手柄、文本排版
(function () {
    'use strict';

    const measureCanvas = document.createElement('canvas');
    const measureCtx = measureCanvas.getContext('2d');

    const STROKE = { s: 2, m: 4, l: 8 };   // 线宽（世界坐标 px）
    const FONT = { s: 16, m: 24, l: 32 };  // 字号
    const LINE_H = 1.35;                   // 行高系数
    const PAD = 0.35;                      // 文本内边距（相对字号）
    const MIN_SIZE = 8;                    // 最小尺寸

    // 可选字体：props.family 存 key（旧文档没有该字段时回落到 sans）
    const FAMILIES = {
        sans: '"Segoe UI", "Microsoft YaHei", system-ui, sans-serif',
        simsun: '"SimSun", "Songti SC", "Microsoft YaHei", serif',
        simhei: '"SimHei", "Microsoft YaHei", "Segoe UI", sans-serif',
        kai: 'KaiTi, STKaiti, "Microsoft YaHei", serif',
        fangsong: '"FangSong", "STFangsong", "SimSun", "Microsoft YaHei", serif',
        youyuan: '"YouYuan", STYuanti, "Microsoft YaHei", sans-serif',
        mono: '"Cascadia Mono", Consolas, "Courier New", "Microsoft YaHei", monospace',
        serif: 'Georgia, "Times New Roman", "SimSun", "Microsoft YaHei", serif',
    };

    function uid() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    function fontStack(props) {
        return FAMILIES[(props && props.family) || 'sans'] || FAMILIES.sans;
    }

    function fontFor(props) {
        return '500 ' + (FONT[props.font] || 24) + 'px ' + fontStack(props);
    }

    // 垂直度量：把 canvas 的 top/middle 基线换算成 SVG 的 alphabetic 基线
    function textMetrics(props) {
        measureCtx.font = fontFor(props);
        const m = measureCtx.measureText('中');
        const size = FONT[props.font] || 24;
        return {
            ascent: m.fontBoundingBoxAscent != null ? m.fontBoundingBoxAscent : size * 0.88,
            descent: m.fontBoundingBoxDescent != null ? m.fontBoundingBoxDescent : size * 0.22,
        };
    }

    function normRect(x1, y1, x2, y2) {
        return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
    }

    function inflate(b, p) {
        return { x: b.x - p, y: b.y - p, w: b.w + p * 2, h: b.h + p * 2 };
    }

    function center(b) {
        return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    }

    function union(a, b) {
        const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
        return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
    }

    function rectsIntersect(a, b) {
        return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    }

    // ---------- 文本排版 ----------
    function wrapLines(ctx, text, maxW) {
        const lines = [];
        for (const raw of String(text || '').split('\n')) {
            if (raw === '') { lines.push(''); continue; }
            let line = '';
            for (const ch of raw) {
                const t = line + ch;
                if (line && ctx.measureText(t).width > maxW) { lines.push(line); line = ch; }
                else line = t;
            }
            lines.push(line);
        }
        return lines;
    }

    // 文本形状排版：按形状宽度换行
    function textLayout(s) {
        const key = s.label + '\u0001' + s.w + '\u0001' + s.props.font + '\u0001' + (s.props.family || '');
        if (s._layout && s._layout.key === key) return s._layout;
        const size = FONT[s.props.font] || 24;
        measureCtx.font = fontFor(s.props);
        const lines = wrapLines(measureCtx, s.label, Math.max(20, s.w - size * PAD * 2));
        const layout = { key, lines, lineHeight: size * LINE_H, textH: lines.length * size * LINE_H, size };
        s._layout = layout;
        return layout;
    }

    // 形状标签排版：按形状宽度 80% 换行
    function labelLayout(s) {
        const key = 'L' + s.label + '\u0001' + s.w + '\u0001' + s.props.font + '\u0001' + (s.props.family || '');
        if (s._llayout && s._llayout.key === key) return s._llayout;
        const size = FONT[s.props.font] || 24;
        measureCtx.font = fontFor(s.props);
        const lines = wrapLines(measureCtx, s.label, Math.max(20, s.w * 0.8));
        const layout = { key, lines, lineHeight: size * LINE_H, textH: lines.length * size * LINE_H, size };
        s._llayout = layout;
        return layout;
    }

    // ---------- 包围盒 ----------
    function boundsOfPoints(pts, pad) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of pts) {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
        }
        if (!isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
        return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
    }

    // 形状包围盒（箭头需要 getShape 解析绑定端点）
    function boundsOf(s, getShape) {
        if (s.type === 'draw') {
            return boundsOfPoints(s.points, (STROKE[s.props.size] || 4) / 2 + 1);
        }
        if (s.type === 'arrow') {
            const r = arrowRoute(s, getShape);
            return boundsOfPoints(r.pts, (STROKE[s.props.size] || 4) / 2 + 5);
        }
        if (s.type === 'text') {
            const lay = textLayout(s);
            return { x: s.x, y: s.y, w: s.w, h: Math.max(lay.textH + lay.size * PAD * 2, lay.size * 1.6) };
        }
        return { x: s.x, y: s.y, w: s.w, h: s.h };
    }

    // ---------- 命中测试 ----------
    function distToSeg(p, a, b) {
        const dx = b.x - a.x, dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
        let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
    }

    function hitRoute(pts, x, y, tol) {
        for (let i = 1; i < pts.length; i++) {
            if (distToSeg({ x, y }, pts[i - 1], pts[i]) <= tol) return true;
        }
        return false;
    }

    // 形状命中（tol 为世界坐标容差）
    function hitShape(s, wx, wy, tol, getShape) {
        const b = boundsOf(s, getShape);
        if (s.type === 'arrow') {
            return hitRoute(arrowRoute(s, getShape).pts, wx, wy, Math.max(tol, (STROKE[s.props.size] || 4) / 2 + 4));
        }
        if (s.type === 'draw') {
            const pts = s.points;
            for (let i = 1; i < pts.length; i++) {
                if (distToSeg({ x: wx, y: wy }, pts[i - 1], pts[i]) <= tol) return true;
            }
            return pts.length === 1 && Math.hypot(wx - pts[0].x, wy - pts[0].y) <= tol;
        }
        if (s.type === 'text') {
            return wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h;
        }

        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        const filled = s.props.fill && s.props.fill !== 'transparent';
        if (s.type === 'ellipse') {
            const rx = b.w / 2, ry = b.h / 2;
            const k = ((wx - cx) / rx) ** 2 + ((wy - cy) / ry) ** 2;
            if (filled) return k <= 1;
            const t = tol / Math.min(rx, ry);
            return k <= 1 && k >= (1 - t) ** 2;
        }
        if (s.type === 'diamond') {
            const rx = b.w / 2, ry = b.h / 2;
            const k = Math.abs(wx - cx) / rx + Math.abs(wy - cy) / ry;
            if (filled) return k <= 1;
            const t = tol / Math.min(rx, ry);
            return k <= 1 && k >= 1 - t;
        }
        // rect
        if (filled) {
            return wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h;
        }
        const inOuter = wx >= b.x - tol && wx <= b.x + b.w + tol && wy >= b.y - tol && wy <= b.y + b.h + tol;
        const inInner = wx >= b.x + tol && wx <= b.x + b.w - tol && wy >= b.y + tol && wy <= b.y + b.h - tol;
        return inOuter && !inInner;
    }

    // ---------- 箭头 ----------
    // 射线与包围盒边界交点
    function borderPoint(s, tx, ty, getShape) {
        const b = boundsOf(s, getShape);
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        const dx = tx - cx, dy = ty - cy;
        if (dx === 0 && dy === 0) return { x: b.x + b.w, y: cy };
        if (s.type === 'ellipse') {
            const rx = b.w / 2, ry = b.h / 2;
            const t = Math.atan2(dy * rx, dx * ry);
            return { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) };
        }
        if (s.type === 'diamond') {
            const rx = b.w / 2, ry = b.h / 2;
            const k = 1 / (Math.abs(dx) / rx + Math.abs(dy) / ry);
            return { x: cx + dx * k, y: cy + dy * k };
        }
        const rx = b.w / 2, ry = b.h / 2;
        const k = Math.min(dx === 0 ? Infinity : rx / Math.abs(dx), dy === 0 ? Infinity : ry / Math.abs(dy));
        return { x: cx + dx * k, y: cy + dy * k };
    }

    // 连接点：四边中点（Visio 风格，箭头可绑定到具体连接点）
    function portsOf(s, getShape) {
        const b = boundsOf(s, getShape);
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        return [
            { id: 'n', x: cx, y: b.y },
            { id: 'e', x: b.x + b.w, y: cy },
            { id: 's', x: cx, y: b.y + b.h },
            { id: 'w', x: b.x, y: cy },
        ];
    }

    function portOf(s, anchor, getShape) {
        if (!s || !anchor) return null;
        for (const p of portsOf(s, getShape)) {
            if (p.id === anchor) return p;
        }
        return null;
    }

    // 连接点法线：连接线离开图形的方向
    function portNormal(port) {
        if (!port) return { x: 0, y: 0 };
        if (port.id === 'e') return { x: 1, y: 0 };
        if (port.id === 'w') return { x: -1, y: 0 };
        if (port.id === 's') return { x: 0, y: 1 };
        return { x: 0, y: -1 };
    }

    function isHorizPort(port) {
        return !!port && (port.id === 'e' || port.id === 'w');
    }

    function dedupePts(pts) {
        const out = [];
        for (const p of pts) {
            const last = out[out.length - 1];
            if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
            out.push(p);
        }
        return out;
    }

    // 按主轴方向取形状边中点（直线/折线共用的端点）
    function anchorToward(s, other, axis, getShape) {
        const b = boundsOf(s, getShape);
        const c = center(b);
        if (axis === 'h') return { x: other.x <= c.x ? b.x : b.x + b.w, y: c.y };
        return { x: c.x, y: other.y <= c.y ? b.y : b.y + b.h };
    }

    // 解析箭头两端：端点位置只取决于绑定关系（图形 + 连接点），与直线/折线无关
    // 因此切换线型时端点不会跳动，只是中间走线改变
    function arrowEnds(s, getShape) {
        getShape = getShape || (() => null);
        const sa = s.a.id ? getShape(s.a.id) : null;
        const sb = s.b.id ? getShape(s.b.id) : null;
        const ca = sa ? center(boundsOf(sa, getShape)) : { x: s.a.x, y: s.a.y };
        const cb = sb ? center(boundsOf(sb, getShape)) : { x: s.b.x, y: s.b.y };
        const qa = portOf(sa, s.a.anchor, getShape);
        const qb = portOf(sb, s.b.anchor, getShape);

        // 主轴：有水平方向的连接点时用水平，否则看两端中心偏移
        let horizontal;
        if (isHorizPort(qa) || isHorizPort(qb)) horizontal = true;
        else if (qa || qb) horizontal = false;
        else horizontal = Math.abs(cb.x - ca.x) >= Math.abs(cb.y - ca.y);
        const axis = horizontal ? 'h' : 'v';

        let A = qa ? { x: qa.x, y: qa.y }
            : (sa ? anchorToward(sa, cb, axis, getShape) : { x: s.a.x, y: s.a.y });
        let B = qb ? { x: qb.x, y: qb.y }
            : (sb ? anchorToward(sb, ca, axis, getShape) : { x: s.b.x, y: s.b.y });

        // 两端重合（如旧数据两端连到同一连接点）：给一个最小可见长度，避免整条线堆成一个点
        if (Math.hypot(B.x - A.x, B.y - A.y) < 2) {
            const nb = portNormal(qb), na = portNormal(qa);
            const dir = (nb.x || nb.y) ? nb
                : ((na.x || na.y) ? { x: -na.x, y: -na.y } : { x: 1, y: 0 });
            B = { x: B.x + dir.x * 40, y: B.y + dir.y * 40 };
        }
        return { A, B, qa, qb, horizontal };
    }

    // 解析箭头两端（支持绑定图形与连接点）并计算路径点
    function arrowRoute(s, getShape) {
        const ends = arrowEnds(s, getShape);
        const A = ends.A, B = ends.B;
        const qa = ends.qa, qb = ends.qb;
        const nA = portNormal(qa), nB = portNormal(qb);
        const route = (s.props && s.props.route) || 'straight';

        if (route === 'elbow') {
            const horizontal = ends.horizontal;
            const STUB = 24;
            let pts;

            if (qa && qb && isHorizPort(qa) !== isHorizPort(qb)) {
                // 两端法线互相垂直：走两段直角过渡
                if (isHorizPort(qa)) {
                    let sx = (A.x + B.x) / 2;
                    if (nA.x > 0 && sx < A.x + STUB) sx = A.x + STUB;
                    if (nA.x < 0 && sx > A.x - STUB) sx = A.x - STUB;
                    let sy = (A.y + B.y) / 2;
                    if (nB.y < 0 && sy > B.y - STUB) sy = B.y - STUB;
                    if (nB.y > 0 && sy < B.y + STUB) sy = B.y + STUB;
                    pts = [A, { x: sx, y: A.y }, { x: sx, y: sy }, { x: B.x, y: sy }, B];
                } else {
                    let my = (A.y + B.y) / 2;
                    if (nA.y > 0 && my < A.y + STUB) my = A.y + STUB;
                    if (nA.y < 0 && my > A.y - STUB) my = A.y - STUB;
                    let sx = (A.x + B.x) / 2;
                    if (nB.x < 0 && sx > B.x - STUB) sx = B.x - STUB;
                    if (nB.x > 0 && sx < B.x + STUB) sx = B.x + STUB;
                    pts = [A, { x: A.x, y: my }, { x: sx, y: my }, { x: sx, y: B.y }, B];
                }
            } else if (horizontal) {
                const sameSide = nA.x !== 0 && nB.x !== 0 && nA.x === nB.x;
                if (sameSide && Math.abs(A.y - B.y) < 0.5) {
                    // 两端同侧且高度相近：上下绕行，避免穿过图形
                    const xs = A.x + nA.x * STUB, xe = B.x + nB.x * STUB;
                    const my = A.y - STUB * 2;
                    pts = [A, { x: xs, y: A.y }, { x: xs, y: my }, { x: xe, y: my }, { x: xe, y: B.y }, B];
                } else {
                    let mx = (A.x + B.x) / 2;
                    if (nA.x > 0 && mx < A.x + STUB) mx = A.x + STUB;
                    if (nA.x < 0 && mx > A.x - STUB) mx = A.x - STUB;
                    if (nB.x < 0 && mx > B.x - STUB) mx = B.x - STUB;
                    if (nB.x > 0 && mx < B.x + STUB) mx = B.x + STUB;
                    pts = Math.abs(A.y - B.y) < 0.5 ? [A, B] : [A, { x: mx, y: A.y }, { x: mx, y: B.y }, B];
                }
            } else {
                const sameSide = nA.y !== 0 && nB.y !== 0 && nA.y === nB.y;
                if (sameSide && Math.abs(A.x - B.x) < 0.5) {
                    const ys = A.y + nA.y * STUB, ye = B.y + nB.y * STUB;
                    const mx = A.x - STUB * 2;
                    pts = [A, { x: A.x, y: ys }, { x: mx, y: ys }, { x: mx, y: ye }, { x: B.x, y: ye }, B];
                } else {
                    let my = (A.y + B.y) / 2;
                    if (nA.y > 0 && my < A.y + STUB) my = A.y + STUB;
                    if (nA.y < 0 && my > A.y - STUB) my = A.y - STUB;
                    if (nB.y < 0 && my > B.y - STUB) my = B.y - STUB;
                    if (nB.y > 0 && my < B.y + STUB) my = B.y + STUB;
                    pts = Math.abs(A.x - B.x) < 0.5 ? [A, B] : [A, { x: A.x, y: my }, { x: B.x, y: my }, B];
                }
            }
            return { pts: dedupePts(pts), a: A, b: B };
        }

        // 直线：直接连接两端（端点与折线完全一致）
        return { pts: dedupePts([A, B]), a: A, b: B };
    }

    // 箭头几何：线段（末端回退避免穿透箭头）+ 箭头三角形
    function arrowHead(pts, sw) {
        const last = pts[pts.length - 1];
        const prev = pts[pts.length - 2] || last;
        const dLen = Math.hypot(last.x - prev.x, last.y - prev.y) || 1;
        const ux = (last.x - prev.x) / dLen, uy = (last.y - prev.y) / dLen;
        const headLen = Math.max(9, sw * 3);
        const back = Math.min(headLen * 0.8, dLen / 2);
        return {
            shaft: pts.slice(0, -1).concat([{ x: last.x - ux * back, y: last.y - uy * back }]),
            tip: last,
            left: { x: last.x - ux * headLen - uy * headLen * 0.45, y: last.y - uy * headLen + ux * headLen * 0.45 },
            right: { x: last.x - ux * headLen + uy * headLen * 0.45, y: last.y - uy * headLen - ux * headLen * 0.45 },
        };
    }

    // ---------- 移动 / 缩放 ----------
    function moveShape(s, dx, dy) {
        if (s.type === 'draw') {
            for (const p of s.points) { p.x += dx; p.y += dy; }
            s._layout = null;
        } else if (s.type === 'arrow') {
            if (!s.a.id) { s.a.x += dx; s.a.y += dy; }
            if (!s.b.id) { s.b.x += dx; s.b.y += dy; }
        } else {
            s.x += dx;
            s.y += dy;
        }
    }

    function mapper(from, to) {
        const sx = from.w === 0 ? 1 : to.w / from.w;
        const sy = from.h === 0 ? 1 : to.h / from.h;
        return p => ({ x: to.x + (p.x - from.x) * sx, y: to.y + (p.y - from.y) * sy });
    }

    function scaleShape(s, map) {
        if (s.type === 'draw') {
            s.points = s.points.map(map);
        } else if (s.type === 'arrow') {
            if (!s.a.id) { const m = map(s.a); s.a.x = m.x; s.a.y = m.y; }
            if (!s.b.id) { const m = map(s.b); s.b.x = m.x; s.b.y = m.y; }
        } else {
            const p1 = map({ x: s.x, y: s.y });
            const p2 = map({ x: s.x + s.w, y: s.y + s.h });
            s.x = p1.x; s.y = p1.y;
            s.w = Math.abs(p2.x - p1.x);
            s.h = Math.abs(p2.y - p1.y);
            s._layout = null; s._llayout = null;
        }
    }

    // ---------- 缩放手柄 ----------
    function handles(b) {
        const x = b.x, y = b.y, w = b.w, h = b.h;
        return [
            { id: 'nw', x, y, cursor: 'nwse-resize' },
            { id: 'n', x: x + w / 2, y, cursor: 'ns-resize' },
            { id: 'ne', x: x + w, y, cursor: 'nesw-resize' },
            { id: 'e', x: x + w, y: y + h / 2, cursor: 'ew-resize' },
            { id: 'se', x: x + w, y: y + h, cursor: 'nwse-resize' },
            { id: 's', x: x + w / 2, y: y + h, cursor: 'ns-resize' },
            { id: 'sw', x, y: y + h, cursor: 'nesw-resize' },
            { id: 'w', x, y: y + h / 2, cursor: 'ew-resize' },
        ];
    }

    function handleAt(b, wx, wy, tol) {
        for (const hd of handles(b)) {
            if (Math.abs(wx - hd.x) <= tol && Math.abs(wy - hd.y) <= tol) return hd;
        }
        return null;
    }

    function resizeBox(b0, id, wx, wy) {
        let x1 = b0.x, y1 = b0.y, x2 = b0.x + b0.w, y2 = b0.y + b0.h;
        if (id.indexOf('w') >= 0) x1 = Math.min(wx, x2 - MIN_SIZE);
        if (id.indexOf('e') >= 0) x2 = Math.max(wx, x1 + MIN_SIZE);
        if (id.indexOf('n') >= 0) y1 = Math.min(wy, y2 - MIN_SIZE);
        if (id.indexOf('s') >= 0) y2 = Math.max(wy, y1 + MIN_SIZE);
        return normRect(x1, y1, x2, y2);
    }

    // ---------- 铅笔点简化 ----------
    function simplify(pts, minDist) {
        if (pts.length <= 2) return pts.slice();
        const out = [pts[0]];
        for (let i = 1; i < pts.length - 1; i++) {
            const last = out[out.length - 1];
            if (Math.hypot(pts[i].x - last.x, pts[i].y - last.y) >= minDist) out.push(pts[i]);
        }
        out.push(pts[pts.length - 1]);
        return out;
    }

    window.Geom = {
        STROKE, FONT, LINE_H, PAD, MIN_SIZE, FAMILIES,
        uid, fontStack, fontFor, textMetrics, normRect, inflate, center, union, rectsIntersect,
        textLayout, labelLayout, boundsOf, hitShape, hitRoute, distToSeg,
        borderPoint, arrowRoute, arrowHead, portsOf, portOf, portNormal, isHorizPort,
        moveShape, mapper, scaleShape,
        handles, handleAt, resizeBox, simplify, boundsOfPoints,
    };
})();
