import * as vscode from 'vscode';
import { AnalysisTreeProvider } from './analysisView';
import { computeFoldingRanges } from './core/folding';
import { analyzeFlow, FlowAnalysis } from './core/graph';
import { computeMetrics } from './core/metrics';
import { parseRpy } from './core/parser';
import { buildJsonReport, buildMarkdownReport } from './core/report';
import { analyzeSaveSafety, SaveSafetyFinding } from './core/saveSafety';
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

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('renpy-analytics');
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

interface AnalysisResult {
  flow: FlowAnalysis;
  safety: SaveSafetyFinding[];
  metrics: ReturnType<typeof computeMetrics>;
}

export function activate(context: vscode.ExtensionContext): void {
  const index = new WorkspaceIndex();
  const safetyDiagnostics = vscode.languages.createDiagnosticCollection('renpy-save-safety');
  const flowDiagnostics = vscode.languages.createDiagnosticCollection('renpy-flow');
  const tree = new AnalysisTreeProvider();
  context.subscriptions.push(
    safetyDiagnostics,
    flowDiagnostics,
    vscode.window.registerTreeDataProvider('renpyAnalytics.analysis', tree),
    vscode.languages.registerFoldingRangeProvider(SELECTOR, new RenpyFoldingProvider())
  );

  const runAnalysis = async (): Promise<AnalysisResult> => {
    const models = await index.getModels();
    const extraEntryPoints = config().get<string[]>('extraEntryPoints', []);
    const flow = analyzeFlow(models, extraEntryPoints);
    const safety = config().get<boolean>('saveSafety.enabled', true)
      ? analyzeSaveSafety(models)
      : [];
    const metrics = computeMetrics(models);
    publishDiagnostics(flow, safety);
    tree.setResults(flow, metrics, safety);
    return { flow, safety, metrics };
  };

  const publishDiagnostics = (flow: FlowAnalysis, safety: SaveSafetyFinding[]): void => {
    const safetyByFile = new Map<string, vscode.Diagnostic[]>();
    for (const f of safety) {
      const d = new vscode.Diagnostic(
        new vscode.Range(f.line, 0, f.line, 1000),
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
            new vscode.Location(
              vscode.Uri.file(f.related.file),
              new vscode.Position(f.related.line, 0)
            ),
            f.related.message
          ),
        ];
      }
      const arr = safetyByFile.get(f.file) ?? [];
      arr.push(d);
      safetyByFile.set(f.file, arr);
    }
    safetyDiagnostics.clear();
    for (const [file, ds] of safetyByFile) safetyDiagnostics.set(vscode.Uri.file(file), ds);

    // Dynamic jumps make reachability undecidable; in lenient mode (or by
    // default when any exist and mode is lenient) downgrade to Information.
    const mode = config().get<string>('dynamicJumpMode', 'strict');
    const severity =
      mode === 'lenient' && flow.dynamicJumps > 0
        ? vscode.DiagnosticSeverity.Information
        : vscode.DiagnosticSeverity.Warning;
    const flowByFile = new Map<string, vscode.Diagnostic[]>();
    for (const l of flow.inaccessible) {
      const suffix =
        flow.dynamicJumps > 0
          ? ` (${flow.dynamicJumps} dynamic jump target(s) could not be resolved — this may be a false positive)`
          : '';
      const d = new vscode.Diagnostic(
        new vscode.Range(l.line, 0, l.line, 1000),
        `Label '${l.name}' is not reachable from any entry point (start, splashscreen, after_load, screen actions…).${suffix} ` +
          `If it is entered dynamically, add '# renpy-analytics: reachable' above it.`,
        severity
      );
      d.source = 'renpy-analytics';
      d.code = 'inaccessible-label';
      const arr = flowByFile.get(l.file) ?? [];
      arr.push(d);
      flowByFile.set(l.file, arr);
    }
    flowDiagnostics.clear();
    for (const [file, ds] of flowByFile) flowDiagnostics.set(vscode.Uri.file(file), ds);
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const scheduleRefresh = (doc?: vscode.TextDocument): void => {
    if (doc) {
      if (!isRenpyDoc(doc)) return;
      index.overrideDocument(doc);
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void runAnalysis();
    }, 700);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('renpy-analytics.foldAllLabels', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isRenpyDoc(editor.document)) return;
      const model = parseRpy(editor.document.uri.fsPath, editor.document.getText());
      const lines = model.labels.map((l) => l.headerLine);
      if (lines.length) {
        await vscode.commands.executeCommand('editor.fold', { levels: 1, selectionLines: lines });
      }
    }),

    vscode.commands.registerCommand('renpy-analytics.analyzeProject', async () => {
      const { flow, safety, metrics } = await runAnalysis();
      void vscode.window.showInformationMessage(
        `Ren'Py Analytics: ${metrics.totalLabels} labels (${flow.inaccessible.length} inaccessible), ` +
          `${metrics.totalMenus} menus, ${metrics.totalWords.toLocaleString('en-US')} words, ` +
          `${safety.length} save-safety finding(s).`
      );
    }),

    vscode.commands.registerCommand('renpy-analytics.analyzeSaveSafety', async () => {
      const { safety } = await runAnalysis();
      void vscode.window.showInformationMessage(
        safety.length === 0
          ? "Ren'Py Analytics: no save-file safety risks found."
          : `Ren'Py Analytics: ${safety.length} save-file safety finding${safety.length === 1 ? '' : 's'} — see the Problems panel.`
      );
    }),

    vscode.commands.registerCommand('renpy-analytics.exportReport', async () => {
      const result = await runAnalysis();
      const folder = vscode.workspace.workspaceFolders?.[0];
      const defaultUri = folder
        ? vscode.Uri.joinPath(folder.uri, 'renpy-analytics-report.md')
        : undefined;
      const uri = await vscode.window.showSaveDialog({
        defaultUri,
        filters: { Markdown: ['md'], JSON: ['json'] },
        title: 'Export Ren\'Py Analytics report',
      });
      if (!uri) return;
      const rel = (p: string): string => vscode.workspace.asRelativePath(p);
      const input = { ...result, relativize: rel };
      const content = uri.fsPath.endsWith('.json')
        ? buildJsonReport(input)
        : buildMarkdownReport(input);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
      await vscode.window.showTextDocument(uri);
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
