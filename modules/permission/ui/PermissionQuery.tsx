import { useState } from 'react';
import { MagnifyingGlass, ShieldCheck, Sparkle } from '@phosphor-icons/react';
import './permission.css';

export function PermissionQuery({ onAskAI }: {
  onAskAI?(prompt: string): void;
}) {
  const [query, setQuery] = useState('');

  return (
    <section className="view on panel glass" id="view-permission-query" aria-label="权限查询">
      <div className="perm-query-layout">
        <div className="greet">
          <div>
            <h1>权限查询</h1>
            <div className="gsub">查询用户、角色或资源的权限分配情况</div>
          </div>
        </div>

        <div className="perm-search-bar">
          <input
            type="search"
            placeholder="输入用户名、角色名或资源标识…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="搜索权限"
          />
          <button className="btn btn-pri" type="button" disabled={!query.trim()}>
            <MagnifyingGlass size={15} weight="bold" />查询
          </button>
          {onAskAI && (
            <button
              className="btn btn-sec"
              type="button"
              onClick={() => onAskAI(`帮我分析权限查询：${query || '(未输入查询条件)'}`)}
            >
              <Sparkle size={15} weight="fill" />AI 分析
            </button>
          )}
        </div>

        <div className="perm-result-empty">
          <ShieldCheck size={40} className="perm-result-icon" />
          输入查询条件后点击查询，结果将展示在这里
        </div>
      </div>
    </section>
  );
}
