import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { AnalysisTreeProvider } from './analysisView';
import { analyzeChoices } from './core/choiceConsequences';
import { computeFileInsights, estimatePlaytime } from './core/fileInsights';
import { buildFlowGraph, filterGraphToFile, FlowGraph, toDot } from './core/flowGraph';
import { computeFoldingRanges } from './core/folding';
import {
  ALL_FOOTER_SECTIONS,
  applyFooter,
  buildFooter,
  FooterSection,
  hasFooter,
} from './core/footer';
import { analyzeFlow, FlowAnalysis } from './core/graph';
import { collectCharacterDisplayNames, computeMetrics } from './core/metrics';
import { convertProse, extractSpeakers, slug } from './core/prose';
import {
  exportDialogueMarkdown,
  planProofreadEdits,
  replaceDialogueOnLine,
} from './core/proofread';
import { FileModel } from './core/model';
import { parseRpy } from './core/parser';
import { samePath } from './core/paths';
import {
  findWarpTarget,
  looksLikeSdkDir,
  rankSdkDirNames,
  resolveSdkExecutable,
} from './core/warp';
import { buildVariableIndex } from './core/variables';
import { CurrentFileTreeProvider } from './currentFileView';
import { VariablesTreeProvider } from './variablesView';
import { buildJsonReport, buildMarkdownReport } from './core/report';
import { analyzeSaveSafety, SaveSafetyFinding } from './core/saveSafety';
import { analyzeSpeakers, SpeakerFinding } from './core/speakers';
import { showFlowGraphPanel } from './graphView';
import { EXCLUDE_GLOB, WorkspaceIndex } from './workspaceIndex';

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

class ChoiceConsequenceLensProvider implements vscode.CodeLensProvider {
  private cache = new Map<string, { version: number; lenses: vscode.CodeLens[] }>();
  private emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.emitter.event;

  invalidate(): void {
    this.cache.clear();
    this.emitter.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!config().get<boolean>('codeLens.enabled', true)) return [];
    const key = document.uri.toString();
    const hit = this.cache.get(key);
    if (hit && hit.version === document.version) return hit.lenses;
    const model = parseRpy(document.uri.fsPath, document.getText());
    const lenses = analyzeChoices(model).map(
      (s) =>
        new vscode.CodeLens(new vscode.Range(s.line, 0, s.line, 0), {
          title: s.summary,
          command: '',
        })
    );
    this.cache.set(key, { version: document.version, lenses });
    return lenses;
  }
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
  models: FileModel[];
  flow: FlowAnalysis;
  safety: SaveSafetyFinding[];
  speakers: SpeakerFinding[];
  metrics: ReturnType<typeof computeMetrics>;
}

export function activate(context: vscode.ExtensionContext): void {
  const index = new WorkspaceIndex();
  const safetyDiagnostics = vscode.languages.createDiagnosticCollection('renpy-save-safety');
  const flowDiagnostics = vscode.languages.createDiagnosticCollection('renpy-flow');
  const speakerDiagnostics = vscode.languages.createDiagnosticCollection('renpy-speakers');
  const tree = new AnalysisTreeProvider();
  const currentFileTree = new CurrentFileTreeProvider();
  const variablesTree = new VariablesTreeProvider();
  const lensProvider = new ChoiceConsequenceLensProvider();
  context.subscriptions.push(
    safetyDiagnostics,
    flowDiagnostics,
    speakerDiagnostics,
    vscode.window.registerTreeDataProvider('renpyAnalytics.analysis', tree),
    vscode.window.registerTreeDataProvider('renpyAnalytics.currentFile', currentFileTree),
    vscode.window.registerTreeDataProvider('renpyAnalytics.variables', variablesTree),
    vscode.languages.registerFoldingRangeProvider(SELECTOR, new RenpyFoldingProvider()),
    vscode.languages.registerCodeLensProvider(SELECTOR, lensProvider)
  );

  let lastAnalysis: AnalysisResult | undefined;

  const updateCurrentFileView = (): void => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isRenpyDoc(editor.document)) {
      currentFileTree.setMessage('Open a .rpy file to see its analysis');
      return;
    }
    if (!lastAnalysis) {
      currentFileTree.setMessage('Analyzing…');
      return;
    }
    const fsPath = editor.document.uri.fsPath;
    const model = lastAnalysis.models.find((m) => samePath(m.path, fsPath));
    if (!model) {
      currentFileTree.setMessage(
        'File is outside the analyzed scope — check the game folder (Scope) setting'
      );
      return;
    }
    const wpm = config().get<number>('readingSpeedWpm', 200);
    const insights = computeFileInsights(model, lastAnalysis.models, lastAnalysis.flow, wpm);
    currentFileTree.setResults(
      insights,
      lastAnalysis.safety.filter((f) => samePath(f.file, model.path)),
      lastAnalysis.speakers.filter((f) => samePath(f.file, model.path))
    );
  };

  const runAnalysis = async (): Promise<AnalysisResult> => {
    const models = await index.getModels();
    const extraEntryPoints = config().get<string[]>('extraEntryPoints', []);
    const flow = analyzeFlow(models, extraEntryPoints);
    const safety = config().get<boolean>('saveSafety.enabled', true)
      ? analyzeSaveSafety(models)
      : [];
    const speakers = analyzeSpeakers(models);
    const metrics = computeMetrics(models);
    publishDiagnostics(flow, safety, speakers);
    const gameDir = config().get<string>('gameDir', '').trim();
    const wpm = config().get<number>('readingSpeedWpm', 200);
    const playtime = estimatePlaytime(models, flow, wpm);
    tree.setResults(flow, metrics, safety, speakers, gameDir || 'entire workspace', playtime);
    variablesTree.setResults(buildVariableIndex(models));
    lastAnalysis = { models, flow, safety, speakers, metrics };
    updateCurrentFileView();
    return lastAnalysis;
  };

  const publishDiagnostics = (
    flow: FlowAnalysis,
    safety: SaveSafetyFinding[],
    speakers: SpeakerFinding[]
  ): void => {
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
    for (const de of flow.deadEnds) {
      const d = new vscode.Diagnostic(
        new vscode.Range(de.line, 0, de.line, 1000),
        `Label '${de.name}' is reachable but its flow runs off the end of the file without ` +
          `'return' or 'jump' — Ren'Py raises an error when the script runs out. ` +
          `End the label with 'return' or jump to the next scene.`,
        vscode.DiagnosticSeverity.Warning
      );
      d.source = 'renpy-analytics';
      d.code = 'dead-end';
      const arr = flowByFile.get(de.file) ?? [];
      arr.push(d);
      flowByFile.set(de.file, arr);
    }
    flowDiagnostics.clear();
    for (const [file, ds] of flowByFile) flowDiagnostics.set(vscode.Uri.file(file), ds);

    const speakerByFile = new Map<string, vscode.Diagnostic[]>();
    for (const f of speakers) {
      const d = new vscode.Diagnostic(
        new vscode.Range(f.line, 0, f.line, 1000),
        f.message,
        vscode.DiagnosticSeverity.Information
      );
      d.source = 'renpy-analytics';
      d.code = f.rule;
      const arr = speakerByFile.get(f.file) ?? [];
      arr.push(d);
      speakerByFile.set(f.file, arr);
    }
    speakerDiagnostics.clear();
    for (const [file, ds] of speakerByFile) speakerDiagnostics.set(vscode.Uri.file(file), ds);
  };

  /**
   * Regenerates the footer in `doc`. When `force` is false the document is
   * only touched if it already contains a footer block. Returns true when an
   * edit was applied.
   */
  const updateFooterInDocument = async (
    doc: vscode.TextDocument,
    force: boolean
  ): Promise<boolean> => {
    const text = doc.getText();
    if (!force && !hasFooter(text)) return false;
    const models = await index.getModels();
    const target = parseRpy(doc.uri.fsPath, text);
    const sections = config().get<FooterSection[]>('footer.sections', [...ALL_FOOTER_SECTIONS]);
    const footer = buildFooter(target, models, { sections });
    const newText = applyFooter(text, footer);
    if (newText === text) return false;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(0, 0, doc.lineCount, 0), newText);
    return vscode.workspace.applyEdit(edit);
  };

  /**
   * Folds every region of the given block kinds in the active editor.
   * Inner regions (choices inside menus inside labels) are passed in the same
   * call, so unfolding an outer block reveals still-collapsed inner blocks.
   */
  const foldBlocks = async (kinds: string[]): Promise<void> => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isRenpyDoc(editor.document)) {
      void vscode.window.showWarningMessage('Open a .rpy file to fold its blocks.');
      return;
    }
    const model = parseRpy(editor.document.uri.fsPath, editor.document.getText());
    const wanted = new Set(kinds);
    const lines = computeFoldingRanges(model)
      .filter((r) => wanted.has(r.blockKind))
      .map((r) => r.start);
    if (lines.length) {
      await vscode.commands.executeCommand('editor.fold', { levels: 1, selectionLines: lines });
    }
  };

  /** Scans common install locations for Ren'Py SDK folders, newest first. */
  const detectSdkExecutables = (): string[] => {
    const home = os.homedir();
    const roots = [home, path.join(home, 'Downloads'), path.join(home, 'Documents')];
    if (process.platform === 'win32') roots.push('C:\\', 'D:\\');
    else roots.push('/opt', path.join(home, 'Applications'));
    const found: string[] = [];
    for (const root of roots) {
      let names: string[];
      try {
        names = fs.readdirSync(root);
      } catch {
        continue;
      }
      for (const name of rankSdkDirNames(names.filter(looksLikeSdkDir))) {
        const exe = resolveSdkExecutable(path.join(root, name), process.platform, fs.existsSync);
        if (exe) found.push(exe);
      }
    }
    return found;
  };

  /**
   * Returns the Ren'Py launcher executable, asking the user to pick or browse
   * when the sdkPath setting is missing or invalid. Persists the choice.
   */
  const resolveSdkForLaunch = async (): Promise<string | undefined> => {
    const configured = config().get<string>('sdkPath', '').trim();
    if (configured) {
      const exe = resolveSdkExecutable(configured, process.platform, fs.existsSync);
      if (exe) return exe;
      void vscode.window.showWarningMessage(
        `renpy-analytics.sdkPath ('${configured}') does not contain a Ren'Py launcher — falling back to auto-detection.`
      );
    }
    const browseItem = { label: '$(folder-opened) Browse for the Ren\'Py SDK folder…', exe: '' };
    const items = [
      ...detectSdkExecutables().map((exe) => ({ label: path.dirname(exe), exe })),
      browseItem,
    ];
    let exe: string | undefined;
    if (items.length === 1) {
      // Nothing detected — go straight to the folder picker.
      exe = await browseSdk();
    } else {
      const picked = await vscode.window.showQuickPick(items, {
        title: "Select the Ren'Py SDK to playtest with",
        placeHolder: 'Detected SDK installs (pick one, or browse)',
      });
      if (!picked) return undefined;
      exe = picked.exe || (await browseSdk());
    }
    if (exe) {
      await config().update('sdkPath', path.dirname(exe), vscode.ConfigurationTarget.Global);
    }
    return exe;
  };

  const browseSdk = async (): Promise<string | undefined> => {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: "Select your Ren'Py SDK folder (contains renpy.exe / renpy.sh)",
    });
    if (!picked?.length) return undefined;
    const exe = resolveSdkExecutable(picked[0].fsPath, process.platform, fs.existsSync);
    if (!exe) {
      void vscode.window.showErrorMessage(
        `No Ren'Py launcher found in '${picked[0].fsPath}'. Pick the SDK folder that contains renpy.exe (Windows) or renpy.sh.`
      );
    }
    return exe;
  };

  const playtestFromHere = async (): Promise<void> => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isRenpyDoc(editor.document)) {
      void vscode.window.showWarningMessage('Open a .rpy file to playtest from the cursor.');
      return;
    }
    if (editor.document.isDirty) await editor.document.save();
    const target = findWarpTarget(editor.document.uri.fsPath, editor.selection.active.line);
    if (!target) {
      void vscode.window.showErrorMessage(
        "Ren'Py can only warp into scripts inside a project's game/ folder — this file isn't under one."
      );
      return;
    }
    const exe = await resolveSdkForLaunch();
    if (!exe) return;
    const child = spawn(exe, [target.projectDir, 'run', '--warp', target.spec], {
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', (err) => {
      void vscode.window.showErrorMessage(`Failed to launch Ren'Py: ${err.message}`);
    });
    child.unref();
    void vscode.window.setStatusBarMessage(
      `$(play) Ren'Py warping to ${target.spec} (requires config.developer)`,
      8000
    );
  };

  const pasteAsDialogue = async (): Promise<void> => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isRenpyDoc(editor.document)) {
      void vscode.window.showWarningMessage('Open a .rpy file to paste dialogue into.');
      return;
    }
    const clip = await vscode.env.clipboard.readText();
    if (!clip.trim()) {
      void vscode.window.showInformationMessage('Clipboard is empty — copy your draft first.');
      return;
    }
    const models = await index.getModels();
    const displayNames = collectCharacterDisplayNames(models); // var -> display
    const characterMap = new Map<string, string>();
    for (const [v, d] of displayNames) {
      if (!characterMap.has(d.toLowerCase())) characterMap.set(d.toLowerCase(), v);
      characterMap.set(v.toLowerCase(), v);
    }
    const stringSpeakers = new Set<string>();
    for (const name of extractSpeakers(clip)) {
      const key = name.toLowerCase();
      if (characterMap.has(key)) continue;
      type Item = vscode.QuickPickItem & { action: 'slug' | 'string' | 'map'; variable?: string };
      const items: Item[] = [
        {
          label: `$(add) Use new variable '${slug(name)}'`,
          description: 'adds a TODO define comment above the paste',
          action: 'slug',
        },
        {
          label: `$(quote) Keep as string speaker "${name}"`,
          description: 'ad-hoc one-off character',
          action: 'string',
        },
        ...[...displayNames].map(
          ([v, d]): Item => ({ label: `$(person) ${v}`, description: d, action: 'map', variable: v })
        ),
      ];
      const picked = await vscode.window.showQuickPick(items, {
        title: `Speaker "${name}" is not a defined character — how should it be written?`,
      });
      if (!picked) return; // cancelled
      if (picked.action === 'string') stringSpeakers.add(key);
      else if (picked.action === 'map' && picked.variable) characterMap.set(key, picked.variable);
      // 'slug': leave unmapped — converter emits the slug + TODO define comment
    }
    const { rpy, unknown } = convertProse(clip, { characterMap, stringSpeakers });
    if (!rpy) {
      void vscode.window.showInformationMessage('Nothing convertible found in the clipboard.');
      return;
    }
    const pos = editor.selection.active;
    const indent = /^\s*/.exec(editor.document.lineAt(pos.line).text)![0];
    const indented = rpy
      .split('\n')
      .map((l) => (l === '' ? '' : indent + l))
      .join('\n');
    const insertAt = new vscode.Position(pos.line, 0);
    await editor.edit((eb) => eb.insert(insertAt, indented + '\n'));
    void vscode.window.setStatusBarMessage(
      `$(check) Pasted as Ren'Py dialogue${unknown.length ? ` — ${unknown.length} character(s) need defines (see TODO comment)` : ''}`,
      8000
    );
  };

  const exportDialogue = async (): Promise<void> => {
    const models = await index.getModels();
    const md = exportDialogueMarkdown(models, (p) => vscode.workspace.asRelativePath(p));
    const folder = vscode.workspace.workspaceFolders?.[0];
    const uri = await vscode.window.showSaveDialog({
      defaultUri: folder ? vscode.Uri.joinPath(folder.uri, 'dialogue-proofread.md') : undefined,
      filters: { Markdown: ['md'] },
      title: 'Export dialogue for proofreading',
    });
    if (!uri) return;
    await vscode.workspace.fs.writeFile(uri, Buffer.from(md, 'utf8'));
    await vscode.window.showTextDocument(uri);
    void vscode.window.showInformationMessage(
      "Dialogue exported. Share it, collect edits, then run \"Ren'Py: Apply Proofread Dialogue\"."
    );
  };

  const applyProofread = async (): Promise<void> => {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { Markdown: ['md'] },
      title: 'Select the edited proofreading document',
    });
    if (!picked?.length) return;
    const md = Buffer.from(await vscode.workspace.fs.readFile(picked[0])).toString('utf8');
    const models = await index.getModels();
    const byRel = new Map<string, FileModel>();
    for (const m of models) {
      byRel.set(vscode.workspace.asRelativePath(m.path).replace(/\\/g, '/'), m);
    }
    const plan = planProofreadEdits(md, (rel) => byRel.get(rel.replace(/\\/g, '/')));
    if (!plan.isExport && plan.edits.length === 0 && plan.unchanged === 0) {
      void vscode.window.showErrorMessage(
        "This file doesn't look like a Ren'Py Analytics dialogue export."
      );
      return;
    }
    const wsEdit = new vscode.WorkspaceEdit();
    let applied = 0;
    for (const e of plan.edits) {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(e.file));
      const raw = doc.lineAt(e.line).text;
      const replaced = replaceDialogueOnLine(raw, e.newText, e.adhoc);
      if (replaced === null) {
        plan.skipped.push({
          anchor: `${vscode.workspace.asRelativePath(e.file)}:${e.line + 1}`,
          reason: 'line changed since export — apply manually',
        });
        continue;
      }
      wsEdit.replace(
        doc.uri,
        new vscode.Range(e.line, 0, e.line, raw.length),
        replaced
      );
      applied++;
    }
    if (applied) await vscode.workspace.applyEdit(wsEdit);
    const parts = [
      `${applied} line(s) updated`,
      `${plan.unchanged} unchanged`,
      plan.skipped.length ? `${plan.skipped.length} skipped` : '',
    ].filter(Boolean);
    const msg = `Proofread dialogue applied: ${parts.join(', ')}.`;
    if (plan.skipped.length) {
      const detail = plan.skipped.map((s) => `${s.anchor} — ${s.reason}`).join('\n');
      void vscode.window.showWarningMessage(`${msg}\n${detail}`, { modal: false });
    } else {
      void vscode.window.showInformationMessage(msg);
    }
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
    vscode.commands.registerCommand('renpy-analytics.foldAllLabels', () =>
      foldBlocks(['label'])
    ),
    vscode.commands.registerCommand('renpy-analytics.foldAllMenus', () =>
      foldBlocks(['menu', 'choice'])
    ),
    vscode.commands.registerCommand('renpy-analytics.foldAllLabelsAndMenus', () =>
      foldBlocks(['label', 'menu', 'choice'])
    ),

    vscode.commands.registerCommand('renpy-analytics.playtestFromHere', playtestFromHere),
    vscode.commands.registerCommand('renpy-analytics.pasteDialogue', pasteAsDialogue),
    vscode.commands.registerCommand('renpy-analytics.exportDialogue', exportDialogue),
    vscode.commands.registerCommand('renpy-analytics.applyProofread', applyProofread),

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

    vscode.commands.registerCommand('renpy-analytics.showFlowGraph', async () => {
      const { models, flow } = await runAnalysis();
      showFlowGraphPanel(buildFlowGraph(models, flow));
    }),

    vscode.commands.registerCommand('renpy-analytics.showFlowGraphForFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isRenpyDoc(editor.document)) {
        void vscode.window.showWarningMessage('Open a .rpy file to show its flow graph.');
        return;
      }
      const { models, flow } = await runAnalysis();
      const fsPath = editor.document.uri.fsPath;
      if (!models.some((m) => samePath(m.path, fsPath))) {
        void vscode.window.showWarningMessage(
          "File is outside the analyzed scope — check the game folder setting."
        );
        return;
      }
      const graph = filterGraphToFile(buildFlowGraph(models, flow), fsPath);
      const name = vscode.workspace.asRelativePath(fsPath);
      showFlowGraphPanel(graph, `Story Flow — ${name}`);
    }),

    vscode.commands.registerCommand('renpy-analytics.exportDot', async () => {
      const { models, flow } = await runAnalysis();
      let graph: FlowGraph = buildFlowGraph(models, flow);
      let suggestedName = 'renpy-flow.dot';
      const editor = vscode.window.activeTextEditor;
      if (editor && isRenpyDoc(editor.document)) {
        const fsPath = editor.document.uri.fsPath;
        if (models.some((m) => samePath(m.path, fsPath))) {
          const rel = vscode.workspace.asRelativePath(fsPath);
          const picked = await vscode.window.showQuickPick(
            [
              { label: 'Whole project', scope: 'project' as const },
              { label: `Current file only (${rel})`, scope: 'file' as const },
            ],
            { title: 'Export flow graph for…' }
          );
          if (!picked) return;
          if (picked.scope === 'file') {
            graph = filterGraphToFile(graph, fsPath);
            suggestedName = `${rel.replace(/[\\/]/g, '_').replace(/\.rpym?$/, '')}-flow.dot`;
          }
        }
      }
      const folder = vscode.workspace.workspaceFolders?.[0];
      const uri = await vscode.window.showSaveDialog({
        defaultUri: folder ? vscode.Uri.joinPath(folder.uri, suggestedName) : undefined,
        filters: { 'Graphviz DOT': ['dot', 'gv'] },
        title: 'Export story flow graph as Graphviz DOT',
      });
      if (!uri) return;
      await vscode.workspace.fs.writeFile(uri, Buffer.from(toDot(graph), 'utf8'));
      void vscode.window.showInformationMessage(
        `Flow graph exported. Render with Graphviz (dot -Tsvg) or a DOT preview extension.`
      );
    }),

    vscode.commands.registerCommand('renpy-analytics.generateFooter', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isRenpyDoc(editor.document)) {
        void vscode.window.showWarningMessage("Open a .rpy file to generate its footer.");
        return;
      }
      await updateFooterInDocument(editor.document, true);
    }),

    vscode.commands.registerCommand('renpy-analytics.generateAllFooters', async () => {
      const models = await index.getModels();
      let updated = 0;
      for (const m of models) {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(m.path));
        if (await updateFooterInDocument(doc, true)) {
          await doc.save();
          updated++;
        }
      }
      void vscode.window.showInformationMessage(
        `Ren'Py Analytics: footers generated in ${updated} of ${models.length} file(s).`
      );
    }),

    vscode.commands.registerCommand('renpy-analytics.selectGameFolder', async () => {
      // Candidate game roots: directories holding options.rpy or script.rpy
      const markers = await vscode.workspace.findFiles(
        '**/{options.rpy,script.rpy}',
        EXCLUDE_GLOB
      );
      const dirs = [...new Set(markers.map((u) => path.dirname(u.fsPath)))].sort();
      const current = config().get<string>('gameDir', '').trim();
      const items: (vscode.QuickPickItem & { value: string })[] = dirs.map((d) => {
        const rel = vscode.workspace.asRelativePath(d);
        return {
          label: rel,
          description: rel === current ? 'current' : undefined,
          value: rel,
        };
      });
      items.push({
        label: 'Entire workspace',
        description: current === '' ? 'current' : 'analyze every .rpy in the workspace',
        value: '',
      });
      const picked = await vscode.window.showQuickPick(items, {
        title: "Select the game folder Ren'Py Analytics should analyze",
        placeHolder:
          dirs.length > 1
            ? `${dirs.length} game folders detected — pick one to scope the analysis`
            : 'Pick the analysis scope',
      });
      if (!picked) return;
      await config().update('gameDir', picked.value, vscode.ConfigurationTarget.Workspace);
      // onDidChangeConfiguration triggers a refresh; message for clarity
      void vscode.window.showInformationMessage(
        picked.value
          ? `Ren'Py Analytics now analyzes '${picked.value}'.`
          : "Ren'Py Analytics now analyzes the entire workspace."
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
    vscode.workspace.onDidSaveTextDocument(async (doc) => {
      if (!isRenpyDoc(doc)) return;
      index.clearOverride(doc);
      // Regenerate existing footers on save when enabled. Loop-safe: the
      // second save produces identical text, so no edit and no further save.
      if (config().get<boolean>('footer.onSave', false)) {
        if (await updateFooterInDocument(doc, false)) await doc.save();
      }
      scheduleRefresh();
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('renpy-analytics')) {
        lensProvider.invalidate();
        scheduleRefresh();
      }
    }),
    vscode.window.onDidChangeActiveTextEditor(() => updateCurrentFileView())
  );

  scheduleRefresh();
}

export function deactivate(): void {}
