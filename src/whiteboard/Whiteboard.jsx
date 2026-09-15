import { useEffect, useRef, useState } from 'react';
import { WhiteboardEngine } from './engine.js';

// React integration layer only. The imperative whiteboard engine owns
// pointer processing and canvas rendering outside React's render cycle.

const COLORS = [
  { name: 'Red', value: '#f55' },
  { name: 'Yellow', value: '#ff5' },
  { name: 'Green', value: '#5f5' },
  { name: 'Blue', value: '#55f' },
  { name: 'White', value: '#ddd' },
];

function Icon({ name }) {
  const common = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', xmlns: 'http://www.w3.org/2000/svg', 'aria-hidden': true };
  const stroke = { stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };

  const paths = {
    pen: <path {...stroke} d="M5 19.5 15.6 8.9m0 0 1.9-1.9a1.8 1.8 0 0 1 2.5 0l.9.9a1.8 1.8 0 0 1 0 2.5L19 12.3m-3.4-3.4L18.2 11m-9.8 5.8-3.1 2.8 4.2-.8 2.8-3.1" />,
    pencil: <path {...stroke} d="m5 17 1.2 2.2L8.4 20 19 9.4a1.8 1.8 0 0 0 0-2.5l-.9-.9a1.8 1.8 0 0 0-2.5 0L5 16.6V17Zm10.6-9.6 2.5 2.5M7.6 16.6l2 2" />,
    eraser: <path {...stroke} d="m8.8 19.2 9.5-9.5a1.9 1.9 0 0 0 0-2.7L16.9 5.6a1.9 1.9 0 0 0-2.7 0l-9.5 9.5a1.9 1.9 0 0 0 0 2.7l1.4 1.4h2.7Zm3.3-6.1 3.8 3.8M12 19h7" />,
    undo: <path {...stroke} d="M9 8 4 12l5 4M4 12h9a5 5 0 1 1 0 10" />,
    redo: <path {...stroke} d="m15 8 5 4-5 4m5-4h-9a5 5 0 1 0 0 10" />,
    select: <path {...stroke} d="M5 3.5v13l3.6-3.3 2.9 6.3 2.2-1-2.9-6.2H16L5 3.5Z" />,
    previous: <path {...stroke} d="m5 14.5 7-7 7 7" />,
    next: <path {...stroke} d="m5 9.5 7 7 7-7" />,
    reset: <path {...stroke} d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />,
    fullscreen: <path {...stroke} d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />,
    more: <><circle cx="5" cy="12" r="1.3" fill="currentColor" /><circle cx="12" cy="12" r="1.3" fill="currentColor" /><circle cx="19" cy="12" r="1.3" fill="currentColor" /></>,
    plus: <path {...stroke} d="M12 5v14M5 12h14" />,
  };

  return <svg {...common}>{paths[name]}</svg>;
}

export default function Whiteboard() {
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const leftRailRef = useRef(null);
  const [tool, setTool] = useState('pen');
  const [colour, setColour] = useState('#ddd');
  const [sizeOpen, setSizeOpen] = useState(false);
  const [size, setSize] = useState(4);
  const [eraserMode, setEraserMode] = useState('lasso');
  const [pageInfo, setPageInfo] = useState({ current: 1, total: 1 });

  useEffect(() => {
    if (!canvasRef.current) return undefined;

    const engine = new WhiteboardEngine(canvasRef.current);
    engineRef.current = engine;
    const unsubscribe = engine.subscribe(setPageInfo);

    return () => {
      unsubscribe?.();
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onPointerDown = (event) => {
      if (!leftRailRef.current?.contains(event.target)) setSizeOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  const activateTool = (nextTool) => {
    const engine = engineRef.current;
    if (!engine) return;

    if (nextTool === tool && nextTool !== 'select') {
      setSizeOpen((open) => !open);
      return;
    }

    engine.setTool(nextTool);
    setTool(nextTool);
    setSizeOpen(nextTool !== 'select');
  };

  const chooseColour = (nextColour) => {
    engineRef.current?.setColour(nextColour);

    if (tool !== 'pen' && tool !== 'pencil') {
      engineRef.current?.setTool('pen');
      setTool('pen');
    }

    setColour(nextColour);
    setSizeOpen(false);
  };

  const chooseSize = (value) => {
    const nextSize = Number(value);
    engineRef.current?.setToolSize(nextSize);
    setSize(nextSize);
  };

  const chooseEraserMode = (mode) => {
    engineRef.current?.setEraserMode(mode);
    setEraserMode(mode);
  };

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen?.();
    } else {
      await document.exitFullscreen?.();
    }
  };

  return (
    <main className="lucid-app">
      <canvas ref={canvasRef} className="whiteboard-canvas" aria-label="Lucid whiteboard" />

      <aside ref={leftRailRef} className="tool-rail tool-rail-left" aria-label="Drawing tools">
        <button className={tool === 'pen' ? 'tool active' : 'tool'} onClick={() => activateTool('pen')} aria-label="Pen" title="Pen">
          <Icon name="pen" />
        </button>
        <button className={tool === 'pencil' ? 'tool active' : 'tool'} onClick={() => activateTool('pencil')} aria-label="Pencil" title="Pencil">
          <Icon name="pencil" />
        </button>
        <button className={tool === 'eraser' ? 'tool active' : 'tool'} onClick={() => activateTool('eraser')} aria-label="Eraser" title="Eraser">
          <Icon name="eraser" />
        </button>

        <div className="rail-divider" />

        <button className="tool" onClick={() => engineRef.current?.undo()} aria-label="Undo" title="Undo">
          <Icon name="undo" />
        </button>
        <button className="tool" onClick={() => engineRef.current?.redo()} aria-label="Redo" title="Redo">
          <Icon name="redo" />
        </button>

        <div className="rail-divider" />

        {COLORS.map((item) => (
          <button
            key={item.value}
            className={`colour-button${colour === item.value ? ' selected' : ''}`}
            style={{ '--swatch': item.value }}
            onClick={() => chooseColour(item.value)}
            aria-label={item.name}
            title={item.name}
          />
        ))}

        <label className={`colour-button custom${!COLORS.some((item) => item.value === colour) ? ' selected' : ''}`} aria-label="Custom colour" title="Custom colour">
          <input type="color" value={colour} onChange={(event) => chooseColour(event.target.value)} />
          <Icon name="plus" />
        </label>

        {sizeOpen && (
          <div className="size-popover">
            <label htmlFor="tool-size">Size</label>
            <input
              id="tool-size"
              type="range"
              min="1"
              max="48"
              value={size}
              onChange={(event) => chooseSize(event.target.value)}
            />
            <strong>{size}px</strong>
            {tool === 'eraser' && (
              <div className="eraser-modes">
                <button className={eraserMode === 'lasso' ? 'mode active' : 'mode'} onClick={() => chooseEraserMode('lasso')}>Lasso</button>
                <button className={eraserMode === 'area' ? 'mode active' : 'mode'} onClick={() => chooseEraserMode('area')}>Area</button>
              </div>
            )}
          </div>
        )}
      </aside>

      <aside className="tool-rail tool-rail-right" aria-label="Canvas controls">
        <button className={tool === 'select' ? 'tool active' : 'tool'} onClick={() => activateTool('select')} aria-label="Select" title="Select">
          <Icon name="select" />
        </button>

        <div className="rail-divider" />

        <button className="tool" onClick={() => engineRef.current?.previousPage()} disabled={pageInfo.current === 1} aria-label="Previous page" title="Previous page">
          <Icon name="previous" />
        </button>
        <div className="page-indicator" aria-live="polite">{pageInfo.current} / {pageInfo.total}</div>
        <button className="tool" onClick={() => engineRef.current?.nextPage()} disabled={pageInfo.current === pageInfo.total} aria-label="Next page" title="Next page">
          <Icon name="next" />
        </button>
        <button className="tool" onClick={() => engineRef.current?.addPage()} aria-label="New page" title="New page">
          <Icon name="plus" />
        </button>

        <div className="rail-divider" />

        <button className="tool" onClick={() => engineRef.current?.resetView()} aria-label="Reset view" title="Reset view">
          <Icon name="reset" />
        </button>
        <button className="tool" onClick={toggleFullscreen} aria-label="Fullscreen" title="Fullscreen">
          <Icon name="fullscreen" />
        </button>
        <button className="tool" aria-label="More tools" title="More tools">
          <Icon name="more" />
        </button>
      </aside>
    </main>
  );
}
