export interface BotWorkspaceFile {
  id: string; botId: string; path: string; name: string; bytes: number; updatedAt: string;
}
export interface BotDirectory {
  root: string; workspace: string; inputs: string; outputs: string; skills: string;
  pending: number; error?: string;
}
