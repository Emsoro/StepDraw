// SVG 导出：把画板转成矢量图，绘制参数与 canvas 渲染（render.js）保持一致
(function () {
    'use strict';

    const STROKE_DEFAULT = '#1d1d21';

    function num(v) {
        return Math.round(v * 100) / 100;
    }

    function esc(s) {
        return String(s).replace(/[&<>"']/g, m => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
        })[m]);
    }

    function strokeOf(p) {
        return p.stroke || STROKE_DEFAULT;
    }

    function fillOf(p) {
        return p.fill && p.fill !== 'transparent' ? p.fill : 'none';
    }

    function dashAttr(p, sw) {
        const d = Render.dashFor(p.dash, sw);
        return d.length ? ' stroke-dasharray="' + d.map(num).join(' ') + '"' : '';
    }

    function pointsAttr(list) {
        return list.map(p => num(p.x) + ',' + num(p.y)).join(' ');
    }

    // 描边 + 填充（rect / ellipse / diamond 共用）
    function boxAttrs(p, sw) {
        return 'fill="' + esc(fillOf(p)) + '" stroke="' + esc(strokeOf(p)) +
            '" stroke-width="' + num(sw) + '" stroke-linejoin="round" stroke-linecap="round"' +
            dashAttr(p, sw);
    }

    // 文字属性（字号、字体族、颜色）
    function textAttrs(p, size, color) {
        return 'font-family="' + esc(Geom.fontStack(p)) + '" font-size="' + num(size) +
            '" font-weight="500" fill="' + esc(color) + '"';
    }

    function textEl(s, p) {
        const lay = Geom.textLayout(s);
        const met = Geom.textMetrics(p);
        const x = s.x + lay.size * Geom.PAD;
        const yTop = s.y + lay.size * Geom.PAD;
        const attrs = textAttrs(p, lay.size, strokeOf(p));
        const out = [];
        for (let i = 0; i < lay.lines.length; i++) {
            if (!lay.lines[i]) continue;
            // canvas 用 textBaseline='top'，SVG 用 ascent 折算成 alphabetic 基线
            out.push('<text x="' + num(x) + '" y="' + num(yTop + i * lay.lineHeight + met.ascent) +
                '" ' + attrs + ' xml:space="preserve">' + esc(lay.lines[i]) + '</text>');
        }
        return out.join('\n');
    }

    function labelEl(s, p) {
        if (!s.label) return '';
        const lay = Geom.labelLayout(s);
        const met = Geom.textMetrics(p);
        const cx = s.x + s.w / 2;
        const startY = s.y + s.h / 2 - (lay.textH - lay.lineHeight) / 2;
        // canvas 用 textBaseline='middle'，折算出 alphabetic 基线
        const off = (met.ascent - met.descent) / 2;
        const attrs = textAttrs(p, lay.size, strokeOf(p));
        const out = [];
        for (let i = 0; i < lay.lines.length; i++) {
            if (!lay.lines[i]) continue;
            out.push('<text x="' + num(cx) + '" y="' + num(startY + i * lay.lineHeight + off) +
                '" text-anchor="middle" ' + attrs + ' xml:space="preserve">' + esc(lay.lines[i]) + '</text>');
        }
        return out.join('\n');
    }

    function drawEl(s, p) {
        const sw = Geom.STROKE[p.size] || 4;
        const pts = s.points || [];
        if (!pts.length) return '';
        const color = esc(strokeOf(p));
        if (pts.length === 1) {
            return '<circle cx="' + num(pts[0].x) + '" cy="' + num(pts[0].y) +
                '" r="' + num(sw / 2) + '" fill="' + color + '"/>';
        }
        // 与 canvas 的 quadraticCurveTo 平滑方式一致
        let d = 'M' + num(pts[0].x) + ' ' + num(pts[0].y);
        for (let i = 1; i < pts.length - 1; i++) {
            const mx = (pts[i].x + pts[i + 1].x) / 2;
            const my = (pts[i].y + pts[i + 1].y) / 2;
            d += ' Q' + num(pts[i].x) + ' ' + num(pts[i].y) + ' ' + num(mx) + ' ' + num(my);
        }
        const last = pts[pts.length - 1];
        d += ' L' + num(last.x) + ' ' + num(last.y);
        return '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="' + num(sw) +
            '" stroke-linecap="round" stroke-linejoin="round"/>';
    }

    function arrowEl(s, p, getShape) {
        const sw = Geom.STROKE[p.size] || 4;
        const route = Geom.arrowRoute(s, getShape);
        const a = Geom.arrowHead(route.pts, sw);
        const color = esc(strokeOf(p));
        let out = '<polyline points="' + pointsAttr(a.shaft) + '" fill="none" stroke="' + color +
            '" stroke-width="' + num(sw) + '" stroke-linejoin="round" stroke-linecap="round"' +
            dashAttr(p, sw) + '/>';
        out += '\n<polygon points="' + pointsAttr([a.tip, a.left, a.right]) +
            '" fill="' + color + '" stroke="none"/>';
        return out;
    }

    function shapeToSvg(s, getShape) {
        const p = s.props || {};
        const sw = Geom.STROKE[p.size] || 4;
        switch (s.type) {
            case 'rect': {
                const r = Math.max(0, Math.min(6, s.w / 3, s.h / 3));
                return '<rect x="' + num(s.x) + '" y="' + num(s.y) + '" width="' + num(s.w) +
                    '" height="' + num(s.h) + '" rx="' + num(r) + '" ' + boxAttrs(p, sw) + '/>' +
                    '\n' + labelEl(s, p);
            }
            case 'ellipse':
                return '<ellipse cx="' + num(s.x + s.w / 2) + '" cy="' + num(s.y + s.h / 2) +
                    '" rx="' + num(Math.max(0.5, s.w / 2)) + '" ry="' + num(Math.max(0.5, s.h / 2)) +
                    '" ' + boxAttrs(p, sw) + '/>' + '\n' + labelEl(s, p);
            case 'diamond':
                return '<polygon points="' + pointsAttr([
                    { x: s.x + s.w / 2, y: s.y },
                    { x: s.x + s.w, y: s.y + s.h / 2 },
                    { x: s.x + s.w / 2, y: s.y + s.h },
                    { x: s.x, y: s.y + s.h / 2 },
                ]) + '" ' + boxAttrs(p, sw) + '/>' + '\n' + labelEl(s, p);
            case 'text':
                return textEl(s, p);
            case 'draw':
                return drawEl(s, p);
            case 'arrow':
                return arrowEl(s, p, getShape);
            default:
                return '';
        }
    }

    // 生成整张画板的 SVG 文本；画板为空时返回 null
    function build() {
        const getShape = id => State.shapes.get(id);
        let box = null;
        for (const s of State.shapes.values()) {
            const b = Geom.boundsOf(s, getShape);
            box = box ? Geom.union(box, b) : { x: b.x, y: b.y, w: b.w, h: b.h };
        }
        if (!box) return null;
        box = Geom.inflate(box, 40);

        const bodies = [];
        for (const s of State.shapes.values()) {
            const body = shapeToSvg(s, getShape);
            if (body) bodies.push(body);
        }

        const w = Math.max(1, Math.round(box.w));
        const h = Math.max(1, Math.round(box.h));
        const text =
            '<?xml version="1.0" encoding="UTF-8"?>\n' +
            '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h +
            '" viewBox="' + num(box.x) + ' ' + num(box.y) + ' ' + num(box.w) + ' ' + num(box.h) + '">\n' +
            '<rect x="' + num(box.x) + '" y="' + num(box.y) + '" width="' + num(box.w) +
            '" height="' + num(box.h) + '" fill="#ffffff"/>\n' +
            bodies.join('\n') + '\n</svg>\n';
        return { text, width: w, height: h };
    }

    window.SvgExport = { build };
})();
