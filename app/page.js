"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getBrowserClient } from "../lib/supabase-browser";
import { hourlyEquivalent, payType } from "../lib/pay";

const STATUSES = ["New", "Saved", "Applied", "Skipped", "Expired"];
const WORK_MODES = ["Remote", "Hybrid", "On-site"];

async function callAction(token, action, body = {}) {
  const res = await fetch(`/api/actions/${action}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `request failed (${res.status})`);
  }
  return data;
}

function fmtDate(d) {
  return d ? String(d).slice(0, 10) : "";
}

function fmtDateTime(d) {
  if (!d) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(d));
  } catch {
    return fmtDate(d);
  }
}

function hastText(node) {
  if (!node) return "";
  if (node.type === "text") return node.value || "";
  return (node.children || []).map(hastText).join("");
}

// Skills-match documents are a 2-column markdown table ("What the posting
// asks for" | "Matt's match"). The original app rendered each row as a
// card; keep that look. Any other table falls back to a styled HTML table.
function MdTable({ node }) {
  const rows = [];
  const walk = (n) => {
    if (!n) return;
    if (n.tagName === "tr") {
      const cells = (n.children || [])
        .filter((c) => c.tagName === "td" || c.tagName === "th")
        .map(hastText);
      rows.push(cells);
      return;
    }
    (n.children || []).forEach(walk);
  };
  walk(node);
  const header = rows[0] || [];
  const isMatchTable =
    header.length === 2 && /match/i.test(header[1] || "") && rows.length > 1;
  if (isMatchTable) {
    return (
      <div className="match-cards">
        {rows.slice(1).map((cells, i) => (
          <div className="match-card" key={i}>
            <p className="match-req">{cells[0]}</p>
            <p className="match-body">
              <span className="match-label">{header[1]}:</span> {cells[1]}
            </p>
          </div>
        ))}
      </div>
    );
  }
  return (
    <table className="md-table">
      <tbody>
        {rows.map((cells, i) => (
          <tr key={i}>
            {cells.map((c, j) =>
              i === 0 ? <th key={j}>{c}</th> : <td key={j}>{c}</td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const MD_COMPONENTS = { table: MdTable };

function DocViewer({ job, openDoc, setOpenDoc }) {
  const docs = job.documents || [];
  if (!docs.length) return null;
  const selected =
    docs.find((d) => d.label === openDoc) ||
    docs.find((d) => d.content) ||
    docs[0];
  return (
    <>
      <div className="docs-head">
        <h4>Application documents</h4>
        <a
          href="https://drive.google.com/drive/folders/15-Z16BkdDGcnYWLQAeDkYKa0oK0cDeps"
          target="_blank"
          rel="noopener noreferrer"
        >
          Drive folder ↗
        </a>
      </div>
      <div className="doc-tabs">
        {docs.map((doc, i) => (
          <button
            key={`${doc.label}-${i}`}
            className={`doc-tab${doc.label === selected.label ? " active" : ""}`}
            onClick={() => setOpenDoc(doc.label)}
          >
            {doc.label}
          </button>
        ))}
      </div>
      <div className="doc-pane">
        {selected.url && (
          <div className="doc-pane-head">
            <a href={selected.url} target="_blank" rel="noopener noreferrer">
              Open in Drive ↗
            </a>
          </div>
        )}
        {selected.content ? (
          <div className="doc-content md">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
              {selected.content}
            </ReactMarkdown>
          </div>
        ) : (
          <p className="no-detail">
            This file lives in Drive — use “Open in Drive ↗” above to view or
            download it.
          </p>
        )}
      </div>
    </>
  );
}

export default function JobsPage() {
  const tokenRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [counts, setCounts] = useState({ total: 0 });
  const [error, setError] = useState("");

  const [statusFilter, setStatusFilter] = useState("Active");
  const [sourceFilter, setSourceFilter] = useState("All");
  const [modeFilter, setModeFilter] = useState("All");
  const [payFilter, setPayFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const [expanded, setExpanded] = useState(null);
  const [openDoc, setOpenDoc] = useState(null); // selected document label
  const [pkgOpen, setPkgOpen] = useState(null); // job id with package panel open
  const [busy, setBusy] = useState(null); // `${jobId}:${op}`

  const refresh = useCallback(async () => {
    const data = await callAction(tokenRef.current, "listJobs");
    setJobs(data.jobs || []);
    setCounts(data.counts || { total: 0 });
  }, []);

  useEffect(() => {
    (async () => {
      const supabase = getBrowserClient();
      const { data } = await supabase.auth.getSession();
      if (!data?.session) {
        window.location.replace("/login");
        return;
      }
      tokenRef.current = data.session.access_token;
      try {
        await refresh();
      } catch (err) {
        setError(String(err?.message || err));
      }
      setReady(true);
      // Keep the token fresh for later clicks.
      supabase.auth.onAuthStateChange((_e, session) => {
        if (session) tokenRef.current = session.access_token;
      });
    })();
  }, [refresh]);

  const sources = useMemo(
    () => [...new Set(jobs.map((j) => j.source).filter(Boolean))].sort(),
    [jobs]
  );

  const applyLaterCount = useMemo(
    () => jobs.filter((j) => j.applyLater).length,
    [jobs]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = jobs.filter((j) => {
      if (statusFilter === "ApplyLater") {
        // Highlight view: every flagged job, whatever its status.
        if (!j.applyLater) return false;
      } else if (statusFilter === "Active") {
        // Main list: active jobs only. Skipped/Expired live under their
        // own tabs and leave this list the moment they're marked.
        if (j.status === "Skipped" || j.status === "Expired") return false;
      } else if (statusFilter !== "All" && j.status !== statusFilter) {
        return false;
      }
      if (sourceFilter !== "All" && j.source !== sourceFilter) return false;
      if (modeFilter !== "All" && j.workMode !== modeFilter) return false;
      if (payFilter !== "All" && payType(j.salary) !== payFilter) return false;
      if (q) {
        const hay = `${j.title || ""} ${j.company || ""} ${j.location || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    if (sort === "match") {
      list = [...list].sort((a, b) => {
        const sa = a.matchScore ?? -1;
        const sb = b.matchScore ?? -1;
        return sb - sa;
      });
    }
    if (sort === "pay-desc" || sort === "pay-asc") {
      const dir = sort === "pay-desc" ? -1 : 1;
      list = [...list].sort((a, b) => {
        const pa = hourlyEquivalent(a.salary);
        const pb = hourlyEquivalent(b.salary);
        if (pa === null && pb === null) return 0;
        if (pa === null) return 1; // no-pay always last
        if (pb === null) return -1;
        return (pa - pb) * dir;
      });
    }
    return list;
  }, [jobs, statusFilter, sourceFilter, modeFilter, payFilter, search, sort]);

  async function mutate(job, op, fn) {
    setBusy(`${job.id}:${op}`);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setBusy(null);
    }
  }

  const setStatus = (job, status) =>
    mutate(job, `status-${status}`, () =>
      callAction(tokenRef.current, "setStatus", { id: job.id, status })
    );

  const requestApply = (job) =>
    mutate(job, "apply", () =>
      callAction(tokenRef.current, "requestApply", { id: job.id })
    );

  const toggleApplyLater = (job) =>
    mutate(job, "later", () =>
      callAction(tokenRef.current, "updateJob", {
        id: job.id,
        applyLater: !job.applyLater,
      })
    );

  async function signOut() {
    await getBrowserClient().auth.signOut();
    window.location.replace("/login");
  }

  if (!ready) {
    return (
      <main className="wrap">
        <p className="state-msg">Loading your jobs…</p>
      </main>
    );
  }

  return (
    <main className="wrap">
      <header className="app-head">
        <div>
          <h1>Jobs</h1>
          <div className="total">
            <strong>{counts.total || 0}</strong> jobs ·{" "}
            {STATUSES.map((s) => `${counts[s] || 0} ${s}`).join(" · ")}
          </div>
        </div>
        <button className="signout" onClick={signOut}>
          Sign out
        </button>
      </header>

      <div className="filters">
        {["Active", "All", "ApplyLater", ...STATUSES].map((s) => (
          <button
            key={s}
            className={`chip${statusFilter === s ? " active" : ""}`}
            onClick={() => setStatusFilter(s)}
          >
            {s === "ApplyLater" ? "Apply later" : s}
            <span className="n">
              {s === "All"
                ? counts.total || 0
                : s === "Active"
                  ? (counts.New || 0) + (counts.Saved || 0) + (counts.Applied || 0)
                  : s === "ApplyLater"
                    ? applyLaterCount
                    : counts[s] || 0}
            </span>
          </button>
        ))}
      </div>
      <div className="filters">
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          aria-label="Source"
        >
          <option value="All">All sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={modeFilter}
          onChange={(e) => setModeFilter(e.target.value)}
          aria-label="Work mode"
        >
          <option value="All">All modes</option>
          {WORK_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select
          value={payFilter}
          onChange={(e) => setPayFilter(e.target.value)}
          aria-label="Pay type"
        >
          <option value="All">All pay types</option>
          <option value="Hourly">Hourly</option>
          <option value="Yearly">Yearly</option>
          <option value="None">No pay listed</option>
        </select>
        <input
          type="search"
          placeholder="Search title, company, location…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="sortsel"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          aria-label="Sort"
        >
          <option value="newest">Newest first</option>
          <option value="match">Best match</option>
          <option value="pay-desc">Pay: high → low</option>
          <option value="pay-asc">Pay: low → high</option>
        </select>
      </div>
      <div className="result-count">
        Showing {visible.length} of {counts.total || 0}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {visible.map((job) => {
        const isOpen = expanded === job.id;
        const requested = !!job.applyRequested;
        const acked = !!job.applyAcknowledged;
        return (
          <article
            className={`job-card${job.applyLater ? " apply-later" : ""}`}
            key={job.id}
          >
            <div className="top">
              <h2>
                <a href={job.url} target="_blank" rel="noopener noreferrer">
                  {job.title || "(untitled)"}
                </a>
              </h2>
              {job.applyLater && <span className="later-pill">Apply later</span>}
              <span className={`pill ${job.status}`}>{job.status}</span>
            </div>
            <div className="meta">
              <span className="company">{job.company}</span>
              {job.location ? <> · {job.location}</> : null}{" "}
              {job.workMode && <span className="badge">{job.workMode}</span>}
            </div>
            <div className="meta2">
              {job.salary && <span className="salary">{job.salary}</span>}
              {job.postedDate && <span>Posted {fmtDate(job.postedDate)}</span>}
              {job.foundDate && <span>Found {fmtDate(job.foundDate)}</span>}
              {job.source && <span>via {job.source}</span>}
              {job.status === "Applied" && job.appliedDate && (
                <span>Applied {fmtDate(job.appliedDate)}</span>
              )}
              {job.matchScore != null && (
                <span
                  className="match-badge"
                  title={job.matchReasons || undefined}
                >
                  {job.matchScore}% match
                </span>
              )}
            </div>

            <div className="actions">
              <button
                className="toggle-detail"
                onClick={() => setExpanded(isOpen ? null : job.id)}
              >
                {isOpen ? "Hide details ▲" : "Details ▼"}
              </button>
              <button
                className={`btn later${job.applyLater ? " on" : ""}`}
                disabled={busy !== null}
                onClick={() => toggleApplyLater(job)}
              >
                {job.applyLater ? "✓ Apply later" : "Apply later"}
              </button>
              {job.status !== "Saved" && (
                <button
                  className="btn"
                  disabled={busy !== null}
                  onClick={() => setStatus(job, "Saved")}
                >
                  Save
                </button>
              )}
              {job.status !== "Applied" && (
                <button
                  className="btn"
                  disabled={busy !== null}
                  onClick={() => setStatus(job, "Applied")}
                >
                  Mark applied
                </button>
              )}
              {job.status !== "Skipped" && (
                <button
                  className="btn"
                  disabled={busy !== null}
                  onClick={() => setStatus(job, "Skipped")}
                >
                  Skip
                </button>
              )}
              {job.status !== "New" && (
                <button
                  className="btn"
                  disabled={busy !== null}
                  onClick={() => setStatus(job, "New")}
                >
                  Back to New
                </button>
              )}
              {job.status !== "Expired" && (
                <button
                  className="btn"
                  disabled={busy !== null}
                  onClick={() => setStatus(job, "Expired")}
                >
                  Expire
                </button>
              )}
              <button
                className={`btn apply${requested ? " requested" : ""}`}
                disabled={busy !== null || requested}
                onClick={() => requestApply(job)}
              >
                {requested
                  ? "Apply requested ✓"
                  : "📩 Send to Everest to apply"}
              </button>
            </div>

            {requested && (
              <div className="sent-block">
                <div className="sent-bar">✓ Sent to Everest</div>
                <p className="sent-note">
                  {acked
                    ? "Everest has picked this up — the application package lands in the Developer chat."
                    : `Sent ${fmtDateTime(job.applyRequestedAt)} — Everest will pick this up in chat. The job's status hasn't changed.`}
                </p>
              </div>
            )}

            {Array.isArray(job.documents) && job.documents.length > 0 && (
              <>
                <div className="pkg-row">
                  <button
                    className="pkg-pill"
                    onClick={() => setPkgOpen(pkgOpen === job.id ? null : job.id)}
                  >
                    📩 Application package · {job.documents.length} docs —{" "}
                    {pkgOpen === job.id ? "hide" : "view"}
                  </button>
                </div>
                {pkgOpen === job.id && (
                  <div className="detail pkg-panel">
                    <DocViewer job={job} openDoc={openDoc} setOpenDoc={setOpenDoc} />
                  </div>
                )}
              </>
            )}

            {isOpen && (
              <div className="detail">
                <p className="posting-link">
                  <a href={job.url} target="_blank" rel="noopener noreferrer">
                    Open the original posting ↗
                  </a>
                </p>
                {job.description && (
                  <>
                    <h4>Description</h4>
                    <p>{job.description}</p>
                  </>
                )}
                {(job.companyAbout || job.whyFit) && (
                  <div className="about-card">
                    {job.companyAbout && (
                      <>
                        <h4>About the company</h4>
                        <p>{job.companyAbout}</p>
                      </>
                    )}
                    {job.whyFit && (
                      <p className="whyfit">
                        <span className="why-label">Why it fits:</span>{" "}
                        {job.whyFit}
                      </p>
                    )}
                  </div>
                )}
                {Array.isArray(job.documents) && job.documents.length > 0 && (
                  <DocViewer job={job} openDoc={openDoc} setOpenDoc={setOpenDoc} />
                )}
                {!job.description &&
                  !job.companyAbout &&
                  !job.whyFit &&
                  !(
                    Array.isArray(job.documents) && job.documents.length > 0
                  ) && (
                    <p className="no-detail">
                      No description was captured for this posting — use the
                      original posting link above for the full text. (Jobs
                      saved before October 21, 2026 were stored without
                      descriptions.)
                    </p>
                  )}
              </div>
            )}
          </article>
        );
      })}

      {visible.length === 0 && (
        <p className="state-msg">No jobs match those filters.</p>
      )}
    </main>
  );
}
