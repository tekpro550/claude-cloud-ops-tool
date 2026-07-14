import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createTicketTodo, deleteTicketTodo, listTicketTodos, updateTicketTodo } from "../lib/apiClient";
import type { TicketTodo } from "../types/ticket";

export default function TicketTodos({ tenantId, ticketId }: { tenantId: string; ticketId: string }) {
  const [todos, setTodos] = useState<TicketTodo[]>([]);
  const [newBody, setNewBody] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    listTicketTodos(tenantId, ticketId).then(setTodos);
  };

  useEffect(load, [tenantId, ticketId]);

  const handleAdd = (event: FormEvent) => {
    event.preventDefault();
    if (!newBody.trim()) return;
    setBusy(true);
    createTicketTodo(tenantId, ticketId, newBody)
      .then(() => {
        setNewBody("");
        load();
      })
      .finally(() => setBusy(false));
  };

  const toggle = (todo: TicketTodo) => {
    updateTicketTodo(tenantId, ticketId, todo.id, { isDone: !todo.is_done }).then(load);
  };

  const remove = (todo: TicketTodo) => {
    deleteTicketTodo(tenantId, ticketId, todo.id).then(load);
  };

  return (
    <div className="todo-list">
      {todos.length === 0 && <p className="hint">No to-dos yet.</p>}
      <ul>
        {todos.map((todo) => (
          <li key={todo.id} className={todo.is_done ? "todo-done" : ""}>
            <label>
              <input type="checkbox" checked={todo.is_done} onChange={() => toggle(todo)} />
              {todo.body}
            </label>
            <button type="button" className="link-button" onClick={() => remove(todo)} aria-label={`Delete to-do: ${todo.body}`}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={handleAdd} className="todo-form">
        <input placeholder="Add a to-do…" value={newBody} onChange={(e) => setNewBody(e.target.value)} />
        <button type="submit" disabled={busy}>
          Add
        </button>
      </form>
    </div>
  );
}
