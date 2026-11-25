# AI Use Declaration

During the development of Wdrunge, the team used generative AI tools, including ChatGPT, Claude and OpenAI Codex, primarily for agent prompt refinement, code development and debugging, and technical documentation. AI-generated content was reviewed, revised and validated by team members before being incorporated into the project.

As the project was developed iteratively, AI-assisted interactions were distributed across different team members' development environments, tools and individual sessions. Some interactions took place during routine code modifications and debugging and were not centrally archived. Consequently, some original prompts and exact model versions cannot be fully recovered. The following are representative prompts retrospectively reconstructed from actual development tasks:

1. Refine the Leader Agent's system prompt to clarify task decomposition, dependencies and role assignment rules, reducing unnecessary delegation and repeated calls.
2. Review the tool permissions of each agent. Ensure that the Product and Designer agents cannot execute development commands, while the Frontend and Testing agents can perform necessary browser verification.
3. Investigate repeated file reads and accumulated message history in the context management mechanism. Improve the context compression strategy to reduce unnecessary token consumption.
4. Review error handling for failed model API calls and improve retry, fallback model selection and safe stopping mechanisms.
5. Review element selection, region selection and batch annotation in the website preview, and resolve inconsistent selection states after page navigation.
6. Update the README based on the actual source code and configuration files, including environment requirements, model configuration, startup commands and testing procedures.

These prompts are retrospective summaries of development tasks rather than verbatim records of the original interactions. The complete runtime agent prompts and model configuration used by Wdrunge are included in the submitted source code.

All team members share responsibility for the accuracy and completeness of the submitted code, experimental results and report.
