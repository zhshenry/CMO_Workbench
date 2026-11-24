export interface BotWorkspaceFile {
  id: string; botId: string; path: string; name: string; bytes: number; updatedAt: string;
}
export interface BotDirectory {
  root: string; workspace: string; inputs: string; outputs: string; skills: string;
  pending: number; error?: string;
}
export interface BotFilesView {
  directory: BotDirectory; files: BotWorkspaceFile[];
  skills: { name: string; description: string; source: 'shared' | 'private' }[]; skillErrors: string[];
}
export interface BotSkillView { name: string; description: string; source: 'shared' | 'private'; overridden: boolean; }
export interface BotSkillsView { skills: BotSkillView[]; errors: string[]; }
