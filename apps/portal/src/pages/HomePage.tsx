import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

export default function HomePage() {
  const { contact } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState("");

  const handleSearch = (event: FormEvent) => {
    event.preventDefault();
    navigate(q.trim() ? `/solutions?q=${encodeURIComponent(q)}` : "/solutions");
  };

  return (
    <div className="home-page">
      <h2>How can we help?</h2>
      <form className="home-search" onSubmit={handleSearch}>
        <input placeholder="Search our knowledge base…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="submit">Search</button>
      </form>

      <div className="home-cards">
        <Link to="/submit" className="home-card">
          <h3>Submit a ticket</h3>
          <p>Tell us what's going on and we'll get back to you.</p>
        </Link>
        <Link to="/solutions" className="home-card">
          <h3>Browse solutions</h3>
          <p>Answers to common questions.</p>
        </Link>
        <Link to={contact ? "/tickets" : "/login"} className="home-card">
          <h3>{contact ? "My tickets" : "Track a ticket"}</h3>
          <p>{contact ? "View the status of your requests." : "Log in to see your ticket history."}</p>
        </Link>
      </div>
    </div>
  );
}
