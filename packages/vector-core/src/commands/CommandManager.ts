import type { CommandParamSchema, ICommand } from './ICommand.js';

export interface LastActionSnapshot {
  id: string;
  label: string;
  params: Record<string, unknown>;
  schema: CommandParamSchema[];
}

export type CommandListener = () => void;

export class CommandManager {
  private undoStack: ICommand[] = [];
  private redoStack: ICommand[] = [];
  private listeners = new Set<CommandListener>();
  private maxHistory: number;

  constructor(maxHistory = 200) {
    this.maxHistory = maxHistory;
  }

  subscribe(listener: CommandListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  execute(command: ICommand): void {
    command.execute();
    this.undoStack.push(command);
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    this.notify();
  }

  undo(): boolean {
    const cmd = this.undoStack.pop();
    if (!cmd) return false;
    cmd.undo();
    this.redoStack.push(cmd);
    this.notify();
    return true;
  }

  redo(): boolean {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    cmd.execute();
    this.undoStack.push(cmd);
    this.notify();
    return true;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  getLastCommand(): ICommand | null {
    return this.undoStack[this.undoStack.length - 1] ?? null;
  }

  getLastActionSnapshot(): LastActionSnapshot | null {
    const cmd = this.getLastCommand();
    if (!cmd) return null;
    return {
      id: cmd.id,
      label: cmd.label,
      params: { ...cmd.getParams() },
      schema: cmd.schema ?? [],
    };
  }

  /**
   * Last Action pattern:
   * Immediately executes lastCommand.undo(), updates its parameters,
   * and re-executes lastCommand.execute().
   */
  updateLastActionParams(partial: Record<string, unknown>): boolean {
    const last = this.getLastCommand();
    if (!last || !last.updateParams) return false;

    last.undo();
    last.updateParams(partial);
    last.execute();
    this.notify();
    return true;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.notify();
  }
}
