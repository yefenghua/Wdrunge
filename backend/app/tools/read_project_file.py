"""Read a UTF-8 project file within a role's scope."""

from pathlib import Path

from langchain_core.tools import tool

from app.tools._workspace import resolve_allowed


MAX_READ_CHARACTERS = 30000
MAX_READ_LINES = 400


def make_read_project_file(allowed_roots: tuple[str, ...]):
    @tool("read_project_file")
    def read_project_file(
        path: str,
        start_line: int = 1,
        end_line: int | None = None,
    ) -> str:
        """Read a UTF-8 project file, optionally limiting the result to a line range.

        Paths are relative to the selected workspace and line numbers start at 1.
        Use a range for large files; at most 400 lines can be requested at once.
        """
        if start_line < 1:
            raise ValueError("start_line must be at least 1")
        if end_line is not None:
            if end_line < start_line:
                raise ValueError("end_line must be greater than or equal to start_line")
            if end_line - start_line + 1 > MAX_READ_LINES:
                raise ValueError(f"Read at most {MAX_READ_LINES} lines at once")

        target = resolve_allowed(path, allowed_roots)
        if not target.is_file():
            return f"File not found: {path}"
        try:
            content = target.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            return f"Not a UTF-8 text file: {path}"

        # Keep the original response shape for existing calls that only provide a path.
        if start_line == 1 and end_line is None:
            return content[:MAX_READ_CHARACTERS] + (
                "\n[truncated]" if len(content) > MAX_READ_CHARACTERS else ""
            )

        lines = content.splitlines()
        total_lines = len(lines)
        if start_line > total_lines:
            return f"Line range starts beyond end of file: {path} has {total_lines} lines."

        requested_end = end_line or start_line + MAX_READ_LINES - 1
        actual_end = min(requested_end, total_lines)
        width = len(str(actual_end))
        body = "\n".join(
            f"{line_number:>{width}} | {lines[line_number - 1]}"
            for line_number in range(start_line, actual_end + 1)
        )
        if len(body) > MAX_READ_CHARACTERS:
            body = body[:MAX_READ_CHARACTERS] + "\n[truncated by character limit]"

        display_path = Path(path).as_posix()
        return (
            f"File: {display_path}\n"
            f"Lines: {start_line}-{actual_end} of {total_lines}\n\n"
            f"{body}"
        )

    return read_project_file
