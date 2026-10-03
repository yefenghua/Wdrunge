"""Replace an exact text block within a role's writable project scope."""

from pathlib import Path

from langchain_core.tools import tool

from app.tools._workspace import resolve_allowed


MAX_FILE_CHARACTERS = 100000


def _normalize_newlines(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n")


def _preferred_newline(text: str) -> str:
    crlf_count = text.count("\r\n")
    lf_count = text.count("\n") - crlf_count
    cr_count = text.count("\r") - crlf_count
    counts = ((crlf_count, "\r\n"), (lf_count, "\n"), (cr_count, "\r"))
    count, newline = max(counts, key=lambda item: item[0])
    return newline if count else "\n"


def _use_newline(text: str, newline: str) -> str:
    return _normalize_newlines(text).replace("\n", newline)


def make_replace_project_text(allowed_roots: tuple[str, ...]):
    @tool("replace_project_text")
    def replace_project_text(
        path: str,
        old_text: str,
        new_text: str,
        expected_replacements: int = 1,
    ) -> str:
        """Replace exact text only when its match count equals the expected count.

        Read the relevant file first and include enough surrounding text to make
        old_text unique. The file is left unchanged when the count does not match.
        """
        if not old_text:
            raise ValueError("old_text must not be empty")
        if expected_replacements < 1:
            raise ValueError("expected_replacements must be at least 1")

        target = resolve_allowed(path, allowed_roots)
        display_path = Path(path).as_posix()
        if not target.is_file():
            return f"File not found: {display_path}"

        try:
            with target.open("r", encoding="utf-8", newline="") as file:
                content = file.read()
        except UnicodeDecodeError:
            return f"Not a UTF-8 text file: {display_path}"

        newline = _preferred_newline(content)
        replacement_old = old_text
        actual_replacements = content.count(replacement_old)
        if actual_replacements != expected_replacements:
            newline_adjusted_old = _use_newline(old_text, newline)
            newline_adjusted_count = content.count(newline_adjusted_old)
            if newline_adjusted_count == expected_replacements:
                replacement_old = newline_adjusted_old
                actual_replacements = newline_adjusted_count

        if actual_replacements != expected_replacements:
            return (
                f"Replacement refused for {display_path}: expected "
                f"{expected_replacements}, found {actual_replacements}. "
                "Read the file again and provide a more specific old_text block."
            )

        replacement_new = _use_newline(new_text, newline)
        updated = content.replace(
            replacement_old, replacement_new, expected_replacements
        )
        if len(updated) > MAX_FILE_CHARACTERS:
            return (
                f"Replacement refused for {display_path}: resulting file exceeds "
                f"{MAX_FILE_CHARACTERS} characters."
            )

        first_match = content.index(replacement_old)
        start_line = len(content[:first_match].splitlines()) + 1
        end_line = start_line + _normalize_newlines(replacement_old).count("\n")
        with target.open("w", encoding="utf-8", newline="") as file:
            file.write(updated)

        occurrence_label = (
            "occurrence" if expected_replacements == 1 else "occurrences"
        )
        line_label = (
            f" at line {start_line}"
            if start_line == end_line
            else f" at lines {start_line}-{end_line}"
        )
        return (
            f"Replaced {expected_replacements} {occurrence_label} in "
            f"{display_path}{line_label}."
        )

    return replace_project_text
