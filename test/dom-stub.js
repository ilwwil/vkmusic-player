// Минимальный DOM-стаб для загрузки shared.js/selectors.js вне Electron —
// им достаточно, чтобы IIFE-обёртки отработали до конца при require().
function makeClassList() {
  const set = new Set();
  return {
    add: (...c) => c.forEach(x => set.add(x)),
    remove: (...c) => c.forEach(x => set.delete(x)),
    toggle(c, force) {
      const on = force === undefined ? !set.has(c) : force;
      if (on) set.add(c); else set.delete(c);
      return on;
    },
    contains: (c) => set.has(c)
  };
}

function stubElement() {
  return {
    classList: makeClassList(),
    style: {},
    textContent: '',
    addEventListener() {},
    executeJavaScript: async () => ''
  };
}

function installDomStubs() {
  global.window = global;
  global.document = { getElementById: () => stubElement() };
}

module.exports = { installDomStubs, stubElement };
