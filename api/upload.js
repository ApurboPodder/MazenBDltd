import { handleUpload } from "@vercel/blob/client";
import { isUploadAuthorized } from "../lib/vercel-projects.js";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const jsonResponse = await handleUpload({
      body: request.body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!isUploadAuthorized(request)) {
          throw new Error("The upload password is incorrect or not configured.");
        }
        if (!/^projects\/[a-z0-9]+(?:-[a-z0-9]+)*\/(?:images|models)\/[a-zA-Z0-9._-]+$/.test(pathname)) {
          throw new Error("The uploaded file path is invalid.");
        }
        const isModel = pathname.toLowerCase().endsWith(".glb");
        const isImage = pathname.toLowerCase().endsWith(".webp");
        if (!isImage && !isModel) throw new Error("Only WebP images and GLB models can be uploaded.");

        return {
          addRandomSuffix: false,
          allowedContentTypes: [isImage ? "image/webp" : "model/gltf-binary"],
          maximumSizeInBytes: isImage ? 10 * 1024 * 1024 : 70 * 1024 * 1024,
        };
      },
    });
    response.status(200).json(jsonResponse);
  } catch (error) {
    console.error("Could not authorize Vercel Blob upload", error);
    response.status(400).json({ error: error.message || "The upload could not be authorized." });
  }
}
