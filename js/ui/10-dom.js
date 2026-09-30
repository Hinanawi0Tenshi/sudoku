/* 数独 · UI 基础工具：DOM 构建、弹窗、提示条 */
(function (global) {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  /**
   * 极简元素构建器。
   * el('div.card', { onclick }, [child, 'text'])
   */
  function el(spec, attrs, children) {
    const parts = String(spec).split(/(?=[.#])/);
    const node = document.createElement(parts[0] || 'div');
    for (let i = 1; i < parts.length; i++) {
      const p = parts[i];
      if (p[0] === '.') node.classList.add(p.slice(1));
      else if (p[0] === '#') node.id = p.slice(1);
    }
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'style' && typeof v === 'object') {
          for (const prop of Object.keys(v)) {
            // Object.assign 设不了 --自定义属性，必须走 setProperty
            if (prop.charAt(0) === '-' && prop.charAt(1) === '-') node.style.setProperty(prop, v[prop]);
            else node.style[prop] = v[prop];
          }
        }
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else node.setAttribute(k, v === true ? '' : v);
      }
    }
    append(node, children);
    return node;
  }

  function append(node, children) {
    if (children === null || children === undefined || children === false) return node;
    if (Array.isArray(children)) {
      for (const c of children) append(node, c);
      return node;
    }
    node.appendChild(children instanceof Node ? children : document.createTextNode(String(children)));
    return node;
  }

  const clear = (node) => {
    while (node && node.firstChild) node.removeChild(node.firstChild);
    return node;
  };

  /* ---------------- 提示条 ---------------- */
  let toastRoot = null;
  function toast(message, kind, ms) {
    toastRoot = toastRoot || $('#toast-root');
    if (!toastRoot) return;
    const node = el('div.toast' + (kind ? '.' + kind : ''), { text: message });
    toastRoot.appendChild(node);
    setTimeout(() => {
      node.style.transition = 'opacity .25s, transform .25s';
      node.style.opacity = '0';
      node.style.transform = 'translateY(8px)';
      setTimeout(() => node.remove(), 260);
    }, ms || 2200);
  }

  /* ---------------- 弹窗 ---------------- */
  function modal(opts) {
    const root = $('#dialog-root');
    const close = () => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      if (opts.onClose) opts.onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };

    const foot = opts.footer
      ? el('div.modal-foot', null, opts.footer.map((b) => el('button.btn' + (b.primary ? '.btn-primary' : '') + (b.danger ? '.btn-warn' : ''), {
          text: b.label,
          onclick: () => {
            const keep = b.onClick ? b.onClick(close) : undefined;
            if (keep !== false && b.closes !== false) close();
          },
        })))
      : null;

    const box = el('div.modal', { role: 'dialog', 'aria-modal': 'true' }, [
      el('div.modal-head', null, [
        el('h2', { text: opts.title || '' }),
        el('button.btn.btn-icon', { text: '✕', 'aria-label': '关闭', onclick: close }),
      ]),
      el('div.modal-body', null, opts.body || ''),
      foot,
    ]);

    const backdrop = el('div.modal-backdrop', {
      onclick: (e) => {
        if (e.target === backdrop && opts.dismissable !== false) close();
      },
    }, [box]);

    root.appendChild(backdrop);
    document.addEventListener('keydown', onKey);
    const focusable = box.querySelector('button, input, select, textarea');
    if (focusable) focusable.focus();
    return { close: close, node: box };
  }

  function confirmDialog(title, message, okLabel) {
    return new Promise((resolve) => {
      modal({
        title: title,
        body: el('p', { text: message }),
        footer: [
          { label: '取消', onClick: () => resolve(false) },
          { label: okLabel || '确定', primary: true, onClick: () => resolve(true) },
        ],
        onClose: () => resolve(false),
      });
    });
  }

  /* ---------------- 文件与剪贴板 ---------------- */
  function downloadFile(filename, content, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function pickFile(accept) {
    return new Promise((resolve) => {
      const input = el('input', { type: 'file', accept: accept || '', style: { display: 'none' } });
      input.addEventListener('change', () => {
        resolve(input.files && input.files[0] ? input.files[0] : null);
        input.remove();
      });
      document.body.appendChild(input);
      input.click();
    });
  }

  const loadImage = (src) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = src;
    });

  const fileToImage = async (file) => {
    const url = URL.createObjectURL(file);
    try {
      return await loadImage(url);
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  };

  /** 监听粘贴事件（截图常走这条路） */
  function onPasteImage(handler) {
    const listener = (e) => {
      const items = (e.clipboardData && e.clipboardData.items) || [];
      for (const it of items) {
        if (it.type && it.type.indexOf('image/') === 0) {
          const f = it.getAsFile();
          if (f) {
            e.preventDefault();
            handler(f);
            return;
          }
        }
      }
    };
    document.addEventListener('paste', listener);
    return () => document.removeEventListener('paste', listener);
  }

  const debounce = (fn, ms) => {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms || 150);
    };
  };

  SD.UI = { $: $, $$: $$, el: el, clear: clear, toast: toast, modal: modal, confirm: confirmDialog, download: downloadFile, pickFile: pickFile, loadImage: loadImage, fileToImage: fileToImage, onPasteImage: onPasteImage, debounce: debounce };
})(window);
