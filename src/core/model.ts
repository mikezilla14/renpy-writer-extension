// Shared parse model. Every feature (folding, analysis, footers, CodeLens)
// consumes a FileModel produced by a single pass in parser.ts — nothing re-parses.

export type BlockKind =
  | 'label'
  | 'menu'
  | 'choice'
  | 'screen'
  | 'init'
  | 'python'
  | 'if'
  | 'elif'
  | 'else'
  | 'while'
  | 'for'
  | 'block';

export interface Block {
  kind: BlockKind;
  name?: string;
  headerLine: number;
  endLine: number;
  indent: number;
  children: Block[];
}

export interface LabelDecl {
  /** Fully qualified name; local labels are resolved to parent.local */
  name: string;
  local: boolean;
  headerLine: number;
  endLine: number;
}

export interface ChoiceDecl {
  text: string;
  headerLine: number;
  endLine: number;
}

export interface MenuDecl {
  name?: string;
  headerLine: number;
  endLine: number;
  choices: ChoiceDecl[];
}

/**
 * Where an assignment executes, which determines its save-file semantics:
 * - 'label': at runtime, stored in saves and rollback
 * - 'init': at init time on every game start, NOT stored in saves
 * - 'screen': per-interaction screen scope, NOT stored in saves
 * - 'python': a python block outside label/init/screen
 * - 'top': module top level
 */
export type AssignContext = 'label' | 'init' | 'python' | 'screen' | 'top';

export interface VarDef {
  kind: 'define' | 'default';
  /** store. prefix stripped */
  name: string;
  rhs: string;
  line: number;
}

export interface Assignment {
  /** Full dotted target, store. prefix stripped */
  name: string;
  /** '=', '+=', ... — empty string for in-place mutations */
  op: string;
  /** Method name for in-place mutations (append, update, ...) */
  mutation?: string;
  /** Right-hand side of the assignment (absent for mutations) */
  rhs?: string;
  line: number;
  context: AssignContext;
}

export interface JumpCall {
  kind: 'jump' | 'call';
  /** Undefined when the target is a runtime expression */
  target?: string;
  dynamic: boolean;
  line: number;
}

export interface DialogueLine {
  /** null for the narrator */
  speaker: string | null;
  /** True for the ad-hoc string-speaker form: "Name" "dialogue" */
  adhoc: boolean;
  text: string;
  line: number;
}

/** Screen-action label references: Jump("x"), Call("x"), Start("x") */
export interface ActionTarget {
  target: string;
  line: number;
}

/** An identifier used in an expression (condition, RHS, python line, screen action) */
export interface IdentifierRef {
  /** Full dotted name as written (renpy.pause, persistent.seen, …) */
  name: string;
  /** True when the identifier is invoked: name(...) */
  call: boolean;
  line: number;
}

export interface FileModel {
  path: string;
  blocks: Block[];
  labels: LabelDecl[];
  menus: MenuDecl[];
  defines: VarDef[];
  defaults: VarDef[];
  assignments: Assignment[];
  jumps: JumpCall[];
  /** Lines holding a `return` statement — used for fall-through detection */
  returns: number[];
  actionTargets: ActionTarget[];
  identifiers: IdentifierRef[];
  dialogue: DialogueLine[];
  /** line -> text after a "# renpy-analytics:" comment on that line */
  suppressions: Map<number, string>;
}
