const MIN_ZOOM = 0.2;
const MAX_ZOOM = 8;

export class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.zoom = 1;
  }

  worldToScreen(x, y) {
    return {
      x: (x - this.x) * this.zoom,
      y: (y - this.y) * this.zoom,
    };
  }

  screenToWorld(x, y) {
    return {
      x: x / this.zoom + this.x,
      y: y / this.zoom + this.y,
    };
  }

  pan(screenDx, screenDy) {
    this.x -= screenDx / this.zoom;
    this.y -= screenDy / this.zoom;
  }

  zoomAt(factor, screenX, screenY) {
    const before = this.screenToWorld(screenX, screenY);
    const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));

    if (nextZoom === this.zoom) return;

    this.zoom = nextZoom;

    const after = this.screenToWorld(screenX, screenY);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
  }

  reset(viewWidth, viewHeight) {
    this.zoom = 1;
    this.x = -viewWidth / 2;
    this.y = -viewHeight / 2;
  }

  snapshot() {
    return { x: this.x, y: this.y, zoom: this.zoom };
  }

  restore(state) {
    if (!state) return;
    this.x = state.x;
    this.y = state.y;
    this.zoom = state.zoom;
  }
}
