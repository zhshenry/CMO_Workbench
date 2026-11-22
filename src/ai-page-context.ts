import type { ViewId } from '../shared/contracts';
import { TODO_AI_WORKBENCH_NAME, type AiScope } from '../shared/ai-scope';
import { workbenchAiContext } from './nav';

export interface PageAiSelection {
  reading: { id: string; title: string } | null;
}

export interface PageAiContext {
  scope: AiScope;
  label: string;
  object: string;
}

/** 当前页面交给助手卡片的上下文。待办和已选书目继续用各自的专用名称。 */
export function pageAiContext(view: ViewId, selection: PageAiSelection): PageAiContext {
  if (view === 'todo') return { scope: { module: 'todo' }, label: '日程待办', object: TODO_AI_WORKBENCH_NAME };
  if (view === 'reading' && selection.reading) {
    return { scope: { module: 'reading', profileId: selection.reading.id }, label: '阅读助手', object: selection.reading.title };
  }
  const page = workbenchAiContext(view);
  return { scope: { module: 'workbench', viewId: view }, label: page.label, object: page.object };
}
