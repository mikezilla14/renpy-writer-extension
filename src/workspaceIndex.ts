import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import { FileModel } from './core/model';
import { parseRpy } from './core/parser';

const EXCLUDE_GLOB = '{**/saves/**,**/cache/**,**/.git/**,**/tl/**,**/node_modules/**}';

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
    const uris = await vscode.workspace.findFiles('**/*.{rpy,rpym}', EXCLUDE_GLOB);
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
