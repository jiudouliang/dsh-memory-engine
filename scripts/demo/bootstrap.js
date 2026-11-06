window.__ModuleLoader__ = {
  load(definition) {
    const plugin = definition.factory(name => {
      if (name === 'react') return window.React;
      if (name === 'react-dom') return window.ReactDOM;
      throw new Error('演示页面不支持此模块。');
    });
    plugin.apply({ slots: {
      has: name => name === 'conversation.session.header.actions',
      inject(name, setup) { return setup(); },
      register(entry, Button) {
        const root = ReactDOM.createRoot(document.getElementById('demo-entry'));
        const observer = new MutationObserver(() => {
          const button = document.querySelector('[data-memory-engine-map]');
          if (button) { observer.disconnect(); button.click(); }
        });
        observer.observe(document.getElementById('demo-entry'), { childList: true, subtree: true });
        root.render(React.createElement(Button));
        return () => { observer.disconnect(); root.unmount(); };
      },
    } });
  },
};
