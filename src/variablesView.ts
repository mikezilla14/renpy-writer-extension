import * as vscode from 'vscode';
import { BaseTreeProvider, fmt, TreeNode } from './analysisView';
import { VariableInfo, VarSite } from './core/variables';

const MAX_SITES = 60;

function siteNode(site: VarSite): TreeNode {
  const rel = vscode.workspace.asRelativePath(site.file);
  const where = [site.label && `in ${site.label}`, site.choice && `via "${site.choice}"`]
    .filter(Boolean)
    .join(' · ');
  const icons: Record<VarSite['kind'], string> = {
    define: 'symbol-constant',
    default: 'symbol-field',
    write: 'edit',
    read: 'eye',
    gate: 'filter',
  };
  return {
    label: site.detail ? `${site.kind} ${site.detail}` : site.kind,
    description: `${rel}:${site.line + 1}${where ? ` — ${where}` : ''}`,
    tooltip: where || undefined,
    icon: new vscode.ThemeIcon(icons[site.kind]),
    file: site.file,
    line: site.line,
  };
}

function siteList(sites: VarSite[]): TreeNode[] {
  const nodes = sites.slice(0, MAX_SITES).map(siteNode);
  if (sites.length > MAX_SITES) {
    nodes.push({ label: `… ${fmt(sites.length - MAX_SITES)} more`, icon: new vscode.ThemeIcon('ellipsis') });
  }
  return nodes;
}

function varNode(v: VariableInfo): TreeNode {
  const gates = v.reads.filter((r) => r.kind === 'gate').length;
  const parts = [
    `${fmt(v.writes.length)} write${v.writes.length === 1 ? '' : 's'}`,
    `${fmt(v.reads.length)} read${v.reads.length === 1 ? '' : 's'}${gates ? ` (${fmt(gates)} gating)` : ''}`,
  ];
  if (v.kind === 'undeclared') parts.push('no default');
  const first = v.decls[0] ?? v.writes[0] ?? v.reads[0];
  return {
    label: v.name,
    description: parts.join(' · '),
    tooltip:
      v.kind === 'undeclared'
        ? 'Created by an assignment inside a label with no define/default — older saves may hit NameError'
        : undefined,
    icon: new vscode.ThemeIcon(
      v.kind === 'define' ? 'symbol-constant' : v.kind === 'default' ? 'symbol-variable' : 'warning'
    ),
    file: first?.file,
    line: first?.line,
    collapsed: true,
    children: siteList([...v.decls, ...v.writes, ...v.reads]),
  };
}

export class VariablesTreeProvider extends BaseTreeProvider {
  protected roots: TreeNode[] = [
    { label: 'Run "Ren\'Py: Analyze Project" to populate', icon: new vscode.ThemeIcon('info') },
  ];

  setResults(variables: VariableInfo[]): void {
    const unwritten = variables.filter((v) => v.unwritten);
    const unread = variables.filter((v) => v.unread);

    const roots: TreeNode[] = [];
    if (unwritten.length) {
      roots.push({
        label: `Gated but never set (${fmt(unwritten.length)})`,
        tooltip:
          'Conditions read these flags, but no statement ever assigns them — the gated branches can never trigger (or the write is dynamic/setattr).',
        icon: new vscode.ThemeIcon('warning'),
        children: unwritten.map(varNode),
      });
    }
    if (unread.length) {
      roots.push({
        label: `Never read (${fmt(unread.length)})`,
        tooltip:
          'Nothing reads these variables in any expression — possibly abandoned flags (reads via renpy.* string APIs are not detected).',
        icon: new vscode.ThemeIcon('eye-closed'),
        collapsed: true,
        children: unread.map(varNode),
      });
    }
    roots.push({
      label: `All variables (${fmt(variables.length)})`,
      icon: new vscode.ThemeIcon('symbol-namespace'),
      collapsed: roots.length > 0,
      children: variables.length
        ? variables.map(varNode)
        : [{ label: 'No story variables found', icon: new vscode.ThemeIcon('info') }],
    });
    this.roots = roots;
    this.refresh();
  }
}
