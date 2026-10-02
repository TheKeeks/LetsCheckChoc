// Minimal, permissive browser DOM for running app.js / kiosk.js inside a
// node:vm context (see load-app.js). It is NOT a DOM implementation: there
// is no HTML parser, no layout and no CSS. It exists so app code that pokes
// elements, canvases and listeners runs without throwing, and so tests can
// read back what the app wrote (textContent, classList, style, dataset,
// canvas draw calls).
//
// getElementById(id) returns a stable FakeElement per id (auto-created on
// first lookup) unless the loader runs with dom: 'null', in which case it
// returns null for ids nobody created (the old smoke_regression.js shape).
// querySelector() returns null and querySelectorAll() returns [].
'use strict';

class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = !!init.bubbles;
    this.cancelable = !!init.cancelable;
    this.detail = init.detail;
    this.defaultPrevented = false;
    this.target = null;
    this.currentTarget = null;
    Object.assign(this, init);
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() {}
  stopImmediatePropagation() {}
}

// addEventListener / removeEventListener / dispatchEvent for any stub.
class FakeEventTarget {
  constructor() { this._listeners = {}; }
  addEventListener(type, fn) {
    if (typeof fn !== 'function' && !(fn && typeof fn.handleEvent === 'function')) return;
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  }
  removeEventListener(type, fn) {
    const l = this._listeners[type];
    if (l) this._listeners[type] = l.filter(f => f !== fn);
  }
  dispatchEvent(ev) {
    if (typeof ev === 'string') ev = new FakeEvent(ev);
    if (!ev.target) ev.target = this;
    ev.currentTarget = this;
    for (const fn of (this._listeners[ev.type] || []).slice()) {
      if (typeof fn === 'function') fn.call(this, ev); else fn.handleEvent(ev);
    }
    const prop = this['on' + ev.type];
    if (typeof prop === 'function') prop.call(this, ev);
    return !ev.defaultPrevented;
  }
  listeners(type) { return (this._listeners[type] || []).slice(); }
}

class FakeClassList {
  constructor() { this._set = new Set(); }
  add(...names) { names.forEach(n => this._set.add(String(n))); }
  remove(...names) { names.forEach(n => this._set.delete(String(n))); }
  contains(name) { return this._set.has(String(name)); }
  toggle(name, force) {
    const on = force === undefined ? !this._set.has(name) : !!force;
    if (on) this._set.add(name); else this._set.delete(name);
    return on;
  }
  replace(a, b) { if (!this._set.has(a)) return false; this._set.delete(a); this._set.add(b); return true; }
  get length() { return this._set.size; }
  get value() { return [...this._set].join(' '); }
  set value(v) { this._set = new Set(String(v).split(/\s+/).filter(Boolean)); }
  toString() { return this.value; }
  [Symbol.iterator]() { return this._set.values(); }
}

// 2D context that accepts every property write and every method call.
// Calls are recorded on ctx.__calls as { fn, args } (e.g. filter for
// fn === 'fillText' to see which labels were drawn).
function createCanvasContext(canvas) {
  const state = {
    canvas,
    fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
    font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic', globalAlpha: 1,
    globalCompositeOperation: 'source-over', shadowBlur: 0, shadowColor: 'transparent',
    shadowOffsetX: 0, shadowOffsetY: 0, imageSmoothingEnabled: true, lineDashOffset: 0
  };
  const calls = [];
  const gradient = () => ({ addColorStop() {} });
  const special = {
    measureText: text => ({ width: String(text).length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    createLinearGradient: gradient,
    createRadialGradient: gradient,
    createConicGradient: gradient,
    createPattern: () => ({ setTransform() {} }),
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(0, (w | 0) * (h | 0) * 4)) }),
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(0, (w | 0) * (h | 0) * 4)) }),
    getLineDash: () => [],
    isPointInPath: () => false,
    isPointInStroke: () => false,
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
  };
  return new Proxy(state, {
    get(target, prop) {
      if (prop === '__calls') return calls;
      if (typeof prop === 'symbol' || prop === 'then' || prop === 'toJSON') return undefined;
      if (prop in target) return target[prop];
      const impl = special[prop];
      return (...args) => {
        calls.push({ fn: prop, args });
        return impl ? impl(...args) : undefined;
      };
    },
    set(target, prop, value) { target[prop] = value; return true; }
  });
}

class FakeElement extends FakeEventTarget {
  constructor(doc, tagName = 'div') {
    super();
    this.ownerDocument = doc;
    this.tagName = String(tagName).toUpperCase();
    this.nodeName = this.tagName;
    this.nodeType = 1;
    this._id = '';
    this.style = {};
    this.dataset = {};
    this.classList = new FakeClassList();
    this.attributes = {};
    this.children = [];
    this.childNodes = this.children;
    this.parentElement = null;
    this.parentNode = null;
    this.textContent = '';
    this.innerHTML = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.width = 300;
    this.height = 150;
    this.clientWidth = 800;
    this.clientHeight = 300;
    this.offsetWidth = 800;
    this.offsetHeight = 300;
    this.offsetTop = 0;
    this.offsetLeft = 0;
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.scrollWidth = 800;
    this.scrollHeight = 300;
    this._ctx = null;
  }
  get id() { return this._id; }
  set id(v) {
    this._id = String(v);
    if (this._id && this.ownerDocument) this.ownerDocument._register(this._id, this);
  }
  get className() { return this.classList.value; }
  set className(v) { this.classList.value = v; }
  get innerText() { return this.textContent; }
  set innerText(v) { this.textContent = String(v); }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  get firstElementChild() { return this.firstChild; }
  get isConnected() { return true; }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
    if (k === 'id') this.id = v;
    else if (k === 'class') this.className = v;
    else if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(v);
  }
  getAttribute(k) {
    if (k === 'id') return this._id || null;
    if (k === 'class') return this.className || null;
    return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null;
  }
  hasAttribute(k) { return this.getAttribute(k) !== null; }
  removeAttribute(k) { delete this.attributes[k]; }
  toggleAttribute(k, force) {
    const on = force === undefined ? !this.hasAttribute(k) : !!force;
    if (on) this.setAttribute(k, ''); else this.removeAttribute(k);
    return on;
  }
  appendChild(child) {
    if (child && child.parentElement) child.remove();
    this.children.push(child);
    if (child && typeof child === 'object') { child.parentElement = this; child.parentNode = this; }
    return child;
  }
  append(...nodes) { nodes.forEach(n => { if (n && typeof n === 'object') this.appendChild(n); }); }
  prepend(...nodes) {
    nodes.reverse().forEach(n => {
      if (!n || typeof n !== 'object') return;
      if (n.parentElement) n.remove();
      this.children.unshift(n); n.parentElement = this; n.parentNode = this;
    });
  }
  insertBefore(node, ref) {
    if (node.parentElement) node.remove();
    const i = this.children.indexOf(ref);
    if (i < 0) this.children.push(node); else this.children.splice(i, 0, node);
    node.parentElement = this; node.parentNode = this;
    return node;
  }
  insertAdjacentHTML() {}
  insertAdjacentElement(pos, node) { return this.appendChild(node); }
  removeChild(child) { const i = this.children.indexOf(child); if (i >= 0) this.children.splice(i, 1); child.parentElement = null; child.parentNode = null; return child; }
  remove() { if (this.parentElement) this.parentElement.removeChild(this); }
  replaceWith(node) {
    const p = this.parentElement;
    if (p) { const i = p.children.indexOf(this); p.children[i] = node; node.parentElement = p; node.parentNode = p; this.parentElement = null; }
    if (node && node.id && this.ownerDocument) this.ownerDocument._register(node.id, node);
  }
  replaceChildren(...nodes) { this.children.length = 0; this.append(...nodes); }
  cloneNode() {
    const c = new FakeElement(this.ownerDocument, this.tagName);
    c._id = this._id; c.className = this.className; c.textContent = this.textContent; c.innerHTML = this.innerHTML;
    Object.assign(c.style, this.style); Object.assign(c.dataset, this.dataset); Object.assign(c.attributes, this.attributes);
    return c;
  }
  contains(node) { return node === this || this.children.some(c => c && c.contains && c.contains(node)); }
  closest() { return null; }
  matches() { return false; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  getElementsByTagName() { return []; }
  getElementsByClassName() { return []; }
  getBoundingClientRect() {
    return { x: 0, y: 0, left: 0, top: 0, right: this.clientWidth, bottom: this.clientHeight, width: this.clientWidth, height: this.clientHeight };
  }
  getClientRects() { return [this.getBoundingClientRect()]; }
  getContext(kind) {
    if (kind && kind !== '2d') return null;
    if (!this._ctx) this._ctx = createCanvasContext(this);
    return this._ctx;
  }
  toDataURL() { return 'data:image/png;base64,'; }
  toBlob(cb) { cb && cb(null); }
  focus() {}
  blur() {}
  click() { this.dispatchEvent(new FakeEvent('click')); }
  scrollIntoView() {}
  scrollTo() {}
  scrollBy() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() { return false; }
  animate() { return { cancel() {}, finished: Promise.resolve(), onfinish: null }; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  play() { return Promise.resolve(); }
  pause() {}
  load() {}
  submit() {}
  reset() {}
  select() {}
}

class FakeDocument extends FakeEventTarget {
  constructor({ autoCreate = true } = {}) {
    super();
    this._autoCreate = autoCreate;
    this._byId = new Map();
    this.readyState = 'loading';
    this.hidden = false;
    this.visibilityState = 'visible';
    this.title = '';
    this.cookie = '';
    this.documentElement = new FakeElement(this, 'html');
    this.head = new FakeElement(this, 'head');
    this.body = new FakeElement(this, 'body');
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.activeElement = this.body;
    this.fonts = {
      ready: Promise.resolve(),
      status: 'loaded',
      load: () => Promise.resolve([]),
      check: () => true,
      add() {},
      addEventListener() {},
      removeEventListener() {}
    };
  }
  _register(id, node) { this._byId.set(id, node); }
  getElementById(id) {
    const key = String(id);
    if (this._byId.has(key)) return this._byId.get(key);
    if (!this._autoCreate) return null;
    const node = new FakeElement(this, key.includes('canvas') ? 'canvas' : 'div');
    node.id = key;
    return node;
  }
  createElement(tag) { return new FakeElement(this, tag); }
  createElementNS(ns, tag) { return new FakeElement(this, tag); }
  createTextNode(text) { return { nodeType: 3, textContent: String(text), remove() {} }; }
  createDocumentFragment() { return new FakeElement(this, '#fragment'); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  getElementsByTagName() { return []; }
  getElementsByClassName() { return []; }
  hasFocus() { return true; }
  execCommand() { return false; }
}

// Map-backed Web Storage. Keys are enumerable (Object.keys(localStorage)
// works as in browsers). quotaBytes > 0 makes setItem throw once the
// stored string total would exceed it, like a full iOS Safari quota.
function createStorage(seed = {}, { quotaBytes = 0 } = {}) {
  const map = new Map(Object.entries(seed).map(([k, v]) => [k, String(v)]));
  const size = () => [...map].reduce((n, [k, v]) => n + k.length + v.length, 0);
  const api = {
    getItem: k => (map.has(String(k)) ? map.get(String(k)) : null),
    setItem: (k, v) => {
      const key = String(k), val = String(v);
      if (quotaBytes > 0) {
        const prev = map.has(key) ? key.length + map.get(key).length : 0;
        if (size() - prev + key.length + val.length > quotaBytes) {
          const e = new Error('QuotaExceededError: storage quota exceeded');
          e.name = 'QuotaExceededError';
          throw e;
        }
      }
      map.set(key, val);
    },
    removeItem: k => { map.delete(String(k)); },
    clear: () => map.clear(),
    key: i => [...map.keys()][i] ?? null,
    get length() { return map.size; },
    // Test-only helper: a plain { key: value } snapshot.
    dump: () => Object.fromEntries(map)
  };
  return new Proxy(api, {
    get(t, p) { return p in t ? t[p] : (typeof p === 'string' && map.has(p) ? map.get(p) : undefined); },
    set(t, p, v) { api.setItem(p, v); return true; },
    has(t, p) { return p in t || map.has(p); },
    deleteProperty(t, p) { map.delete(p); return true; },
    ownKeys() { return [...map.keys()]; },
    getOwnPropertyDescriptor(t, p) {
      return map.has(p) ? { value: map.get(p), enumerable: true, configurable: true, writable: true } : undefined;
    }
  });
}

module.exports = { FakeEvent, FakeEventTarget, FakeClassList, FakeElement, FakeDocument, createCanvasContext, createStorage };
