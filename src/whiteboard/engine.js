import { Camera } from './camera.js';
import { InputController } from './input.js';

// Performance-critical layer.
// Rendering and pointer processing are intentionally imperative and independent
// from React's render cycle. Persistent geometry is stored in world coordinates.

const DEFAULT_BACKGROUND = '#335';
const DEFAULT_COLOUR = '#ddd';
const MIN_TOOL_SIZE = 1;
const MAX_TOOL_SIZE = 48;

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  const x = ax + t * dx;
  const y = ay + t * dy;
  return Math.hypot(px - x, py - y);
}

function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects = ((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function lerpPoint(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    pressure: a.pressure + (b.pressure - a.pressure) * t,
  };
}

function clonePoint(point) {
  return { x: point.x, y: point.y, pressure: point.pressure };
}

export class WhiteboardEngine {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.camera = new Camera();
    this.pages = [{ strokes: [], camera: null }];
    this.pageIndex = 0;
    this.tool = 'pen';
    this.colour = DEFAULT_COLOUR;
    this.toolSize = 4;
    this.eraserMode = 'lasso';
    this.activeStroke = null;
    this.activeEraseBefore = null;
    this.activeEraseChanged = false;
    this.activeLasso = null;
    this.pointerPreview = null;
    this.undoStack = [];
    this.redoStack = [];
    this.framePending = false;
    this.destroyed = false;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);

    this.input = new InputController(canvas, {
      onDrawStart: (point) => this.handleDrawStart(point),
      onDrawMove: (point, event) => this.handleDrawMove(point, event),
      onDrawEnd: (point, event) => this.handleDrawEnd(point, event),
      onDrawCancel: () => this.handleDrawCancel(),
      onPan: (dx, dy) => this.pan(dx, dy),
      onZoom: (factor, x, y) => this.zoom(factor, x, y),
      onPointerPosition: (point) => this.updatePointerPreview(point),
      onPointerLeave: () => this.clearPointerPreview(),
    });

    this.resize();
    if (!this.currentPage.camera) {
      this.camera.reset(this.cssWidth, this.cssHeight);
      this.saveCurrentCamera();
    }
    this.queueRender();

    options.onPageChange?.(this.getPageInfo());
  }

  destroy() {
    this.destroyed = true;
    this.input.destroy();
    this.resizeObserver.disconnect();
  }

  get currentPage() {
    return this.pages[this.pageIndex];
  }

  getPageInfo() {
    return { current: this.pageIndex + 1, total: this.pages.length };
  }

  subscribe(listener) {
    this.onPageChange = listener;
    return () => {
      if (this.onPageChange === listener) this.onPageChange = null;
    };
  }

  notifyPageChange() {
    this.onPageChange?.(this.getPageInfo());
  }

  setTool(tool) {
    this.tool = tool;
    if (tool !== 'eraser') {
      this.activeLasso = null;
      this.activeEraseBefore = null;
      this.activeEraseChanged = false;
    }
    this.queueRender();
  }

  setColour(colour) {
    this.colour = colour;
  }

  setToolSize(size) {
    this.toolSize = Math.min(MAX_TOOL_SIZE, Math.max(MIN_TOOL_SIZE, Number(size) || 1));
    this.queueRender();
  }

  setEraserMode(mode) {
    this.eraserMode = mode === 'area' ? 'area' : 'lasso';
    this.activeLasso = null;
    this.activeEraseBefore = null;
    this.activeEraseChanged = false;
    this.queueRender();
  }

  resetView() {
    this.camera.reset(this.cssWidth, this.cssHeight);
    this.saveCurrentCamera();
    this.queueRender();
  }

  pan(screenDx, screenDy) {
    this.camera.pan(screenDx, screenDy);
    this.saveCurrentCamera();
    this.queueRender();
  }

  zoom(factor, x, y) {
    this.camera.zoomAt(factor, x, y);
    this.saveCurrentCamera();
    this.queueRender();
  }

  saveCurrentCamera() {
    this.currentPage.camera = this.camera.snapshot();
  }

  restorePageCamera(page) {
    if (page.camera) {
      this.camera.restore(page.camera);
      return;
    }
    this.camera.reset(this.cssWidth, this.cssHeight);
    page.camera = this.camera.snapshot();
  }

  nextPage() {
    if (this.pageIndex >= this.pages.length - 1) return;
    this.saveCurrentCamera();
    this.pageIndex += 1;
    this.activeStroke = null;
    this.activeLasso = null;
    this.activeEraseBefore = null;
    this.activeEraseChanged = false;
    this.restorePageCamera(this.currentPage);
    this.notifyPageChange();
    this.queueRender();
  }

  previousPage() {
    if (this.pageIndex <= 0) return;
    this.saveCurrentCamera();
    this.pageIndex -= 1;
    this.activeStroke = null;
    this.activeLasso = null;
    this.activeEraseBefore = null;
    this.activeEraseChanged = false;
    this.restorePageCamera(this.currentPage);
    this.notifyPageChange();
    this.queueRender();
  }

  addPage() {
    this.saveCurrentCamera();
    this.pages.push({ strokes: [], camera: { x: -this.cssWidth / 2, y: -this.cssHeight / 2, zoom: 1 } });
    this.pageIndex = this.pages.length - 1;
    this.activeStroke = null;
    this.activeLasso = null;
    this.activeEraseBefore = null;
    this.activeEraseChanged = false;
    this.restorePageCamera(this.currentPage);
    this.undoStack = [];
    this.redoStack = [];
    this.notifyPageChange();
    this.queueRender();
  }

  handleDrawStart(screenPoint) {
    if (this.tool === 'select') return;

    const world = this.camera.screenToWorld(screenPoint.x, screenPoint.y);

    if (this.tool === 'eraser') {
      if (this.eraserMode === 'lasso') {
        this.activeLasso = [world];
        this.queueRender();
        return;
      }

      this.activeEraseBefore = this.cloneStrokes(this.currentPage.strokes);
      this.activeEraseChanged = false;
      this.eraseAt(world.x, world.y);
      return;
    }

    this.activeStroke = {
      tool: this.tool,
      colour: this.colour,
      size: this.toolSize,
      points: [{ x: world.x, y: world.y, pressure: screenPoint.pressure }],
    };
    this.queueRender();
  }

  handleDrawMove(screenPoint) {
    const world = this.camera.screenToWorld(screenPoint.x, screenPoint.y);

    if (this.tool === 'eraser' && this.eraserMode === 'lasso' && this.activeLasso) {
      const last = this.activeLasso[this.activeLasso.length - 1];
      if (!last || Math.hypot(world.x - last.x, world.y - last.y) >= 2) {
        this.activeLasso.push(world);
        this.queueRender();
      }
      return;
    }

    if (!this.activeStroke) {
      if (this.tool === 'eraser' && this.eraserMode === 'area') {
        this.eraseAt(world.x, world.y);
      }
      return;
    }

    const last = this.activeStroke.points[this.activeStroke.points.length - 1];
    if (last && Math.hypot(world.x - last.x, world.y - last.y) < 0.2) return;

    this.activeStroke.points.push({ x: world.x, y: world.y, pressure: screenPoint.pressure });
    this.queueRender();
  }

  handleDrawEnd() {
    if (this.tool === 'eraser' && this.eraserMode === 'lasso') {
      if (this.activeLasso?.length >= 3) {
        const before = this.cloneStrokes(this.currentPage.strokes);
        const changed = this.eraseInsideLasso(this.activeLasso);
        if (changed) {
          this.undoStack.push({
            type: 'replace-strokes',
            pageIndex: this.pageIndex,
            before,
            after: this.cloneStrokes(this.currentPage.strokes),
          });
          this.redoStack = [];
        }
      }
      this.activeLasso = null;
      this.queueRender();
      return;
    }

    if (this.tool === 'eraser' && this.eraserMode === 'area') {
      if (this.activeEraseBefore && this.activeEraseChanged) {
        this.undoStack.push({
          type: 'replace-strokes',
          pageIndex: this.pageIndex,
          before: this.activeEraseBefore,
          after: this.cloneStrokes(this.currentPage.strokes),
        });
        this.redoStack = [];
      }
      this.activeEraseBefore = null;
      this.activeEraseChanged = false;
      this.queueRender();
      return;
    }

    if (!this.activeStroke) return;

    if (this.activeStroke.points.length > 0) {
      this.currentPage.strokes.push(this.activeStroke);
      this.undoStack.push({ type: 'add-stroke', pageIndex: this.pageIndex, stroke: this.activeStroke });
      this.redoStack = [];
    }

    this.activeStroke = null;
    this.queueRender();
  }

  handleDrawCancel() {
    this.activeStroke = null;
    this.activeLasso = null;
    this.activeEraseBefore = null;
    this.activeEraseChanged = false;
    this.queueRender();
  }

  updatePointerPreview(screenPoint) {
    this.pointerPreview = { x: screenPoint.x, y: screenPoint.y };
    this.queueRender();
  }

  clearPointerPreview() {
    this.pointerPreview = null;
    this.queueRender();
  }

  eraseAt(x, y) {
    const radius = this.toolSize / 2;
    const strokes = this.currentPage.strokes;
    let changed = false;

    for (let index = strokes.length - 1; index >= 0; index -= 1) {
      const stroke = strokes[index];
      if (stroke.points.length < 2) {
        if (Math.hypot(stroke.points[0].x - x, stroke.points[0].y - y) <= radius) {
          strokes.splice(index, 1);
          changed = true;
        }
        continue;
      }

      const keeps = [];
      let current = [];
      let removed = false;

      for (let pointIndex = 1; pointIndex < stroke.points.length; pointIndex += 1) {
        const a = stroke.points[pointIndex - 1];
        const b = stroke.points[pointIndex];
        const hit = distanceToSegment(x, y, a.x, a.y, b.x, b.y) <= radius + stroke.size / 2;

        if (pointIndex === 1 && !hit) current.push(a);

        if (hit) {
          removed = true;
          if (current.length > 1) keeps.push(current);
          current = [];
        } else {
          current.push(b);
        }
      }

      if (current.length > 1) keeps.push(current);

      if (!removed) continue;

      strokes.splice(index, 1, ...keeps.map((points) => ({ ...stroke, points })));
      changed = true;
    }

    if (changed) {
      this.activeEraseChanged = true;
      this.queueRender();
    }
  }

  eraseInsideLasso(polygon) {
    const strokes = this.currentPage.strokes;
    let changed = false;
    const nextStrokes = [];

    for (const stroke of strokes) {
      if (stroke.points.length === 1) {
        if (!pointInPolygon(stroke.points[0].x, stroke.points[0].y, polygon)) {
          nextStrokes.push(stroke);
        } else {
          changed = true;
        }
        continue;
      }

      const pieces = [];
      let current = [];
      let previous = stroke.points[0];
      let previousInside = pointInPolygon(previous.x, previous.y, polygon);
      let strokeChanged = previousInside;

      if (!previousInside) current.push(clonePoint(previous));

      for (let index = 1; index < stroke.points.length; index += 1) {
        const point = stroke.points[index];
        const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
        const steps = Math.max(1, Math.ceil(distance / 4));

        for (let step = 1; step <= steps; step += 1) {
          const t = step / steps;
          const sample = lerpPoint(previous, point, t);
          const inside = pointInPolygon(sample.x, sample.y, polygon);

          if (!inside && previousInside) {
            strokeChanged = true;
            let low = Math.max(0, (step - 1) / steps);
            let high = t;
            for (let iteration = 0; iteration < 8; iteration += 1) {
              const mid = (low + high) / 2;
              const candidate = lerpPoint(previous, point, mid);
              if (pointInPolygon(candidate.x, candidate.y, polygon)) low = mid;
              else high = mid;
            }
            current.push(lerpPoint(previous, point, high));
          }

          if (inside && !previousInside) {
            strokeChanged = true;
            let low = Math.max(0, (step - 1) / steps);
            let high = t;
            for (let iteration = 0; iteration < 8; iteration += 1) {
              const mid = (low + high) / 2;
              const candidate = lerpPoint(previous, point, mid);
              if (pointInPolygon(candidate.x, candidate.y, polygon)) high = mid;
              else low = mid;
            }
            current.push(lerpPoint(previous, point, high));
            if (current.length > 1) pieces.push(current);
            current = [];
          }

          if (!inside) current.push(sample);
          previousInside = inside;
        }

        previous = point;
      }

      if (current.length > 1) pieces.push(current);

      if (!strokeChanged) {
        nextStrokes.push(stroke);
      } else {
        changed = true;
        for (const points of pieces) {
          if (points.length > 1) nextStrokes.push({ ...stroke, points });
        }
      }
    }

    this.currentPage.strokes = nextStrokes;
    if (changed) this.queueRender();
    return changed;
  }

  cloneStrokes(strokes) {
    return strokes.map((stroke) => ({
      ...stroke,
      points: stroke.points.map((point) => ({ ...point })),
    }));
  }

  undo() {
    const operation = this.undoStack.pop();
    if (!operation) return;

    if (operation.type === 'add-stroke') {
      const page = this.pages[operation.pageIndex];
      const index = page.strokes.lastIndexOf(operation.stroke);
      if (index >= 0) page.strokes.splice(index, 1);
    } else if (operation.type === 'replace-strokes') {
      this.pages[operation.pageIndex].strokes = this.cloneStrokes(operation.before);
    }

    this.redoStack.push(operation);
    this.queueRender();
  }

  redo() {
    const operation = this.redoStack.pop();
    if (!operation) return;

    if (operation.type === 'add-stroke') {
      this.pages[operation.pageIndex].strokes.push(operation.stroke);
    } else if (operation.type === 'replace-strokes') {
      this.pages[operation.pageIndex].strokes = this.cloneStrokes(operation.after);
    }

    this.undoStack.push(operation);
    this.queueRender();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.cssWidth = Math.max(1, rect.width);
    this.cssHeight = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.cssWidth * dpr);
    this.canvas.height = Math.round(this.cssHeight * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.queueRender();
  }

  queueRender() {
    if (this.framePending || this.destroyed) return;
    this.framePending = true;
    requestAnimationFrame(() => {
      this.framePending = false;
      if (!this.destroyed) this.render();
    });
  }

  render() {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = DEFAULT_BACKGROUND;
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
    ctx.translate(-this.camera.x * this.camera.zoom, -this.camera.y * this.camera.zoom);
    ctx.scale(this.camera.zoom, this.camera.zoom);

    for (const stroke of this.currentPage.strokes) this.renderStroke(ctx, stroke);
    if (this.activeStroke) this.renderStroke(ctx, this.activeStroke);

    if (this.activeLasso?.length >= 2) {
      this.renderLasso(ctx, this.activeLasso);
    }

    ctx.restore();

    this.renderEraserPreview(ctx, dpr);
  }

  renderStroke(ctx, stroke) {
    const { points } = stroke;
    if (!points.length) return;

    ctx.save();
    ctx.strokeStyle = stroke.colour;
    ctx.lineWidth = stroke.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = stroke.tool === 'pencil' ? 0.95 : 1;
    ctx.setLineDash(stroke.tool === 'pencil' ? [stroke.size * 2.5, stroke.size * 1.8] : []);

    if (points.length === 1) {
      ctx.fillStyle = stroke.colour;
      const radius = stroke.size / 2;
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    for (let index = 1; index < points.length; index += 1) {
      const point = points[index];
      const previous = points[index - 1];
      const midX = (previous.x + point.x) / 2;
      const midY = (previous.y + point.y) / 2;
      ctx.quadraticCurveTo(previous.x, previous.y, midX, midY);
    }

    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
    ctx.restore();
  }

  renderLasso(ctx, points) {
    ctx.save();
    ctx.strokeStyle = 'rgba(221, 221, 255, 0.9)';
    ctx.fillStyle = 'rgba(221, 221, 255, 0.10)';
    ctx.lineWidth = 1.5 / this.camera.zoom;
    ctx.setLineDash([7 / this.camera.zoom, 6 / this.camera.zoom]);
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      ctx.lineTo(points[index].x, points[index].y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  renderEraserPreview(ctx, dpr) {
    if (this.tool !== 'eraser' || !this.pointerPreview || this.eraserMode !== 'area') return;

    const radius = this.toolSize / 2;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.82)';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(this.pointerPreview.x, this.pointerPreview.y, radius * this.camera.zoom, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
