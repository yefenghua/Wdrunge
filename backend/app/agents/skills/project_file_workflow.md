Project file workflow:

- Use `list_project_files` to discover relevant files and `read_project_file` to inspect the latest content before editing.
- Use `create_project_directory` when an explicit directory should exist before files are added.
- Use `write_project_file` for new files or an intentional complete rewrite only.
- For an existing file, prefer `replace_project_text` with an exact block copied from the latest read result so unrelated content is preserved.
- If `replace_project_text` refuses a change because the match count differs, read the file again and make `old_text` more specific. Do not bypass the refusal by overwriting the whole file.
- Report only paths that a tool confirmed were changed, and run the available project checks when the assignment requires verification.
