import type { Task, Category, ChatSession, ChatSummary, AIProvider, AIModel, RlcdProvider, RlcdModel } from './todo-contracts';
import type { ReadingStoreData, BookCandidate, BookAggregate } from './reading-contracts';
import type { ProposalReceipt } from './todo-proposal';
import type { AuthApi } from './auth-contracts';

export interface TodoState { tasks: Task[]; categories: Category[]; }

export interface AiConfig {
  aiEnabled: boolean; providers: AIProvider[]; models: AIModel[];
  activeModelId: string; hasConnection: boolean;
  rlcdProviders: RlcdProvider[]; rlcdModels: RlcdModel[]; activeRlcdModelId: string;
}

/** Shared preload/renderer contract; the main process validates mutation inputs. */
export interface WorkbenchApi {
  bot: import('./bot-contracts').BotBridge;
  officeWorkbench: {
    state(): Promise<import('./office-workbench').OfficeSnapshot>;
    refresh(): Promise<import('./office-workbench').OfficeSnapshot>;
    material(id: string): Promise<import('./office-workbench').OfficeMaterial>;
    dismiss(id: string): Promise<import('./office-workbench').OfficeSnapshot>;
    proposeTodo(id: string): Promise<import('./bot-contracts').BotAction>;
  };
  captureAssistantBackdrop(): Promise<string>;
  minimize(): void;
  maximizeToggle(): void;
  close(): void;
  onMaximized(callback: (maximized: boolean) => void): () => void;
  browser: import('./browser-contracts').BrowserBridge;
  browserAutomation: import('./browser-automation-contracts').BrowserAutomationBridge;
  island: import('./island-contracts').IslandBridge;
  speech: import('./speech-contracts').SpeechBridge;
  office: {
    convert(
      filename: string,
      bytes: Uint8Array,
    ): Promise<import('./office-contracts').OfficeConvertResult>;
  };
  todo: {
    state(): Promise<TodoState>;
    info(): Promise<import('./contracts').TodoDbInfo>;
    create(input: unknown): Promise<TodoState>;
    update(id: string, patch: unknown, revision: string): Promise<TodoState>;
    remove(id: string, revision: string): Promise<TodoState>;
    snooze(id: string): Promise<TodoState>;
    restore(id: string): Promise<TodoState>;
    createCategory(input: unknown): Promise<TodoState>;
    updateCategory(id: string, input: unknown, revision: string): Promise<TodoState>;
    removeCategory(id: string, revision: string): Promise<TodoState>;
    review(): Promise<string>;
    onChanged(callback: () => void): () => void;
  };
  reading: {
    list(): Promise<ReadingStoreData>;
    save(input: unknown): Promise<ReadingStoreData>;
    remove(id: string): Promise<ReadingStoreData>;
    setVault(vaultPath: string): Promise<ReadingStoreData>;
    scan(vaultPath: string): Promise<BookCandidate[]>;
    aggregate(folder: string): Promise<BookAggregate>;
    openObsidian(vault: string, rel?: string): Promise<void>;
  };
  ai: {
    openLink(url: string): Promise<void>;
    config(): Promise<AiConfig>;
    setEnabled(enabled: boolean): Promise<AiConfig>;
    saveProvider(input: unknown): Promise<AiConfig>;
    removeProvider(id: string): Promise<AiConfig>;
    saveModel(input: unknown): Promise<AiConfig>;
    removeModel(id: string): Promise<AiConfig>;
    activateModel(id: string): Promise<AiConfig>;
    test(input: unknown): Promise<string>;
    saveRlcdProvider(input: unknown): Promise<AiConfig>;
    removeRlcdProvider(id: string): Promise<AiConfig>;
    saveRlcdModel(input: unknown): Promise<AiConfig>;
    removeRlcdModel(id: string): Promise<AiConfig>;
    testRlcd(input: unknown): Promise<string>;
    chatList(): Promise<ChatSummary[]>;
    chatOpen(id?: string): Promise<ChatSession>;
    chatNew(tag?: import('./ai-scope').AiScope): Promise<ChatSession>;
    chatRename(id: string, title: string): Promise<ChatSession>;
    chatRemove(id: string): Promise<ChatSession>;
    chatDraft(id: string, text: string): Promise<void>;
    chatContext(id: string, scope: import('./ai-scope').AiScope): Promise<ChatSession>;
    ask(sessionId: string, text: string, context?: import('./ai-reference').AiTurnContext): Promise<void>;
    cancel(sessionId: string): void;
    apply(token: string, indices: number[]): Promise<{ todoReceipt: ProposalReceipt } | null>;
    discard(token: string): Promise<null>;
    onChat(callback: (chat: ChatSession) => void): () => void;
    onConfigChanged(callback: (config: AiConfig) => void): () => void;
    onAsk(callback: (ask: { id: string; sessionId: string; question: string; options: { label: string; description?: string }[] }) => void): () => void;
    answerAsk(input: { id: string; sessionId: string; kind: 'option' | 'text' | 'skip'; value?: string }): void;
  };
  float: {
    toggle(): Promise<boolean>;
    show(): Promise<void>;
    onVisibilityChanged(callback: (visible: boolean) => void): () => void;
  };
  settings: {
    get(): Promise<import('./contracts').AppSettings | null>;
    patch(patch: import('./contracts').AppSettingsPatch): Promise<import('./contracts').AppSettings>;
  };
  appInfo: {
    about(): Promise<{
      name: string;
      version: string;
      electron: string;
      chrome: string;
      userDataPath: string;
      todoDbPath: string;
    }>;
    openUserDataDir(): Promise<void>;
    openTodoDir(): Promise<void>;
  };
  updater: {
    status(): Promise<import('./contracts').UpdateStatus>;
    check(): Promise<void>;
    install(): Promise<void>;
    notes(): Promise<void>;
    onStatus(callback: (status: import('./contracts').UpdateStatus) => void): () => void;
  };
  auth: AuthApi;
  clipboard: { write(text: string): Promise<void> };
}
