import pytest

from app.tools import _workspace
from app.tools.create_project_directory import make_create_project_directory
from app.tools.list_project_files import make_list_project_files
from app.tools.read_project_file import make_read_project_file
from app.tools.replace_project_text import make_replace_project_text
from app.tools.write_project_file import make_write_project_file


def test_file_tool_stays_within_role_scope(tmp_path, monkeypatch):
    monkeypatch.setattr(_workspace, "WORKSPACE_ROOT", tmp_path)
    write = make_write_project_file(("docs/product",))

    assert "Wrote" in write.invoke(
        {"path": "docs/product/spec.md", "content": "hello"}
    )
    assert (tmp_path / "docs/product/spec.md").read_text() == "hello"

    with pytest.raises(ValueError):
        write.invoke({"path": "../outside.md", "content": "no"})
    with pytest.raises(ValueError):
        write.invoke({"path": "backend/app/main.py", "content": "no"})


def test_selected_workspace_is_used_by_file_tools(tmp_path):
    token = _workspace.active_workspace.set(tmp_path)
    try:
        write = make_write_project_file(("docs/product",))
        read = make_read_project_file(("docs/product",))
        listing = make_list_project_files(("docs/product",))

        assert "Wrote" in write.invoke(
            {"path": "src/hello.txt", "content": "selected workspace"}
        )
        assert read.invoke({"path": "src/hello.txt"}) == "selected workspace"
        assert "src/hello.txt" in listing.invoke({})

        with pytest.raises(ValueError):
            write.invoke({"path": "../outside.txt", "content": "no"})
    finally:
        _workspace.active_workspace.reset(token)


def test_write_project_file_preserves_supplied_line_endings(tmp_path):
    token = _workspace.active_workspace.set(tmp_path)
    try:
        write = make_write_project_file((".",))

        write.invoke({"path": "example.py", "content": "first\nsecond\n"})

        assert (tmp_path / "example.py").read_bytes() == b"first\nsecond\n"
    finally:
        _workspace.active_workspace.reset(token)


def test_read_project_file_supports_line_ranges(tmp_path):
    token = _workspace.active_workspace.set(tmp_path)
    try:
        source = tmp_path / "src" / "example.py"
        source.parent.mkdir()
        source.write_text("first\n第二行\nthird\nfourth\n", encoding="utf-8")
        read = make_read_project_file(("src",))

        result = read.invoke(
            {"path": "src/example.py", "start_line": 2, "end_line": 3}
        )

        assert "File: src/example.py" in result
        assert "Lines: 2-3 of 4" in result
        assert "2 | 第二行" in result
        assert "3 | third" in result
        assert "1 | first" not in result
        assert "4 | fourth" not in result
    finally:
        _workspace.active_workspace.reset(token)


def test_read_project_file_keeps_default_full_file_behavior(tmp_path):
    token = _workspace.active_workspace.set(tmp_path)
    try:
        source = tmp_path / "notes.txt"
        source.write_text("hello\nworld", encoding="utf-8")
        read = make_read_project_file((".",))

        assert read.invoke({"path": "notes.txt"}) == "hello\nworld"
    finally:
        _workspace.active_workspace.reset(token)


@pytest.mark.parametrize(
    ("start_line", "end_line"),
    [(0, 1), (-1, 2), (3, 2), (1, 401)],
)
def test_read_project_file_rejects_invalid_line_ranges(
    tmp_path, start_line, end_line
):
    token = _workspace.active_workspace.set(tmp_path)
    try:
        (tmp_path / "example.py").write_text("one\ntwo\nthree", encoding="utf-8")
        read = make_read_project_file((".",))

        with pytest.raises(ValueError):
            read.invoke(
                {
                    "path": "example.py",
                    "start_line": start_line,
                    "end_line": end_line,
                }
            )
    finally:
        _workspace.active_workspace.reset(token)


def test_create_project_directory_creates_nested_directories(tmp_path):
    token = _workspace.active_workspace.set(tmp_path)
    try:
        create_directory = make_create_project_directory(("src",))

        result = create_directory.invoke({"path": "src/features/blog"})

        assert result == "Created directory: src/features/blog"
        assert (tmp_path / "src" / "features" / "blog").is_dir()
    finally:
        _workspace.active_workspace.reset(token)


def test_create_project_directory_is_idempotent(tmp_path):
    token = _workspace.active_workspace.set(tmp_path)
    try:
        target = tmp_path / "src" / "existing"
        target.mkdir(parents=True)
        create_directory = make_create_project_directory(("src",))

        result = create_directory.invoke({"path": "src/existing"})

        assert result == "Directory already exists: src/existing"
        assert target.is_dir()
    finally:
        _workspace.active_workspace.reset(token)


def test_create_project_directory_rejects_file_conflict(tmp_path):
    token = _workspace.active_workspace.set(tmp_path)
    try:
        target = tmp_path / "src" / "conflict"
        target.parent.mkdir()
        target.write_text("keep me", encoding="utf-8")
        create_directory = make_create_project_directory(("src",))

        result = create_directory.invoke({"path": "src/conflict"})

        assert result == "Cannot create directory; a file already exists: src/conflict"
        assert target.read_text(encoding="utf-8") == "keep me"
    finally:
        _workspace.active_workspace.reset(token)


def test_create_project_directory_enforces_scope_and_workspace(tmp_path):
    token = _workspace.active_workspace.set(tmp_path)
    try:
        create_directory = make_create_project_directory(("docs/product",))

        with pytest.raises(ValueError):
            create_directory.invoke({"path": "../outside"})
    finally:
        _workspace.active_workspace.reset(token)


def test_replace_project_text_changes_only_the_expected_block(tmp_path):
    token = _workspace.active_workspace.set(tmp_path)
    try:
        source = tmp_path / "src" / "app.py"
        source.parent.mkdir()
        source.write_text(
            'HEADER\n\ndef hello():\n    return "hello"\n\nFOOTER\n',
            encoding="utf-8",
        )
        replace = make_replace_project_text(("src",))

        result = replace.invoke(
            {
                "path": "src/app.py",
                "old_text": 'def hello():\n    return "hello"',
                "new_text": 'def hello(name):\n    return f"hello {name}"',
            }
        )

        assert "Replaced 1 occurrence" in result
        assert "lines 3-4" in result
        assert source.read_text(encoding="utf-8") == (
            'HEADER\n\ndef hello(name):\n    return f"hello {name}"\n\nFOOTER\n'
        )
    finally:
        _workspace.active_workspace.reset(token)


@pytest.mark.parametrize("newline", [b"\n", b"\r\n"])
def test_replace_project_text_preserves_existing_line_endings(tmp_path, newline):
    token = _workspace.active_workspace.set(tmp_path)
    try:
        source = tmp_path / "example.py"
        source.write_bytes(
            newline.join(
                [b"def greeting():", b'    return "hello"', b""]
            )
        )
        replace = make_replace_project_text((".",))

        result = replace.invoke(
            {
                "path": "example.py",
                "old_text": 'def greeting():\n    return "hello"',
                "new_text": 'def greeting(name):\n    return f"hello {name}"',
            }
        )

        assert "Replaced 1 occurrence" in result
        assert source.read_bytes() == newline.join(
            [b"def greeting(name):", b'    return f"hello {name}"', b""]
        )
    finally:
        _workspace.active_workspace.reset(token)


@pytest.mark.parametrize(
    ("content", "old_text", "expected", "found"),
    [
        ("alpha\nbeta\n", "missing", 1, 0),
        ("same\nsame\n", "same", 1, 2),
    ],
)
def test_replace_project_text_refuses_unexpected_match_counts(
    tmp_path, content, old_text, expected, found
):
    token = _workspace.active_workspace.set(tmp_path)
    try:
        source = tmp_path / "example.txt"
        source.write_text(content, encoding="utf-8")
        replace = make_replace_project_text((".",))

        result = replace.invoke(
            {
                "path": "example.txt",
                "old_text": old_text,
                "new_text": "changed",
                "expected_replacements": expected,
            }
        )

        assert f"expected {expected}, found {found}" in result
        assert source.read_text(encoding="utf-8") == content
    finally:
        _workspace.active_workspace.reset(token)


def test_replace_project_text_can_replace_an_explicit_number_of_matches(tmp_path):
    token = _workspace.active_workspace.set(tmp_path)
    try:
        source = tmp_path / "example.txt"
        source.write_text("old\nkeep\nold\n", encoding="utf-8")
        replace = make_replace_project_text((".",))

        result = replace.invoke(
            {
                "path": "example.txt",
                "old_text": "old",
                "new_text": "new",
                "expected_replacements": 2,
            }
        )

        assert "Replaced 2 occurrences" in result
        assert source.read_text(encoding="utf-8") == "new\nkeep\nnew\n"
    finally:
        _workspace.active_workspace.reset(token)


@pytest.mark.parametrize("expected_replacements", [0, -1])
def test_replace_project_text_rejects_invalid_arguments(
    tmp_path, expected_replacements
):
    token = _workspace.active_workspace.set(tmp_path)
    try:
        (tmp_path / "example.txt").write_text("hello", encoding="utf-8")
        replace = make_replace_project_text((".",))

        with pytest.raises(ValueError):
            replace.invoke(
                {
                    "path": "example.txt",
                    "old_text": "hello",
                    "new_text": "hi",
                    "expected_replacements": expected_replacements,
                }
            )
        with pytest.raises(ValueError):
            replace.invoke(
                {
                    "path": "example.txt",
                    "old_text": "",
                    "new_text": "hi",
                }
            )
    finally:
        _workspace.active_workspace.reset(token)


def test_replace_project_text_reports_missing_and_non_utf8_files(tmp_path):
    token = _workspace.active_workspace.set(tmp_path)
    try:
        replace = make_replace_project_text((".",))

        assert replace.invoke(
            {"path": "missing.txt", "old_text": "old", "new_text": "new"}
        ) == "File not found: missing.txt"

        (tmp_path / "binary.bin").write_bytes(b"\xff\xfe\xfd")
        assert replace.invoke(
            {"path": "binary.bin", "old_text": "old", "new_text": "new"}
        ) == "Not a UTF-8 text file: binary.bin"
    finally:
        _workspace.active_workspace.reset(token)


def test_file_tool_rejects_symlink_escape(tmp_path):
    token = _workspace.active_workspace.set(tmp_path)
    try:
        link = tmp_path / "link"
        try:
            link.symlink_to(tmp_path.parent, target_is_directory=True)
        except OSError as error:
            if getattr(error, "winerror", None) == 1314:
                pytest.skip(
                    "Windows symlink creation requires Developer Mode or elevated privileges"
                )
            raise

        write = make_write_project_file(("docs/product",))
        with pytest.raises(ValueError):
            write.invoke({"path": "link/escape.txt", "content": "no"})
    finally:
        _workspace.active_workspace.reset(token)
