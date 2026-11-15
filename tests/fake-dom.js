// Маленький DOM для проверки разметки, которую строят модули: элементы, текст, атрибуты, клики.
class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.listeners = {};
    this.className = '';
    this.disabled = false;
    this.type = '';
    this._text = '';
  }

  get textContent() {
    return this._text + this.children.map(child => (typeof child === 'string' ? child : child.textContent)).join('');
  }

  set textContent(value) {
    this._text = String(value);
    this.children = [];
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }

  addEventListener(type, listener) {
    (this.listeners[type] ||= []).push(listener);
  }

  click() {
    if (this.disabled) return;
    (this.listeners.click || []).forEach(listener => listener({ type: 'click', target: this }));
  }

  // Все потомки (без самого элемента), подходящие под условие.
  findAll(predicate) {
    const found = [];
    const walk = node => node.children.forEach(child => {
      if (typeof child === 'string') return;
      if (predicate(child)) found.push(child);
      walk(child);
    });
    walk(this);
    return found;
  }

  byTag(tag) {
    return this.findAll(el => el.tagName === tag.toUpperCase());
  }

  byClass(name) {
    return this.findAll(el => el.className.split(/\s+/).includes(name));
  }
}

export function installFakeDocument() {
  globalThis.document = {
    createElement: tag => new FakeElement(tag),
    querySelector: () => null,
    querySelectorAll: () => []
  };
  return globalThis.document;
}
