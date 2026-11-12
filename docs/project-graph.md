# Project graph

The project graph shows the files of a linked project as nodes, and how the files
relate as lines: imports, calls and references. Agents query the same graph instead of
reading the whole codebase. The project graph needs TDT 0.1.15 or later.

TDT builds the graph with [graphify](https://github.com/Graphify-Labs/graphify), a
local tool that parses code with tree-sitter. Helm only reads the graph through TDT.

> Helm's graphify integration is community-built and is not affiliated with or
> endorsed by Graphify Labs. "graphify" is a mark of Graphify Labs.

## Generate a graph

1. Open a project. See the **Project graph** section.
2. Click **Generate graph**. If the project already has a graph, the button is
   **Rebuild graph**.

Helm hands `/tdt-project-graph <project id>` to your host (Claude Code or Codex) in a
new session. Helm does not run graphify. The agent:

- checks that graphify 0.9.107 or later is installed. If it is not, the agent shows
  `pipx install graphifyy` and stops.
- asks whether to run the docs pass. The docs pass reads CLAUDE.md, AGENTS.md and other
  documents with an LLM and costs tokens. The default is no: the code pass only, which
  uses no tokens.
- installs graphify's git hook, so the code graph refreshes after each commit.

When the session is done, open the project again. The section shows when the graph was
built, and the **Project graph** button opens it.

The **Project graph** section is not shown when TDT is older than 0.1.15, or when the
project's source location is not available.

## Read the graph

Each file kind has a colour: **Code**, **Instructions** (CLAUDE.md, AGENTS.md, as
diamonds) and **Docs**. Instruction and doc files appear only when the docs pass was
used. Each line colour is a relation group: **Imports** (imports, re-exports, dynamic
imports), **Calls**, **References** and **Declares / extends**.

To hide a file kind or a relation group, click it in the legend. Click it again to
show it.

Under the stats bar, Helm shows when the graph was built, the graphify version, and
whether the graph is code only. If graphify's git hook is not installed, Helm warns
that the graph may be stale after commits. To refresh it, click **Rebuild graph** on
the project.

Move around the graph as in the [brain graph](brain-graph.md#move-around).

## Search and inspect

Type in **Search files and symbols…**. Helm finds files by path and by the symbols
they declare. Press Enter to select the first result.

Click a node to see the file path, its symbols (TDT sends up to 50; Helm shows
"+N more" for the rest) and its connections. **Ask Helm** starts a chat about the file.

## If the graph does not load

- "The project graph needs TDT 0.1.15 or newer (tdt_project_graph).": update TDT, then
  click **Retry**.
- "TDT returned a project graph schema this Helm does not support.": update Helm or
  TDT, then click **Retry**.
- "Couldn't load the project graph: …": read the cause, correct it, then click
  **Retry**.

## Offline mode

In offline mode, the sample project shows a sample graph. The status is SAMPLE DATA.
