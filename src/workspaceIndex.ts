import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { FileModel } from './core/model';
import { parseRpy } from './core/parser';
import { isUnder } from './core/paths';

export const EXCLUDE_GLOB = '{**/saves/**,**/cache/**,**/.git/**,**/tl/**,**/node_modules/**}';

/**
 * Roots to restrict analysis to, from the renpy-analytics.gameDir setting
 * (relative to each workspace folder, or absolute). Empty when unset —
 * analyze the whole workspace.
 */
function gameDirRoots(): string[] {
  const gameDir = vscode.workspace
    .getConfiguration('renpy-analytics')
    .get<string>('gameDir', '')
    .trim();
  if (!gameDir) return [];
  if (path.isAbsolute(gameDir)) return [gameDir];
  const folders = vscode.workspace.workspaceFolders ?? [];
  return folders.map((f) => path.join(f.uri.fsPath, gameDir));
}

/**
 * mtime-keyed cache of parsed FileModels for every .rpy/.rpym in the
 * workspace. Dirty (unsaved) documents override the on-disk version.
 */
export class WorkspaceIndex {
  private cache = new Map<string, { mtimeMs: number; model: FileModel }>();
  private overrides = new Map<string, { version: number; model: FileModel }>();

  overrideDocument(doc: vscode.TextDocument): void {
    const key = doc.uri.fsPath;
    const cur = this.overrides.get(key);
    if (!cur || cur.version !== doc.version) {
      this.overrides.set(key, { version: doc.version, model: parseRpy(key, doc.getText()) });
    }
  }

  clearOverride(doc: vscode.TextDocument): void {
    this.overrides.delete(doc.uri.fsPath);
  }

  async getModels(): Promise<FileModel[]> {
    let uris = await vscode.workspace.findFiles('**/*.{rpy,rpym}', EXCLUDE_GLOB);
    const roots = gameDirRoots();
    if (roots.length) {
      uris = uris.filter((u) => roots.some((r) => isUnder(r, u.fsPath)));
    }
    const models: FileModel[] = [];
    const seen = new Set<string>();
    for (const uri of uris) {
      const key = uri.fsPath;
      seen.add(key);
      const ov = this.overrides.get(key);
      if (ov) {
        models.push(ov.model);
        continue;
      }
      const stat = await fs.stat(key).catch(() => null);
      if (!stat) continue;
      const cached = this.cache.get(key);
      if (cached && cached.mtimeMs === stat.mtimeMs) {
        models.push(cached.model);
        continue;
      }
      const text = await fs.readFile(key, 'utf8');
      const model = parseRpy(key, text);
      this.cache.set(key, { mtimeMs: stat.mtimeMs, model });
      models.push(model);
    }
    for (const k of [...this.cache.keys()]) {
      if (!seen.has(k)) this.cache.delete(k);
    }
    return models;
  }
}
