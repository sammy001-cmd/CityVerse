// ============================================================
// CITYVERSE — INPUT MANAGER
// Owns raw browser input only.
// Gameplay decisions remain outside this class.
// ============================================================

export class InputManager {
  constructor(
    element,
    {
      onKeyDown = null,
      onKeyUp = null,
      onMouseMove = null,
      onWheel = null
    } = {}
  ) {
    this.element = element;
    this.keys = Object.create(null);

    this.onKeyDown = onKeyDown;
    this.onKeyUp = onKeyUp;
    this.onMouseMove = onMouseMove;
    this.onWheel = onWheel;

    this.handleKeyDown = (event) => {
      this.keys[event.code] = true;
      this.onKeyDown?.(event);
    };

    this.handleKeyUp = (event) => {
      this.keys[event.code] = false;
      this.onKeyUp?.(event);
    };

    this.handleClick = () => {
      if (
        document.pointerLockElement !==
        this.element
      ) {
        this.element.requestPointerLock();
      }
    };

    this.handleMouseMove = (event) => {
      if (
        document.pointerLockElement !==
        this.element
      ) {
        return;
      }

      this.onMouseMove?.(event);
    };

    this.handleWheel = (event) => {
      this.onWheel?.(event);
    };

    window.addEventListener(
      'keydown',
      this.handleKeyDown
    );

    window.addEventListener(
      'keyup',
      this.handleKeyUp
    );

    window.addEventListener(
      'mousemove',
      this.handleMouseMove
    );

    window.addEventListener(
      'wheel',
      this.handleWheel
    );

    this.element.addEventListener(
      'click',
      this.handleClick
    );
  }

  isDown(code) {
    return Boolean(this.keys[code]);
  }

  destroy() {
    window.removeEventListener(
      'keydown',
      this.handleKeyDown
    );

    window.removeEventListener(
      'keyup',
      this.handleKeyUp
    );

    window.removeEventListener(
      'mousemove',
      this.handleMouseMove
    );

    window.removeEventListener(
      'wheel',
      this.handleWheel
    );

    this.element.removeEventListener(
      'click',
      this.handleClick
    );

    this.keys = Object.create(null);
  }
}