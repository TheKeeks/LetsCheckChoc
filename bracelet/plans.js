// Fishers Bracelet plans for the jeweller: a 1:1 flat drawing of the piece
// as it is bent before the tail is wrapped round the wrist, the spec, and
// how to make it. Spanish by default (the jeweller's language), English on
// request. One drawing model renders both to SVG (screen and the .svg file)
// and to PDF (jsPDF), so the PDF is exactly what the page shows.
//
// Page: US Letter landscape, 279.4 × 215.9 mm, drawn in millimetres. Printed
// at 100 % the wire drawing is real size; the 50 mm scale bar checks it.
// Pure apart from saveFile() (browser only). Classic script; also loads in
// node for tests and for scripts/bracelet_plans.js.
(function (root) {
  'use strict';

  var G = root.BraceletGeom || (typeof require === 'function' ? require('./geometry.js') : null);

  var PAGE = { w: 279.4, h: 215.9, margin: 12 };
  var PT = 25.4 / 72;   // mm per typographic point
  var INK = '#1d2329', MUTED = '#5f6b75', WIRE = '#c99a3b', GUIDE = '#9aa5ad';

  var METAL_NAME = {
    es: { '14k': 'oro amarillo de 14 k', '18k': 'oro amarillo de 18 k', '22k': 'oro amarillo de 22 k', silver: 'plata esterlina (pieza de prueba)' },
    en: { '14k': '14k yellow gold', '18k': '18k yellow gold', '22k': '22k yellow gold', silver: 'sterling silver (test piece)' }
  };

  function lang_(lang) { return lang === 'en' ? 'en' : 'es'; }
  // Spanish writes decimals with a comma.
  function num(x, d, lang) {
    var s = Number(x).toFixed(d == null ? 0 : d);
    return lang === 'es' ? s.replace('.', ',') : s;
  }
  function metalName(model, lang) { return METAL_NAME[lang][model.params.metal] || METAL_NAME[lang]['18k']; }

  // ── The figures every part of the plans quotes ─────────────
  function figures(model, lang) {
    var p = model.params, L = model.lengths;
    return {
      metal: metalName(model, lang),
      dia: num(p.wireDiaMm, 1, lang),
      len: String(Math.round(L.totalMm)),
      cut: String(Math.ceil((L.totalMm + 20) / 10) * 10),
      grams: num(G.grams(model, p.metal), 1, lang),
      inner: num(model.ring.innerDiaMm, 1, lang),
      circ: num(p.wristCircMm, 2, lang),
      inches: num(p.wristCircMm / 25.4, 2, lang),
      islandL: String(Math.round(model.island.lengthMm)),
      islandW: num(model.island.widthMm, 1, lang),
      ring: String(Math.round(model.ring.lenMm)),
      tail: String(Math.round(model.flatPiece.tailLenMm)),
      ball: num(model.clasp.ballDiaMm, 1, lang),
      turn: String(Math.round(Math.abs(model.clasp.turnDeg))),
      seat: model.clasp.landmark,
      spots: model.spots.length
    };
  }

  // ── How to make it ─────────────────────────────────────────
  function steps(model, lang) {
    lang = lang_(lang);
    var f = figures(model, lang);
    if (lang === 'es') {
      return [
        'Material: alambre redondo macizo de ' + f.metal + ', Ø ' + f.dia + ' mm. El diseño usa ' + f.len + ' mm de alambre; corte ' + f.cut + ' mm para tener margen. Peso estimado de la pieza terminada: ' + f.grams + ' g.',
        'Recueza el alambre para que se doble sin marcarse.',
        'Imprima la página 1 al 100 % (sin «ajustar a la página») y compruebe que la barra de escala mide 50 mm.',
        'Empiece en el Extremo Este (Wicopesset). Doble el alambre sobre el plano hacia el oeste por la costa norte, pasando por North Hill y Silver Eel, hasta Race Point.',
        'Rodee Race Point y siga hacia el este por la costa sur hasta volver al Extremo Este.',
        'En el Extremo Este el alambre vuelve a tocar su propio inicio. Suelde el inicio a tope contra el alambre que pasa (unión en T), sin superponerlo ni doblarlo, para que la unión quede del mismo grosor que el resto. Lime y pula la unión.',
        f.spots ? 'El contorno se toca a sí mismo en ' + f.spots + (f.spots === 1 ? ' lugar' : ' lugares') + ', donde la isla es más angosta. Suelde un punto en cada uno para darle rigidez.' : null,
        'Desde el Extremo Este el mismo alambre sigue recto: es la cola de ' + f.tail + ' mm que formará el círculo.',
        'Curve la pieza sobre un tribulete de pulsera de ' + f.inner + ' mm de diámetro (' + f.circ + ' mm de circunferencia, ' + f.inches + ' in). La isla queda encima de la muñeca y la cola da la vuelta por debajo, formando un círculo perfecto y plano. La isla va girada ' + f.turn + '° respecto a la cola, como en el plano: así el Extremo Este y ' + f.seat + ' quedan a la misma altura y el círculo no se tuerce.',
        'Haga una bola de Ø ' + f.ball + ' mm en la punta de la cola (con el soplete, o soldando una bola). Al cerrar la pulsera, la cola sube por debajo de la muñeca y la bola se apoya sobre ' + f.seat + ', un poco hacia dentro de la isla, donde la tensión del círculo la mantiene en su sitio.',
        'Endurezca la pieza (martillo de nailon o tamboreado) y pula.'
      ].filter(Boolean);
    }
    return [
      'Material: solid round ' + f.metal + ' wire, ' + f.dia + ' mm. The design uses ' + f.len + ' mm of wire; cut ' + f.cut + ' mm to have some spare. Estimated finished weight: ' + f.grams + ' g.',
      'Anneal the wire so it bends without marking.',
      'Print page 1 at 100 % (not "fit to page") and check the scale bar measures 50 mm.',
      'Start at the East End (Wicopesset). Bend the wire over the drawing west along the north shore, past North Hill and Silver Eel, to Race Point.',
      'Round Race Point and carry on east along the south shore back to the East End.',
      'At the East End the wire touches its own start again. Solder the start end-on against the passing wire (a T joint), without overlapping or doubling it, so the joint is the same thickness as the rest. File and polish the joint.',
      f.spots ? 'The outline touches itself in ' + f.spots + (f.spots === 1 ? ' place' : ' places') + ', where the island is narrowest. Solder a point at each for stiffness.' : null,
      'From the East End the same wire carries straight on: this is the ' + f.tail + ' mm tail that becomes the circle.',
      'Curve the piece round a bracelet mandrel ' + f.inner + ' mm across (' + f.circ + ' mm round, ' + f.inches + ' in). The island sits on top of the wrist and the tail goes round underneath as a flat, perfect circle. The island is turned ' + f.turn + '° to the tail, as drawn, so the East End and ' + f.seat + ' sit at the same height and the circle does not twist.',
      'Ball the end of the tail to ' + f.ball + ' mm (torch, or solder on a ball). When the bracelet is closed the tail comes up from under the wrist and the ball sits on ' + f.seat + ', just inside the island, where the pull of the circle holds it.',
      'Work-harden (nylon mallet or tumbler) and polish.'
    ].filter(Boolean);
  }

  function specRows(model, lang) {
    lang = lang_(lang);
    var f = figures(model, lang);
    if (lang === 'es') {
      return [
        ['Metal', f.metal.charAt(0).toUpperCase() + f.metal.slice(1)],
        ['Alambre', 'redondo macizo, Ø ' + f.dia + ' mm'],
        ['Largo de alambre', f.len + ' mm (corte ' + f.cut + ' mm)'],
        ['Peso estimado', f.grams + ' g'],
        ['Muñeca', f.circ + ' mm (' + f.inches + ' in), Ø interior ' + f.inner + ' mm'],
        ['Isla', f.islandL + ' × ' + f.islandW + ' mm, girada ' + f.turn + '°'],
        ['Círculo', f.ring + ' mm de alambre'],
        ['Cierre', 'bola Ø ' + f.ball + ' mm sobre ' + f.seat],
        ['Soldaduras', 'unión en T en el Extremo Este' + (f.spots ? ' + ' + f.spots + ' puntos de contacto' : '')]
      ];
    }
    return [
      ['Metal', f.metal.charAt(0).toUpperCase() + f.metal.slice(1)],
      ['Wire', 'solid round, ' + f.dia + ' mm'],
      ['Wire length', f.len + ' mm (cut ' + f.cut + ' mm)'],
      ['Est. weight', f.grams + ' g'],
      ['Wrist', f.circ + ' mm (' + f.inches + ' in) round, ' + f.inner + ' mm inside'],
      ['Island', f.islandL + ' × ' + f.islandW + ' mm, turned ' + f.turn + '°'],
      ['Circle', f.ring + ' mm of wire'],
      ['Clasp', f.ball + ' mm ball on ' + f.seat],
      ['Solder', 'T joint at the East End' + (f.spots ? ' + ' + f.spots + ' touch points' : '')]
    ];
  }

  // A note to send with the plans, asking the jeweller for a quote.
  function message(model, lang) {
    lang = lang_(lang);
    var f = figures(model, lang);
    if (lang === 'es') {
      return 'Hola. ¿Podría cotizar y hacer esta pulsera? Es un solo alambre redondo macizo de ' + f.metal + ' de ' + f.dia + ' mm que dibuja el contorno de Fishers Island (Nueva York) y luego rodea la muñeca en un círculo, con una bola como cierre. Le envío el plano a escala real (1:1) y las instrucciones. Largo de alambre: ' + f.len + ' mm. Peso estimado: ' + f.grams + ' g. Muñeca: ' + f.circ + ' mm (' + f.inches + ' pulgadas). ¿Cuál sería el precio y el plazo de entrega? Muchas gracias.';
    }
    return 'Hello. Could you quote and make this bracelet? It is one solid round ' + f.dia + ' mm ' + f.metal + ' wire that traces the outline of Fishers Island (New York) and then goes round the wrist as a circle, with a ball as the clasp. The real-size (1:1) drawing and instructions are attached. Wire length: ' + f.len + ' mm. Estimated weight: ' + f.grams + ' g. Wrist: ' + f.circ + ' mm (' + f.inches + ' in). What would the price and lead time be? Thank you.';
  }

  // ── Page 1: the drawing, as a list of shapes in mm ─────────
  function sheet(model, lang) {
    lang = lang_(lang);
    var es = lang === 'es';
    var f = figures(model, lang);
    var p = model.params, fp = model.flatPiece, r = model.wireRadius;
    var items = [];
    function line(pts, w, color, dash, cap) { items.push({ t: 'line', pts: pts, w: w, color: color, dash: dash || null, cap: cap || 'round' }); }
    function circle(c, rad, fill, stroke, w) { items.push({ t: 'circle', c: c, r: rad, fill: fill || null, stroke: stroke || null, w: w || 0 }); }
    function poly(pts, fill) { items.push({ t: 'poly', pts: pts, fill: fill }); }
    function text(x, y, lines, size, opt) {
      opt = opt || {};
      items.push({ t: 'text', x: x, y: y, lines: [].concat(lines), size: size, bold: !!opt.bold, anchor: opt.anchor || 'start', color: opt.color || INK, lh: 1.25 });
    }

    // Where the flat piece goes: centred across the page, island high up.
    var uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    model.loop.forEach(function (q) {
      if (q[0] < uMin) uMin = q[0];
      if (q[0] > uMax) uMax = q[0];
      if (q[1] < vMin) vMin = q[1];
      if (q[1] > vMax) vMax = q[1];
    });
    var right = fp.ball[0] + fp.ballR;
    var width = right - (uMin - r);
    var x0 = PAGE.margin + (PAGE.w - 2 * PAGE.margin - width) / 2 + r - uMin;
    var yC = 70;
    function X(u) { return x0 + u; }
    function Y(v) { return yC - v; }
    function P(q) { return [X(q[0]), Y(q[1])]; }

    text(PAGE.margin, 18, es ? 'Pulsera Fishers Island: plano a escala real (1:1)' : 'Fishers Island bracelet: real-size drawing (1:1)', 15, { bold: true });
    text(PAGE.margin, 25, es
      ? 'Un solo alambre redondo macizo de ' + f.metal + ', Ø ' + f.dia + ' mm, doblado en plano antes de curvar la cola alrededor de la muñeca. Medidas en mm.'
      : 'One solid round ' + f.metal + ' wire, ' + f.dia + ' mm, bent flat before the tail is curved round the wrist. Sizes in mm.', 9.5, { color: MUTED });

    // The wire, real size, with its centreline.
    var pts = fp.pts.map(P);
    line(pts, p.wireDiaMm, WIRE);
    line(pts, 0.18, INK);
    circle(P(fp.ball), fp.ballR, WIRE, INK, 0.18);

    // Which way the wire runs: chevrons on the north shore, the south shore and the tail.
    function chevron(i) {
      var a = fp.pts[Math.max(0, i - 2)], b = fp.pts[Math.min(fp.pts.length - 1, i + 2)];
      var dx = b[0] - a[0], dy = -(b[1] - a[1]), l = Math.hypot(dx, dy) || 1;
      dx /= l; dy /= l;
      var c = P(fp.pts[i]), s = 1.1;
      poly([[c[0] + dx * s, c[1] + dy * s], [c[0] - dx * s - dy * s * 0.8, c[1] - dy * s + dx * s * 0.8], [c[0] - dx * s + dy * s * 0.8, c[1] - dy * s - dx * s * 0.8]], INK);
    }
    var race = model.index.raceLoop - model.index.startLoop;
    chevron(Math.round(race * 0.35));
    chevron(Math.round(race * 0.75));
    chevron(Math.round(race + (model.index.junctionStart - race) * 0.5));
    chevron(Math.round((model.index.ringStart + model.index.ringEnd) / 2));

    // Labels with leaders.
    function leader(at, to, lines, anchor) {
      line([at, to], 0.2, GUIDE);
      circle(at, 0.55, INK);
      text(to[0] + (anchor === 'end' ? -1 : 1), to[1] - 1, lines, 8, { anchor: anchor || 'start' });
    }
    var joint = P(fp.joint);
    leader(joint, [joint[0] + 14, Y(vMax) - 14], es
      ? ['Extremo Este (Wicopesset): el inicio se suelda', 'a tope aquí, mismo grosor, sin doblar el alambre']
      : ['East End (Wicopesset): the start is soldered', 'end-on here, same thickness, no doubled wire']);
    var nh = P(fp.northHill);
    leader(nh, [nh[0] - 6, Y(vMax) - 14], es
      ? [f.seat + ': aquí se apoya', 'la bola al cerrar']
      : [f.seat + ': the ball', 'sits here when closed'], 'end');
    model.landmarks.forEach(function (lm) {
      if (lm.name !== 'Race Point' && lm.name !== 'Silver Eel') return;
      var at = P(lm.flat);
      var to = [at[0] - 7, at[1] + (lm.name === 'Race Point' ? 5 : -3)];
      line([[at[0] - r, at[1]], to], 0.2, GUIDE);
      text(to[0] - 0.8, to[1] + 1, lm.name, 7.5, { anchor: 'end', color: MUTED });
    });
    var ball = P(fp.ball);
    text(ball[0], ball[1] + fp.ballR + 4, es ? 'Bola Ø ' + f.ball + ' mm' : f.ball + ' mm ball', 8, { anchor: 'middle' });

    // Dimensions.
    function dimH(xa, xb, y, label, below) {
      line([[xa, y], [xb, y]], 0.2, INK, null, 'butt');
      line([[xa, y - 1.5], [xa, y + 1.5]], 0.2, INK, null, 'butt');
      line([[xb, y - 1.5], [xb, y + 1.5]], 0.2, INK, null, 'butt');
      poly([[xa, y], [xa + 2, y - 0.7], [xa + 2, y + 0.7]], INK);
      poly([[xb, y], [xb - 2, y - 0.7], [xb - 2, y + 0.7]], INK);
      text((xa + xb) / 2, below ? y + 4 : y - 1.2, label, 8, { anchor: 'middle' });
    }
    var yIsl = Y(vMin) + 8;
    dimH(X(uMin), X(uMax), yIsl, (es ? 'isla ' : 'island ') + f.islandL + ' mm');
    var yTail = Y(fp.joint[1]) - 6;
    dimH(joint[0], X(fp.tailEnd[0]), yTail, es
      ? 'cola recta ' + f.tail + ' mm desde el Extremo Este: forma el círculo alrededor de la muñeca'
      : 'straight tail ' + f.tail + ' mm from the East End: becomes the circle round the wrist');
    var yAll = Y(vMin) + 17;
    dimH(X(uMin) - r, ball[0] + fp.ballR, yAll, (es ? 'largo total en plano ' : 'overall length flat ') + Math.round(ball[0] + fp.ballR - X(uMin) + r) + ' mm');
    // Island width, a vertical dimension left of Race Point.
    var xw = X(uMin) - 30;
    line([[xw, Y(vMax)], [xw, Y(vMin)]], 0.2, INK, null, 'butt');
    line([[xw - 1.5, Y(vMax)], [xw + 1.5, Y(vMax)]], 0.2, INK, null, 'butt');
    line([[xw - 1.5, Y(vMin)], [xw + 1.5, Y(vMin)]], 0.2, INK, null, 'butt');
    text(xw - 2, Y((vMax + vMin) / 2) + 1, f.islandW + ' mm', 8, { anchor: 'end' });
    text(PAGE.margin, yAll + 8, es
      ? 'Al curvar la pieza, la cola da la vuelta por debajo de la muñeca y la bola sube a apoyarse sobre ' + f.seat + '.'
      : 'Curved, the tail goes round under the wrist and the ball comes up to sit on ' + f.seat + '.', 8.5, { color: MUTED });
    // Direction legend.
    var lx = PAGE.margin, ly = yAll + 14;
    poly([[lx + 2.2, ly - 1], [lx, ly - 2.2], [lx, ly + 0.2]], INK);
    text(lx + 4, ly, es ? 'sentido en que se dobla el alambre, empezando en el Extremo Este' : 'direction the wire is bent, starting at the East End', 8, { color: MUTED });

    // 50 mm scale bar.
    var sy = 126;
    line([[PAGE.margin, sy], [PAGE.margin + 50, sy]], 0.5, INK, null, 'butt');
    for (var k = 0; k <= 50; k += 10) {
      line([[PAGE.margin + k, sy - (k % 50 === 0 ? 2 : 1.2)], [PAGE.margin + k, sy]], 0.3, INK, null, 'butt');
      text(PAGE.margin + k, sy + 3.5, String(k), 6.5, { anchor: 'middle', color: MUTED });
    }
    text(PAGE.margin + 54, sy + 0.5, es ? 'Compruebe: esta barra debe medir 50 mm impresa al 100 %.' : 'Check: this bar must measure 50 mm printed at 100 %.', 8, { color: MUTED });

    // Spec table.
    var rows = specRows(model, lang), ty = 140;
    text(PAGE.margin, ty, es ? 'Datos' : 'Spec', 9.5, { bold: true });
    rows.forEach(function (row, i) {
      var y = ty + 6 + i * 4.6;
      text(PAGE.margin, y, row[0], 8, { color: MUTED });
      text(PAGE.margin + 32, y, row[1], 8);
    });

    // Side view, real size: the island on top, the circle round the wrist.
    var rc = model.centreRadius, R = model.wristRadius;
    var cx = PAGE.w - PAGE.margin - rc - 16, cy = 160;
    function sv(u, rad) { var th = u / rc; return [cx + rad * Math.sin(th), cy - rad * Math.cos(th)]; }
    var ring = [];
    for (var a = 0; a <= 180; a++) ring.push(sv(a / 180 * 2 * Math.PI * rc, rc));
    line(ring, p.wireDiaMm, WIRE);
    // Inside diameter, measured across.
    line([[cx - R, cy + 4], [cx + R, cy + 4]], 0.2, INK, null, 'butt');
    poly([[cx - R, cy + 4], [cx - R + 2, cy + 3.3], [cx - R + 2, cy + 4.7]], INK);
    poly([[cx + R, cy + 4], [cx + R - 2, cy + 3.3], [cx + R - 2, cy + 4.7]], INK);
    var isl = [];
    for (var u = uMin; u <= uMax; u += 0.5) isl.push(sv(u, rc));
    line(isl, p.wireDiaMm + 1.6, INK);
    line(isl, p.wireDiaMm - 0.6, WIRE);
    circle(sv(fp.joint[0], rc), 0.8, INK);
    circle(sv(model.clasp.u, rc + r + model.clasp.ballR), model.clasp.ballR, WIRE, INK, 0.18);
    text(cx, cy - rc - r - 9.5, es ? 'Vista lateral, 1:1' : 'Side view, 1:1', 8.5, { anchor: 'middle', bold: true });
    text(cx, cy + 1, (es ? 'Ø interior ' : 'inside ') + f.inner + ' mm', 7.5, { anchor: 'middle', color: MUTED });
    text(cx + rc + 4, cy - rc * 0.55, es ? ['isla', '(arriba)'] : ['island', '(on top)'], 7, { color: MUTED });
    text(cx + rc + 4, cy + rc * 0.75, es ? ['círculo', '(debajo)'] : ['circle', '(underneath)'], 7, { color: MUTED });
    text(cx - rc - 4, cy - rc * 0.62, es ? ['bola sobre', f.seat] : ['ball on', f.seat], 7, { anchor: 'end', color: MUTED });

    text(PAGE.margin, PAGE.h - 7, 'Fishers Island, NY · ' + (es ? 'costa' : 'coastline') + ': © OpenStreetMap', 7, { color: MUTED });
    text(PAGE.w - PAGE.margin, PAGE.h - 7, es ? 'página 1 de 2' : 'page 1 of 2', 7, { anchor: 'end', color: MUTED });
    return { w: PAGE.w, h: PAGE.h, items: items };
  }

  // ── Renderers ──────────────────────────────────────────────
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function f2(x) { return (Math.round(x * 100) / 100).toString(); }

  function toSVG(dr) {
    var out = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + dr.w + 'mm" height="' + dr.h + 'mm" viewBox="0 0 ' + dr.w + ' ' + dr.h + '" font-family="Helvetica, Arial, sans-serif">',
      '<rect width="' + dr.w + '" height="' + dr.h + '" fill="#ffffff"/>'];
    dr.items.forEach(function (it) {
      if (it.t === 'line') {
        out.push('<polyline points="' + it.pts.map(function (q) { return f2(q[0]) + ',' + f2(q[1]); }).join(' ') + '" fill="none" stroke="' + it.color + '" stroke-width="' + f2(it.w) +
          '" stroke-linecap="' + it.cap + '" stroke-linejoin="round"' + (it.dash ? ' stroke-dasharray="' + it.dash.join(' ') + '"' : '') + '/>');
      } else if (it.t === 'circle') {
        out.push('<circle cx="' + f2(it.c[0]) + '" cy="' + f2(it.c[1]) + '" r="' + f2(it.r) + '" fill="' + (it.fill || 'none') + '"' + (it.stroke ? ' stroke="' + it.stroke + '" stroke-width="' + f2(it.w) + '"' : '') + '/>');
      } else if (it.t === 'poly') {
        out.push('<polygon points="' + it.pts.map(function (q) { return f2(q[0]) + ',' + f2(q[1]); }).join(' ') + '" fill="' + it.fill + '"/>');
      } else if (it.t === 'text') {
        var size = it.size * PT, anchor = it.anchor;
        out.push('<text x="' + f2(it.x) + '" y="' + f2(it.y) + '" font-size="' + f2(size) + '"' + (it.bold ? ' font-weight="700"' : '') + ' text-anchor="' + anchor + '" fill="' + it.color + '">' +
          it.lines.map(function (l, i) { return '<tspan x="' + f2(it.x) + '"' + (i ? ' dy="' + f2(size * it.lh) + '"' : '') + '>' + esc(l) + '</tspan>'; }).join('') + '</text>');
      }
    });
    out.push('</svg>');
    return out.join('\n');
  }

  function rgb(hex) { var n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

  function drawPDF(doc, items) {
    items.forEach(function (it) {
      if (it.t === 'line') {
        doc.setLineWidth(it.w);
        doc.setDrawColor.apply(doc, rgb(it.color));
        doc.setLineCap(it.cap);
        doc.setLineJoin('round');
        doc.setLineDashPattern(it.dash || [], 0);
        var rel = [];
        for (var i = 1; i < it.pts.length; i++) rel.push([it.pts[i][0] - it.pts[i - 1][0], it.pts[i][1] - it.pts[i - 1][1]]);
        if (rel.length) doc.lines(rel, it.pts[0][0], it.pts[0][1], [1, 1], 'S', false);
        doc.setLineDashPattern([], 0);
      } else if (it.t === 'circle') {
        if (it.fill) doc.setFillColor.apply(doc, rgb(it.fill));
        if (it.stroke) { doc.setDrawColor.apply(doc, rgb(it.stroke)); doc.setLineWidth(it.w); }
        doc.circle(it.c[0], it.c[1], it.r, it.fill && it.stroke ? 'FD' : it.fill ? 'F' : 'S');
      } else if (it.t === 'poly') {
        doc.setFillColor.apply(doc, rgb(it.fill));
        var q = it.pts;
        doc.triangle(q[0][0], q[0][1], q[1][0], q[1][1], q[2][0], q[2][1], 'F');
      } else if (it.t === 'text') {
        doc.setFont('helvetica', it.bold ? 'bold' : 'normal');
        doc.setFontSize(it.size);
        doc.setTextColor.apply(doc, rgb(it.color));
        doc.text(it.lines, it.x, it.y, { align: it.anchor === 'middle' ? 'center' : it.anchor === 'end' ? 'right' : 'left', lineHeightFactor: it.lh });
      }
    });
  }

  // Two pages: the drawing, then how to make it. jsPDF is root.jspdf in a
  // browser (vendor/jspdf.umd.min.js) or passed in from node.
  function pdf(model, lang, jsPDFCtor) {
    lang = lang_(lang);
    var es = lang === 'es';
    var JS = jsPDFCtor || (root.jspdf && root.jspdf.jsPDF);
    if (!JS) throw new Error('jsPDF not loaded');
    var doc = new JS({ orientation: 'landscape', unit: 'mm', format: 'letter' });
    doc.setProperties({ title: es ? 'Pulsera Fishers Island: plano para el joyero' : 'Fishers Island bracelet: plans for the jeweller', creator: 'LetsCheckChoc · Fishers Bracelet' });
    drawPDF(doc, sheet(model, lang).items);

    doc.addPage('letter', 'landscape');
    var m = PAGE.margin, y = 20, colW = 168;
    doc.setTextColor.apply(doc, rgb(INK));
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(es ? 'Cómo hacerla' : 'How to make it', m, y);
    y += 9;
    doc.setFontSize(10);
    steps(model, lang).forEach(function (s, i) {
      var lines = doc.splitTextToSize(s, colW - 8);
      doc.setFont('helvetica', 'bold');
      doc.text(String(i + 1) + '.', m, y);
      doc.setFont('helvetica', 'normal');
      doc.text(lines, m + 7, y, { lineHeightFactor: 1.3 });
      y += lines.length * 10 * PT * 1.3 + 2.6;
    });
    // Right column: the note to the jeweller's client and tolerances.
    var rx = m + colW + 10, rw = PAGE.w - m - rx;
    var ry = 29;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(es ? 'Notas' : 'Notes', rx, ry);
    ry += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    var notes = es
      ? ['Medidas en milímetros. Tolerancia ±0,5 mm.', 'Todo es un solo alambre del mismo grosor: no hay piezas añadidas salvo la bola del cierre.', 'El círculo debe quedar plano y redondo; la isla va encima de la muñeca.']
      : ['Sizes in millimetres. Tolerance ±0.5 mm.', 'Everything is one wire of one thickness: nothing is added except the clasp ball.', 'The circle must stay flat and round; the island sits on top of the wrist.'];
    notes.forEach(function (n) {
      var lines = doc.splitTextToSize(n, rw);
      doc.text(lines, rx, ry, { lineHeightFactor: 1.3 });
      ry += lines.length * 9 * PT * 1.3 + 2.5;
    });
    doc.setFontSize(7);
    doc.setTextColor.apply(doc, rgb(MUTED));
    doc.text(es ? 'página 2 de 2' : 'page 2 of 2', PAGE.w - m, PAGE.h - 7, { align: 'right' });
    return doc;
  }

  // ── Saving a file (browser) ────────────────────────────────
  // In a published artifact the viewer's downloads capability offers the file
  // (with a confirmation); on the site itself a plain download link does.
  function saveFile(name, data) {
    var use = root.claude && typeof root.claude.use === 'function'
      ? root.claude.use('downloads').then(null, function () { return null; })
      : Promise.resolve(null);
    return use.then(function (dl) {
      if (dl) return dl.save({ filename: name, data: data }).then(function () { return 'saved'; });
      var type = /\.pdf$/.test(name) ? 'application/pdf' : /\.svg$/.test(name) ? 'image/svg+xml' : 'text/plain';
      var blob = data instanceof Blob ? data : new Blob([data], { type: type });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      return 'link';
    });
  }

  var FILE = { pdf: 'plano-pulsera-fishers.pdf', svg: 'plano-pulsera-fishers.svg' };

  var api = {
    PAGE: PAGE,
    FILE: FILE,
    num: num,
    steps: steps,
    specRows: specRows,
    message: message,
    sheet: sheet,
    toSVG: toSVG,
    svg: function (model, lang) { return toSVG(sheet(model, lang)); },
    pdf: pdf,
    saveFile: saveFile
  };
  root.BraceletPlans = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
