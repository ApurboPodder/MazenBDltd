import { getProjects, isUploadAuthorized, saveProject } from "../lib/vercel-projects.js";

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");

  if (request.method === "GET") {
    try {
      response.status(200).json(await getProjects());
    } catch (error) {
      console.error("Could not list Vercel-hosted projects", error);
      response.status(500).json({ error: "Project storage is unavailable. Check the Vercel Blob configuration." });
    }
    return;
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "GET, POST");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  if (!isUploadAuthorized(request)) {
    response.status(401).json({ error: "The upload password is incorrect or not configured." });
    return;
  }

  try {
    const project = await saveProject(request.body);
    response.status(201).json(project);
  } catch (error) {
    if (error.message?.includes("already exists")) {
      response.status(409).json({ error: "A project with that name was just published. Try again with a different name." });
      return;
    }
    console.error("Could not save Vercel project details", error);
    response.status(400).json({ error: error.message || "The project could not be saved." });
  }
}
