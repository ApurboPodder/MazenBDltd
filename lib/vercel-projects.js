import { timingSafeEqual } from "node:crypto";
import { list, put } from "@vercel/blob";

const PROJECT_RECORD_PREFIX = "project-records/";

export function isUploadAuthorized(request) {
  const expectedPassword = process.env.PROJECT_UPLOAD_PASSWORD;
  const suppliedPassword = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!expectedPassword || !suppliedPassword) return false;

  const expected = Buffer.from(expectedPassword);
  const supplied = Buffer.from(suppliedPassword);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

function isBlobUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname.endsWith(".blob.vercel-storage.com");
  } catch {
    return false;
  }
}

export function validateProject(project) {
  if (
    !project ||
    typeof project !== "object" ||
    typeof project.id !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project.id) ||
    typeof project.title !== "string" ||
    !project.title.trim() ||
    project.title.length > 80 ||
    !Array.isArray(project.photos) ||
    project.photos.length < 1 ||
    project.photos.length > 100 ||
    !project.photos.every(isBlobUrl) ||
    project.cover !== project.photos[0] ||
    (project.model !== undefined && !isBlobUrl(project.model)) ||
    (project.faceModel !== undefined && !isBlobUrl(project.faceModel))
  ) {
    return false;
  }
  return true;
}

async function listProjectRecords() {
  const records = [];
  let cursor;
  let hasMore = true;
  while (hasMore) {
    const page = await list({
      prefix: PROJECT_RECORD_PREFIX,
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    });
    records.push(...page.blobs.filter((blob) => blob.pathname.endsWith("/project.json")));
    cursor = page.cursor;
    hasMore = page.hasMore;
  }
  return records;
}

export async function getProjects() {
  const records = await listProjectRecords();
  const projects = await Promise.all(records.map(async (record) => {
    const response = await fetch(record.downloadUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Could not read project record (${response.status}).`);
    }
    return response.json();
  }));
  return projects.sort((first, second) =>
    (first.createdAt || "").localeCompare(second.createdAt || "")
  );
}

export async function saveProject(project) {
  if (!validateProject(project)) {
    throw new Error("The project details or uploaded asset URLs are invalid.");
  }

  const record = {
    ...project,
    categories: Array.isArray(project.categories) ? project.categories :
      (typeof project.category === "string" ? [project.category] : []),
    description: "A new eyewear design concept, shown from multiple product views.",
    createdAt: new Date().toISOString(),
  };
  await put(`${PROJECT_RECORD_PREFIX}${project.id}/project.json`, JSON.stringify(record), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: false,
    contentType: "application/json",
  });
  return record;
}
