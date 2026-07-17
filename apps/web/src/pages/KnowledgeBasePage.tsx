import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, listSolutions, updateSolution } from "../lib/apiClient";
import { useTenant } from "../lib/tenant";
import type { Solution } from "../types/ticket";

// Internal knowledge base: agent-facing grid of solution articles, searchable.
// Articles are auto-seeded as drafts when a ticket is resolved; only published
// ones reach the customer portal, so drafts stay internal until reviewed.
export default function KnowledgeBasePage() {
  const { tenantId } = useTenant();
  const [articles, setArticles] = useState<Solution[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!tenantId) return;
    setLoading(true);
    listSolutions(tenantId, search)
      .then(setArticles)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load the knowledge base"))
      .finally(() => setLoading(false));
  };

  // Debounce the search so typing doesn't fire a request per keystroke.
  useEffect(() => {
    if (!tenantId) return;
    const handle = setTimeout(load, 250);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, search]);

  const togglePublished = (article: Solution) => {
    if (!tenantId) return;
    updateSolution(tenantId, article.id, { isPublished: !article.is_published })
      .then((updated) => setArticles((prev) => prev.map((a) => (a.id === updated.id ? updated : a))))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to update the article"));
  };

  const snippet = (body: string) => (body.length > 180 ? `${body.slice(0, 180)}…` : body);

  if (!tenantId) {
    return <p className="hint">Set a tenant id above to view the knowledge base.</p>;
  }

  return (
    <div>
      <div className="page-header">
        <h2>Knowledge base</h2>
        <span className="hint">Internal — {articles.length} article{articles.length === 1 ? "" : "s"}</span>
      </div>
      <div className="toolbar">
        <input
          placeholder="Search articles by title or content"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {error && <p className="error">{error}</p>}
      {!loading && articles.length === 0 && (
        <p className="hint">
          {search
            ? "No articles match your search."
            : "No articles yet. Resolving a ticket automatically drafts one from the agent's reply."}
        </p>
      )}

      <div className="kb-grid">
        {articles.map((article) => (
          <article key={article.id} className="kb-card">
            <div className="kb-card-head">
              <h3 className="kb-card-title">{article.title}</h3>
              <span className={`badge ${article.is_published ? "kb-badge-published" : "kb-badge-draft"}`}>
                {article.is_published ? "Published" : "Draft"}
              </span>
            </div>
            <p className="kb-card-body">{snippet(article.body)}</p>
            <div className="kb-card-foot">
              {article.source_ticket_id && (
                <Link className="link-button" to={`/tickets/${article.source_ticket_id}`}>
                  From ticket
                </Link>
              )}
              <button type="button" className="link-button" onClick={() => togglePublished(article)}>
                {article.is_published ? "Unpublish" : "Publish"}
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
