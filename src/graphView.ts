// Interactive story flow graph webview: layered left-to-right layout with
// pan/zoom and click-to-open-source. Layout is computed extension-side; the
// webview is a static SVG plus a small pan/zoom/click script.

import * as vscode from 'vscode';
import { FlowGraph, VisNode } from './core/flowGraph';

interface Placed extends VisNode {
  x: number;
  y: number;
  w: number;
  h: number;
}

const COL_WIDTH = 260;
const ROW_HEIGHT = 64;
const NODE_W = 190;
const NODE_H = 36;
const CHOICE_W = 170;
const CHOICE_H = 28;

function layout(graph: FlowGraph): Placed[] {
  // BFS depth from entry nodes; unreachable/unvisited nodes go in a trailing column
  const adj = new Map<string, string[]>();
  for (const e of graph.edges) {
    const arr = adj.get(e.from) ?? [];
    arr.push(e.to);
    adj.set(e.from, arr);
  }
  // Roots: entry labels plus anything nothing points at (covers file-scoped
  // graphs where the project entry points live in other files).
  const hasIncoming = new Set(graph.edges.map((e) => e.to));
  const depth = new Map<string, number>();
  const queue: string[] = [];
  for (const n of graph.nodes) {
    if (n.entry || !hasIncoming.has(n.id)) {
      depth.set(n.id, 0);
      queue.push(n.id);
    }
  }
  while (queue.length) {
    const cur = queue.shift()!;
    const d = depth.get(cur)!;
    for (const to of adj.get(cur) ?? []) {
      if (!depth.has(to)) {
        depth.set(to, d + 1);
        queue.push(to);
      }
    }
  }
  let maxDepth = 0;
  for (const d of depth.values()) maxDepth = Math.max(maxDepth, d);
  const orphanCol = maxDepth + 1;

  const columns = new Map<number, VisNode[]>();
  for (const n of graph.nodes) {
    const col = depth.get(n.id) ?? orphanCol;
    const arr = columns.get(col) ?? [];
    arr.push(n);
    columns.set(col, arr);
  }

  const placed: Placed[] = [];
  for (const [col, nodes] of columns) {
    nodes.sort((a, b) =>
      (a.file ?? '') === (b.file ?? '')
        ? (a.line ?? 0) - (b.line ?? 0)
        : (a.file ?? '') < (b.file ?? '')
          ? -1
          : 1
    );
    nodes.forEach((n, i) => {
      const w = n.kind === 'choice' ? CHOICE_W : NODE_W;
      const h = n.kind === 'choice' ? CHOICE_H : NODE_H;
      placed.push({ ...n, x: col * COL_WIDTH, y: i * ROW_HEIGHT, w, h });
    });
  }
  return placed;
}

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderSvg(graph: FlowGraph): string {
  const placed = layout(graph);
  const byId = new Map(placed.map((p) => [p.id, p]));
  const width = Math.max(...placed.map((p) => p.x + p.w), 400) + 60;
  const height = Math.max(...placed.map((p) => p.y + p.h), 300) + 60;

  const parts: string[] = [];
  for (const e of graph.edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) continue;
    const x1 = a.x + a.w;
    const y1 = a.y + a.h / 2;
    const x2 = b.x;
    const y2 = b.y + b.h / 2;
    const mid = (x1 + x2) / 2;
    const cls = `edge edge-${e.kind}`;
    parts.push(
      `<path class="${cls}" d="M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}" marker-end="url(#arrow)"/>`
    );
  }
  for (const p of placed) {
    const cls = [
      'node',
      `node-${p.kind}`,
      p.external ? 'node-external' : '',
      !p.external && p.entry ? 'node-entry' : '',
      !p.external && !p.reachable ? 'node-unreachable' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const clickable = p.file !== undefined ? ` data-file="${escXml(p.file)}" data-line="${p.line ?? 0}"` : '';
    const maxChars = p.kind === 'choice' ? 26 : 24;
    const text = p.title.length > maxChars ? p.title.slice(0, maxChars - 1) + '…' : p.title;
    parts.push(
      `<g class="${cls}"${clickable}>` +
        `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="${p.kind === 'choice' ? 12 : 6}"/>` +
        `<text x="${p.x + p.w / 2}" y="${p.y + p.h / 2 + 4}" text-anchor="middle">${escXml(text)}</text>` +
        `<title>${escXml(p.title)}${p.file ? `\n${escXml(p.file)}:${(p.line ?? 0) + 1}` : ''}</title>` +
        `</g>`
    );
  }

  return (
    `<svg id="canvas" width="100%" height="100%" data-width="${width}" data-height="${height}">` +
    `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
    `<path d="M 0 0 L 10 5 L 0 10 z" class="arrowhead"/></marker></defs>` +
    `<g id="viewport">${parts.join('')}</g></svg>`
  );
}

export function showFlowGraphPanel(graph: FlowGraph, title = "Ren'Py Story Flow"): void {
  const panel = vscode.window.createWebviewPanel(
    'renpyAnalytics.flowGraph',
    title,
    vscode.ViewColumn.Beside,
    { enableScripts: true }
  );
  const nonce = Math.random().toString(36).slice(2);
  panel.webview.html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  html, body { height: 100%; margin: 0; overflow: hidden; }
  #hint { position: fixed; top: 6px; left: 10px; font-family: var(--vscode-font-family); font-size: 11px; opacity: 0.7; z-index: 10; }
  svg { cursor: grab; }
  svg.dragging { cursor: grabbing; }
  .node rect { fill: var(--vscode-editorWidget-background); stroke: var(--vscode-editorWidget-border, #888); }
  .node text { fill: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: 12px; pointer-events: none; }
  .node[data-file] { cursor: pointer; }
  .node[data-file]:hover rect { stroke: var(--vscode-focusBorder); stroke-width: 2; }
  .node-choice rect { stroke-dasharray: none; opacity: 0.85; }
  .node-choice text { font-style: italic; font-size: 10px; opacity: 0.9; }
  .node-entry rect { stroke: var(--vscode-testing-iconPassed, #2ea043); stroke-width: 2.5; }
  .node-unreachable rect { stroke: var(--vscode-errorForeground, #f14c4c); stroke-width: 2; }
  .node-unreachable text { fill: var(--vscode-errorForeground, #f14c4c); }
  .node-dynamic rect { stroke-dasharray: 4 3; }
  .node-external rect { stroke-dasharray: 4 3; opacity: 0.55; }
  .node-external text { opacity: 0.6; font-style: italic; }
  .edge { fill: none; stroke: var(--vscode-editorWidget-border, #888); stroke-width: 1.3; }
  .edge-fallthrough { stroke-dasharray: 5 4; opacity: 0.6; }
  .edge-call { stroke-dasharray: 2 3; }
  .edge-choice { opacity: 0.5; }
  .arrowhead { fill: var(--vscode-editorWidget-border, #888); }
</style>
</head>
<body>
<div id="hint">drag to pan · scroll to zoom · click a node to open it</div>
${renderSvg(graph)}
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const svg = document.getElementById('canvas');
  const vp = document.getElementById('viewport');
  let scale = 1, tx = 24, ty = 24;
  const apply = () => vp.setAttribute('transform', 'translate(' + tx + ',' + ty + ') scale(' + scale + ')');
  apply();
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const f = e.deltaY < 0 ? 1.12 : 0.89;
    scale = Math.min(3, Math.max(0.1, scale * f));
    apply();
  }, { passive: false });
  let dragging = false, lx = 0, ly = 0, moved = false;
  svg.addEventListener('mousedown', (e) => { dragging = true; moved = false; lx = e.clientX; ly = e.clientY; svg.classList.add('dragging'); });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    tx += e.clientX - lx; ty += e.clientY - ly;
    if (Math.abs(e.clientX - lx) + Math.abs(e.clientY - ly) > 2) moved = true;
    lx = e.clientX; ly = e.clientY;
    apply();
  });
  window.addEventListener('mouseup', () => { dragging = false; svg.classList.remove('dragging'); });
  for (const node of document.querySelectorAll('.node[data-file]')) {
    node.addEventListener('click', () => {
      if (moved) return;
      vscode.postMessage({ file: node.getAttribute('data-file'), line: Number(node.getAttribute('data-line')) });
    });
  }
</script>
</body>
</html>`;

  panel.webview.onDidReceiveMessage(async (msg: { file: string; line: number }) => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(msg.file));
    await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.One,
      selection: new vscode.Range(msg.line, 0, msg.line, 0),
    });
  });
}
