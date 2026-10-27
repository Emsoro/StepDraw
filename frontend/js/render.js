// 画布渲染：网格、图形绘制、选择框/手柄、框选。renderScene 同时供屏幕与 PNG 导出复用
(function () {
    'use strict';

    let canvas = null, ctx = null, wrap = null;
    let cssW = 0, cssH = 0, dpr = 1;

    function init(cv, wrapper) {
        canvas = cv;
        ctx = cv.getContext('2d');
        wrap = wrapper;
        resize();
    }

    function resize() {
        cssW = wrap.clientWidth;
        cssH = wrap.clientHeight;
        dpr = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, Math.round(cssW * dpr));
        canvas.height = Math.max(1, Math.round(cssH * dpr));
        canvas.style.width = cssW + 'px';
        canvas.style.height = cssH + 'px';
    }

    function s2w(px, py, cam) {
        return { x: cam.x + px / cam.z, y: cam.y + py / cam.z };
    }

    function w2s(wx, wy, cam) {
        return { x: (wx - cam.x) * cam.z, y: (wy - cam.y) * cam.z };
    }

    function gridSpacing(z) {
        let g = 32;
        while (g * z < 26) g *= 2;
        return g;
    }

    function dashFor(dash, sw) {
        if (dash === 'dashed') return [sw * 3, sw * 2.6];
        if (dash === 'dotted') return [0.1, sw * 2.2];
        return [];
    }

    function roundRectPath(c, x, y, w, h, r) {
        r = Math.max(0, Math.min(r, w / 2, h / 2));
        c.beginPath();
        c.moveTo(x + r, y);
        c.arcTo(x + w, y, x + w, y + h, r);
        c.arcTo(x + w, y + h, x, y + h, r);
        c.arcTo(x, y + h, x, y, r);
        c.arcTo(x, y, x + w, y, r);
        c.closePath();
    }

    // 在世界坐标系下绘制单个图形（ctx 已应用相机变换）
    function drawShape(c, s, getShape) {
        const p = s.props || {};
        const sw = Geom.STROKE[p.size] || 4;
        c.lineWidth = sw;
        c.strokeStyle = p.stroke || '#1d1d21';
        c.fillStyle = p.fill && p.fill !== 'transparent' ? p.fill : 'rgba(0,0,0,0)';
        c.lineJoin = 'round';
        c.lineCap = 'round';
        c.setLineDash(dashFor(p.dash, sw));

        switch (s.type) {
            case 'rect': {
                roundRectPath(c, s.x, s.y, s.w, s.h, Math.min(6, s.w / 3, s.h / 3));
                if (p.fill && p.fill !== 'transparent') c.fill();
                c.stroke();
                drawLabel(c, s);
                break;
            }
            case 'ellipse': {
                c.beginPath();
                c.ellipse(s.x + s.w / 2, s.y + s.h / 2, Math.max(0.5, s.w / 2), Math.max(0.5, s.h / 2), 0, 0, Math.PI * 2);
                if (p.fill && p.fill !== 'transparent') c.fill();
                c.stroke();
                drawLabel(c, s);
                break;
            }
            case 'diamond': {
                c.beginPath();
                c.moveTo(s.x + s.w / 2, s.y);
                c.lineTo(s.x + s.w, s.y + s.h / 2);
                c.lineTo(s.x + s.w / 2, s.y + s.h);
                c.lineTo(s.x, s.y + s.h / 2);
                c.closePath();
                if (p.fill && p.fill !== 'transparent') c.fill();
                c.stroke();
                drawLabel(c, s);
                break;
            }
            case 'text': {
                c.setLineDash([]);
                const lay = Geom.textLayout(s);
                c.fillStyle = p.stroke || '#1d1d21';
                c.font = Geom.fontFor(p);
                c.textBaseline = 'top';
                c.textAlign = 'left';
                const x = s.x + lay.size * Geom.PAD;
                const y = s.y + lay.size * Geom.PAD;
                for (let i = 0; i < lay.lines.length; i++) {
                    c.fillText(lay.lines[i], x, y + i * lay.lineHeight);
                }
                break;
            }
            case 'draw': {
                c.setLineDash([]);
                const pts = s.points;
                if (!pts.length) break;
                c.beginPath();
                if (pts.length === 1) {
                    c.arc(pts[0].x, pts[0].y, sw / 2, 0, Math.PI * 2);
                    c.fillStyle = p.stroke || '#1d1d21';
                    c.fill();
                } else {
                    c.moveTo(pts[0].x, pts[0].y);
                    for (let i = 1; i < pts.length - 1; i++) {
                        const mx = (pts[i].x + pts[i + 1].x) / 2;
                        const my = (pts[i].y + pts[i + 1].y) / 2;
                        c.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
                    }
                    c.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
                    c.stroke();
                }
                break;
            }
            case 'arrow': {
                const r = Geom.arrowRoute(s, getShape);
                const pts = r.pts;
                const headLen = Math.max(9, sw * 3);
                // 线段（终点回退，避免穿过箭头）
                c.beginPath();
                const last = pts[pts.length - 1];
                const prev = pts[pts.length - 2] || last;
                const dLen = Math.hypot(last.x - prev.x, last.y - prev.y) || 1;
                const ux = (last.x - prev.x) / dLen, uy = (last.y - prev.y) / dLen;
                const back = Math.min(headLen * 0.8, dLen / 2);
                c.moveTo(pts[0].x, pts[0].y);
                for (let i = 1; i < pts.length - 1; i++) c.lineTo(pts[i].x, pts[i].y);
                c.lineTo(last.x - ux * back, last.y - uy * back);
                c.stroke();
                // 箭头
                c.setLineDash([]);
                c.beginPath();
                c.moveTo(last.x, last.y);
                c.lineTo(last.x - ux * headLen - uy * headLen * 0.45, last.y - uy * headLen + ux * headLen * 0.45);
                c.lineTo(last.x - ux * headLen + uy * headLen * 0.45, last.y - uy * headLen - ux * headLen * 0.45);
                c.closePath();
                c.fillStyle = p.stroke || '#1d1d21';
                c.fill();
                break;
            }
        }
    }

    // 图形内部标签（居中）
    function drawLabel(c, s) {
        if (!s.label) return;
        const lay = Geom.labelLayout(s);
        c.setLineDash([]);
        c.fillStyle = s.props.stroke || '#1d1d21';
        c.font = Geom.fontFor(s.props);
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        const cx = s.x + s.w / 2;
        const startY = s.y + s.h / 2 - (lay.textH - lay.lineHeight) / 2;
        for (let i = 0; i < lay.lines.length; i++) {
            c.fillText(lay.lines[i], cx, startY + i * lay.lineHeight);
        }
        c.textAlign = 'left';
        c.textBaseline = 'alphabetic';
    }

    // 主渲染入口
    // 约束：canvas.width == viewW * dpr；世界变换总缩放 = dpr * cam.z
    // 屏幕渲染：dpr = devicePixelRatio；PNG 导出：dpr = 1，cam.z = 导出倍率
    function renderScene(c, cam, viewW, viewH, opts) {
        opts = opts || {};
        const dpr = opts.dpr || 1;
        const getShape = id => State.shapes.get(id);

        // 网格点（CSS 像素坐标）
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (opts.grid) {
            const g = gridSpacing(cam.z);
            const startX = Math.floor(cam.x / g) * g;
            const startY = Math.floor(cam.y / g) * g;
            for (let wx = startX, i = 0; wx <= cam.x + viewW / cam.z; wx += g, i++) {
                for (let wy = startY, j = 0; wy <= cam.y + viewH / cam.z; wy += g, j++) {
                    const px = (wx - cam.x) * cam.z;
                    const py = (wy - cam.y) * cam.z;
                    const major = (i % 4 === 0 && j % 4 === 0);
                    c.fillStyle = major ? 'rgba(29,29,33,0.16)' : 'rgba(29,29,33,0.08)';
                    c.fillRect(px - 1, py - 1, 2, 2);
                }
            }
        }

        // 世界变换
        const total = dpr * cam.z;
        c.save();
        c.setTransform(total, 0, 0, total, -cam.x * total, -cam.y * total);

        // 视口裁剪（世界坐标，含余量）
        const vp = { x: cam.x - 100, y: cam.y - 100, w: viewW / cam.z + 200, h: viewH / cam.z + 200 };
        for (const s of State.shapes.values()) {
            const b = Geom.boundsOf(s, getShape);
            if (!Geom.rectsIntersect(Geom.inflate(b, 60), vp)) continue;
            drawShape(c, s, getShape);
        }
        if (State.ui.temp) drawShape(c, State.ui.temp, getShape);
        c.restore();

        // 屏幕坐标层：橡皮高亮、选区、框选
        c.setTransform(dpr, 0, 0, dpr, 0, 0);

        if (opts.overlays) {
            // 橡皮悬停高亮
            for (const id of State.ui.hover) {
                const s = State.shapes.get(id);
                if (!s) continue;
                strokeBoundsScreen(c, Geom.boundsOf(s, getShape), cam, 'rgba(229,72,77,0.9)', 2);
            }

            // 框选
            if (State.ui.marquee) {
                const p0 = w2s(State.ui.marquee.x, State.ui.marquee.y, cam);
                c.fillStyle = 'rgba(59,130,246,0.08)';
                c.strokeStyle = 'rgba(59,130,246,0.7)';
                c.lineWidth = 1;
                c.setLineDash([4, 3]);
                c.fillRect(p0.x, p0.y, State.ui.marquee.w * cam.z, State.ui.marquee.h * cam.z);
                c.strokeRect(p0.x + 0.5, p0.y + 0.5, State.ui.marquee.w * cam.z - 1, State.ui.marquee.h * cam.z - 1);
                c.setLineDash([]);
            }

            // 选择框与手柄
            if (State.selection.size && !State.ui.editingId) {
                let box = null;
                for (const id of State.selection) {
                    const s = State.shapes.get(id);
                    if (!s) continue;
                    const b = Geom.boundsOf(s, getShape);
                    box = box ? Geom.union(box, b) : { x: b.x, y: b.y, w: b.w, h: b.h };
                    if (State.selection.size > 1) {
                        strokeBoundsScreen(c, b, cam, 'rgba(59,130,246,0.45)', 1, true);
                    }
                }
                if (box) {
                    strokeBoundsScreen(c, box, cam, '#3b82f6', 1.5, true);
                    const p0 = w2s(box.x, box.y, cam);
                    const w = box.w * cam.z, h = box.h * cam.z;
                    for (const hd of Geom.handles({ x: p0.x, y: p0.y, w, h })) {
                        c.fillStyle = '#ffffff';
                        c.strokeStyle = '#3b82f6';
                        c.lineWidth = 1.5;
                        c.beginPath();
                        c.rect(hd.x - 4.5, hd.y - 4.5, 9, 9);
                        c.fill();
                        c.stroke();
                    }
                }
            }
        }
        c.setTransform(1, 0, 0, 1, 0, 0);
    }

    function strokeBoundsScreen(c, box, cam, color, width, dashed) {
        const p0 = w2s(box.x, box.y, cam);
        c.strokeStyle = color;
        c.lineWidth = width;
        c.setLineDash(dashed ? [5, 4] : []);
        c.strokeRect(p0.x, p0.y, box.w * cam.z, box.h * cam.z);
        c.setLineDash([]);
    }

    function draw() {
        if (!ctx) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        renderScene(ctx, State.camera, cssW, cssH, { dpr, grid: true, overlays: true });
    }

    window.Render = { init, resize, draw, s2w, w2s, renderScenePublic: renderScene };
})();
