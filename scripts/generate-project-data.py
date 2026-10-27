import argparse
import json
import re
from pathlib import Path
from urllib.parse import quote


ROOT = Path(__file__).resolve().parent.parent


def natural_sort_key(value):
    return [
        (1, int(part)) if part.isdigit() else (0, part.casefold())
        for part in re.split(r"(\d+)", value)
    ]


def model_sort_key(path):
    name = path.name.casefold()
    if name == "glb1.glb":
        return (0, [])
    if name == "glb2.glb":
        return (1, [])
    return (2, natural_sort_key(name))


def create_slug(value):
    slug = re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")
    return slug or "project"


def encoded_asset_path(path):
    return quote(path.as_posix(), safe="/")


def generate_projects(projects):
    known_folders = {
        project.get("sourceFolder")
        for project in projects
        if isinstance(project, dict) and isinstance(project.get("sourceFolder"), str)
    }
    project_ids = {
        project.get("id")
        for project in projects
        if isinstance(project, dict) and isinstance(project.get("id"), str)
    }

    for project in projects:
        source_folder = project.get("sourceFolder") if isinstance(project, dict) else None
        if not isinstance(source_folder, str):
            continue
        folder = ROOT / source_folder
        if not folder.is_dir():
            continue
        models = sorted(
            (path for path in folder.iterdir() if path.is_file() and path.suffix.casefold() == ".glb"),
            key=model_sort_key,
        )
        if models:
            project["model"] = encoded_asset_path(models[0].relative_to(ROOT))
            if len(models) > 1:
                project["faceModel"] = encoded_asset_path(models[1].relative_to(ROOT))
            else:
                project.pop("faceModel", None)
            if len(models) > 1 and isinstance(project.get("faceVariants"), dict):
                project["faceVariants"]["faceHidden"] = encoded_asset_path(models[0].relative_to(ROOT))
                project["faceVariants"]["faceVisible"] = encoded_asset_path(models[1].relative_to(ROOT))

    covers_root = ROOT / "assets" / "gallery-covers"
    if not covers_root.is_dir():
        raise FileNotFoundError(f"Project folder not found: {covers_root}")

    for folder in sorted(covers_root.iterdir(), key=lambda item: natural_sort_key(item.name)):
        if not folder.is_dir():
            continue
        source_folder = folder.relative_to(ROOT).as_posix()
        if source_folder in known_folders:
            continue

        images = sorted(
            (path for path in folder.iterdir() if path.is_file() and path.suffix.casefold() == ".webp"),
            key=lambda item: natural_sort_key(item.name),
        )
        if not images:
            continue

        base_id = create_slug(folder.name)
        project_id = base_id
        suffix = 2
        while project_id in project_ids:
            project_id = f"{base_id}-{suffix}"
            suffix += 1

        image_paths = [encoded_asset_path(path.relative_to(ROOT)) for path in images]
        project = {
            "id": project_id,
            "title": folder.name,
            "category": "Eyewear design",
            "description": "A new eyewear design concept, shown from multiple product views.",
            "cover": image_paths[0],
            "photos": image_paths,
            "sourceFolder": source_folder,
        }
        models = sorted(
            (path for path in folder.iterdir() if path.is_file() and path.suffix.casefold() == ".glb"),
            key=model_sort_key,
        )
        if models:
            project["model"] = encoded_asset_path(models[0].relative_to(ROOT))
            if len(models) > 1:
                project["faceModel"] = encoded_asset_path(models[1].relative_to(ROOT))
        projects.append(project)
        project_ids.add(project_id)
        known_folders.add(source_folder)

    return projects


def main():
    parser = argparse.ArgumentParser(
        description="Add gallery projects discovered in assets/gallery-covers folders."
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=ROOT / "project-data.json",
        help="Project data JSON to read.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=ROOT / "project-data.json",
        help="Generated project data JSON to write.",
    )
    arguments = parser.parse_args()

    projects = json.loads(arguments.input.read_text(encoding="utf-8"))
    if not isinstance(projects, list):
        raise ValueError(f"{arguments.input} must contain a JSON array.")

    generated_projects = generate_projects(projects)
    arguments.output.write_text(
        f"{json.dumps(generated_projects, indent=2, ensure_ascii=False)}\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
