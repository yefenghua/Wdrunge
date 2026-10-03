"""Create a directory within a role's writable project scope."""

from pathlib import Path

from langchain_core.tools import tool

from app.tools._workspace import resolve_allowed


def make_create_project_directory(allowed_roots: tuple[str, ...]):
    @tool("create_project_directory")
    def create_project_directory(path: str) -> str:
        """Create a directory, including missing parents, inside the workspace."""
        target = resolve_allowed(path, allowed_roots)
        display_path = Path(path).as_posix()

        if target.is_dir():
            return f"Directory already exists: {display_path}"
        if target.exists():
            return f"Cannot create directory; a file already exists: {display_path}"

        try:
            target.mkdir(parents=True, exist_ok=False)
        except FileExistsError:
            if target.is_dir():
                return f"Directory already exists: {display_path}"
            return f"Cannot create directory; a file already exists: {display_path}"

        return f"Created directory: {display_path}"

    return create_project_directory
