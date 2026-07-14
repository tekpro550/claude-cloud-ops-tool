import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError, search } from "../lib/apiClient";
import { formatTicketNumber } from "../lib/ticketNumber";
import { useTenant } from "../lib/tenant";
import type { SearchResults, SearchScope } from "../types/ticket";

const SCOPES: SearchScope[] = ["all", "tickets", "contacts", "companies"];

export default function SearchPage() {
  const { tenantId } = useTenant();
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get("q") ?? "";
  const scope = (searchParams.get("scope") as SearchScope | null) ?? "all";

  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId || !q.trim()) {
      setResults(null);
      return;
    }
    setLoading(true);
    setError(null);
    search(tenantId, q, scope)
      .then(setResults)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Search failed"))
      .finally(() => setLoading(false));
  }, [tenantId, q, scope]);

  if (!tenantId) {
    return <p className="hint">Set a tenant id above to search.</p>;
  }

  const totalResults = results ? results.tickets.length + results.contacts.length + results.companies.length : 0;

  return (
    <div>
      <h2>Search</h2>
      <div className="toolbar">
        <input
          placeholder="Search tickets, contacts, companies…"
          value={q}
          onChange={(e) => setSearchParams({ q: e.target.value, scope })}
        />
        <select value={scope} onChange={(e) => setSearchParams({ q, scope: e.target.value })}>
          {SCOPES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="error">{error}</p>}
      {loading && <p>Searching…</p>}
      {!loading && q.trim() && results && totalResults === 0 && <p className="hint">No results for "{q}".</p>}

      {results && results.tickets.length > 0 && (
        <div className="admin-entity">
          <h4>Tickets</h4>
          <ul className="admin-list">
            {results.tickets.map((t) => (
              <li key={t.id}>
                <Link to={`/tickets/${t.id}`}>
                  {formatTicketNumber(t)} — {t.subject}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {results && results.contacts.length > 0 && (
        <div className="admin-entity">
          <h4>Contacts</h4>
          <ul className="admin-list">
            {results.contacts.map((c) => (
              <li key={c.id}>
                <span>
                  <strong>{c.name}</strong> <span className="hint">{c.email}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {results && results.companies.length > 0 && (
        <div className="admin-entity">
          <h4>Companies</h4>
          <ul className="admin-list">
            {results.companies.map((c) => (
              <li key={c.id}>
                <strong>{c.name}</strong>
                {c.domain && <span className="hint"> — {c.domain}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
