import { NextResponse } from "next/server";
import { getServiceClient, getUserFromToken } from "../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Field mapping: camelCase on the wire (same as the Muse artifact),
// snake_case in Postgres.
// ---------------------------------------------------------------------------
const FIELD_MAP = {
  url: "url",
  title: "title",
  company: "company",
  companyAbout: "company_about",
  description: "description",
  whyFit: "why_fit",
  location: "location",
  workMode: "work_mode",
  salary: "salary",
  postedDate: "posted_date",
  foundDate: "found_date",
  source: "source",
  status: "status",
  appliedDate: "applied_date",
  applyRequested: "apply_requested",
  applyRequestedAt: "apply_requested_at",
  applyAcknowledged: "apply_acknowledged",
  documents: "documents",
  matchScore: "match_score",
  matchReasons: "match_reasons",
  applyLater: "apply_later",
};

const DATE_FIELDS = new Set(["postedDate", "foundDate", "appliedDate"]);
const BOOL_FIELDS = new Set(["applyRequested", "applyAcknowledged", "applyLater"]);

function cleanValue(field, value) {
  if (value === undefined) return undefined;
  if (BOOL_FIELDS.has(field)) return !!value;
  if (DATE_FIELDS.has(field)) {
    if (value === null || value === "") return null;
    return String(value).slice(0, 10);
  }
  if (value === "") return null;
  return value;
}

function toColumns(job, { partial = false } = {}) {
  const out = {};
  for (const [camel, snake] of Object.entries(FIELD_MAP)) {
    if (!(camel in job)) continue;
    const v = cleanValue(camel, job[camel]);
    if (partial && v === undefined) continue;
    out[snake] = v === undefined ? (BOOL_FIELDS.has(camel) ? false : null) : v;
  }
  return out;
}

function toCamel(row) {
  if (!row) return null;
  const out = { id: row.id };
  for (const [camel, snake] of Object.entries(FIELD_MAP)) {
    out[camel] = row[snake] ?? null;
  }
  out.documents = Array.isArray(row.documents) ? row.documents : [];
  out.applyRequested = !!row.apply_requested;
  out.applyAcknowledged = !!row.apply_acknowledged;
  out.applyLater = !!row.apply_later;
  return out;
}

function todayInLosAngeles() {
  // en-CA renders as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// ---------------------------------------------------------------------------
// Auth: either the shared feed key (cron jobs / watcher) via x-feed-key,
// or a Supabase user session token as Authorization: Bearer <token>.
// ---------------------------------------------------------------------------
async function authorize(req) {
  const feedKey = process.env.FEED_API_KEY;
  const given = req.headers.get("x-feed-key");
  if (feedKey && given && given === feedKey) return { via: "feed" };

  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) {
    const user = await getUserFromToken(m[1].trim());
    if (user) return { via: "user", user };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
async function listJobs(db) {
  const { data, error } = await db
    .from("jobs")
    .select("*")
    .order("id", { ascending: false });
  if (error) throw error;
  const counts = { total: data.length };
  for (const row of data) {
    counts[row.status || "New"] = (counts[row.status || "New"] || 0) + 1;
  }
  return { counts, jobs: data.map(toCamel) };
}

async function addJobs(db, body) {
  const incoming = Array.isArray(body.jobs) ? body.jobs : [];
  let added = 0;
  let updated = 0;
  for (const job of incoming) {
    if (!job || !job.url) continue;
    const { data: existing, error: selErr } = await db
      .from("jobs")
      .select("*")
      .eq("url", job.url)
      .maybeSingle();
    if (selErr) throw selErr;

    if (!existing) {
      const cols = toColumns(job);
      if (!cols.status) cols.status = "New";
      let { error } = await db.from("jobs").insert(cols);
      if (error && /apply_later/.test(String(error.message || ""))) {
        // The apply_later column lands via a one-line SQL migration; until
        // it has run, insert without it so a pending migration can never
        // break the feeds.
        delete cols.apply_later;
        ({ error } = await db.from("jobs").insert(cols));
      }
      if (error) throw error;
      added++;
    } else {
      const cols = toColumns(job, { partial: true });
      delete cols.url;
      // Never downgrade an Applied or Saved job: a feed re-sighting a job
      // must not reset its status, applied date, documents, or apply state.
      if (existing.status === "Applied" || existing.status === "Saved") {
        delete cols.status;
        delete cols.applied_date;
        delete cols.documents;
        delete cols.apply_requested;
        delete cols.apply_requested_at;
        delete cols.apply_acknowledged;
      }
      if (Object.keys(cols).length > 0) {
        const { error } = await db.from("jobs").update(cols).eq("id", existing.id);
        if (error) throw error;
      }
      updated++;
    }
  }
  return { added, updated, received: incoming.length };
}

async function getJobOrThrow(db, id) {
  const { data, error } = await db
    .from("jobs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`job ${id} not found`);
  return data;
}

// Several callers (the cron feeds and the apply watcher) identify a job by
// its posting URL rather than its numeric id. Resolve either shape.
async function resolveJob(db, body) {
  if (body.id !== undefined && body.id !== null) {
    return getJobOrThrow(db, body.id);
  }
  if (body.url) {
    const { data, error } = await db
      .from("jobs")
      .select("*")
      .eq("url", body.url)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error(`no job with url ${body.url}`);
    return data;
  }
  throw new Error("an id or url is required");
}

async function updateJob(db, body) {
  const { id, url, ...fields } = body;
  const row = await resolveJob(db, body);
  const cols = toColumns(fields, { partial: true });
  delete cols.url;
  const { data, error } = await db
    .from("jobs")
    .update(cols)
    .eq("id", row.id)
    .select("*")
    .single();
  if (error) throw error;
  return { job: toCamel(data) };
}

async function setStatus(db, body) {
  const { status } = body;
  if (!status) throw new Error("setStatus requires a status");
  const { id } = await resolveJob(db, body);
  const cols = { status };
  if (status === "Applied") {
    // Stamp the applied date (America/Los_Angeles today) unless one is given.
    cols.applied_date =
      body.appliedDate !== undefined && body.appliedDate !== null
        ? String(body.appliedDate).slice(0, 10)
        : todayInLosAngeles();
  } else if ("appliedDate" in body) {
    cols.applied_date =
      body.appliedDate === null ? null : String(body.appliedDate).slice(0, 10);
  }
  const { data, error } = await db
    .from("jobs")
    .update(cols)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return { job: toCamel(data) };
}

async function requestApply(db, body) {
  const row = await resolveJob(db, body);
  if (!row.apply_requested) {
    const { data, error } = await db
      .from("jobs")
      .update({
        apply_requested: true,
        apply_requested_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .select("*")
      .single();
    if (error) throw error;
    return { job: toCamel(data), alreadyRequested: false };
  }
  // Dedupe: a second click changes nothing.
  return { job: toCamel(row), alreadyRequested: true };
}

async function listApplyRequests(db) {
  const { data, error } = await db
    .from("jobs")
    .select("*")
    .eq("apply_requested", true)
    .eq("apply_acknowledged", false)
    .order("apply_requested_at", { ascending: true });
  if (error) throw error;
  const requests = data.map(toCamel);
  return { requests, jobs: requests, count: requests.length };
}

async function ackApplyRequest(db, body) {
  const row = await resolveJob(db, body);
  const { data, error } = await db
    .from("jobs")
    .update({ apply_acknowledged: true })
    .eq("id", row.id)
    .select("*")
    .single();
  if (error) throw error;
  return { job: toCamel(data) };
}

async function appendDocuments(db, row, documents) {
  const docs = Array.isArray(documents) ? documents : [];
  const merged = [...(Array.isArray(row.documents) ? row.documents : []), ...docs];
  const { data, error } = await db
    .from("jobs")
    .update({ documents: merged })
    .eq("id", row.id)
    .select("*")
    .single();
  if (error) throw error;
  return { job: toCamel(data), documentsAdded: docs.length };
}

async function attachDocuments(db, body) {
  const row = await resolveJob(db, body);
  return appendDocuments(db, row, body.documents);
}

async function attachPackageDocuments(db, body) {
  if (!body.url) throw new Error("attachPackageDocuments requires url");
  const { data: row, error } = await db
    .from("jobs")
    .select("*")
    .eq("url", body.url)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw new Error(`no job with url ${body.url}`);
  return appendDocuments(db, row, body.documents);
}

async function setDocumentContent(db, body) {
  const row = await resolveJob(db, body);
  const docs = (Array.isArray(row.documents) ? row.documents : []).map((d) =>
    d && d.label === body.label ? { ...d, content: body.content ?? null } : d
  );
  const { data, error } = await db
    .from("jobs")
    .update({ documents: docs })
    .eq("id", row.id)
    .select("*")
    .single();
  if (error) throw error;
  return { job: toCamel(data) };
}

async function removeDocument(db, body) {
  const row = await resolveJob(db, body);
  const docs = (Array.isArray(row.documents) ? row.documents : []).filter(
    (d) => !(d && d.label === body.label)
  );
  const { data, error } = await db
    .from("jobs")
    .update({ documents: docs })
    .eq("id", row.id)
    .select("*")
    .single();
  if (error) throw error;
  return { job: toCamel(data) };
}

const ACTIONS = {
  listJobs,
  addJobs,
  updateJob,
  setStatus,
  requestApply,
  listApplyRequests,
  ackApplyRequest,
  attachDocuments,
  attachPackageDocuments,
  setDocumentContent,
  removeDocument,
};

export async function POST(req, { params }) {
  const { action } = await params;
  const fn = ACTIONS[action];
  if (!fn) {
    return NextResponse.json(
      { ok: false, error: `unknown action: ${action}` },
      { status: 404 }
    );
  }
  const auth = await authorize(req).catch(() => null);
  if (!auth) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    );
  }
  let body = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  try {
    const db = getServiceClient();
    const result = await fn(db, body || {});
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}
