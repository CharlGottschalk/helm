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

The **Context window** and **Tokens today** values at the bottom of the panel are
examples. They do not show your real usage.

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
