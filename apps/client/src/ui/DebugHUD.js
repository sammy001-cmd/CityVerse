// ============================================================
// CITYVERSE — DEBUG HUD
// ============================================================

export class DebugHUD {
  constructor() {
    this.element = document.createElement('div');

    this.element.style.cssText = [
      'position:fixed',
      'top:10px',
      'left:10px',
      'z-index:1000',
      'font:12px/1.4 monospace',
      'color:#fff',
      'background:rgba(0,0,0,.45)',
      'padding:8px 10px',
      'border-radius:6px',
      'pointer-events:none',
      'white-space:pre'
    ].join(';');

    document.body.appendChild(this.element);
  }

  setText(text) {
    this.element.textContent = text;
  }

  show() {
    this.element.style.display = 'block';
  }

  hide() {
    this.element.style.display = 'none';
  }

  destroy() {
    this.element.remove();
  }
}