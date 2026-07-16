import { useEffect, useRef } from "react";

/**
 * A dependency-free rich-text editor: a contentEditable surface plus a small
 * formatting toolbar. Emits HTML (the backend sanitizes it on write, so the
 * allowlist there is the real trust boundary). Kept controlled-ish -- the
 * incoming `value` is written into the DOM only when it differs from what the
 * editor already shows and the editor isn't focused, so external updates
 * (inserting a canned response) apply without clobbering the caret mid-type.
 */
export default function RichTextEditor({
  value,
  onChange,
  onInput,
  placeholder,
}: {
  value: string;
  onChange: (html: string) => void;
  onInput?: () => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement !== el && el.innerHTML !== value) {
      el.innerHTML = value;
    }
  }, [value]);

  const exec = (command: string, arg?: string) => {
    ref.current?.focus();
    // execCommand is deprecated but still the only zero-dependency way to get
    // rich-text editing across current browsers; the emitted HTML is
    // sanitized server-side regardless.
    document.execCommand(command, false, arg);
    if (ref.current) onChange(ref.current.innerHTML);
  };

  const addLink = () => {
    const url = window.prompt("Link URL");
    if (url) exec("createLink", url);
  };

  const handleInput = () => {
    if (ref.current) onChange(ref.current.innerHTML);
    onInput?.();
  };

  return (
    <div className="rich-editor">
      <div className="rich-editor-toolbar">
        <button type="button" title="Bold" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("bold")}>
          <strong>B</strong>
        </button>
        <button type="button" title="Italic" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("italic")}>
          <em>I</em>
        </button>
        <button type="button" title="Underline" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("underline")}>
          <u>U</u>
        </button>
        <span className="rich-editor-sep" />
        <button type="button" title="Bulleted list" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("insertUnorderedList")}>
          • List
        </button>
        <button type="button" title="Numbered list" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("insertOrderedList")}>
          1. List
        </button>
        <span className="rich-editor-sep" />
        <button type="button" title="Insert link" onMouseDown={(e) => e.preventDefault()} onClick={addLink}>
          🔗 Link
        </button>
        <button type="button" title="Clear formatting" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("removeFormat")}>
          Clear
        </button>
      </div>
      <div
        ref={ref}
        className="rich-editor-surface"
        contentEditable
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder ?? ""}
        onInput={handleInput}
        suppressContentEditableWarning
      />
    </div>
  );
}
