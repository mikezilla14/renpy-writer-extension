import * as vscode from 'vscode';
import { computeFoldingRanges } from './core/folding';
import { parseRpy } from './core/parser';
import { analyzeSaveSafety } from './core/saveSafety';
import { WorkspaceIndex } from './workspaceIndex';

const SELECTOR: vscode.DocumentSelector = [
  { language: 'renpy' },
  { pattern: '**/*.rpy' },
  { pattern: '**/*.rpym' },
];

function isRenpyDoc(doc: vscode.TextDocument): boolean {
  return (
    doc.languageId === 'renpy' || doc.fileName.endsWith('.rpy') || doc.fileName.endsWith('.rpym')
  );
}

class RenpyFoldingProvider implements vscode.FoldingRangeProvider {
  private cache = new Map<string, { version: number; ranges: vscode.FoldingRange[] }>();

  provideFoldingRanges(document: vscode.TextDocument): vscode.FoldingRange[] {
    const key = document.uri.toString();
    const hit = this.cache.get(key);
    if (hit && hit.version === document.version) return hit.ranges;
    const model = parseRpy(document.uri.fsPath, document.getText());
    const ranges = computeFoldingRanges(model).map(
      (r) =>
        new vscode.FoldingRange(r.start, r.end, r.region ? vscode.FoldingRangeKind.Region : undefined)
    );
    this.cache.set(key, { version: document.version, ranges });
    return ranges;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const index = new WorkspaceIndex();
  const diagnostics = vscode.languages.createDiagnosticCollection('renpy-analytics');
  context.subscriptions.push(diagnostics);

  context.subscriptions.push(
    vscode.languages.registerFoldingRangeProvider(SELECTOR, new RenpyFoldingProvider())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('renpy-analytics.foldAllLabels', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isRenpyDoc(editor.document)) return;
      const model = parseRpy(editor.document.uri.fsPath, editor.document.getText());
      const lines = model.labels.map((l) => l.headerLine);
      if (lines.length) {
        await vscode.commands.executeCommand('editor.fold', { levels: 1, selectionLines: lines });
      }
    })
  );

  const refresh = async (): Promise<number> => {
    const enabled = vscode.workspace
      .getConfiguration('renpy-analytics')
      .get<boolean>('saveSafety.enabled', true);
    if (!enabled) {
      diagnostics.clear();
      return 0;
    }
    const models = await index.getModels();
    const findings = analyzeSaveSafety(models);
    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const f of findings) {
      const range = new vscode.Range(f.line, 0, f.line, 1000);
      const d = new vscode.Diagnostic(
        range,
        f.message,
        f.severity === 'warning'
          ? vscode.DiagnosticSeverity.Warning
          : vscode.DiagnosticSeverity.Information
      );
      d.source = 'renpy-analytics';
      d.code = f.rule;
      if (f.related) {
        d.relatedInformation = [
          new vscode.DiagnosticRelatedInformation(
            new vscode.Location(vscode.Uri.file(f.related.file), new vscode.Position(f.related.line, 0)),
            f.related.message
          ),
        ];
      }
      const arr = byFile.get(f.file) ?? [];
      arr.push(d);
      byFile.set(f.file, arr);
    }
    diagnostics.clear();
    for (const [file, ds] of byFile) diagnostics.set(vscode.Uri.file(file), ds);
    return findings.length;
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const scheduleRefresh = (doc?: vscode.TextDocument): void => {
    if (doc) {
      if (!isRenpyDoc(doc)) return;
      index.overrideDocument(doc);
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void refresh();
    }, 700);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('renpy-analytics.analyzeSaveSafety', async () => {
      const count = await refresh();
      void vscode.window.showInformationMessage(
        count === 0
          ? 'Ren\'Py Analytics: no save-file safety risks found.'
          : `Ren'Py Analytics: ${count} save-file safety finding${count === 1 ? '' : 's'} — see the Problems panel.`
      );
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => scheduleRefresh(e.document)),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (isRenpyDoc(doc)) {
        index.clearOverride(doc);
        scheduleRefresh();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('renpy-analytics')) scheduleRefresh();
    })
  );

  scheduleRefresh();
}

export function deactivate(): void {}
