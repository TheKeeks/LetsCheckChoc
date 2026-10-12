(function () {
  'use strict';
  const $ = id => document.getElementById(id), G = window.MapGeometry, T = window.THREE;
  const params = new URLSearchParams(location.search), compact = params.get('compact') === '1';
  const SPOTS = { choc: { name: 'Chocomount reef', lon: -71.96339, lat: 41.27557, distance: 3.8 }, race: { name: 'The Race', lon: -72.043, lat: 41.243, distance: 6.2 } };
  const SOURCES = {
    survey: { max: 17, label: 'NOAA relief', url: t => {
      const a = G.tileLocation(t.x, t.y + 1, t.z), b = G.tileLocation(t.x + 1, t.y, t.z);
      return 'https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/DEM_all/ImageServer/exportImage?' + new URLSearchParams({ bbox: [a[0], a[1], b[0], b[1]].join(','), bboxSR: '4326', imageSR: '3857', size: '256,256', format: 'png', interpolation: 'RSP_BilinearInterpolation', renderingRule: '{"rasterFunction":"ColorHillshade"}', f: 'image' });
    } },
    satellite: { max: 19, label: 'Esri imagery', url: t => `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${t.z}/${t.y}/${t.x}` },
    topo: { max: 16, label: 'USGS topography', url: t => `https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/${t.z}/${t.y}/${t.x}` }
  };
  const state = { spot: params.get('spot') === 'race' ? 'race' : 'choc', theme: params.get('theme') === 'dark' ? 'dark' : 'light', threeD: true, exaggeration: 8, follow: true, active: true,
    layers: { relief: true, survey: false, satellite: false, topo: false, field: false, waves: compact, wind: false, rays: false }, forecast: null,
    camera: { az: 0.2, el: 0.72, distance: 4, x: 0, z: 0 }, tileCache: new Map(), rayCache: new Map(), failedSources: new Set(), dirty: true };
  let renderer, scene, camera, root, ground, overlays, markers, meta, values, wet, footprint, viewBounds, surveyBounds, running = false, visible = true, updateTimer, generation = 0;
  let fieldMetadata, fieldPixels, fieldWidth, fieldTexture, fieldMesh, fieldTime, fieldRequest = 0, tileWorkers = 0;
  const tileJobs = [];
  let origin = [-71.98, 41.265], requestedDate = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') ? params.get('date') : null;
  const image = src => new Promise((resolve, reject) => {
    const im = new Image(); const timer = setTimeout(() => { im.src = ''; reject(new Error('Tile timed out')); }, 18000);
    if (/^https?:/.test(src)) im.crossOrigin = 'anonymous';
    im.onload = () => { clearTimeout(timer); resolve(im); }; im.onerror = () => { clearTimeout(timer); reject(new Error('Image unavailable')); }; im.src = src;
  });
  async function json(url) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
    try { const r = await fetch(url, { signal: controller.signal }); if (!r.ok) throw new Error('Data unavailable'); return await r.json(); } finally { clearTimeout(timer); }
  }
  const local = (lon, lat) => [(lon - origin[0]) * meta.kmlon, (origin[1] - lat) * meta.kmlat];
  const geographic = (x, z) => [origin[0] + x / meta.kmlon, origin[1] - z / meta.kmlat];
  const depth = (lon, lat) => G.sample(meta, values, wet, lon, lat);
  const height = (lon, lat) => { const d = depth(lon, lat); return d ? -d.depth / 1000 : 0; };
  function surfaceHeight(lon, lat) {
    if (!ground) return height(lon, lat);
    const g = ground.geometry, p = g.attributes.position, nx = g.userData.nx, ny = g.userData.ny, q = local(lon, lat);
    const fx = (q[0] - p.getX(0)) / (p.getX(nx) - p.getX(0)) * nx, fy = (q[1] - p.getZ(0)) / (p.getZ(ny * (nx + 1)) - p.getZ(0)) * ny;
    if (fx < 0 || fy < 0 || fx > nx || fy > ny) return height(lon, lat);
    const x = Math.min(nx - 1, Math.floor(fx)), y = Math.min(ny - 1, Math.floor(fy)), u = fx - x, v = fy - y, i = y * (nx + 1) + x;
    return u + v <= 1 ? p.getY(i) * (1 - u - v) + p.getY(i + 1) * u + p.getY(i + nx + 1) * v :
      p.getY(i + 1) * (1 - v) + p.getY(i + nx + 1) * (1 - u) + p.getY(i + nx + 2) * (u + v - 1);
  }
  const overlayHeight = (lon, lat, offset) => { const y = surfaceHeight(lon, lat); return (state.follow ? y : Math.max(0, y)) + offset; };
  function dispose(obj) {
    if (!obj) return;
    obj.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (Array.isArray(o.material)) o.material.forEach(m => m.dispose()); else o.material.dispose(); } });
    if (obj.parent) obj.parent.remove(obj);
  }
  function setTheme(theme) {
    state.theme = theme === 'dark' || theme === 'night' ? 'dark' : 'light'; document.documentElement.dataset.theme = state.theme;
    if (scene) scene.background.set(state.theme === 'dark' ? 0x15292f : 0xe6efec);
    const f = $('researchExplorer'); if (f.contentWindow && f.src) f.contentWindow.postMessage({ type: 'lcc-theme', theme: state.theme }, location.origin);
    dirty();
  }
  function dirty() { state.dirty = true; if (renderer && !running && state.active && visible && !document.hidden) { running = true; requestAnimationFrame(frame); } }
  function frame() {
    running = false; if (!renderer || !state.active || !visible || document.hidden) return;
    if (state.dirty) {
      state.dirty = false; const v = state.camera, el = state.threeD ? v.el : Math.PI / 2 - 0.001;
      root.scale.y = state.threeD ? state.exaggeration : 0.00001;
      camera.position.set(v.x + v.distance * Math.cos(el) * Math.sin(v.az), v.distance * Math.sin(el), v.z + v.distance * Math.cos(el) * Math.cos(v.az));
      camera.lookAt(v.x, 0, v.z); renderer.render(scene, camera);
    }
  }
  function resize() {
    if (!renderer) return; const cv = $('terrain'), w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); dirty(); queueUpdate();
  }
  function setSpot(spot, force) {
    if (!SPOTS[spot] || (!force && state.spot === spot)) return;
    state.spot = spot; const p = SPOTS[spot];
    $('placeName').textContent = p.name; $('coordinates').textContent = `${p.lat.toFixed(4)}° N · ${Math.abs(p.lon).toFixed(4)}° W`;
    document.querySelectorAll('[data-spot]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.spot === spot)));
    if (meta) { const q = local(p.lon, p.lat); state.camera = { az: 0.2, el: 0.72, distance: p.distance, x: q[0], z: q[1] }; queueUpdate(); dirty(); }
    forecastReadout();
  }
  function bounds() {
    const v = state.camera, half = v.distance * 0.85, cx = geographic(v.x, v.z), ratio = Math.max(1, camera.aspect);
    return [Math.max(surveyBounds[0], cx[0] - half * ratio / meta.kmlon), Math.max(surveyBounds[1], cx[1] - half / meta.kmlat),
      Math.min(surveyBounds[2], cx[0] + half * ratio / meta.kmlon), Math.min(surveyBounds[3], cx[1] + half / meta.kmlat)];
  }
  function color(d) {
    if (!d.wet) return new T.Color().setRGB(0.61 + Math.min(0.15, -d.depth / 120), 0.65 + Math.min(0.12, -d.depth / 130), 0.49 + Math.min(0.1, -d.depth / 150));
    const stops = [[0, [0.86, 0.82, 0.62]], [4, [0.49, 0.73, 0.69]], [12, [0.27, 0.57, 0.63]], [35, [0.17, 0.39, 0.51]], [100, [0.08, 0.23, 0.33]]];
    let i = 0; while (i < stops.length - 2 && d.depth > stops[i + 1][0]) i++;
    const a = stops[i], b = stops[i + 1], f = G.clamp((d.depth - a[0]) / (b[0] - a[0]), 0, 1);
    return new T.Color().setRGB(...a[1].map((v, k) => v + f * (b[1][k] - v)));
  }
  function terrainMesh(box, spacing, tile, offset) {
    const width = (box[2] - box[0]) * meta.kmlon, tall = (box[3] - box[1]) * meta.kmlat;
    const nx = Math.max(2, Math.ceil(width / spacing)), ny = Math.max(2, Math.ceil(tall / spacing));
    const positions = new Float32Array((nx + 1) * (ny + 1) * 3), colors = new Float32Array(positions.length), uv = new Float32Array((nx + 1) * (ny + 1) * 2), indices = [];
    for (let y = 0; y <= ny; y++) for (let x = 0; x <= nx; x++) {
      const lon = box[0] + (box[2] - box[0]) * x / nx, lat = box[3] - (box[3] - box[1]) * y / ny, p = y * (nx + 1) + x;
      const q = local(lon, lat), d = depth(lon, lat), c = d ? color(d) : new T.Color(0x708980);
      positions.set([q[0], d ? -d.depth / 1000 + (offset || 0) : 0, q[1]], p * 3); colors.set([c.r, c.g, c.b], p * 3);
      const t = tile ? G.tilePoint(lon, lat, tile.z) : [x / nx, y / ny]; uv.set(tile ? [t[0] - tile.x, 1 - (t[1] - tile.y)] : [t[0], 1 - t[1]], p * 2);
      if (x < nx && y < ny) { const a = p, b = p + 1, c1 = p + nx + 1, d1 = c1 + 1; indices.push(a, c1, b, b, c1, d1); }
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(positions, 3)); g.setAttribute('color', new T.BufferAttribute(colors, 3)); g.setAttribute('uv', new T.BufferAttribute(uv, 2)); g.setIndex(indices); g.computeVertexNormals(); g.userData = { nx, ny, box }; return g;
  }
  function drapedTileGeometry(tile, offset) {
    // Clip the actual ground triangles at tile edges. Independent raster meshes
    // interpolate the survey differently and let peaks poke through their imagery.
    const a = G.tileLocation(tile.x, tile.y + 1, tile.z), b = G.tileLocation(tile.x + 1, tile.y, tile.z);
    const box = [Math.max(a[0], viewBounds[0]), Math.max(a[1], viewBounds[1]), Math.min(b[0], viewBounds[2]), Math.min(b[1], viewBounds[3])];
    const out = new T.BufferGeometry(), positions = [], uvs = [];
    if (box[0] >= box[2] || box[1] >= box[3]) { out.setAttribute('position', new T.Float32BufferAttribute([], 3)); out.setAttribute('uv', new T.Float32BufferAttribute([], 2)); return out; }
    const lo = local(box[0], box[3]), hi = local(box[2], box[1]);
    const g = ground.geometry, p = g.attributes.position, nx = g.userData.nx, ny = g.userData.ny, w = p.getX(nx) - p.getX(0), h = p.getZ(ny * (nx + 1)) - p.getZ(0);
    const x0 = G.clamp(Math.floor((lo[0] - p.getX(0)) / w * nx), 0, nx - 1), x1 = G.clamp(Math.floor((hi[0] - p.getX(0)) / w * nx), 0, nx - 1);
    const y0 = G.clamp(Math.floor((lo[1] - p.getZ(0)) / h * ny), 0, ny - 1), y1 = G.clamp(Math.floor((hi[1] - p.getZ(0)) / h * ny), 0, ny - 1);
    const point = i => [p.getX(i), p.getY(i), p.getZ(i)];
    const clip = (polygon, axis, boundary, side) => {
      const result = [];
      for (let i = 0; i < polygon.length; i++) {
        const cur = polygon[i], prev = polygon[(i + polygon.length - 1) % polygon.length];
        const ci = (cur[axis] - boundary) * side >= -1e-10, pi = (prev[axis] - boundary) * side >= -1e-10;
        if (ci !== pi) { const f = (boundary - prev[axis]) / (cur[axis] - prev[axis]); result.push(prev.map((v, k) => v + (cur[k] - v) * f)); }
        if (ci) result.push(cur);
      }
      return result;
    };
    const put = v => { const q = geographic(v[0], v[2]), t = G.tilePoint(q[0], q[1], tile.z); positions.push(v[0], v[1] + offset, v[2]); uvs.push(t[0] - tile.x, 1 - (t[1] - tile.y)); };
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * (nx + 1) + x;
      for (const vertices of [[i, i + nx + 1, i + 1], [i + 1, i + nx + 1, i + nx + 2]]) {
        let polygon = vertices.map(point);
        for (const edge of [[0, lo[0], 1], [0, hi[0], -1], [2, lo[1], 1], [2, hi[1], -1]]) polygon = clip(polygon, ...edge);
        for (let j = 1; j < polygon.length - 1; j++) { put(polygon[0]); put(polygon[j]); put(polygon[j + 1]); }
      }
    }
    out.setAttribute('position', new T.Float32BufferAttribute(positions, 3)); out.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2)); return out;
  }
  function drawGround() {
    dispose(ground); viewBounds = bounds();
    const w = (viewBounds[2] - viewBounds[0]) * meta.kmlon;
    const spacing = Math.max(meta.dx / 1000, w / 280);
    ground = new T.Mesh(terrainMesh(viewBounds, spacing), new T.MeshLambertMaterial({ vertexColors: state.layers.relief, color: state.layers.relief ? 0xffffff : 0x87aaa2, side: T.DoubleSide })); root.add(ground);
    if (!footprint) {
      const a = local(surveyBounds[0], surveyBounds[1]), b = local(surveyBounds[2], surveyBounds[3]);
      footprint = new T.LineLoop(new T.BufferGeometry().setFromPoints([new T.Vector3(a[0], 0, a[1]), new T.Vector3(b[0], 0, a[1]), new T.Vector3(b[0], 0, b[1]), new T.Vector3(a[0], 0, b[1])] ), new T.LineBasicMaterial({ color: 0x81a49b, transparent: true, opacity: 0.45 })); root.add(footprint);
    }
    drawMarkers(); dirty();
  }
  function drawMarkers() {
    dispose(markers); markers = new T.Group(); root.add(markers);
    for (const [key, p] of Object.entries(SPOTS)) {
      const q = local(p.lon, p.lat), y = height(p.lon, p.lat);
      const g = new T.BufferGeometry().setFromPoints([new T.Vector3(q[0], y + 0.004, q[1]), new T.Vector3(q[0], 0.035, q[1])]);
      markers.add(new T.Line(g, new T.LineBasicMaterial({ color: key === state.spot ? 0xeea858 : 0xfaf0cc })));
      const pin = new T.Mesh(new T.SphereGeometry(state.camera.distance * 0.009, 12, 8), new T.MeshBasicMaterial({ color: key === state.spot ? 0xeea858 : 0xfaf0cc })); pin.position.set(q[0], 0.035, q[1]); pin.scale.y = 1 / state.exaggeration; markers.add(pin);
    }
  }
  function queueUpdate() {
    clearTimeout(updateTimer); updateTimer = setTimeout(() => { if (!meta || !renderer) return; drawGround(); updateTiles(); drawOverlays(); }, 180);
  }
  function updateStatus() {
    const failed = [...state.failedSources].filter(k => state.layers[k]).map(k => SOURCES[k].label);
    $('mapStatus').textContent = failed.length ? `${failed.join(', ')} unavailable · showing available layers and local terrain` : '16 m terrain · drag to pan · shift-drag to orbit · pinch to zoom';
  }
  async function updateTiles() {
    if (!viewBounds) return; const gen = ++generation, needed = new Set();
    const metresPerPixel = state.camera.distance * 800 / Math.max(300, $('terrain').clientHeight);
    const wantedZ = Math.round(Math.log2(156543.03 * Math.cos(SPOTS[state.spot].lat * Math.PI / 180) / metresPerPixel));
    const jobs = [];
    Object.entries(SOURCES).forEach(([source, service], order) => {
      if (!state.layers[source]) return;
      const tiles = G.tilesFor(viewBounds, G.clamp(wantedZ + 1, 11, service.max), 28);
      for (const tile of tiles) {
        const key = `${source}/${tile.z}/${tile.x}/${tile.y}`; needed.add(key);
        let record = state.tileCache.get(key);
        if (record) { record.last = Date.now(); if (record.mesh) { record.mesh.visible = true; record.mesh.geometry.dispose(); record.mesh.geometry = drapedTileGeometry(tile, 0.0007 + order * 0.0006); } continue; }
        record = { source, last: Date.now(), mesh: null, loading: true }; state.tileCache.set(key, record);
        jobs.push(async () => {
          if (!currentTile(key)) { state.tileCache.delete(key); return; }
          try {
            const im = await image(service.url(tile));
            if (!state.tileCache.has(key)) return;
            const a = G.tileLocation(tile.x, tile.y + 1, tile.z), b = G.tileLocation(tile.x + 1, tile.y, tile.z);
            const box = [Math.max(a[0], surveyBounds[0]), Math.max(a[1], surveyBounds[1]), Math.min(b[0], surveyBounds[2]), Math.min(b[1], surveyBounds[3])];
            if (box[2] <= box[0] || box[3] <= box[1]) return;
            const tex = new T.Texture(im); tex.needsUpdate = true; tex.encoding = T.sRGBEncoding; tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
            record.texture = tex; record.mesh = new T.Mesh(drapedTileGeometry(tile, 0.0007 + order * 0.0006), new T.MeshBasicMaterial({ map: tex, transparent: true, opacity: source === 'survey' ? 0.9 : source === 'satellite' ? 0.82 : 0.65, side: T.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 - order }));
            record.mesh.renderOrder = order + 1; record.mesh.visible = state.layers[source] && (gen === generation || currentTile(key)); root.add(record.mesh);
            state.failedSources.delete(source); dirty();
          } catch (e) { state.failedSources.add(source); state.tileCache.delete(key); } finally { record.loading = false; updateStatus(); }
        });
      }
    });
    state.neededTiles = needed;
    state.tileCache.forEach((r, k) => { if (r.mesh) r.mesh.visible = needed.has(k); });
    // Bound decoded GPU images and share six workers across all camera updates.
    const old = [...state.tileCache.entries()].filter(([k, r]) => !needed.has(k) && !r.loading).sort((a, b) => a[1].last - b[1].last);
    while (state.tileCache.size > 72 && old.length) { const [k, r] = old.shift(); dispose(r.mesh); if (r.texture) r.texture.dispose(); state.tileCache.delete(k); }
    tileJobs.push(...jobs);
    while (tileWorkers < 6 && tileJobs.length) {
      tileWorkers++;
      (async () => { try { while (tileJobs.length) await tileJobs.shift()(); } finally { tileWorkers--; } })();
    }
  }
  function currentTile(key) { return state.neededTiles && state.neededTiles.has(key); }
  function line(points, color, opacity) {
    const g = new T.BufferGeometry().setFromPoints(points); const l = new T.Line(g, new T.LineBasicMaterial({ color, transparent: true, opacity: opacity || 0.9, depthTest: true })); overlays.add(l);
  }
  function geographicLine(points, color, offset, opacity) {
    let segment = [];
    const flush = () => { if (segment.length > 1) line(segment, color, opacity); segment = []; };
    for (const q of points) {
      if (!depth(q[0], q[1])) { flush(); continue; }
      const p = local(q[0], q[1]); segment.push(new T.Vector3(p[0], overlayHeight(q[0], q[1], offset), p[1]));
    }
    flush();
  }
  function arrow(lon, lat, from, color, offset) {
    const direction = (from + 180) * Math.PI / 180, l = state.camera.distance * 0.045;
    const q = local(lon, lat), dx = Math.sin(direction) * l, dz = -Math.cos(direction) * l;
    const points = [];
    for (let i = 0; i <= 10; i++) points.push(geographic(q[0] + dx * i / 10, q[1] + dz * i / 10));
    geographicLine(points, color, offset);
    geographicLine([geographic(q[0] + dx * 0.6 - dz * 0.3, q[1] + dz * 0.6 + dx * 0.3), geographic(q[0] + dx, q[1] + dz), geographic(q[0] + dx * 0.6 + dz * 0.3, q[1] + dz * 0.6 - dx * 0.3)], color, offset);
  }
  function drawOverlays() {
    if (!root || !viewBounds) return; dispose(overlays); overlays = new T.Group(); root.add(overlays);
    drawField();
    const fc = state.forecast;
    if (fc && (state.layers.waves || state.layers.wind)) {
      for (let y = 1; y < 8; y++) for (let x = 1; x < 10; x++) {
        const lon = viewBounds[0] + (viewBounds[2] - viewBounds[0]) * x / 10, lat = viewBounds[1] + (viewBounds[3] - viewBounds[1]) * y / 8;
        const d = depth(lon, lat); if (!d || !d.wet) continue;
        if (state.layers.waves && Number.isFinite(fc.waveDirection)) arrow(lon, lat, fc.waveDirection, 0xf3dfad, 0.004);
        if (state.layers.wind && Number.isFinite(fc.windDirection) && (x + y) % 2 === 0) arrow(lon, lat, fc.windDirection, 0xe8bdf2, 0.008);
      }
    }
    if (state.layers.rays && fc && Number.isFinite(fc.wavePeriod) && Number.isFinite(fc.waveDirection)) {
      const period = G.clamp(Math.round(fc.wavePeriod / 2) * 2, 6, 16), direction = G.clamp(Math.round(fc.waveDirection / 5) * 5, 50, 230);
      const data = state.rayCache.get(period);
      if (!data) {
        if (!state.rayCache.has(period)) { state.rayCache.set(period, null); json(`../research/fr/${period}.json`).then(j => { state.rayCache.set(period, j); drawOverlays(); }).catch(() => { state.rayCache.delete(period); $('mapStatus').textContent = 'Refraction paths unavailable · other layers remain available'; }); }
      } else if (data[direction]) {
        for (const r of data[direction].rays) {
          const points = []; for (let i = 0; i < r.p.length; i += 2) points.push([-72.4 + r.p[i] / 100 / meta.kmlon, 41.5 - r.p[i + 1] / 100 / meta.kmlat]);
          // Densify source paths before draping, so long path segments follow the bottom.
          const dense = [];
          for (let i = 0; i < points.length - 1; i++) {
            const a = points[i], b = points[i + 1];
            if (Math.max(a[0], b[0]) < viewBounds[0] || Math.min(a[0], b[0]) > viewBounds[2] || Math.max(a[1], b[1]) < viewBounds[1] || Math.min(a[1], b[1]) > viewBounds[3]) { if (dense.length) { geographicLine(dense, r.h ? 0xffd48c : 0xc9e6dc, 0.003, r.h ? 0.95 : 0.36); dense.length = 0; } continue; }
            const n = Math.min(160, Math.ceil(Math.hypot((b[0] - a[0]) * meta.kmlon, (b[1] - a[1]) * meta.kmlat) / 0.035));
            for (let k = 0; k <= n; k++) dense.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
          }
          geographicLine(dense, r.h ? 0xffd48c : 0xc9e6dc, 0.003, r.h ? 0.95 : 0.36);
        }
      }
    }
    forecastReadout(); dirty();
  }
  function forecastReadout() {
    const fc = state.forecast, el = $('forecastReadout'), showing = state.layers.field || state.layers.rays || state.layers.waves || state.layers.wind;
    el.hidden = !showing;
    if (!showing) return;
    if (!fc) { el.textContent = 'Forecast overlays unavailable. The sea floor and map layers still work.'; return; }
    const parts = [];
    if (fc.time) { const date = new Date(fc.time); if (Number.isFinite(date.getTime())) parts.push(date.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric' }) + ' ET'); }
    if (Number.isFinite(fc.waveHeight)) parts.push(`${fc.waveHeight.toFixed(1)} ft swell`);
    if (Number.isFinite(fc.wavePeriod)) parts.push(`${fc.wavePeriod.toFixed(1)} s`);
    if (Number.isFinite(fc.waveDirection)) parts.push(`from ${Math.round(fc.waveDirection)}°`);
    if (state.layers.wind && Number.isFinite(fc.windSpeed)) parts.push(`${Math.round(fc.windSpeed)} mph wind`);
    if (state.layers.rays && Number.isFinite(fc.wavePeriod) && Number.isFinite(fc.waveDirection)) parts.push(`paths: ${G.clamp(Math.round(fc.wavePeriod / 2) * 2, 6, 16)} s / ${G.clamp(Math.round(fc.waveDirection / 5) * 5, 50, 230)}°`);
    if (state.spot === 'race') parts.push('Choc-area reference conditions; no Race surf model');
    if (state.layers.field) parts.push(fieldTime ? `GFS height field: ${new Date(fieldTime).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric' })} ET · 0.25° grid` : 'Wave-height field unavailable');
    if (fc.time && Date.now() - Date.parse(fc.time) > 12 * 3600000) parts.push('past forecast hour');
    el.textContent = parts.join(' · ') || 'Forecast values unavailable';
  }
  function setForecast(fc) {
    if (!fc || typeof fc !== 'object') return;
    const out = {}; for (const k of ['waveHeight', 'wavePeriod', 'waveDirection', 'windSpeed', 'windDirection']) out[k] = typeof fc[k] === 'number' && Number.isFinite(fc[k]) ? fc[k] : null;
    if (typeof fc.time === 'string' && Number.isFinite(Date.parse(fc.time))) out.time = fc.time;
    state.forecast = out; drawOverlays();
  }
  async function loadForecast() {
    try {
      const localData = await json('../research/fc/fc.json');
      const apply = d => {
        if (state.externalForecast) return; const rows = d.gfs || []; if (!rows.length) return;
        const row = rows.reduce((a, b) => Math.abs(Date.parse(a.t) - Date.now()) < Math.abs(Date.parse(b.t) - Date.now()) ? a : b), train = (row.trains || []).filter(t => t.k !== 'ww').sort((a, b) => b.ft - a.ft)[0];
        setForecast({ time: row.t, waveHeight: train ? train.ft : row.hs, wavePeriod: train ? train.T : null, waveDirection: train ? train.D : null, windSpeed: row.wind ? row.wind[0] * 1.15078 : null, windDirection: row.wind ? row.wind[1] : null });
      };
      loadField(localData, '../research/fc/');
      apply(localData);
      json('https://raw.githubusercontent.com/TheKeeks/LetsCheckChoc/fc-data/fc/fc.json').then(d => { if (Date.parse(d.made) > Date.parse(localData.made)) { apply(d); loadField(d, 'https://raw.githubusercontent.com/TheKeeks/LetsCheckChoc/fc-data/fc/'); } }).catch(() => {});
    } catch (e) { forecastReadout(); }
  }
  async function loadField(data, base) {
    const request = ++fieldRequest;
    try {
      const im = await image(base + 'field_gfs_reg.png' + (base.startsWith('https:') ? '?m=' + encodeURIComponent(data.made) : ''));
      if (request !== fieldRequest) return;
      const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const ctx = c.getContext('2d');
      ctx.drawImage(im, 0, 0); fieldPixels = ctx.getImageData(0, 0, c.width, c.height).data; fieldWidth = c.width; fieldMetadata = data; c.width = c.height = 1;
      drawField(); forecastReadout();
    } catch (e) { forecastReadout(); }
  }
  function drawField() {
    dispose(fieldMesh); fieldMesh = null; if (fieldTexture) { fieldTexture.dispose(); fieldTexture = null; }
    if (!root || !state.layers.field || !fieldMetadata || !fieldPixels || !viewBounds) return;
    const rows = fieldMetadata.gfs, grid = fieldMetadata.grids.reg, wanted = Date.parse((state.forecast || {}).time) || Date.now();
    let row = 0; rows.forEach((r, i) => { if (Math.abs(Date.parse(r.t) - wanted) < Math.abs(Date.parse(rows[row].t) - wanted)) row = i; });
    fieldTime = rows[row].t;
    const c = document.createElement('canvas'); c.width = grid.lon[3]; c.height = grid.lat[3]; const ctx = c.getContext('2d'), pixels = ctx.createImageData(c.width, c.height);
    for (let i = 0; i < c.width * c.height; i++) {
      const p = (row * fieldWidth + i) * 4; if (fieldPixels[p] === 255 || fieldPixels[p + 1] === 255) continue;
      const metres = fieldPixels[p] / 10, col = new T.Color().setHSL(G.clamp(0.57 - metres * 0.075, 0, 0.57), 0.72, 0.52);
      pixels.data.set([Math.round(col.r * 255), Math.round(col.g * 255), Math.round(col.b * 255), 190], i * 4);
    }
    ctx.putImageData(pixels, 0, 0); fieldTexture = new T.CanvasTexture(c); fieldTexture.magFilter = T.NearestFilter; fieldTexture.minFilter = T.NearestFilter;
    const b = [grid.lon[0] - grid.lon[2] / 2, grid.lat[1] - grid.lat[2] / 2, grid.lon[1] + grid.lon[2] / 2, grid.lat[0] + grid.lat[2] / 2];
    const geometry = ground.geometry.clone(), pos = geometry.attributes.position, uv = geometry.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const q = geographic(pos.getX(i), pos.getZ(i)); uv.setXY(i, (q[0] - b[0]) / (b[2] - b[0]), (q[1] - b[1]) / (b[3] - b[1]));
      pos.setY(i, (state.follow ? pos.getY(i) : Math.max(0, pos.getY(i))) + 0.0026);
    }
    uv.needsUpdate = pos.needsUpdate = true;
    fieldMesh = new T.Mesh(geometry, new T.MeshBasicMaterial({ map: fieldTexture, transparent: true, opacity: 0.57, side: T.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5 })); fieldMesh.renderOrder = 5; root.add(fieldMesh); dirty();
  }
  function openExplorer() {
    const frame = $('researchExplorer'); frame.hidden = false; $('explorerToggle').setAttribute('aria-expanded', 'true'); $('explorerToggle').textContent = 'Map explorer is open';
    if (!frame.getAttribute('src')) frame.src = `../research/index.html?view=map&theme=${state.theme}${requestedDate ? '&date=' + requestedDate : ''}`;
    else if (requestedDate) frame.contentWindow.postMessage({ type: 'lcc-map-date', date: requestedDate }, location.origin);
  }
  function receive(data) {
    if (!data || typeof data !== 'object') return;
    if (data.type === 'lcc-theme') setTheme(data.theme);
    if (data.type !== 'lcc-map') return;
    if (data.theme) setTheme(data.theme); if (data.spot) setSpot(data.spot);
    if (data.forecast) { state.externalForecast = true; setForecast(data.forecast); }
    if (typeof data.active === 'boolean') { state.active = data.active; if (state.active) { resize(); dirty(); } }
    if (/^\d{4}-\d{2}-\d{2}$/.test(data.date || '')) { requestedDate = data.date; openExplorer(); }
  }
  addEventListener('message', e => { if (e.origin === location.origin && e.source === parent) receive(e.data); });
  addEventListener('visibilitychange', dirty);
  window.ChocMap = { setSpot, setTheme, setForecast, receive, getState: () => ({ spot: state.spot, theme: state.theme, threeD: state.threeD, layers: Object.assign({}, state.layers), ready: !!renderer, active: state.active, tileCount: state.tileCache.size, loadedTiles: [...state.tileCache.values()].filter(r => r.mesh && r.mesh.visible).length, pendingTiles: [...state.tileCache.values()].filter(r => r.loading).length, overlayFollowsTerrain: state.follow, fieldReady: !!fieldMesh, fieldTime, renderedTriangles: renderer ? renderer.info.render.triangles : 0, camera: Object.assign({}, state.camera) }) };
  document.querySelectorAll('[data-spot]').forEach(b => b.addEventListener('click', () => { setSpot(b.dataset.spot); parent.postMessage({ type: 'lcc-map-spot', spot: state.spot }, location.origin); }));
  $('bathymetryToggle').addEventListener('click', () => { state.threeD = !state.threeD; $('bathymetryToggle').setAttribute('aria-pressed', String(state.threeD)); $('bathymetryToggle').querySelector('span').textContent = state.threeD ? 'On' : 'Off'; $('viewScale').textContent = state.threeD ? `Depth stretched ${state.exaggeration}×` : '2D overhead view'; dirty(); });
  $('layersToggle').addEventListener('click', () => { $('layersPanel').hidden = !$('layersPanel').hidden; $('layersToggle').setAttribute('aria-expanded', String(!$('layersPanel').hidden)); });
  $('closeLayers').addEventListener('click', () => { $('layersPanel').hidden = true; $('layersToggle').setAttribute('aria-expanded', 'false'); $('layersToggle').focus(); });
  document.querySelectorAll('[data-layer]').forEach(input => input.addEventListener('change', () => { state.layers[input.dataset.layer] = input.checked; if (input.dataset.layer === 'relief' && renderer) drawGround(); updateTiles(); drawOverlays(); updateStatus(); }));
  document.querySelectorAll('[data-layer]').forEach(input => { input.checked = !!state.layers[input.dataset.layer]; });
  $('overlayPosition').addEventListener('change', () => { state.follow = $('overlayPosition').value === 'floor'; drawOverlays(); });
  $('verticalScale').addEventListener('input', () => { state.exaggeration = +$('verticalScale').value; $('scaleValue').textContent = state.exaggeration + '×'; $('viewScale').textContent = state.threeD ? `Depth stretched ${state.exaggeration}×` : '2D overhead view'; drawMarkers(); dirty(); });
  $('sourcesToggle').addEventListener('click', () => { $('sources').hidden = !$('sources').hidden; $('sourcesToggle').setAttribute('aria-expanded', String(!$('sources').hidden)); });
  $('explorerToggle').addEventListener('click', openExplorer);
  $('researchExplorer').addEventListener('load', () => setTheme(state.theme));
  function zoom(f) { state.camera.distance = G.clamp(state.camera.distance * f, 0.3, 15); dirty(); queueUpdate(); }
  function pan(dx, dy) {
    const v = state.camera, k = v.distance / Math.max(250, $('terrain').clientHeight) * 0.8;
    v.x -= (dx * Math.cos(v.az) + dy * Math.sin(v.az)) * k; v.z -= (-dx * Math.sin(v.az) + dy * Math.cos(v.az)) * k;
    if (surveyBounds) { const a = local(surveyBounds[0], surveyBounds[3]), b = local(surveyBounds[2], surveyBounds[1]); v.x = G.clamp(v.x, a[0] + 0.1, b[0] - 0.1); v.z = G.clamp(v.z, a[1] + 0.1, b[1] - 0.1); }
    dirty(); queueUpdate();
  }
  $('zoomIn').addEventListener('click', () => zoom(0.7)); $('zoomOut').addEventListener('click', () => zoom(1.4));
  $('rotate').addEventListener('click', () => { state.camera.az += Math.PI / 6; dirty(); queueUpdate(); }); $('resetView').addEventListener('click', () => setSpot(state.spot, true));
  const cv = $('terrain'), pointers = new Map(); let previousGesture;
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('wheel', e => { e.preventDefault(); zoom(Math.exp(e.deltaY * 0.001)); }, { passive: false });
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY, e.button]); previousGesture = null; });
  cv.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return; const prev = pointers.get(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY, prev[2]]);
    if (pointers.size === 1) { if (prev[2] === 2 || e.shiftKey) { state.camera.az -= (e.clientX - prev[0]) * 0.006; state.camera.el = G.clamp(state.camera.el + (e.clientY - prev[1]) * 0.005, 0.2, 1.5); dirty(); queueUpdate(); } else pan(e.clientX - prev[0], e.clientY - prev[1]); }
    else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()], g = { distance: Math.hypot(a[0] - b[0], a[1] - b[1]), angle: Math.atan2(b[1] - a[1], b[0] - a[0]), y: (a[1] + b[1]) / 2 };
      if (previousGesture) { zoom(previousGesture.distance / Math.max(10, g.distance)); state.camera.az += g.angle - previousGesture.angle; state.camera.el = G.clamp(state.camera.el + (g.y - previousGesture.y) * 0.003, 0.2, 1.5); dirty(); }
      previousGesture = g;
    }
  });
  const release = e => { pointers.delete(e.pointerId); previousGesture = null; }; cv.addEventListener('pointerup', release); cv.addEventListener('pointercancel', release);
  cv.addEventListener('keydown', e => { const key = e.key; if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-'].includes(key)) return; e.preventDefault(); if (key === '+' || key === '=') zoom(0.8); else if (key === '-') zoom(1.25); else pan(key === 'ArrowLeft' ? 40 : key === 'ArrowRight' ? -40 : 0, key === 'ArrowUp' ? 40 : key === 'ArrowDown' ? -40 : 0); });
  cv.addEventListener('webglcontextlost', e => { e.preventDefault(); $('mapLoading').hidden = false; $('mapLoading').textContent = 'The 3D view paused. Reload to restore it, or use the map explorer below.'; });
  if ('IntersectionObserver' in window) new IntersectionObserver(entries => { visible = entries.some(e => e.isIntersecting); if (visible) dirty(); }).observe(cv);
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(cv); else addEventListener('resize', resize);
  setSpot(state.spot, true); setTheme(state.theme); loadForecast();
  if (requestedDate && !compact) openExplorer();
  async function start() {
    try {
      if (!T) throw new Error('3D library unavailable');
      const loaded = await Promise.all([json('../research/ocean/fine16.json'), image('../research/ocean/fine16.png')]); meta = loaded[0];
      const im = loaded[1], scratch = document.createElement('canvas'); scratch.width = im.width; scratch.height = im.height;
      const ctx = scratch.getContext('2d', { willReadFrequently: true }); if (!ctx) throw new Error('Canvas unavailable'); ctx.drawImage(im, 0, 0);
      const pixels = ctx.getImageData(0, 0, im.width, im.height).data; values = new Float32Array(meta.cols * meta.rows); wet = new Uint8Array(values.length);
      for (let i = 0; i < values.length; i++) { values[i] = ((pixels[i * 4] << 8) | pixels[i * 4 + 1]) / meta.scale - meta.off; wet[i] = pixels[i * 4 + 2] > 127 ? 1 : 0; }
      scratch.width = scratch.height = 1;
      surveyBounds = [meta.left + meta.dx / 2000 / meta.kmlon, meta.top - (meta.rows - 0.5) * meta.dx / 1000 / meta.kmlat, meta.left + (meta.cols - 0.5) * meta.dx / 1000 / meta.kmlon, meta.top - meta.dx / 2000 / meta.kmlat];
      renderer = new T.WebGLRenderer({ canvas: cv, antialias: true, alpha: false, powerPreference: 'low-power' }); renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1)); renderer.outputEncoding = T.sRGBEncoding;
      scene = new T.Scene(); scene.background = new T.Color(state.theme === 'dark' ? 0x15292f : 0xe6efec); camera = new T.PerspectiveCamera(45, 1, 0.005, 150);
      scene.add(new T.AmbientLight(0xffffff, 0.68)); const sun = new T.DirectionalLight(0xfff7e2, 0.68); sun.position.set(-8, 12, 4); scene.add(sun);
      root = new T.Group(); scene.add(root); setSpot(state.spot, true); resize(); drawGround(); drawOverlays(); $('mapLoading').hidden = true; dirty();
      parent.postMessage({ type: 'lcc-map-ready' }, location.origin);
    } catch (e) {
      $('mapLoading').hidden = true; $('fallback').hidden = false; $('bathymetryToggle').disabled = true; $('mapStatus').textContent = '3D unavailable · the original 2D map remains available below';
      if (!compact) openExplorer(); parent.postMessage({ type: 'lcc-map-ready', webgl: false }, location.origin);
    }
  }
  start();
})();
