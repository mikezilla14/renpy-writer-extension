import * as vscode from 'vscode';
import { FlowAnalysis } from './core/graph';
import { avgSentenceLength, ProjectMetrics } from './core/metrics';
import { SaveSafetyFinding } from './core/saveSafety';
import { SpeakerFinding } from './core/speakers';

export interface TreeNode {
  label: string;
  description?: string;
  tooltip?: string;
  icon?: vscode.ThemeIcon;
  file?: string;
  line?: number;
  /** Command to run on click (takes precedence over file/line navigation) */
  commandId?: string;
  /** Render group initially collapsed instead of expanded */
  collapsed?: boolean;
  children?: TreeNode[];
}

export function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

export abstract class BaseTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  protected roots: TreeNode[] = [];
  private emitter = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  protected refresh(): void {
    this.emitter.fire(undefined);
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.label,
      node.children
        ? node.collapsed
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None
    );
    item.description = node.description;
    item.tooltip = node.tooltip;
    item.iconPath = node.icon;
    if (node.commandId) {
      item.command = { command: node.commandId, title: node.label };
    } else if (node.file !== undefined && node.line !== undefined) {
      item.command = {
        command: 'vscode.open',
        title: 'Open',
        arguments: [
          vscode.Uri.file(node.file),
          { selection: new vscode.Range(node.line, 0, node.line, 0) },
        ],
      };
    }
    return item;
  }

  getChildren(node?: TreeNode): TreeNode[] {
    return node ? node.children ?? [] : this.roots;
  }
}

export class AnalysisTreeProvider extends BaseTreeProvider {
  protected roots: TreeNode[] = [
    { label: 'Run "Ren\'Py: Analyze Project" to populate', icon: new vscode.ThemeIcon('info') },
  ];

  setResults(
    flow: FlowAnalysis,
    metrics: ProjectMetrics,
    safety: SaveSafetyFinding[],
    speakers: SpeakerFinding[],
    scopeLabel: string,
    playtime: { words: number; minutes: number },
    progress?: TreeNode
  ): void {
    const rel = (p: string): string => vscode.workspace.asRelativePath(p);

    const inaccessibleChildren: TreeNode[] =
      flow.inaccessible.length === 0
        ? [{ label: 'None — all labels reachable', icon: new vscode.ThemeIcon('check') }]
        : flow.inaccessible.map((l) => ({
            label: l.name,
            description: `${rel(l.file)}:${l.line + 1}`,
            icon: new vscode.ThemeIcon('debug-disconnect'),
            file: l.file,
            line: l.line,
          }));
    if (flow.dynamicJumps > 0) {
      inaccessibleChildren.push({
        label: `${fmt(flow.dynamicJumps)} dynamic jump target(s) unresolved`,
        description: 'results may be incomplete',
        icon: new vscode.ThemeIcon('question'),
      });
    }

    const safetyChildren: TreeNode[] =
      safety.length === 0
        ? [{ label: 'No risks found', icon: new vscode.ThemeIcon('check') }]
        : safety.map((f) => ({
            label: `${f.name} — ${f.rule}`,
            description: `${rel(f.file)}:${f.line + 1}`,
            tooltip: f.message,
            icon: new vscode.ThemeIcon(f.severity === 'warning' ? 'warning' : 'info'),
            file: f.file,
            line: f.line,
          }));

    const fileChildren: TreeNode[] = metrics.files.map((f) => ({
      label: rel(f.path),
      description: `${fmt(f.labels)} labels · ${fmt(f.menus)} menus · ${fmt(f.words)} words`,
      icon: new vscode.ThemeIcon('file'),
      file: f.path,
      line: 0,
    }));

    const charChildren: TreeNode[] = metrics.characters.map((c) => ({
      label: c.adhoc
        ? `"${c.key}" (string speaker)`
        : c.key === c.displayName
          ? c.displayName
          : `${c.displayName} (${c.key})`,
      description: `${fmt(c.words)} words · ${fmt(c.lines)} lines · ${avgSentenceLength(c).toFixed(1)} w/sentence`,
      tooltip: c.adhoc
        ? 'Ad-hoc string speaker ("Name" "dialogue") — a separate one-off character, not a defined Character variable'
        : undefined,
      icon: new vscode.ThemeIcon(c.adhoc ? 'quote' : 'person'),
    }));

    const speakerChildren: TreeNode[] =
      speakers.length === 0
        ? [{ label: 'No inconsistencies found', icon: new vscode.ThemeIcon('check') }]
        : speakers.map((f) => ({
            label: `"${f.speaker}" vs ${f.characterVar}`,
            description: `${rel(f.file)}:${f.line + 1}`,
            tooltip: f.message,
            icon: new vscode.ThemeIcon('warning'),
            file: f.file,
            line: f.line,
          }));

    const deadEndChildren: TreeNode[] =
      flow.deadEnds.length === 0
        ? [{ label: 'None — all flows end in return/jump', icon: new vscode.ThemeIcon('check') }]
        : flow.deadEnds.map((d) => ({
            label: d.name,
            description: `${rel(d.file)}:${d.line + 1}`,
            tooltip:
              'Reachable label whose flow runs off the end of the file without return/jump — the game errors at runtime',
            icon: new vscode.ThemeIcon('stop-circle'),
            file: d.file,
            line: d.line,
          }));

    const minutes = Math.round(playtime.minutes);
    const playtimeLabel =
      minutes >= 60
        ? `~${Math.floor(minutes / 60)}h ${minutes % 60}m`
        : `~${Math.max(minutes, 1)} min`;

    this.roots = [
      {
        label: `Scope: ${scopeLabel}`,
        description: 'click to change',
        tooltip: 'Restrict analysis to one game folder (useful in monorepos with several game copies)',
        icon: new vscode.ThemeIcon('folder-opened'),
        commandId: 'renpy-analytics.selectGameFolder',
      },
      {
        label: `Estimated playtime: ${playtimeLabel}`,
        description: `${fmt(playtime.words)} reachable words`,
        tooltip:
          'Upper bound: all dialogue in reachable labels at the configured reading speed. A single route is shorter since branches are mutually exclusive.',
        icon: new vscode.ThemeIcon('watch'),
      },
      ...(progress ? [progress] : []),
      {
        label: `Inaccessible labels (${fmt(flow.inaccessible.length)})`,
        icon: new vscode.ThemeIcon('debug-disconnect'),
        children: inaccessibleChildren,
      },
      {
        label: `Dead ends (${fmt(flow.deadEnds.length)})`,
        icon: new vscode.ThemeIcon('stop-circle'),
        children: deadEndChildren,
      },
      {
        label: `Save-file safety (${fmt(safety.length)})`,
        icon: new vscode.ThemeIcon('shield'),
        children: safetyChildren,
      },
      {
        label: `Speaker consistency (${fmt(speakers.length)})`,
        icon: new vscode.ThemeIcon('comment-discussion'),
        children: speakerChildren,
      },
      {
        label: `Files (${fmt(metrics.files.length)}) — ${fmt(metrics.totalLabels)} labels, ${fmt(metrics.totalMenus)} menus`,
        icon: new vscode.ThemeIcon('files'),
        children: fileChildren,
      },
      {
        label: `Characters (${fmt(metrics.characters.length)}) — ${fmt(metrics.totalWords)} words total`,
        icon: new vscode.ThemeIcon('organization'),
        children: charChildren,
      },
    ];
    this.refresh();
  }
}
