import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, act } from 'react';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { Modal } from '../src/ui/controls';

test('cancelling a nested settings editor closes its own dialog without closing the settings dialog', async () => {
  const dom = new JSDOM('<button id="trigger">设置</button><div id="root"></div>', { pretendToBeVisual: true });
  const names = ['window', 'document', 'HTMLElement', 'Node', 'navigator', 'React', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const descriptors = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  names.forEach(name => Object.defineProperty(globalThis, name, { configurable: true,
    value: name === 'IS_REACT_ACT_ENVIRONMENT' ? true : name === 'React' ? React : name === 'window' ? dom.window : dom.window[name] }));
  Object.assign(dom.window.HTMLDialogElement.prototype, {
    showModal() { this.setAttribute('open', ''); },
    close() { this.removeAttribute('open'); },
  });
  let settingsClosed = 0, editorClosed = 0;
  const root = createRoot(document.getElementById('root')!);
  try {
    document.getElementById('trigger')!.focus();
    await act(async () => root.render(createElement(Modal, { title: '设置', close: () => { settingsClosed++; },
      children: createElement(Modal, { title: '添加供应商', close: () => { editorClosed++; }, children: createElement('input', { 'aria-label': '名称' }) }),
    })));
    const child = document.querySelector('dialog[aria-label="添加供应商"]')!;
    const cancelled = new dom.window.Event('cancel', { cancelable: true });
    await act(async () => { child.dispatchEvent(cancelled); });
    assert.equal(cancelled.defaultPrevented, true);
    assert.equal(editorClosed, 1);
    assert.equal(settingsClosed, 0, 'the parent ignores a child dialog cancel event');
    const parent = document.querySelector('dialog[aria-label="设置"]')!;
    await act(async () => { parent.dispatchEvent(new dom.window.Event('cancel', { cancelable: true })); });
    assert.equal(settingsClosed, 1, 'the settings dialog still handles its own Escape/cancel');
  } finally {
    await act(async () => root.unmount());
    names.forEach((name, index) => { const descriptor = descriptors[index]; if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
    dom.window.close();
  }
});

test('an anchored draft ignores clicks and Escape while settings is above it', async () => {
  const dom = new JSDOM('<button id="trigger">新增</button><div id="root"></div>', { pretendToBeVisual: true });
  const names = ['window', 'document', 'HTMLElement', 'Node', 'navigator', 'ResizeObserver', 'React', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const descriptors = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  class Observer { observe() {} disconnect() {} }
  names.forEach(name => Object.defineProperty(globalThis, name, { configurable: true,
    value: name === 'IS_REACT_ACT_ENVIRONMENT' ? true : name === 'React' ? React : name === 'ResizeObserver' ? Observer : name === 'window' ? dom.window : dom.window[name] }));
  Object.assign(dom.window.HTMLDialogElement.prototype, {
    showModal() { this.setAttribute('open', ''); }, close() { this.removeAttribute('open'); },
    showPopover() {}, hidePopover() {}, matches(selector: string) { return selector === ':popover-open'; },
  });
  const root = createRoot(document.getElementById('root')!);
  let closed = 0;
  try {
    await act(async () => root.render(createElement(Modal, { title: '新增事项', anchor: document.getElementById('trigger'), dirty: true,
      close: () => { closed++; }, children: createElement('input', { defaultValue: '未保存草稿' }),
    })));
    const settings = document.createElement('dialog'); settings.showModal();
    const choice = document.createElement('button'); settings.append(choice); document.body.append(settings);
    await act(async () => { choice.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true })); });
    assert.equal(document.querySelector<HTMLDialogElement>('.confirm')!.open, false, 'appearance click must not ask to discard the underlying draft');
    const escape = new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    await act(async () => { choice.dispatchEvent(escape); });
    assert.equal(escape.defaultPrevented, false, 'the upper settings dialog owns Escape');
    assert.equal(document.querySelector<HTMLInputElement>('.modal input')!.value, '未保存草稿');
    assert.equal(closed, 0);
    settings.close(); settings.remove();
    await act(async () => { document.body.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true })); });
    assert.equal(document.querySelector<HTMLDialogElement>('.confirm')!.open, true, 'outside click still protects the draft once settings closes');
  } finally {
    await act(async () => root.unmount());
    names.forEach((name, index) => { const descriptor = descriptors[index]; if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
    dom.window.close();
  }
});
