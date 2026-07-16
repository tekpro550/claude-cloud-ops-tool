import { useState } from "react";
import type { KeyboardEvent } from "react";

interface TicketTagsProps {
  tags: string[];
  disabled?: boolean;
  // Called with the full next tag set whenever the user adds or removes one.
  onChange: (next: string[]) => void;
}

/**
 * Freshdesk-style tag chips: existing tags render as removable chips, a text
 * input adds new ones on Enter or comma. De-dupes and trims here so the caller
 * (and the server) always receive a clean set.
 */
export default function TicketTags({ tags, disabled, onChange }: TicketTagsProps) {
  const [draft, setDraft] = useState("");

  const addTag = (raw: string) => {
    const tag = raw.trim();
    if (!tag || tags.includes(tag)) {
      setDraft("");
      return;
    }
    onChange([...tags, tag]);
    setDraft("");
  };

  const removeTag = (tag: string) => {
    onChange(tags.filter((t) => t !== tag));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(draft);
    } else if (e.key === "Backspace" && draft === "" && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    }
  };

  return (
    <div className="ticket-tags">
      <div className="ticket-tags-chips">
        {tags.map((tag) => (
          <span key={tag} className="ticket-tag-chip">
            {tag}
            {!disabled && (
              <button
                type="button"
                className="ticket-tag-remove"
                aria-label={`Remove tag ${tag}`}
                onClick={() => removeTag(tag)}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {tags.length === 0 && <span className="hint">No tags</span>}
      </div>
      {!disabled && (
        <input
          type="text"
          className="ticket-tags-input"
          placeholder="Add tag, press Enter"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => draft.trim() && addTag(draft)}
        />
      )}
    </div>
  );
}
