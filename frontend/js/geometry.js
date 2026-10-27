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

    function uid() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    function fontFor(props) {
        return '500 ' + (FONT[props.font] || 24) + 'px "Segoe UI", "Microsoft YaHei", system-ui, sans-serif';
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
        const key = s.label + '\u0001' + s.w + '\u0001' + s.props.font;
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
        const key = 'L' + s.label + '\u0001' + s.w + '\u0001' + s.props.font;
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

    // 按主轴方向取形状边中点（折线路由用）
    function anchorToward(s, other, axis, getShape) {
        const b = boundsOf(s, getShape);
        const c = center(b);
        if (axis === 'h') return { x: other.x <= c.x ? b.x : b.x + b.w, y: c.y };
        return { x: c.x, y: other.y <= c.y ? b.y : b.y + b.h };
    }

    // 解析箭头两端（支持绑定图形）并计算路径点
    function arrowRoute(s, getShape) {
        getShape = getShape || (() => null);
        const sa = s.a.id ? getShape(s.a.id) : null;
        const sb = s.b.id ? getShape(s.b.id) : null;
        const pa = sa ? center(boundsOf(sa, getShape)) : { x: s.a.x, y: s.a.y };
        const pb = sb ? center(boundsOf(sb, getShape)) : { x: s.b.x, y: s.b.y };
        const route = (s.props && s.props.route) || 'straight';

        if (route === 'elbow') {
            const horizontal = Math.abs(pb.x - pa.x) >= Math.abs(pb.y - pa.y);
            const A = sa ? anchorToward(sa, pb, horizontal ? 'h' : 'v', getShape) : { x: s.a.x, y: s.a.y };
            const B = sb ? anchorToward(sb, pa, horizontal ? 'h' : 'v', getShape) : { x: s.b.x, y: s.b.y };
            let pts;
            if (horizontal) {
                if (Math.abs(A.y - B.y) < 2) pts = [A, B];
                else { const mx = (A.x + B.x) / 2; pts = [A, { x: mx, y: A.y }, { x: mx, y: B.y }, B]; }
            } else {
                if (Math.abs(A.x - B.x) < 2) pts = [A, B];
                else { const my = (A.y + B.y) / 2; pts = [A, { x: A.x, y: my }, { x: B.x, y: my }, B]; }
            }
            return { pts, a: A, b: B };
        }

        // 直线：从对方中心方向取边界交点
        const B = sb ? borderPoint(sb, pa, getShape) : { x: s.b.x, y: s.b.y };
        const A = sa ? borderPoint(sa, B, getShape) : { x: s.a.x, y: s.a.y };
        return { pts: [A, B], a: A, b: B };
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
        STROKE, FONT, LINE_H, PAD, MIN_SIZE,
        uid, fontFor, normRect, inflate, center, union, rectsIntersect,
        textLayout, labelLayout, boundsOf, hitShape, hitRoute, distToSeg,
        borderPoint, arrowRoute, moveShape, mapper, scaleShape,
        handles, handleAt, resizeBox, simplify, boundsOfPoints,
    };
})();
