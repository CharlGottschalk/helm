# Sessions and chat

Helm does not run a model. When you send a chat message or start a build, Helm hands
it off to Claude Code or Codex. The host runs in a terminal on your computer. This
running host is a **session**.

## Select the host

In the chat dock, use **Hand off to** to select **Claude Code** or **Codex**. Helm
keeps your choice. The default comes from `defaultHost` in
[Configuration](configuration.md).

## Send a chat message

1. Click the chat dock at the bottom of the window, or press `/`.
2. Type your message, or click a suggestion.
3. Press Enter, or click **Send**.

Helm starts the host with your message and opens the session in a new tab. On a
project tab, Helm adds the project name and ID to the message.

You can also click **+** (**New chat**) in the tab bar. A chat tab opens. Messages in
that tab also go to the host.

The chat dock is not shown on chat, terminal, session and record tabs.

If Helm is in [offline mode](troubleshooting.md#offline-mode), it cannot start a host.
Helm then opens a chat tab and keeps your message. Start the server, and send the
message again.

## The Sessions panel

The **Sessions** panel on the right lists your sessions. To show or hide it, click
**Show sessions** or **Hide sessions** in the tab bar.

| Section | Contents |
| --- | --- |
| Agent sessions | Sessions that Helm started, with their host and status |
| Open chats | Your open chat tabs |
| Recent | Earlier sessions |

The **N live** badge counts the sessions that are running or waiting.

## Context window

The header of a session Helm started shows how full the agent's context window is,
for example **Context 42.8k / 200k · 21%**. The meter turns amber at 75% and red at 90%.

- **Claude Code:** Helm's status line saves the session's token count after each response.
- **Codex:** Helm reads the latest token count in the session's own Codex log
  (`~/.codex/sessions`). Only numbers reach the browser, never messages.

Before the first response, or when there is no source, it shows **Context —** with the
reason. An ended session keeps its last value. Sessions started outside Helm don't show it.

## Usage limits

The bottom of the Sessions panel shows how much of your Claude Code and Codex plan
limits you have used:

- Each host shows its **5-hour** window as a percentage, with a meter.
- Point to a host, or click it, to see the **weekly** window and when each window
  resets.
- The meter turns amber at 75% and red at 90%.

These are percentages of your plan's limit, not token counts. They come from the
hosts themselves:

| Host | Source | How often |
| --- | --- | --- |
| Claude Code | Claude's usage service, with Claude Code's own login | Every 15 minutes, and when you return to Helm after 5 minutes |
| Claude Code, in a session that Helm started | The numbers Claude Code gives the session's status line | Within seconds, while the session runs |
| Codex | `codex app-server` | Every 5 minutes, and when you return to Helm after 1 minute |

Helm never signs in for you and never changes your Claude Code login. If that login
has expired, Helm shows the last known values until Claude Code next runs and renews
it. A host that is not installed or not signed in shows **—** with the reason.

Sessions that Helm starts with Claude Code use Helm's status line. It saves the usage
numbers, then shows your own status line from `~/.claude/settings.json` if you have
one. Status lines set in a project's settings are not shown in these sessions.

To turn the usage limits off, open **Settings → Appearance** and turn off **Show
agent usage limits**. Helm then stops asking the hosts. Offline, the panel shows
sample values, marked **Sample data**.

## Token usage

**Token usage** (in the left sidebar, or **Report** next to the usage limits) shows
how many tokens Claude Code and Codex used on this machine. It counts every session,
not only the ones that Helm started.

- Choose **Day**, **Week** or **Month**, and use **‹** and **›** to go to earlier
  periods. Weeks start on Monday. In **Day**, use **Yesterday** or pick any date.
  In **Week** and **Month**, click a day's bar to open that day.
- **New tokens** is the main number: fresh input, cache writes and output.
- **Cache reads** are counted separately. They are earlier context that the host
  sends again with each request, so they are usually far larger than everything
  else.
- The list shows the heaviest **Sessions**, **Projects** or **Models** first.
  Projects are shown by folder name. A session that Helm started links to its
  session view.

The numbers come from the hosts' own transcript files:

| Host | Files |
| --- | --- |
| Claude Code | `~/.claude/projects/` (or `$CLAUDE_CONFIG_DIR/projects/`), including subagents |
| Codex | `~/.codex/sessions/` and `~/.codex/archived_sessions/` (or under `$CODEX_HOME`) |

Claude Code writes one response on several lines, and a resumed session copies
earlier responses, so Helm counts each response once. A session whose transcript
was deleted no longer appears. Lines that Helm cannot read are skipped, and the
report says how many. Costs are not shown. Offline, the report shows sample
values, marked **Sample data**.

## Session status

| Status | Meaning |
| --- | --- |
| starting | Helm is starting the host |
| running | The host is working |
| waiting | The host did not write output for 6 seconds |
| exited | The host stopped with exit code 0 |
| failed | The host stopped with an error, or it did not start |

"waiting" can mean that the host asks you a question. It can also mean that the host
finished its turn. Open the session to see which.

## The session view

Click a session to open it. The session view shows the prompt, the host, the project,
the task and the exit code.

- Click **Open live chat** to see the terminal of the session. Answer the questions
  of the host there. Helm never answers for you.
- When the session ends, its terminal closes. The view stays available.
- A build session also shows the handoff that the build skill writes, in the
  **Handoff** panel.

Helm keeps the last 200 ended sessions in `~/.helm/sessions/`.

## Builds

A build starts the TDT software-production build skill for one task:
`/tdt-software-production-build <project> <task>` in Claude Code, or
`$tdt-software-production-build <project> <task>` in Codex.

Builds start from a plugin, for example the Kanban board of
`helm-plugin-software-production`. See [Plugins](plugins.md). Before a plugin starts a
build or a chat, Helm asks you to allow it. Helm does not read task files itself. The
build skill reads the task again and refuses work that is not ready.

## Terminals

To open a terminal in the workspace folder, click **Terminal** in the **Tools** group
of the left rail. A **Terminal** tab opens.

- The terminal starts in the workspace folder. It is not sandboxed: you can go to
  other folders, and commands run with your user permissions.
- On Linux and macOS, Helm uses `$SHELL`, or `/bin/bash`. On Windows, Helm uses
  `%COMSPEC%`, or `powershell.exe`.
- Terminals need node-pty. See [Troubleshooting](troubleshooting.md#install-scripts).
