"""List files visible to one specialist."""

from langchain_core.tools import tool

from app.tools._workspace import effective_roots, workspace_root


def make_list_project_files(allowed_roots: tuple[str, ...]):
    @tool("list_project_files")
    def list_project_files() -> str:
        """List up to 150 files in your assigned project areas."""
        files: list[str] = []
        workspace = workspace_root().resolve()
        for root in effective_roots(allowed_roots):
            directory = (workspace / root).resolve()
            if not directory.is_relative_to(workspace):
                continue
            if directory.is_file():
                files.append(directory.relative_to(workspace).as_posix())
                continue
            if not directory.exists():
                continue
            for path in directory.rglob("*"):
                if path.is_file() and path.resolve().is_relative_to(workspace) and not any(
                    part in {".git", ".venv", "node_modules", "dist", "__pycache__"}
                    for part in path.parts
                ):
                    files.append(path.relative_to(workspace).as_posix())
        return "\n".join(sorted(set(files))[:150]) or "No files found."

    return list_project_files
