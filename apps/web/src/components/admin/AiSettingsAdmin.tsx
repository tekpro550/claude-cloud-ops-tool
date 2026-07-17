import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError, getAiSettings, updateAiSettings, type AiProvider } from "../../lib/apiClient";

type ModelKind = "closed" | "open";

// Closed = hosted proprietary models; Open = an open / self-hosted model served
// over an OpenAI-compatible endpoint (Ollama, vLLM, LM Studio, …).
const CLOSED_PROVIDERS: { value: AiProvider; label: string; modelPlaceholder: string }[] = [
  { value: "anthropic", label: "Anthropic (Claude)", modelPlaceholder: "claude-sonnet-4-5" },
  { value: "openai", label: "OpenAI (GPT)", modelPlaceholder: "gpt-4o" },
  { value: "gemini", label: "Google (Gemini)", modelPlaceholder: "gemini-2.0-flash" },
  { value: "grok", label: "xAI (Grok)", modelPlaceholder: "grok-2-latest" },
  { value: "llama", label: "Meta (Llama)", modelPlaceholder: "llama-3.3-70b" },
];

export default function AiSettingsAdmin({ tenantId, onChange }: { tenantId: string; onChange?: () => void }) {
  const [kind, setKind] = useState<ModelKind>("closed");
  const [provider, setProvider] = useState<AiProvider>("anthropic");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [isEnabled, setIsEnabled] = useState(true);
  const [hasStoredKey, setHasStoredKey] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getAiSettings(tenantId)
      .then((settings) => {
        if (!settings) return;
        setKind(settings.provider === "openai_compatible" ? "open" : "closed");
        setProvider(settings.provider);
        setModel(settings.model);
        setBaseUrl(settings.base_url ?? "");
        setIsEnabled(settings.is_enabled);
        setHasStoredKey(settings.has_api_key);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load AI settings"));
  }, [tenantId]);

  const chooseKind = (next: ModelKind) => {
    setKind(next);
    // Snap the provider to a valid value for the chosen kind.
    if (next === "open") setProvider("openai_compatible");
    else if (provider === "openai_compatible") setProvider("anthropic");
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!model.trim()) return;
    if (kind === "open" && !baseUrl.trim()) {
      setError("A base URL is required for an open / self-hosted model.");
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    updateAiSettings(tenantId, {
      provider,
      model: model.trim(),
      baseUrl: kind === "open" ? baseUrl.trim() : baseUrl.trim() || undefined,
      // Only send the key when the admin typed a new one; blank keeps the stored key.
      apiKey: apiKey ? apiKey : undefined,
      isEnabled,
    })
      .then((settings) => {
        setHasStoredKey(settings.has_api_key);
        setApiKey("");
        setSaved(true);
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to save AI settings"))
      .finally(() => setBusy(false));
  };

  const closedProvider = CLOSED_PROVIDERS.find((p) => p.value === provider);
  const modelPlaceholder = kind === "open" ? "llama3.1" : (closedProvider?.modelPlaceholder ?? "");

  return (
    <div className="admin-entity">
      <h4>AI assist</h4>
      <p className="hint">
        Powers ticket thread summaries and suggested replies. Choose a hosted model and paste its API key, or point at
        your own open / self-hosted model.
      </p>
      {error && <p className="error">{error}</p>}

      <form className="modal-form" onSubmit={handleSubmit}>
        <div className="ai-kind-toggle" role="group" aria-label="Model type">
          <button
            type="button"
            className={`ai-kind-option${kind === "closed" ? " ai-kind-option-active" : ""}`}
            onClick={() => chooseKind("closed")}
          >
            <strong>Closed (hosted)</strong>
            <span className="hint">Anthropic, OpenAI, Gemini, Grok or Llama — you supply an API key</span>
          </button>
          <button
            type="button"
            className={`ai-kind-option${kind === "open" ? " ai-kind-option-active" : ""}`}
            onClick={() => chooseKind("open")}
          >
            <strong>Open (self-hosted)</strong>
            <span className="hint">Any OpenAI-compatible endpoint (Ollama, vLLM, …)</span>
          </button>
        </div>

        {kind === "closed" && (
          <label>
            Provider
            <select value={provider} onChange={(e) => setProvider(e.target.value as AiProvider)}>
              {CLOSED_PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {kind === "open" && (
          <label>
            Base URL
            <input
              placeholder="http://localhost:11434/v1"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              required
            />
          </label>
        )}

        <label>
          Model
          <input placeholder={modelPlaceholder} value={model} onChange={(e) => setModel(e.target.value)} required />
        </label>

        <label>
          API key
          <input
            type="password"
            placeholder={hasStoredKey ? "•••••••• (stored — leave blank to keep)" : kind === "open" ? "Optional for local models" : "Paste the provider API key"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="off"
          />
        </label>

        <label className="inline-check">
          <input type="checkbox" checked={isEnabled} onChange={(e) => setIsEnabled(e.target.checked)} /> Enable AI assist
        </label>

        <div className="modal-form-actions">
          {saved && <span className="hint">Saved.</span>}
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Save AI settings"}
          </button>
        </div>
      </form>
    </div>
  );
}
