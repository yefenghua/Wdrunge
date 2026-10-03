"""Create or replace a text file within a role's assigned directories."""

from langchain_core.tools import tool

from app.tools._workspace import resolve_allowed


def make_write_project_file(allowed_roots: tuple[str, ...]):
    @tool("write_project_file")
    def write_project_file(path: str, content: str) -> str:
        """Write a complete UTF-8 project file at a path relative to the selected workspace."""
        target = resolve_allowed(path, allowed_roots)
        if len(content) > 100000:
            return "File is too large; keep content under 100000 characters."
        if target.exists() and not target.is_file():
            return f"Not a regular file: {path}"
        target.parent.mkdir(parents=True, exist_ok=True)
        # newline="" prevents Windows from rewriting every LF as CRLF.
        with target.open("w", encoding="utf-8", newline="") as file:
            file.write(content)
        return f"Wrote {path} ({len(content)} characters)."

    return write_project_file
