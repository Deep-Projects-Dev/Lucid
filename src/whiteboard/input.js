const TOUCH = 'touch';
const PEN = 'pen';
const MOUSE = 'mouse';

export class InputController {
  constructor(canvas, handlers) {
    this.canvas = canvas;
    this.handlers = handlers;
    this.pointers = new Map();
    this.drawingPointerId = null;
    this.mousePanPointerId = null;
    this.lastMousePanPoint = null;
    this.lastPanCenter = null;
    this.lastPinchDistance = null;

    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onPointerCancel = this.onPointerCancel.bind(this);
    this.onPointerLeave = this.onPointerLeave.bind(this);
    this.onWheel = this.onWheel.bind(this);
    this.onContextMenu = this.onContextMenu.bind(this);

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerCancel);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  destroy() {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerCancel);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.pointers.clear();
  }

  onPointerDown(event) {
    const point = this.pointFromEvent(event);
    this.handlers.onPointerPosition?.(point, event);

    if (event.pointerType === TOUCH) {
      event.preventDefault();
      this.pointers.set(event.pointerId, point);
      this.updateTouchGestureState();
      return;
    }

    if (event.pointerType === MOUSE && event.button === 2) {
      event.preventDefault();
      this.mousePanPointerId = event.pointerId;
      this.lastMousePanPoint = point;
      this.canvas.setPointerCapture?.(event.pointerId);
      return;
    }

    if (event.pointerType === PEN || (event.pointerType === MOUSE && event.button === 0)) {
      event.preventDefault();
      this.drawingPointerId = event.pointerId;
      this.canvas.setPointerCapture?.(event.pointerId);
      this.handlers.onDrawStart?.(point, event);
    }
  }

  onPointerMove(event) {
    const point = this.pointFromEvent(event);
    this.handlers.onPointerPosition?.(point, event);

    if (event.pointerType === TOUCH) {
      if (!this.pointers.has(event.pointerId)) return;
      event.preventDefault();
      this.pointers.set(event.pointerId, point);
      this.updateTouchGestureState();
      return;
    }

    if (event.pointerId === this.mousePanPointerId) {
      event.preventDefault();
      if (this.lastMousePanPoint) {
        this.handlers.onPan?.(point.x - this.lastMousePanPoint.x, point.y - this.lastMousePanPoint.y);
      }
      this.lastMousePanPoint = point;
      return;
    }

    if (event.pointerId !== this.drawingPointerId) return;

    event.preventDefault();
    const events = event.getCoalescedEvents?.() ?? [event];

    for (const sample of events) {
      this.handlers.onDrawMove?.(this.pointFromEvent(sample), sample);
    }
  }

  onPointerUp(event) {
    const point = this.pointFromEvent(event);
    this.handlers.onPointerPosition?.(point, event);

    if (event.pointerType === TOUCH) {
      if (!this.pointers.has(event.pointerId)) return;
      event.preventDefault();
      this.pointers.delete(event.pointerId);
      this.updateTouchGestureState(true);
      return;
    }

    if (event.pointerId === this.mousePanPointerId) {
      event.preventDefault();
      this.mousePanPointerId = null;
      this.lastMousePanPoint = null;
      this.canvas.releasePointerCapture?.(event.pointerId);
      return;
    }

    if (event.pointerId !== this.drawingPointerId) return;

    event.preventDefault();
    this.handlers.onDrawEnd?.(point, event);
    this.drawingPointerId = null;
    this.canvas.releasePointerCapture?.(event.pointerId);
  }

  onPointerCancel(event) {
    if (event.pointerType === TOUCH) {
      this.pointers.delete(event.pointerId);
      this.updateTouchGestureState(true);
      return;
    }

    if (event.pointerId === this.mousePanPointerId) {
      this.mousePanPointerId = null;
      this.lastMousePanPoint = null;
      this.canvas.releasePointerCapture?.(event.pointerId);
      return;
    }

    if (event.pointerId !== this.drawingPointerId) return;
    this.handlers.onDrawCancel?.();
    this.drawingPointerId = null;
    this.canvas.releasePointerCapture?.(event.pointerId);
  }

  onPointerLeave() {
    this.handlers.onPointerLeave?.();
  }

  onWheel(event) {
    event.preventDefault();
    const point = this.pointFromEvent(event);
    const factor = Math.exp(-event.deltaY * 0.0015);
    this.handlers.onZoom?.(factor, point.x, point.y);
    this.handlers.onPointerPosition?.(point, event);
  }

  onContextMenu(event) {
    event.preventDefault();
  }

  updateTouchGestureState(forceReset = false) {
    const touchPoints = [...this.pointers.values()];

    if (forceReset && touchPoints.length === 0) {
      this.lastPanCenter = null;
      this.lastPinchDistance = null;
      return;
    }

    if (touchPoints.length === 1) {
      const point = touchPoints[0];
      if (this.lastPanCenter) {
        this.handlers.onPan?.(point.x - this.lastPanCenter.x, point.y - this.lastPanCenter.y);
      }
      this.lastPanCenter = { ...point };
      this.lastPinchDistance = null;
      return;
    }

    if (touchPoints.length < 2) return;

    const [a, b] = touchPoints;
    const center = {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    };
    const distance = Math.hypot(a.x - b.x, a.y - b.y);

    if (this.lastPinchDistance == null) {
      this.lastPanCenter = center;
      this.lastPinchDistance = distance;
      return;
    }

    if (this.lastPanCenter) {
      this.handlers.onPan?.(center.x - this.lastPanCenter.x, center.y - this.lastPanCenter.y);
    }

    if (distance > 0) {
      this.handlers.onZoom?.(distance / this.lastPinchDistance, center.x, center.y);
    }

    this.lastPanCenter = center;
    this.lastPinchDistance = distance;
  }

  pointFromEvent(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      pressure: typeof event.pressure === 'number' && event.pressure > 0 ? event.pressure : 0.5,
    };
  }
}
