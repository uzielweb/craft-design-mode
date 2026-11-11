export type ParamFieldType = 'number' | 'boolean' | 'string' | 'color';

export interface CommandParamSchema {
  key: string;
  label: string;
  type: ParamFieldType;
  min?: number;
  max?: number;
  step?: number;
}

export interface ICommand<TParams extends object = Record<string, unknown>> {
  readonly id: string;
  readonly label: string;
  readonly schema?: CommandParamSchema[];
  execute(): void;
  undo(): void;
  getParams(): TParams;
  updateParams?(next: Partial<TParams>): void;
}
