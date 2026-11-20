export interface OfficePortalItem {
  id: string;
  kind: 'todo' | 'apply';
  system: string;
  title: string;
  time: string;
  person?: string;
  progress?: string;
  url?: string;
  cached?: boolean;
  taskId?: string;
}

export interface OfficePortalState {
  status: 'unconfigured' | 'idle' | 'login' | 'error' | 'partial' | 'ready';
  readAt?: number;
  items: OfficePortalItem[];
  message?: string;
}

export interface OfficePortalBridge {
  state(): Promise<OfficePortalState>;
  refresh(): Promise<OfficePortalState>;
  open(id?: string): Promise<void>;
  createTodo(id: string): Promise<string>;
}
