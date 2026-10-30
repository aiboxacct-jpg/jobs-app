#!/usr/bin/env node
/**
 * Import a Muse Jobs-app export (the listJobs tool-output JSON; jobs live
 * under .data.jobs) into Supabase.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/import-seed.mjs <path-to-export.json>
 *
 * Upserts by url. Rows whose existing status is Applied or Saved are never
 * downgraded: their status, applied date, documents, and apply fields are
 * preserved (same rule as the addJobs API action). Artifact ids are kept
 * when present so applied-date/document cross-references stay stable.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const path = process.argv[2];
if (!path) {
  console.error("usage: node scripts/import-seed.mjs <export.json>");
  process.exit(1);
}
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  process.exit(1);
}

const raw = JSON.parse(readFileSync(path, "utf8"));
const jobs = raw?.data?.jobs || raw?.jobs || [];
if (!Array.isArray(jobs) || jobs.length === 0) {
  console.error("no jobs found in export (expected .data.jobs)");
  process.exit(1);
}
console.log(`export contains ${jobs.length} jobs`);

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
};
const DATE_FIELDS = new Set(["postedDate", "foundDate", "appliedDate"]);

function toRow(job) {
  const row = {};
  if (Number.isFinite(job.id)) row.id = job.id;
  for (const [camel, snake] of Object.entries(FIELD_MAP)) {
    let v = job[camel];
    if (v === undefined) continue;
    if (DATE_FIELDS.has(camel)) v = v ? String(v).slice(0, 10) : null;
    if (v === "") v = null;
    row[snake] = v;
  }
  if (!row.status) row.status = "New";
  if (!Array.isArray(row.documents)) row.documents = [];
  row.apply_requested = !!row.apply_requested;
  row.apply_acknowledged = !!row.apply_acknowledged;
  return row;
}

const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Load existing rows so protected statuses survive a re-import.
const { data: existing, error: exErr } = await db
  .from("jobs")
  .select("url,status");
if (exErr) throw exErr;
const protectedUrls = new Map(
  (existing || [])
    .filter((r) => r.status === "Applied" || r.status === "Saved")
    .map((r) => [r.url, r.status])
);

const rows = jobs.map((job) => {
  const row = toRow(job);
  if (protectedUrls.has(row.url)) {
    delete row.status;
    delete row.applied_date;
    delete row.documents;
    delete row.apply_requested;
    delete row.apply_requested_at;
    delete row.apply_acknowledged;
  }
  return row;
});

let done = 0;
for (let i = 0; i < rows.length; i += 100) {
  const batch = rows.slice(i, i + 100);
  const { error } = await db.from("jobs").upsert(batch, { onConflict: "url" });
  if (error) throw error;
  done += batch.length;
  console.log(`upserted ${done}/${rows.length}`);
}

const { data: after, error: cntErr } = await db.from("jobs").select("status");
if (cntErr) throw cntErr;
const counts = { total: after.length };
for (const r of after) counts[r.status || "New"] = (counts[r.status || "New"] || 0) + 1;
console.log("counts by status after import:", JSON.stringify(counts));
